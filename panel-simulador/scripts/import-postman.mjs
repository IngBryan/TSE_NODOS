import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2),
  profiles = {};
const map = {
  funcionarios_url: "centralUrl",
  funcionarios_api_key: "apiKey",
  funcionario_ci: "funcionarioCi",
  tracking_url: "trackingUrl",
  tracking_client_id: "trackingClientId",
  tracking_client_secret: "trackingClientSecret",
  balanzas_url: "balanzasUrl",
  balanzas_client_id: "balanzasClientId",
  balanzas_client_secret: "balanzasClientSecret",
  osrm_url: "osrmUrl",
  gps_sin_guia: "gpsWithoutGuide",
  matricula_sin_guia: "plateWithoutGuide",
  gps_con_guia: "gpsWithGuide",
  matricula_con_guia: "plateWithGuide",
  guia_id: "guideId",
  balanza_id: "scaleId",
  peso_exceso_kg: "excessKg",
  recorrido_origen: "origin",
  recorrido_destino: "destination",
  desvio_waypoint: "waypoint",
  espera_max_ms: "timeoutMs",
  espera_desvio_ms: "deviationTimeoutMs",
  intervalo_ms: "pollMs",
};
const nums = new Set([
  "gpsWithoutGuide",
  "gpsWithGuide",
  "scaleId",
  "excessKg",
  "timeoutMs",
  "deviationTimeoutMs",
  "pollMs",
]);
for (const [flag, id] of [
  ["--local", "local"],
  ["--cloud", "elasticcloud"],
]) {
  const index = args.indexOf(flag);
  if (index < 0) continue;
  if (!args[index + 1]) throw new Error("Falta ruta para " + flag);
  const env = JSON.parse(
    fs.readFileSync(path.resolve(args[index + 1]), "utf8"),
  );
  const p = {};
  for (const item of env.values ?? []) {
    const key = map[item.key];
    if (!key || item.enabled === false || item.value === "") continue;
    p[key] = nums.has(key)
      ? Number(item.value)
      : ["origin", "destination", "waypoint"].includes(key)
        ? JSON.parse(item.value)
        : item.value;
  }
  profiles[id] = p;
}
if (!Object.keys(profiles).length)
  throw new Error(
    "Uso: npm run import:postman -- --local /ruta/entorno.json --cloud /ruta/entorno.json",
  );
const dir = path.resolve(".local");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, "profiles.json");
const existing = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : {};
fs.writeFileSync(
  file,
  JSON.stringify({ ...existing, ...profiles }, null, 2) + "\n",
  { mode: 0o600 },
);
fs.chmodSync(file, 0o600);
const env = path.resolve(".env.local");
if (!fs.existsSync(env)) {
  fs.writeFileSync(
    env,
    "PANEL_CONFIG_FILE=.local/profiles.json\nPANEL_STATE_DIR=.local/state\n",
    { mode: 0o600 },
  );
} else {
  let text = fs.readFileSync(env, "utf8");
  if (!/^PANEL_CONFIG_FILE=/m.test(text)) {
    text += "\nPANEL_CONFIG_FILE=.local/profiles.json\n";
    fs.writeFileSync(env, text);
  }
}
fs.chmodSync(env, 0o600);
console.log(
  "Importados: " +
    Object.keys(profiles).join(", ") +
    ". Credenciales privadas guardadas en .local/profiles.json.",
);
console.log(
  "Configuración del panel en .env.local. No se imprimieron secretos.",
);
