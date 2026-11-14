import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Profile } from "./types.ts";
import { delay } from "./client.ts";

class CommandFailed extends Error {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  constructor(message: string, exitCode: number | null, timedOut: boolean) {
    super(message); this.exitCode = exitCode; this.timedOut = timedOut;
  }
}
export class PollerRunFailed extends Error {}

export function command(
  binary: string,
  args: string[],
  signal: AbortSignal,
  timeout: number,
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(binary, args, {
      signal,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    child.stdin.on("error", () => {}); // SSH can close stdin early when authentication fails.
    child.stdin.end(input);
    let output = "";
    let timedOut = false;
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      child.kill("SIGTERM");
      hardKill = setTimeout(() => child.kill("SIGKILL"), 2000);
      hardKill.unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeout);
    signal.addEventListener("abort", terminate, { once: true });
    // Output can contain infrastructure secrets: only JSON consumed internally is returned.
    child.stdout.on("data", (b) => {
      output += b.toString();
      if (output.length > 4_000_000) child.kill("SIGTERM");
    });
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      clearTimeout(hardKill);
      signal.removeEventListener("abort", terminate);
      reject(
        new Error(
          `${binary}: no disponible o ejecución cancelada. Revisar la configuración del poller.`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(hardKill);
      signal.removeEventListener("abort", terminate);
      if (code !== 0 || timedOut)
        reject(
          new CommandFailed(
            `${binary}: ${timedOut ? "tiempo agotado" : "falló el ejecutor o el acceso al entorno"}. Revisar sus logs en la infraestructura.`,
            code, timedOut,
          ),
        );
      else resolve(output);
    });
  });
}
const quote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
function sshConfig(p: Profile) {
  if (p.pollerMode !== "ssh") throw new Error("Falta configurar SSH para ejecutar el poller de este ambiente.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(p.sshHost) ||
      !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(p.sshUser) ||
      !Number.isSafeInteger(p.sshPort) || p.sshPort < 1 || p.sshPort > 65535 ||
      !/^[a-z0-9][a-z0-9-]*$/.test(p.namespace) || !/^[a-z0-9][a-z0-9-]*$/.test(p.cronjob))
    throw new Error("Destino SSH del poller inválido.");
  for (const [name, file] of [["clave privada", p.sshIdentityFile], ["known_hosts", p.sshKnownHostsFile]]) {
    try {
      if (!path.isAbsolute(file) || !fs.statSync(file).isFile()) throw new Error();
      fs.accessSync(file, fs.constants.R_OK);
    } catch { throw new Error(`No se puede leer ${name} de SSH en el servidor del panel. Revisar ruta y permisos.`); }
  }
}
function remote(p: Profile, args: string[], signal: AbortSignal, timeout: number, input?: string) {
  // OpenSSH invokes the remote shell: quote each argument even though no local shell is used.
  const cmd = ["kubectl", "--request-timeout=10s", "-n", p.namespace, ...args].map(quote).join(" ");
  return command("ssh", ["-F", "/dev/null", "-T", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=yes", "-o", "UpdateHostKeys=no", "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
    "-o", "UserKnownHostsFile=" + p.sshKnownHostsFile,
    "-i", p.sshIdentityFile, "-p", String(p.sshPort), p.sshUser + "@" + p.sshHost, cmd], signal, timeout, input);
}
export async function checkPoller(p: Profile, signal: AbortSignal) {
  if (p.pollerMode === "docker") {
    const active = await command(
      "docker",
      [
        "compose",
        "-f",
        p.composeFile,
        "ps",
        "--status",
        "running",
        "--services",
      ],
      signal,
      15000,
    );
    const services = active.trim().split(/\s+/);
    if (!services.includes("wildfly") || !services.includes("mongodb"))
      throw new Error(
        "El poller requiere WildFly y MongoDB locales levantados.",
      );
    return;
  }
  sshConfig(p);
  await remote(p, ["get", "cronjob", p.cronjob, "-o", "name"], signal, 15000);
  for (const verb of ["create", "get", "list", "delete"]) {
    const allowed = await remote(p, ["auth", "can-i", verb, "jobs"], signal, 15000);
    if (allowed.trim() !== "yes")
      throw new Error("El usuario Kubernetes remoto no tiene los permisos requeridos para ejecutar el poller.");
  }
}
export async function poller(
  p: Profile,
  signal: AbortSignal,
  log: (message: string) => void,
  options: { singleAttempt?: boolean } = {},
) {
  if (p.pollerMode === "docker") await checkPoller(p, signal);
  if (p.pollerMode === "docker") {
    const args = ["compose", "-f", p.composeFile];
    const active = await command(
      "docker",
      [...args, "ps", "--status", "running", "--services"],
      signal,
      15000,
    );
    const running = await command(
      "docker",
      [
        "ps",
        "--filter",
        "label=com.docker.compose.service=fiscalizacionautomatica-poller",
        "--format",
        "{{.ID}}",
      ],
      signal,
      15000,
    );
    if (running.trim()) throw new Error("Ya hay un poller local ejecutándose.");
    if (!active.trim()) throw new Error("El Central local no está levantado.");
    log("Ejecutando poller local.");
    // -T is necessary for a non-interactive server; never invokes a shell.
    const name = "panel-poller-" + crypto.randomUUID().slice(0, 8);
    try {
      await command(
        "docker",
        [
          ...args,
          "run",
          "--name",
          name,
          "--rm",
          "--no-deps",
          "-T",
          "fiscalizacionautomatica-poller",
        ],
        signal,
        p.pollerTimeoutMs,
      );
    } catch (error) {
      if (error instanceof CommandFailed && !error.timedOut && error.exitCode !== null && !signal.aborted)
        throw new PollerRunFailed("El proceso del poller terminó con error.");
      throw error;
    } finally {
      await command(
        "docker",
        ["rm", "-f", name],
        AbortSignal.timeout(15000),
        15000,
      ).catch(() => {});
    }
    return;
  }
  sshConfig(p);
  const call = (more: string[], s = signal, t = p.pollerTimeoutMs, input?: string) =>
    remote(p, more, s, t, input);
  // Check ALL jobs, including CronJob jobs and manually created jobs.
  const jobs = JSON.parse(
    await call(["get", "jobs", "-o", "json"], signal, 15000),
  ) as {
    items: {
      metadata: {
        name: string;
        ownerReferences?: { name: string }[];
        labels?: Record<string, string>;
      };
      status?: {
        active?: number;
        conditions?: { type: string; status: string }[];
      };
      spec?: { template?: { metadata?: { labels?: Record<string, string> } } };
    }[];
  };
  const busy = jobs.items.some(
    (j) =>
      (j.metadata.name.startsWith(p.cronjob) ||
        j.metadata.name.startsWith("panel-poller-") ||
        j.metadata.ownerReferences?.some((o) => o.name === p.cronjob) ||
        j.spec?.template?.metadata?.labels?.app === p.cronjob) &&
      !j.status?.conditions?.some(
        (c) =>
          (c.type === "Complete" || c.type === "Failed") && c.status === "True",
      ),
  );
  if (busy)
    throw new Error(
      "Ya hay un Job del poller pendiente o ejecutándose. Esperar a que termine.",
    );
  const cron = JSON.parse(
    await call(["get", "cronjob", p.cronjob, "-o", "json"], signal, 15000),
  ) as { spec: { suspend?: boolean } };
  // A scheduled run may start at the next minute. Reserve enough room for this manual run.
  if (!cron.spec.suspend) {
    const remaining =
      (30 - (new Date().getUTCMinutes() % 30)) * 60000 -
      new Date().getUTCSeconds() * 1000;
    if (remaining < p.pollerTimeoutMs + 15000)
      throw new Error(
        "Se aproxima la ejecución programada del poller. Esperar o suspender el CronJob durante la demo.",
      );
  }
  const name = "panel-poller-" + crypto.randomUUID().slice(0, 8);
  let creationAttempted = false;
  log("Creando Job del poller en el cluster del Central por SSH.");
  try {
    const creation = ["create", "job", name, "--from=cronjob/" + p.cronjob];
    // Build the existing CronJob template remotely and send it back via stdin, not a local filename.
    const manifest = JSON.parse(await call([...creation, "--dry-run=client", "-o", "json"], signal, 15000));
    if (options.singleAttempt) manifest.spec.backoffLimit = 0;
    manifest.spec.activeDeadlineSeconds = Math.ceil(p.pollerTimeoutMs / 1000);
    manifest.spec.ttlSecondsAfterFinished = 3600;
    creationAttempted = true; // A lost SSH response does not mean Kubernetes did not create the Job.
    await call(["create", "-f", "-"], signal, 15000, JSON.stringify(manifest));
    const deadline = Date.now() + p.pollerTimeoutMs;
    while (Date.now() < deadline) {
      const job = JSON.parse(
        await call(["get", "job", name, "-o", "json"], signal, 15000),
      ) as { status?: { conditions?: { type: string; status: string }[] } };
      const cs = job.status?.conditions ?? [];
      if (cs.some((c) => c.type === "Failed" && c.status === "True"))
        throw new PollerRunFailed("El Job del poller falló. Consultar sus logs.");
      if (cs.some((c) => c.type === "Complete" && c.status === "True")) {
        log("Poller completado.");
        return;
      }
      await delay(1000, signal);
    }
    throw new Error("El Job del poller agotó el tiempo de espera.");
  } finally {
    if (creationAttempted) {
      // Delete only the Job created by this execution; never a scheduled Job.
      await call(
        ["delete", "job", name, "--ignore-not-found=true", "--wait=true", "--timeout=10s"],
        AbortSignal.timeout(15000),
        15000,
      ).catch(() => { throw new Error(`No se pudo eliminar por SSH el Job ${name}; revisar su estado antes de repetir.`); });
    }
  }
}
