import { Client, delay, HttpError } from "./client.ts";
import { poller, PollerRunFailed } from "./poller.ts";
import { save } from "./store.ts";
import type { Profile, Run } from "./types.ts";

const endpoint = "/api/simulation/availability";
interface Availability {
  unavailable: boolean;
  outageId: string | null;
  until: string | null;
  rejectedWeighingQueries: number;
}
export async function checkAvailability(c: Client) {
  let state: Availability;
  try { state = await c.node<Availability>("balanzas", endpoint); }
  catch { throw new Error("La prueba de resiliencia requiere actualizar Balanzas con el control de indisponibilidad y OAuth válido."); }
  if (typeof state.unavailable !== "boolean" || !Number.isSafeInteger(state.rejectedWeighingQueries))
    throw new Error("Balanzas no ofrece el control de indisponibilidad esperado.");
  if (state.unavailable) throw new Error("Balanzas ya tiene una interrupción activa; esperar su recuperación antes de probar.");
}
export async function restoreBalanzas(run: Run, p: Profile) {
  const r = run.resilience;
  if (!r?.restoreRequired) return;
  const c = new Client(p);
  const current = await c.node<Availability>("balanzas", endpoint);
  if (current.outageId === r.outageId) {
    const result = await c.node<Availability>("balanzas", endpoint, "PUT", { outageId: r.outageId, durationSeconds: 0 });
    if (result.unavailable) throw new Error("Balanzas sigue indisponible; repetir Detener y restaurar.");
  }
  // Another operator's lease is never changed, even after a lost response to our PUT.
  r.restoreRequired = false;
  run.cleanupRequired = !!run.gpsBackup || !!run.prepared;
  save(run);
}

/** Registering the weighing happens BEFORE this function. Recovery never submits it again. */
export async function exerciseOutage(run: Run, p: Profile, signal: AbortSignal, log: (message: string) => void,
  verifyPending: () => Promise<void>) {
  const r = run.resilience!;
  const c = new Client(p, signal);
  await checkAvailability(c);
  r.restoreRequired = true;
  run.cleanupRequired = true;
  save(run); // Journal ownership before making the fault active, including a lost HTTP response.
  try {
    const start = Date.now();
    const state = await c.node<Availability>("balanzas", endpoint, "PUT", { outageId: r.outageId, durationSeconds: 180 });
    if (!state.unavailable || state.outageId !== r.outageId) throw new Error("No se confirmó la interrupción de Balanzas.");
    r.status = "indisponible";
    r.until = state.until ?? undefined;
    r.message = "Balanzas devuelve 503. Ejecutando un intento del poller; los GPS continúan.";
    log(r.message);
    try {
      await c.node("balanzas", `/api/scales/${p.scaleId}`);
      throw new Error("Balanzas respondió correctamente durante la interrupción; no se verificó el 503.");
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 503)) throw error;
    }
    await verifyPending();
    let failed = false;
    try {
      await poller({ ...p, pollerTimeoutMs: Math.min(p.pollerTimeoutMs, 90000) }, signal, log, { singleAttempt: true });
    } catch (error) {
      if (signal.aborted || !(error instanceof PollerRunFailed)) throw error;
      failed = true;
    }
    const after = await c.node<Availability>("balanzas", endpoint);
    if (!failed || !after.unavailable || after.outageId !== r.outageId || after.rejectedWeighingQueries < 1)
      throw new Error("No se verificó un intento fallido del poller consultando los pesajes durante el 503.");
    await verifyPending();
    r.failedPollVerified = true;
    r.rejectedWeighingQueries = after.rejectedWeighingQueries;
    r.message = `Fallo esperado confirmado: ${after.rejectedWeighingQueries} consultas de pesajes rechazadas con 503. Recuperación a los 30 s o al terminar este intento.`;
    log(r.message);
    await delay(Math.max(0, 30000 - (Date.now() - start)), signal);
  } catch (error) {
    r.status = signal.aborted ? "cancelado" : "fallido";
    r.message = signal.aborted ? "Prueba cancelada; recuperando Balanzas." : error instanceof Error ? error.message : "Falló la prueba de resiliencia.";
    save(run);
    throw error;
  } finally {
    await restoreBalanzas(run, p);
  }
  await c.node("balanzas", `/api/scales/${p.scaleId}`);
  r.status = "recuperando";
  r.message = "Balanzas disponible. Ejecutando nuevamente el poller para recuperar el pesaje original, sin reenviarlo.";
  log(r.message);
}
