import { Client, delay } from "./client.ts";
import { followTrip } from "./live-trip.ts";
import { resumeDetour } from "./detour.ts";
import { save } from "./store.ts";
import type { Profile, Run } from "./types.ts";

export interface ConcurrentControls {
  live: AbortController;
  detour: AbortController;
  infractions?: AbortController;
  resume?: () => void;
}

/** One durable session, two independent GPS controllers and monitors. */
export async function concurrentDemo(run: Run, p: Profile, signal: AbortSignal,
  controls: ConcurrentControls, log: (message: string) => void) {
  if (p.liveGps === p.gpsWithGuide || p.livePlate === p.plateWithGuide || p.liveGuideId === p.guideId)
    throw new Error("Seguimiento y desvío requieren GPS, vehículo y guía distintos.");
  const c = new Client(p, signal);
  const state = await c.state();
  if (!state.capabilities?.includes("per-gps-control-v1") || state.trackingOn || state.pendingMessages || state.flushing)
    throw new Error("Se requiere Tracking con control por GPS, detenido y sin pendientes después de preparar.");
  run.concurrent = {
    live: { status: "ejecutando", message: "Iniciando GPS de seguimiento a 1x" },
    detour: { status: "pendiente", message: "Preparado y pausado; pulsar Reanudar desvío cuando quieras" },
  };
  const step = run.steps[0];
  save(run);
  const liveSignal = AbortSignal.any([signal, controls.live.signal]);
  const detourSignal = AbortSignal.any([signal, controls.detour.signal]);
  const gate = new Promise<void>((resolve, reject) => {
    const abort = () => reject(new Error("Desvío cancelado antes de reanudar."));
    if (detourSignal.aborted) return abort();
    detourSignal.addEventListener("abort", abort, { once: true });
    controls.resume = () => {
      detourSignal.removeEventListener("abort", abort);
      controls.resume = undefined;
      resolve();
    };
  });
  const monitor = async (key: "live" | "detour", gpsId: number, ownSignal: AbortSignal, fn: () => Promise<void>) => {
    const stream = run.concurrent![key];
    try {
      await fn();
      stream.status = "completado";
      stream.message = key === "detour"
        ? `Caso nuevo ${step.caseId} confirmado · GPS ${ownSignal.aborted ? "detenido por el operador" : "finalizado"}`
        : "Recorrido recibido en Central";
      if (key === "detour") { step.status = "detectado"; step.message = stream.message; }
    } catch (e) {
      stream.status = ownSignal.aborted ? "cancelado" : "fallido";
      stream.message = ownSignal.aborted ? "Detenido por el operador" : e instanceof Error ? e.message : "Falló este GPS";
      if (key === "detour") {
        if (step.status !== "detectado") step.status = ownSignal.aborted ? "cancelado" : "fallido";
        step.message = stream.message;
      }
    } finally {
      try {
        // This endpoint stops just this GPS; the other timer/run is preserved.
        const finalClient = new Client(p);
        await finalClient.stopGps(gpsId);
        const device = (await finalClient.state()).configuredDevices.find(d => d.gpsId === gpsId);
        if (stream.startedAt && device) {
          const expected = Math.max(0, (device.emittedPoints ?? 0) - (stream.emittedOffset ?? 0));
          stream.emitted = expected;
          stream.brokerConfirmed = Math.max(0, (device.confirmedPoints ?? 0) - (stream.emittedOffset ?? 0));
          const deadline = Date.now() + p.timeoutMs;
          do {
            const points = await finalClient.tripPositions(stream.startedAt, new Date(Date.now() + 1).toISOString(),
              key === "live" ? p.liveGuideId : p.guideId);
            const own = points.filter(v => v.gpsId === gpsId && Date.parse(v.fechaHora) >= Date.parse(stream.startedAt!));
            stream.received = new Set(own.map(v => v.messageId)).size;
            stream.lastAt = own.at(-1)?.fechaHora;
            if (stream.received >= expected && (!expected || own.some(v => v.messageId === device.lastMessageId))) break;
            if (Date.now() > deadline) throw new Error("Central no confirmó la última posición del GPS detenido");
            await delay(p.pollMs);
          } while (true);
          if (key === "live" && run.live) { run.live.receivedCount = stream.received; run.live.lastAt = stream.lastAt; }
        }
      } catch {
        stream.status = "fallido";
        stream.message += " · no se confirmó la entrega completa; revisar recepción y restaurar al finalizar";
      }
      save(run);
      log(`${key === "live" ? p.livePlate : p.plateWithGuide}: ${stream.message}.`);
    }
  };
  await Promise.all([
    monitor("live", p.liveGps, liveSignal, () => followTrip(run, p, liveSignal, log, true)),
    monitor("detour", p.gpsWithGuide, detourSignal, async () => {
      await gate;
      detourSignal.throwIfAborted();
      run.concurrent!.detour.status = "ejecutando";
      step.status = "ejecutando";
      step.message = "Esperando un caso nuevo de desvío";
      save(run);
      await resumeDetour(run, p, step, detourSignal, log, true);
    }),
  ]);
  controls.resume = undefined;
  const failed = Object.values(run.concurrent).filter(s => s.status === "fallido");
  if (failed.length) throw new Error(failed.map(s => s.message).join("; "));
}
