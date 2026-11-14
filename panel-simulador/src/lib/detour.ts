import { Client, delay } from "./client.ts";
import { freshEvidence } from "./evidence.ts";
import { save } from "./store.ts";
import type { Guide, Line, Profile, Run, Step, TrackingState } from "./types.ts";

type Log = (message: string) => void;
const context = (p: Profile) => JSON.stringify([
  p.centralUrl, p.trackingUrl, p.guideId, p.gpsWithGuide, p.plateWithGuide,
]);

async function cleanTrip(c: Client, p: Profile): Promise<Guide> {
  const trip = await c.guide();
  if (trip.vehiculo?.matricula !== p.plateWithGuide || trip.fin
      || !["ASIGNADA", "EN_CURSO"].includes(trip.estado)
      || !Number.isFinite(Date.parse(trip.fechaAsignacion))
      || (trip.inicio && !Number.isFinite(Date.parse(trip.inicio))))
    throw new Error("La guía debe estar activa, con asignación e inicio válidos.");
  if ((await c.cases("DESVIO_RUTA", p.plateWithGuide, p.guideId)).length)
    throw new Error("La guía ya tiene un caso de desvío. Elegir otra guía sin caso para demostrar una creación nueva.");
  // Existing read-only APIs suffice: never backdate or edit business data in Central.
  for (const estado of ["ASIGNADA", "EN_CURSO"]) {
    const page = await c.central<{ viajes: { id: string }[]; total: number }>(
      `/viajes?matricula=${encodeURIComponent(p.plateWithGuide)}&estado=${estado}&pagina=1&tamanio=100`);
    if (!Array.isArray(page.viajes) || !Number.isFinite(page.total)
        || page.total !== page.viajes.length || page.viajes.some(v => v.id !== p.guideId))
      throw new Error("Hay viajes activos ambiguos para la matrícula; dejar solo la guía del ensayo.");
  }
  return trip;
}

