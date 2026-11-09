#!/usr/bin/env node
/** One-shot admin utility: imports *exact* authorized geometries from the Central. */
const required = ['GUIA_ID', 'GPS_ID', 'CENTRAL_API_KEY', 'CENTRAL_FUNCIONARIO_CI', 'TRACKING_TOKEN'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(2);
}
const env = process.env;
const centralUrl = (env.CENTRAL_BASE_URL || 'http://localhost:8080/frontofficefuncionarios-web/api').replace(/\/$/, '');
const trackingUrl = (env.TRACKING_URL || 'http://localhost:3000').replace(/\/$/, '');
const scenario = env.TRACKING_SCENARIO || 'NORMAL_A';

/** Neutralizes CR/LF and other control characters so external data cannot forge log lines. */
function sanitizeForLog(value) {
  return Array.from(String(value), (ch) => {
    const code = ch.codePointAt(0);
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    return isControl ? " " : ch;
  }).join("");
}

async function jsonResponse(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const content = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).origin}: ${content.slice(0, 350)}`);
  try { return JSON.parse(content); }
  catch { throw new Error(`Expected JSON from ${new URL(url).origin}`); }
}

try {
  const url = `${centralUrl}/viajes/${encodeURIComponent(env.GUIA_ID)}/rutas-autorizadas`;
  const rutas = await jsonResponse(url, {
    headers: { 'X-Api-Key': env.CENTRAL_API_KEY, 'X-Usuario-Ci': env.CENTRAL_FUNCIONARIO_CI },
  });
  if (!Array.isArray(rutas) || rutas.length < 1) {
    throw new Error('The Central returned no authorized routes for this guide');
  }
  rutas.sort((a, b) => a.alternativa - b.alternativa);
  const authorizedRoutes = rutas.map((r) =>
    typeof r.geometriaGeoJson === 'string' ? JSON.parse(r.geometriaGeoJson) : r.geometriaGeoJson,
  );
  const config = { scenario, authorizedRoutes };
  if (scenario === 'DESVIO') {
    const via = (env.DESVIO_WAYPOINT || '').split(',').map(Number);
    if (via.length !== 2 || !via.every(Number.isFinite)
        || Math.abs(via[0]) > 180 || Math.abs(via[1]) > 90) {
      throw new Error('DESVIO requires DESVIO_WAYPOINT="longitude,latitude" on a real road away from the allowed corridor');
    }
    const base = authorizedRoutes[0];
    const start = base.coordinates[0];
    const end = base.coordinates.at(-1);
    const coordinate = (p) => `${p[0]},${p[1]}`;
    const osrm = (env.OSRM_BASE_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
    const osrmUrl = `${osrm}/route/v1/driving/${coordinate(start)};${coordinate(via)};${coordinate(end)}`
      + '?overview=full&geometries=geojson&steps=false';
    const response = await jsonResponse(osrmUrl);
    if (response.code !== 'Ok' || !response.routes?.[0]?.geometry) {
      throw new Error('OSRM could not find a road route through the specified detour waypoint');
    }
    config.deviationRoute = response.routes[0].geometry;
  }
  const configured = await jsonResponse(
    `${trackingUrl}/api/gps-devices/${encodeURIComponent(env.GPS_ID)}/scenario`,
    { method: 'PUT', headers: {
      Authorization: `Bearer ${env.TRACKING_TOKEN}`,
      'Content-Type': 'application/json',
    }, body: JSON.stringify(config) },
  );
  console.log(sanitizeForLog(`Scenario configured for GPS ${env.GPS_ID} Guide ${env.GUIA_ID}: `
    + JSON.stringify(configured.configuration)));
} catch (error) {
  const reason = error instanceof Error ? error.message : error;
  console.error(sanitizeForLog(`Cannot configure tracking scenario: ${reason}`));
  process.exitCode = 1;
}
