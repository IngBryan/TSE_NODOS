import { Client, delay } from "./client.ts";
import type { ConcurrentControls } from "./concurrent-demo.ts";
import { followTrip } from "./live-trip.ts";
import { followInfractions } from "./infractions.ts";
import { resumeDetour } from "./detour.ts";
import { save } from "./store.ts";
import type { Profile, Run, StreamKey } from "./types.ts";

/** Preparation is exclusive; all live GPS and the scale poller then overlap. */
export async function allDemo(run: Run, p: Profile, signal: AbortSignal,
  controls: ConcurrentControls, weigh: () => Promise<void>, log: (message: string) => void) {
  const c = new Client(p, signal);
  const initial = await c.state();
  if (!initial.capabilities?.includes("per-gps-control-v1") || initial.trackingOn || initial.pendingMessages || initial.flushing)
    throw new Error("Tracking debe estar preparado, detenido y sin mensajes pendientes para iniciar los tres GPS.");
  run.concurrent = {
    live: { status: "ejecutando", message: "Iniciando viaje de seguimiento" },
    detour: { status: "ejecutando", message: "Continuando desvío preparado" },
    infractions: { status: "ejecutando", message: "Iniciando sin guía y sin habilitación" },
  };
  const detour = run.steps.find(s => s.scenario === "desvio")!;
  const weight = run.steps.find(s => s.scenario === "carga")!;
  for (const step of run.steps) {
    step.status = step.scenario === "carga" ? "pendiente" : "ejecutando";
    step.message = step.scenario === "carga" ? "Esperando los tres GPS para registrar el pesaje" : "Esperando evidencia nueva";
  }
  save(run);
  const ids: Record<StreamKey, number> = { live: p.liveGps, detour: p.gpsWithGuide, infractions: p.gpsWithoutGuide };
  const plate = (key: StreamKey) => key === "live" ? p.livePlate : key === "detour" ? p.plateWithGuide : p.plateWithoutGuide;
  const ownSignals = Object.fromEntries((Object.keys(ids) as StreamKey[]).map(key =>
    [key, AbortSignal.any([signal, controls[key]!.signal])])) as Record<StreamKey, AbortSignal>;
  const monitor = async (key: StreamKey, fn: (own: AbortSignal) => Promise<void>) => {
    const stream = run.concurrent![key]!;
    const own = ownSignals[key];
    const steps = run.steps.filter(s => key === "detour" ? s.scenario === "desvio"
      : key === "infractions" ? ["sin_guia", "habilitacion"].includes(s.scenario) : false);
    let status: typeof stream.status = "completado";
    let message = "Recorrido finalizado y recibido en Central.";
    try {
      await fn(own);
      if (own.aborted) message = "GPS detenido por el operador; evidencia conservada.";
    } catch (error) {
      status = own.aborted ? steps.length && steps.every(s => s.status === "detectado") ? "completado" : "cancelado" : "fallido";
      message = own.aborted ? "GPS detenido por el operador; evidencia conservada."
        : error instanceof Error ? error.message : "Falló este GPS.";
      for (const step of steps) if (step.status !== "detectado") {
        step.status = own.aborted ? "cancelado" : "fallido";
        step.message = message;
      }
    } finally {
      stream.message = "Deteniendo este GPS y comprobando sus mensajes pendientes.";
      save(run);
      try {
        const final = new Client(p);
        await final.stopGps(ids[key]);
        const device = (await final.state()).configuredDevices.find(d => d.gpsId === ids[key]);
        if (stream.startedAt && device) {
          stream.emitted = Math.max(0, (device.emittedPoints ?? 0) - (stream.emittedOffset ?? 0));
          stream.brokerConfirmed = Math.max(0, (device.confirmedPoints ?? 0) - (stream.emittedOffset ?? 0));
          const movement = run.steps.find(s => s.scenario === "sin_guia");
          // Without a no-guide case there is no Central read API for this GPS yet.
          // A stop before confirmation remains cancelled, never reported as success.
          if (key !== "infractions" || movement?.caseId) {
            const deadline = Date.now() + p.timeoutMs;
            do {
              const points = key === "infractions"
                ? await final.positions(movement!.caseId!, undefined, ids[key])
                : await final.tripPositions(stream.startedAt, new Date(Date.now() + 1).toISOString(), key === "live" ? p.liveGuideId : p.guideId);
              const own = points.filter(v => v.gpsId === ids[key] && Date.parse(v.fechaHora) >= Date.parse(stream.startedAt!));
              stream.received = new Set(own.map(v => v.messageId)).size;
              stream.lastAt = own.at(-1)?.fechaHora;
              if (key === "live" && run.live) { run.live.receivedCount = stream.received; run.live.lastAt = stream.lastAt; }
              if (stream.received >= stream.emitted && (!stream.emitted || own.some(v => v.messageId === device.lastMessageId))) break;
              if (Date.now() >= deadline) throw new Error("Central no confirmó la última posición del GPS detenido.");
              await delay(p.pollMs);
            } while (true);
          }
        }
      } catch (error) {
        status = "fallido";
        message += ` ${error instanceof Error ? error.message : "No se pudo confirmar la parada."}`;
      }
      stream.status = status;
      stream.message = message;
      save(run);
      log(`${plate(key)}: ${message}`);
    }
  };
  const monitors = [
    monitor("live", own => followTrip(run, p, own, log, true)),
    monitor("infractions", own => followInfractions(run, p, own, log)),
    monitor("detour", own => resumeDetour(run, p, detour, own, log, true)),
  ];
  const weighing = async () => {
    const start = Date.now();
    try {
      const deadline = start + p.timeoutMs;
      do {
        signal.throwIfAborted();
        if ((Object.keys(ids) as StreamKey[]).some(key => ownSignals[key].aborted || run.concurrent![key]!.status !== "ejecutando"))
          throw new Error("No se registró el pesaje porque uno de los GPS se detuvo antes de iniciar la ejecución conjunta.");
        const state = await c.state();
        if (Object.values(ids).every(id => state.configuredDevices.some(d => d.gpsId === id && d.running))) break;
        if (Date.now() >= deadline) throw new Error("No se confirmó el arranque conjunto de los tres GPS; no se registró el pesaje.");
        await delay(p.pollMs, signal);
      } while (true);
      log(`Los tres GPS están activos. Registrando el pesaje de ${p.plateWithGuide} mientras continúan reportando.`);
      weight.status = "ejecutando";
      weight.message = "Registrando pesaje y ejecutando poller de Balanzas";
      save(run);
      await weigh();
      weight.status = "detectado";
      weight.message = "Pesaje nuevo confirmado en Central; los GPS siguen reportando.";
      log(`Exceso de carga: expediente ${weight.caseId} confirmado.`);
    } catch (error) {
      const cancelled = signal.aborted || (weight.status === "pendiente" && Object.values(ownSignals).some(s => s.aborted));
      weight.status = cancelled ? "cancelado" : "fallido";
      weight.message = cancelled ? "Pesaje cancelado por el operador." : error instanceof Error ? error.message : "Falló el pesaje.";
      log(weight.message);
    } finally {
      weight.durationMs = Date.now() - start;
      save(run);
    }
  };
  // All branches settle before global restoration; one failure cannot stop a sibling GPS.
  await Promise.all([...monitors, weighing()]);
  const failures = [...Object.values(run.concurrent!).filter(s => s?.status === "fallido").map(s => s!.message),
    ...run.steps.filter(s => s.status === "fallido").map(s => s.message)];
  if (failures.length) throw new Error([...new Set(failures)].join("; "));
}