export async function prepareDetour(run: Run, p: Profile, signal: AbortSignal, log: Log) {
  const c = new Client(p, signal);
  const trip = await cleanTrip(c, p);
  const state = await c.state();
  if (!state.capabilities?.includes("bounded-preparation-v1"))
    throw new Error("Tracking necesita la versión con preparación y continuación. Redesplegar el nodo.");
  if (state.intervalSeconds !== 5 || state.trackingOn || state.pendingMessages || state.flushing)
    throw new Error("Tracking debe estar detenido, sin pendientes y con intervalo de 5 segundos.");
  const authorized = await c.central<{ geometriaGeoJson: string; sha256: string }[]>(
    `/viajes/${encodeURIComponent(p.guideId)}/rutas-autorizadas`);
  if (authorized.length !== 1 || !authorized[0].sha256)
    throw new Error("Se requiere exactamente una ruta A autorizada con hash.");
  const line = JSON.parse(authorized[0].geometriaGeoJson) as Line;
  if (line.type !== "LineString" || line.coordinates.length < 2) throw new Error("Ruta A inválida.");
  const route = await c.route([line.coordinates[0], p.waypoint, line.coordinates.at(-1)!]);
  const devices = await c.devices();
  if (!devices.some(d => d.id === p.gpsWithGuide && d.licensePlate === p.plateWithGuide))
    throw new Error("El GPS no corresponde al vehículo de la guía.");
  run.gpsBackup = devices;
  run.cleanupRequired = true;
  save(run);
  for (const d of devices) await c.node("tracking", `/api/gps-devices/${d.id}`, "PUT", {
    licensePlate: d.licensePlate, active: d.id === p.gpsWithGuide,
  });
  const { configuration: configured } = await c.node<{ configuration: TrackingState["configuredDevices"][number] }>(
    "tracking", `/api/gps-devices/${p.gpsWithGuide}/scenario`, "PUT", {
      scenario: "DESVIO", authorizedRoutes: [line], deviationRoute: route,
    });
  const plan = configured.preparation;
  if (!plan || !configured.configurationId)
    throw new Error("El recorrido no tiene un tramo inicial común suficiente con A. Cambiar el punto de desvío.");
  const earliest = Math.max(Date.parse(trip.fechaAsignacion), trip.inicio ? Date.parse(trip.inicio) : -Infinity);
  const minimumAgeMs = (plan.durationSeconds + state.intervalSeconds) * 1000;
  if (earliest > Date.now() - minimumAgeMs)
    throw new Error(`La guía/inicio aún no cubre el tramo histórico: necesita al menos ${Math.ceil(minimumAgeMs / 60000)} minutos de antigüedad. No se publicaron puntos.`);
  const expectedDuration = Math.ceil((plan.expectedPoints - 1) * 250 + 10000);
  if (expectedDuration > p.deviationTimeoutMs)
    throw new Error("La preparación a 20x supera el tiempo configurado. Ajustar deviationTimeoutMs antes de publicar.");
  const started = await c.node<TrackingState>("tracking", "/api/tracking-on", "PUT", {
    trackingOn: true, simulationSpeedFactor: 20, stopAtMeters: plan.stopAtMeters,
    configurationId: configured.configurationId,
  });
  const firstAt = started.simulatedStartAt;
  if (!firstAt || !Number.isFinite(Date.parse(firstAt)) || Date.parse(firstAt) < earliest)
    throw new Error("Tracking devolvió una ventana histórica fuera de la guía.");
  log(`Preparando ${plan.expectedPoints} puntos dentro de A a 20x; corte en ${(plan.stopAtMeters / 1000).toFixed(2)} km.`);
  let paused: TrackingState;
  const deadline = Date.now() + p.deviationTimeoutMs;
  do {
    await delay(p.pollMs, signal);
    paused = await c.state();
    if (!paused.trackingOn && !paused.flushing && !paused.pendingMessages) break;
    if (Date.now() >= deadline) throw new Error("La preparación no terminó dentro del tiempo de espera.");
  } while (true);
  const device = paused.configuredDevices.find(d => d.gpsId === p.gpsWithGuide);
  if (!paused.pausedAtBoundary || device?.configurationId !== configured.configurationId
      || device.lastReportedMeters == null || Math.abs(device.lastReportedMeters - plan.stopAtMeters) > 0.001
      || device.emittedPoints !== plan.expectedPoints || !device.lastMeasurementAt || !device.lastMessageId)
    throw new Error("Tracking no confirmó la pausa exacta del tramo preparado.");
  const lastAt = device.lastMeasurementAt;
  log("Tracking pausado. Comprobando que Central almacenó y asoció el tramo completo a la guía.");
  const ingestionDeadline = Date.now() + p.timeoutMs;
  do {
    const points = await c.tripPositions(firstAt, new Date(Date.parse(lastAt) + 1).toISOString());
    const own = points.filter(v => v.gpsId === p.gpsWithGuide);
    const times = new Set(own.map(v => Date.parse(v.fechaHora)));
    if (own.some(v => v.messageId === device.lastMessageId)
        && Array.from({ length: plan.expectedPoints }, (_, i) => Date.parse(firstAt) + i * 5000).every(t => times.has(t))) break;
    if (Date.now() >= ingestionDeadline) throw new Error("Central aún no confirmó todos los puntos del tramo previo.");
    await delay(p.pollMs, signal);
  } while (true);
  await cleanTrip(c, p);
  run.prepared = {
    context: context(p), configurationId: configured.configurationId, gpsId: p.gpsWithGuide,
    stopAtMeters: plan.stopAtMeters, expectedPoints: plan.expectedPoints, firstAt, lastAt,
    lastMessageId: device.lastMessageId, hashes: [authorized[0].sha256],
  };
  save(run);
  log("Tramo previo visible en Central. Preparado para continuar con hora real; todavía no hay caso de desvío.");
}

