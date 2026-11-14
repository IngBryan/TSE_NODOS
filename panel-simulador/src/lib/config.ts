import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Profile, Target } from "./types.ts";

export function profile(target: Target): Profile {
  const cloud = target === "elasticcloud";
  const defaults: Profile = {
    centralUrl: cloud
      ? "https://env-6537388.web.elasticloud.uy/frontofficefuncionarios-web/api"
      : "http://localhost:8081/frontofficefuncionarios-web/api",
    trackingUrl: cloud
      ? "https://tracking-bryan-salamone-dev.apps.rm1.0a51.p1.openshiftapps.com"
      : "http://localhost:3000",
    balanzasUrl: cloud
      ? "https://balanzas-bryan-salamone-dev.apps.rm1.0a51.p1.openshiftapps.com"
      : "http://localhost:3001",
    platformUrl: cloud
      ? "https://env-6537388.web.elasticloud.uy/funcionarios"
      : "http://localhost:8080/funcionarios",
    apiKey: "",
    funcionarioCi: "54074380",
    trackingClientId: "tracking-admin",
    trackingClientSecret: "",
    balanzasClientId: "componente-central",
    balanzasClientSecret: "",
    osrmUrl: "https://router.project-osrm.org",
    gpsWithoutGuide: 1,
    plateWithoutGuide: "SBC1234",
    gpsWithGuide: 2,
    plateWithGuide: "STU5678",
    guideId: "GV-FISC001",
    liveGuideId: "GV-LT00001",
    livePlate: "LT00001",
    liveGps: 100001,
    liveOrigin: [-56.2, -34.9],
    liveDestination: [-54.95, -34.9],
    scaleId: 4,
    excessKg: 50000,
    origin: [-56.2, -34.9],
    destination: [-54.95, -34.9],
    waypoint: [-57.817183, -33.5096],
    timeoutMs: 180000,
    deviationTimeoutMs: 300000,
    pollMs: 2000,
    requestTimeoutMs: 15000,
    pollerMode: cloud ? "ssh" : "docker",
    composeFile: path.resolve(process.cwd(), "../../TSE_CENTRAL/docker-compose.yml"),
    sshHost: cloud ? "gate.elasticloud.uy" : "",
    sshPort: 3022,
    sshUser: cloud ? "6255-648" : "",
    sshIdentityFile: path.join(os.homedir(), ".ssh/ale_id_ed25519"),
    sshKnownHostsFile: path.join(os.homedir(), ".ssh/known_hosts"),
    namespace: "tse",
    cronjob: "fiscalizacionautomatica-poller",
    pollerTimeoutMs: 180000,
  };
  const file = process.env.PANEL_CONFIG_FILE;
  let source = {};
  try {
    source = file
      ? (JSON.parse(fs.readFileSync(path.resolve(file), "utf8"))[target] ?? {})
      : {};
  } catch {
    throw new Error(
      "No se pudo leer el archivo privado de configuración. Revisar su ruta y formato JSON.",
    );
  }
  const p = { ...defaults, ...source } as Profile;
  const prefix = cloud ? "CLOUD_" : "LOCAL_";
  for (const key of Object.keys(defaults) as (keyof Profile)[]) {
    const envName =
      prefix + key.replace(/[A-Z]/g, (m) => "_" + m).toUpperCase();
    const value = process.env[envName];
    if (value === undefined) continue;
    (p as unknown as Record<string, unknown>)[key] =
      typeof defaults[key] === "number"
        ? Number(value)
        : Array.isArray(defaults[key])
          ? JSON.parse(value)
          : value;
  }
  for (const key of [
    "centralUrl",
    "trackingUrl",
    "balanzasUrl",
    "osrmUrl",
    "platformUrl",
  ] as const) {
    const u = new URL(p[key]);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw new Error(`URL inválida: ${key}`);
    if (cloud && u.protocol !== "https:")
      throw new Error(`Elastic Cloud exige HTTPS: ${key}`);
    p[key] = p[key].replace(/\/$/, "");
  }
  for (const key of [
    "timeoutMs",
    "deviationTimeoutMs",
    "pollMs",
    "requestTimeoutMs",
    "pollerTimeoutMs",
    "gpsWithoutGuide",
    "gpsWithGuide",
    "liveGps",
    "scaleId",
    "excessKg",
  ] as const) {
    if (!Number.isFinite(p[key]) || p[key] <= 0)
      throw new Error(`Valor inválido: ${key}`);
  }
  if (
    p.timeoutMs > 600000 ||
    p.deviationTimeoutMs > 600000 ||
    p.pollMs < 100 ||
    p.requestTimeoutMs > 60000 ||
    p.pollerTimeoutMs > 600000
  )
    throw new Error("Tiempos fuera del rango permitido.");
  if (!["disabled", "docker", "ssh"].includes(p.pollerMode))
    throw new Error("Modo de poller inválido.");
  if (cloud && p.pollerMode === "docker")
    throw new Error("Elastic Cloud requiere SSH para ejecutar su poller; Docker corresponde al Central local.");
  if (!Number.isSafeInteger(p.sshPort) || p.sshPort < 1 || p.sshPort > 65535)
    throw new Error("Puerto SSH inválido.");
  for (const key of ["origin", "destination", "waypoint", "liveOrigin", "liveDestination"] as const) {
    const v = p[key];
    if (
      !Array.isArray(v) ||
      v.length !== 2 ||
      !v.every(Number.isFinite) ||
      Math.abs(v[0]) > 180 ||
      Math.abs(v[1]) > 90
    )
      throw new Error(`Coordenadas inválidas: ${key}`);
  }
  if (
    !/^[a-z0-9][a-z0-9-]*$/.test(p.namespace) ||
    !/^[a-z0-9][a-z0-9-]*$/.test(p.cronjob)
  )
    throw new Error("Namespace o CronJob inválido.");
  return p;
}
export function missing(p: Profile) {
  return (
    [
      "apiKey",
      "funcionarioCi",
      "trackingClientId",
      "trackingClientSecret",
      "balanzasClientId",
      "balanzasClientSecret",
    ] as const
  ).filter((k) => !p[k]?.trim());
}
export function publicProfiles() {
  return (["local", "elasticcloud"] as const).map((id) => {
    try {
      const p = profile(id);
      return {
        id,
        name: id === "local" ? "Local" : "Elastic Cloud",
        missing: missing(p),
        platformUrl: p.platformUrl,
        centralUrl: p.centralUrl,
        trackingUrl: p.trackingUrl,
        balanzasUrl: p.balanzasUrl,
        pollerMode: p.pollerMode,
        guideId: p.guideId,
        liveGuideId: p.liveGuideId,
        livePlate: p.livePlate,
        liveGps: p.liveGps,
        plateWithoutGuide: p.plateWithoutGuide,
        plateWithGuide: p.plateWithGuide,
      };
    } catch {
      return {
        id,
        name: id === "local" ? "Local" : "Elastic Cloud",
        missing: ["configuración inválida"],
        platformUrl: "",
        pollerMode: "disabled",
      };
    }
  });
}
