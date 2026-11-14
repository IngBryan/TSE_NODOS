import fs from "node:fs";
import path from "node:path";
import type { Run } from "./types.ts";
export const stateDir = () =>
  path.resolve(process.env.PANEL_STATE_DIR ?? ".local/state");
const boot = Date.now() - process.uptime() * 1000;
const file = () => path.join(stateDir(), "run.json");
const lock = () => path.join(stateDir(), "execution.lock");
export function load(): Run | null {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("No se pudo leer el estado del panel.");
  }
}
export function save(run: Run) {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  run.updatedAt = new Date().toISOString();
  const tmp = file() + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(run), { mode: 0o600 });
  fs.renameSync(tmp, file());
}
export function lockAlive() {
  try {
    const l = JSON.parse(fs.readFileSync(lock(), "utf8")) as {
      pid: number;
      boot: number;
    };
    if (l.pid === process.pid) return Math.abs(l.boot - boot) < 2000;
    try {
      process.kill(l.pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("No se pudo comprobar el bloqueo de ejecución.");
  }
}
export function acquire() {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  if (lockAlive()) throw new Error("Ya hay una ejecución activa.");
  try {
    fs.unlinkSync(lock());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const fd = fs.openSync(lock(), "wx", 0o600);
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, boot }));
  fs.closeSync(fd);
}
export function release() {
  fs.rmSync(lock(), { force: true });
}
export function recover() {
  const run = load();
  if (run?.status === "ejecutando" && !lockAlive()) {
    run.status = "interrumpido";
    run.message =
      "El servidor se reinició. Revisar el resultado y usar Detener y restaurar antes de continuar.";
    if (run.resilience && !["verificado", "fallido", "cancelado"].includes(run.resilience.status)) {
      run.resilience.status = "fallido";
      run.resilience.message = "El panel se reinició. Recuperar Balanzas con Detener y restaurar; la interrupción también vence automáticamente.";
    }
    run.finishedAt = new Date().toISOString();
    for (const step of run.steps)
      if (step.status === "ejecutando") step.status = "fallido";
    if (run.concurrent) for (const stream of Object.values(run.concurrent))
      if (stream && ["pendiente", "ejecutando"].includes(stream.status)) {
        stream.status = "fallido";
        stream.message = "El servidor se reinició; restaurar antes de continuar.";
      }
    save(run);
  }
  return run;
}
