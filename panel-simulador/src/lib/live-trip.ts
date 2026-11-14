import { Client, delay } from "./client.ts";
import { save } from "./store.ts";
import type { Device, Line, Profile, Run } from "./types.ts";

/** Independent vehicle, real clock, existing Central read APIs only. */
export async function followTrip(run: Run, p: Profile, signal: AbortSignal, log: (message: string) => void, concurrent = false) {
  if (p.livePlate === p.plateWithGuide || p.liveGps === p.gpsWithGuide || p.liveGuideId === p.guideId)
    throw new Error("El seguimiento debe usar otra guía, otro vehículo y otro GPS que el desvío.");
  const c = new Client(p, signal);
  const state = await c.state();
  if ((concurrent ? !state.capabilities?.includes("per-gps-control-v1") : state.trackingOn || state.pendingMessages || state.flushing) || state.intervalSeconds !== 5)
    throw new Error("Tracking debe estar detenido, sin pendientes y con GPS cada 5 segundos.");
  const trip = await c.guide(p.liveGuideId);
  if (trip.vehiculo?.matricula !== p.livePlate || trip.fin
      || !["ASIGNADA", "EN_CURSO"].includes(trip.estado)
      || !Number.isFinite(Date.parse(trip.fechaAsignacion))
      || Date.parse(trip.fechaAsignacion) > Date.now()
      || (trip.inicio && (!Number.isFinite(Date.parse(trip.inicio)) || Date.parse(trip.inicio) > Date.now())))
    throw new Error("La guía de seguimiento debe estar activa para el vehículo configurado y con fechas vigentes.");
  for (const estado of ["ASIGNADA", "EN_CURSO"]) {
    const page = await c.central<{ viajes: { id: string }[]; total: number }>(
      `/viajes?matricula=${encodeURIComponent(p.livePlate)}&estado=${estado}&pagina=1&tamanio=100`);
    if (!Array.isArray(page.viajes) || page.total !== page.viajes.length || page.viajes.some(v => v.id !== p.liveGuideId))
      throw new Error("Hay otras guías activas para el vehículo de seguimiento.");
  }
  const authorized = await c.central<{ geometriaGeoJson: string }[]>(
    `/viajes/${encodeURIComponent(p.liveGuideId)}/rutas-autorizadas`);
  if (!Array.isArray(authorized) || authorized.length > 1)
    throw new Error("El seguimiento admite una sola ruta autorizada.");
  // Old seeded guides have no archived route. Use the explicitly configured road segment.
  const route: Line = authorized.length
    ? JSON.parse(authorized[0].geometriaGeoJson)
    : await c.route([p.liveOrigin, p.liveDestination]);
  const devices = await c.devices();
  const existing = devices.find(d => d.id === p.liveGps);
  if (existing && existing.licensePlate !== p.livePlate)
    throw new Error("El GPS dedicado está asignado a otra matrícula. Corregir la configuración; el panel no lo reasigna.");
  if (!existing && !state.capabilities?.includes("explicit-gps-id-v1"))
    throw new Error("Tracking necesita la versión que permite dar de alta el GPS dedicado con su ID de Central.");
  run.gpsBackup ??= devices;
  run.cleanupRequired = true;
  save(run);
  if (!existing) {
    const created = await c.node<Device>("tracking", "/api/gps-devices", "POST", {
      id: p.liveGps, licensePlate: p.livePlate, active: false,
    });
    devices.push(created);
    if (!run.gpsBackup.some(d => d.id === created.id)) run.gpsBackup.push(created);
    save(run);
    if (created.id !== p.liveGps || created.licensePlate !== p.livePlate || created.active)
      throw new Error("Tracking no confirmó el alta inactiva del GPS dedicado.");
  }
  for (const d of (concurrent ? devices.filter(d => d.id === p.liveGps) : devices)) await c.node("tracking", `/api/gps-devices/${d.id}`, "PUT", {
    licensePlate: d.licensePlate, active: d.id === p.liveGps,
  });
  const { configuration } = await c.node<{ configuration: { configurationId: string } }>("tracking", `/api/gps-devices/${p.liveGps}/scenario`, "PUT", {
    scenario: "NORMAL_A", authorizedRoutes: [route],
  });
  const since = new Date().toISOString();
  run.live = {
    guideId: p.liveGuideId, plate: p.livePlate, gpsId: p.liveGps,
    receivedCount: 0, startedAt: since, guideState: trip.estado,
  };
  if (run.concurrent) run.concurrent.live.startedAt = since;
  save(run);
  if (concurrent) await c.node("tracking", `/api/gps-devices/${p.liveGps}/simulation`, "PUT", {
    running: true, configurationId: configuration.configurationId,
  });
  else await c.node("tracking", "/api/tracking-on", "PUT", { trackingOn: true, simulationSpeedFactor: 1 });
  log(`Siguiendo ${p.livePlate} / ${p.liveGuideId} con GPS ${p.liveGps}, hora real y mediciones cada 5 s.${authorized.length ? " Ruta A de la guía." : " Tramo vial configurado: esta guía semilla no tiene una ruta archivada."}`);
  let cursor = since;
  let emptySince = Date.now();
  let endedAt: number | undefined;
  const seen = new Set<string>();
  do {
    const now = Date.now();
    const points = await c.tripPositions(cursor, new Date(now + 1).toISOString(), p.liveGuideId);
    const own = points.filter(v => v.gpsId === p.liveGps && !seen.has(v.messageId)
      && Date.parse(v.fechaHora) >= Date.parse(since) && Date.parse(v.fechaHora) <= Date.now());
    for (const point of own) seen.add(point.messageId);
    if (own.length) {
      emptySince = Date.now();
      run.live.receivedCount += own.length;
      // Retain a 30-second overlap to tolerate out-of-order persistence; UUIDs deduplicate it.
      const latest = Math.max(...own.map(v => Date.parse(v.fechaHora)), Date.parse(run.live.lastAt ?? since));
      run.live.lastAt = new Date(latest).toISOString();
      cursor = new Date(Math.max(Date.parse(since), latest - 30000)).toISOString();
      log(`${p.livePlate}: ${run.live.receivedCount} posiciones confirmadas en Central. Última: ${new Date(latest).toISOString()}.`);
    }
    if (Date.now() - emptySince > p.timeoutMs)
      throw new Error("Central dejó de confirmar posiciones del seguimiento. Revisar consumidor y asociación a la guía.");
    const current = await c.state();
    const device = current.configuredDevices.find(d => d.gpsId === p.liveGps);
    if (run.concurrent) {
      Object.assign(run.concurrent.live, { emitted: device?.emittedPoints ?? 0,
        brokerConfirmed: device?.confirmedPoints ?? 0, received: run.live.receivedCount, lastAt: run.live.lastAt });
      save(run);
    }
    if (concurrent ? !device?.running && !device?.pendingMessages : !current.trackingOn && !current.pendingMessages && !current.flushing) {
      endedAt ??= Date.now();
      const last = current.configuredDevices.find(d => d.gpsId === p.liveGps)?.lastMessageId;
      if (last && seen.has(last)) return;
      if (Date.now() - endedAt > p.timeoutMs)
        throw new Error("El recorrido terminó pero Central no confirmó su última posición.");
    }
    await delay(p.pollMs, signal);
  } while (true);
}
