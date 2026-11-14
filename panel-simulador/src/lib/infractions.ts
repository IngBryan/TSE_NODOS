import { Client, delay } from "./client.ts";
import { evidenceDates, freshEvidence } from "./evidence.ts";
import { save } from "./store.ts";
import { caseTypes, labels } from "./types.ts";
import type { Profile, Run } from "./types.ts";

export async function validateNoGuideContext(c: Client, p: Profile) {
  for (const estado of ["ASIGNADA", "EN_CURSO", "FINALIZADA"]) {
    const page = await c.central<{ viajes: { id: string }[]; total: number }>(
      `/viajes?matricula=${encodeURIComponent(p.plateWithoutGuide)}&estado=${estado}&pagina=1&tamanio=100`);
    if (!Array.isArray(page.viajes) || page.total !== page.viajes.length)
      throw new Error("No se pudo verificar el historial completo del vehículo sin guía.");
    if (estado !== "FINALIZADA" && page.total)
      throw new Error("El vehículo de sin guía debe estar libre de viajes activos.");
    for (const previous of page.viajes) {
      const trip = await c.guide(previous.id);
      if (!trip.fin || !Number.isFinite(Date.parse(trip.fin)) || Date.parse(trip.fin) > Date.now())
        throw new Error(`La guía histórica ${previous.id} no tiene un FIN válido. Completar sus eventos de las seeds antes del ensayo; Central rechazaría los GPS como NO_DETERMINABLE.`);
    }
  }
}

/** One GPS can establish both movement without a guide and invalid documents. */
export async function followInfractions(run: Run, p: Profile, signal: AbortSignal, log: (message: string) => void) {
  const c = new Client(p, signal);
  const stream = run.concurrent!.infractions!;
  const steps = run.steps.filter(s => s.scenario === "sin_guia" || s.scenario === "habilitacion");
  const baselines = new Map<string, Set<number>>();
  await validateNoGuideContext(c, p);
  const route = await c.route([p.origin, p.destination]);
  for (const step of steps) {
    const dates = new Set<number>();
    for (const old of await c.cases(caseTypes[step.scenario], p.plateWithoutGuide))
      for (const date of evidenceDates(await c.evidence(old.id))) dates.add(Date.parse(date));
    baselines.set(step.scenario, dates);
  }
  const devices = await c.devices();
  if (!devices.some(d => d.id === p.gpsWithoutGuide && d.licensePlate === p.plateWithoutGuide))
    throw new Error("El GPS no corresponde al vehículo sin guía.");
  await c.node("tracking", `/api/gps-devices/${p.gpsWithoutGuide}`, "PUT", {
    licensePlate: p.plateWithoutGuide, active: true,
  });
  const { configuration } = await c.node<{ configuration: { configurationId: string } }>(
    "tracking", `/api/gps-devices/${p.gpsWithoutGuide}/scenario`, "PUT", { scenario: "NORMAL_A", authorizedRoutes: [route] });
  const since = Date.now();
  stream.startedAt = new Date(since).toISOString();
  stream.emittedOffset = 0;
  save(run);
  await c.node("tracking", `/api/gps-devices/${p.gpsWithoutGuide}/simulation`, "PUT", {
    running: true, configurationId: configuration.configurationId,
  });
  log(`${p.plateWithoutGuide}: GPS activo; comprobando sin guía y sin habilitación sobre el mismo vehículo.`);
  const deadline = since + p.timeoutMs;
  do {
    signal.throwIfAborted();
    const state = await c.state();
    const device = state.configuredDevices.find(d => d.gpsId === p.gpsWithoutGuide);
    Object.assign(stream, { emitted: device?.emittedPoints ?? 0, brokerConfirmed: device?.confirmedPoints ?? 0 });
    for (const step of steps.filter(s => s.status !== "detectado")) {
      for (const candidate of await c.cases(caseTypes[step.scenario], p.plateWithoutGuide)) {
        const evidence = await c.evidence(candidate.id);
        const dates = freshEvidence(step.scenario, evidence, {
          type: caseTypes[step.scenario], plate: p.plateWithoutGuide, since,
          baseline: baselines.get(step.scenario)!, hashes: [],
        });
        if (!dates) continue;
        if (step.scenario === "sin_guia") {
          const positions = await c.positions(candidate.id, dates, p.gpsWithoutGuide);
          if (new Set(positions.map(v => v.fechaHora)).size < 2) continue;
          if (positions.some(v => !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.messageId)))
            throw new Error("Las posiciones de Central no conservan los UUID publicados por Tracking.");
        }
        Object.assign(step, { status: "detectado", caseId: candidate.id, dates, evidence,
          durationMs: Date.now() - since, message: "Evidencia nueva confirmada; el GPS sigue reportando." });
        log(`${labels[step.scenario]}: expediente ${candidate.id} confirmado para ${p.plateWithoutGuide}.`);
        break;
      }
    }
    const movement = steps.find(s => s.scenario === "sin_guia");
    if (movement?.caseId) {
      const points = (await c.positions(movement.caseId, undefined, p.gpsWithoutGuide))
        .filter(v => Date.parse(v.fechaHora) >= since && Date.parse(v.fechaHora) <= Date.now());
      stream.received = new Set(points.map(v => v.messageId)).size;
      stream.lastAt = points.at(-1)?.fechaHora;
    }
    stream.message = steps.every(s => s.status === "detectado")
      ? "Sin guía y sin habilitación confirmados. El GPS sigue reportando hasta que lo detengas."
      : "Esperando evidencia nueva de sin guía y sin habilitación.";
    save(run);
    if (steps.some(s => s.status !== "detectado") && Date.now() >= deadline)
      throw new Error("No se confirmaron ambos casos del vehículo sin guía dentro del tiempo de espera.");
    if (!device?.running && !device?.pendingMessages) {
      if (steps.some(s => s.status !== "detectado")) throw new Error("El GPS terminó antes de confirmar ambos casos.");
      return;
    }
    await delay(p.pollMs, signal);
  } while (true);
}