export async function resumeDetour(run: Run, p: Profile, step: Step, signal: AbortSignal, log: Log, concurrent = false) {
  const prepared = run.prepared;
  if (!prepared || prepared.context !== context(p))
    throw new Error("No hay una preparación válida para este ambiente, guía y GPS.");
  const c = new Client(p, signal);
  await cleanTrip(c, p);
  const state = await c.state();
  const d = state.configuredDevices.find(d => d.gpsId === prepared.gpsId);
  const active = (await c.devices()).filter(d => d.active);
  if ((concurrent ? !state.capabilities?.includes("per-gps-control-v1") || d?.running || d?.pendingMessages || !d?.pausedAtBoundary
      : state.trackingOn || state.pendingMessages || state.flushing || !state.pausedAtBoundary)
      || state.intervalSeconds !== 5 || d?.configurationId !== prepared.configurationId
      || d.lastMessageId !== prepared.lastMessageId || d.lastReportedMeters == null
      || Math.abs(d.lastReportedMeters - prepared.stopAtMeters) > 0.001
      || (!concurrent && active.length !== 1) || !active.some(a => a.id === prepared.gpsId && a.licensePlate === p.plateWithGuide))
    throw new Error("La preparación cambió o Tracking se reinició. Restaurar y preparar nuevamente.");
  const authorized = await c.central<{ sha256: string }[]>(`/viajes/${encodeURIComponent(p.guideId)}/rutas-autorizadas`);
  if (authorized.length !== 1 || !prepared.hashes.includes(authorized[0].sha256))
    throw new Error("La ruta autorizada cambió después de preparar.");
  const since = Date.now();
  if (concurrent && run.concurrent) Object.assign(run.concurrent.detour, {
    startedAt: new Date(since).toISOString(), emittedOffset: prepared.expectedPoints,
  });
  if (concurrent) await c.node("tracking", `/api/gps-devices/${prepared.gpsId}/simulation`, "PUT", {
    running: true, resume: true, configurationId: prepared.configurationId,
  });
  else await c.node("tracking", "/api/tracking-on", "PUT", {
    trackingOn: true, simulationSpeedFactor: 1, resume: true, configurationId: prepared.configurationId,
  });
  delete run.prepared;
  save(run);
  log("Continuando desde el corte a 1x, con timestamps actuales y GPS cada 5 segundos. Esperando un caso nuevo.");
  const deadline = Date.now() + p.deviationTimeoutMs;
  let detected = false;
  try {
    do {
      signal.throwIfAborted();
      const current = await c.state();
      const device = current.configuredDevices.find(d => d.gpsId === prepared.gpsId);
      if (concurrent && run.concurrent) {
        const points = await c.tripPositions(new Date(since).toISOString(), new Date(Date.now() + 1).toISOString());
        const own = points.filter(v => v.gpsId === prepared.gpsId && Date.parse(v.fechaHora) >= since && Date.parse(v.fechaHora) <= Date.now());
        Object.assign(run.concurrent.detour, { emitted: (device?.emittedPoints ?? prepared.expectedPoints) - prepared.expectedPoints,
          brokerConfirmed: Math.max(0, (device?.confirmedPoints ?? prepared.expectedPoints) - prepared.expectedPoints),
          received: new Set(own.map(v => v.messageId)).size, lastAt: own.at(-1)?.fechaHora });
        save(run);
      }
      if (!detected) for (const candidate of await c.cases("DESVIO_RUTA", p.plateWithGuide, p.guideId)) {
        const evidence = await c.evidence(candidate.id);
        const dates = freshEvidence("desvio", evidence, {
          type: "DESVIO_RUTA", plate: p.plateWithGuide, guide: p.guideId,
          since, baseline: new Set(), hashes: prepared.hashes,
        });
        if (!dates) continue;
        step.caseId = candidate.id;
        step.dates = dates;
        step.evidence = evidence;
        step.status = "detectado";
        step.message = `Caso ${candidate.id} confirmado. El GPS sigue reportando hasta que lo detengas.`;
        detected = true;
        if (concurrent && run.concurrent) run.concurrent.detour.message = step.message;
        save(run);
        log(step.message);
        break;
      }
      // Detection completes the assertion, not the trip. Keep publishing with the
      // real clock until the operator stops this GPS (or its route finishes).
      if (detected && (concurrent ? !device?.running && !device?.pendingMessages
        : !current.trackingOn && !current.pendingMessages && !current.flushing)) return;
      if (!detected && Date.now() >= deadline)
        throw new Error("No apareció un caso nuevo con dos mediciones de desvío posteriores a la continuación. Revisar distancia y umbral.");
      await delay(p.pollMs, signal);
    } while (true);
  } catch (error) {
    // An intentional stop preserves the successful assertion and its evidence.
    if (signal.aborted && detected) return;
    throw error;
  }
}
