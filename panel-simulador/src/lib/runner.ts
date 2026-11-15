import { concurrentDemo, type ConcurrentControls } from "./concurrent-demo.ts";
import { allDemo } from "./all-demo.ts";
import { checkAvailability, exerciseOutage, restoreBalanzas } from "./balanzas-resilience.ts";
import { validateNoGuideContext } from "./infractions.ts";
import { followTrip } from "./live-trip.ts";
import { prepareDetour, resumeDetour } from "./detour.ts";
import { Client, delay, HttpError } from "./client.ts";
import { profile, missing, publicProfiles } from "./config.ts";
import { evidenceDates, freshEvidence } from "./evidence.ts";
import { checkPoller, poller } from "./poller.ts";
import { acquire, release, save, recover, load } from "./store.ts";
import { caseTypes, labels, scenarios } from "./types.ts";
import type {
  Run,
  Target,
  Selection,
  Scenario,
  Step,
  Line,
  Profile,
  TrackingState,
  Position,
  StreamKey,
  Device,
} from "./types.ts";

const g = globalThis as unknown as {
  panelJob?: { controller: AbortController; run: Run; promise: Promise<void>; controls?: ConcurrentControls };
};
function redact(message: string, p: Profile) {
  for (const value of [
    p.apiKey,
    p.trackingClientSecret,
    p.balanzasClientSecret,
  ])
    if (value) message = message.split(value).join("[privado]");
  return message.slice(0, 800);
}
export function view() {
  return {
    profiles: publicProfiles(),
    run: recover(),
    running: !!g.panelJob,
  };
}
function log(run: Run, message: string) {
  run.message = message;
  run.logs.push({ time: new Date().toISOString(), message });
  if (run.logs.length > 160) run.logs.shift();
  save(run);
}
function interrupted(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Ejecución cancelada.");
}
async function restore(run: Run, p: Profile) {
  const client = new Client(p);
  const errors: string[] = [];
  try {
    await client.stop();
    if (run.gpsBackup) {
      for (const d of run.gpsBackup) {
        let restored: Device;
        try {
          restored = await client.node<Device>("tracking", `/api/gps-devices/${d.id}`, "PUT", {
            licensePlate: d.licensePlate,
            active: d.active,
          });
        } catch (error) {
          // Tracking's in-memory GPS store is reset when the node restarts.
          if (!(error instanceof HttpError) || error.status !== 404) throw error;
          restored = await client.node<Device>("tracking", "/api/gps-devices", "POST", d);
        }
        if (restored.id !== d.id || restored.licensePlate !== d.licensePlate || restored.active !== d.active)
          throw new Error(`Tracking no confirmó la restauración del GPS ${d.id}.`);
      }
      delete run.gpsBackup;
    }
    delete run.prepared;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "No se restauraron los GPS.");
  }
  // Each subsystem gets its cleanup attempt even when the other one is unreachable.
  try { await restoreBalanzas(run, p); }
  catch (error) { errors.push(error instanceof Error ? error.message : "No se recuperó Balanzas."); }
  run.cleanupRequired = errors.length > 0;
  save(run);
  if (errors.length) throw new Error(errors.join("; "));
}
async function diagnose(
  run: Run,
  p: Profile,
  signal: AbortSignal,
  selection: Selection,
) {
  const c = new Client(p, signal);
  const errors = missing(p);
  if (errors.length)
    throw new Error("Completar configuración privada: " + errors.join(", "));
  const check = async (name: string, fn: () => Promise<string>) => {
    interrupted(signal);
    try {
      const message = await fn();
      run.checks.push({ name, ok: true, message });
    } catch (e) {
      run.checks.push({
        name,
        ok: false,
        message: redact(
          e instanceof Error ? e.message : "Error de comprobación.",
          p,
        ),
      });
    }
    save(run);
  };
  await check("Central y funcionario", async () => {
    await c.central("/casos?pagina=1&tamanio=1");
    return "Acceso autorizado para CI " + p.funcionarioCi;
  });
  await check("Tracking", async () => {
    await c.request(p.trackingUrl, "/api/health");
    const s = await c.state();
    if (s.intervalSeconds !== 5)
      throw new Error(
        `GPS configurado cada ${s.intervalSeconds} s. Se requieren 5 s; ajustar TRACKING_INTERVAL_SECONDS en el nodo.`,
      );
    if (selection === "todos" && !s.capabilities?.includes("per-gps-control-v1"))
      throw new Error("La ejecución conjunta requiere Tracking con control independiente por GPS. Actualizar ese nodo antes de preparar.");
    return "OAuth correcto · medición GPS cada 5 s";
  });
  await check("GPS de ensayo", async () => {
    const ds = await c.devices();
    if (
      !ds.some(
        (d) =>
          d.id === p.gpsWithoutGuide && d.licensePlate === p.plateWithoutGuide,
      ) ||
      !ds.some(
        (d) => d.id === p.gpsWithGuide && d.licensePlate === p.plateWithGuide,
      )
    )
      throw new Error("Los GPS y matrículas no coinciden con el escenario.");
    return `${p.plateWithoutGuide} / ${p.plateWithGuide}`;
  });
  if (selection === "todos" || selection === "diagnostico") await check("Historial del vehículo sin guía", async () => {
    await validateNoGuideContext(c, p);
    return `${p.plateWithoutGuide}: sin guía activa y con historial temporal verificable`;
  });
  await check("Guía de carga y desvío", async () => {
    const t = await c.guide();
    if (
      t.vehiculo?.matricula !== p.plateWithGuide ||
      !["ASIGNADA", "EN_CURSO"].includes(t.estado) ||
      t.fin ||
      !Number.isFinite(Date.parse(t.fechaAsignacion))
    )
      throw new Error("La guía no está activa para el vehículo configurado.");
    return p.guideId + " · " + p.plateWithGuide;
  });
  if (!["preparar_desvio", "continuar_desvio", "desvio"].includes(selection)) await check("Balanzas", async () => {
    await c.request(p.balanzasUrl, "/api/health");
    const s = await c.node<{ active: boolean }>(
      "balanzas",
      `/api/scales/${p.scaleId}`,
    );
    if (!s.active) throw new Error("Balanza inactiva.");
    return "OAuth correcto · balanza " + p.scaleId + " activa";
  });
  if (
    selection === "todos" ||
    selection === "carga" ||
    selection === "diagnostico"
  )
    await check("Poller", async () => {
      await checkPoller(p, signal);
      return p.pollerMode === "docker" ? "Docker: Central local y ejecutor del poller comprobados"
        : "SSH: CronJob accesible y permisos de Jobs comprobados";
    });
  if (run.resilience) await check("Resiliencia de Balanzas", async () => {
    await checkAvailability(c);
    return "Interrupción controlada disponible; recuperación automática de seguridad a los 180 s";
  });
  if (run.checks.some((c) => !c.ok))
    throw new Error(
      "El diagnóstico detectó condiciones pendientes. Revisar las comprobaciones.",
    );
}
async function gps(run: Run, p: Profile, step: Step, signal: AbortSignal) {
  const key = step.scenario;
  const c = new Client(p, signal);
  const gpsId = p.gpsWithoutGuide, plate = p.plateWithoutGuide, guide = undefined;
  const state = await c.state();
  if (state.intervalSeconds !== 5)
    throw new Error("Tracking debe medir cada 5 segundos.");
  if (state.trackingOn || state.flushing || state.pendingMessages)
    throw new Error(
      "Tracking debe estar detenido y sin pendientes antes de iniciar el ensayo. Usar Detener y restaurar.",
    );
  // Prepare route and validate preconditions BEFORE changing activity of any device.
  const route = await c.route([p.origin, p.destination]);
  const lines: Line[] = [route];
  const hashes: string[] = [];
  const baseline = new Set<number>();
  for (const old of await c.cases(caseTypes[key], plate, guide))
    for (const date of evidenceDates(await c.evidence(old.id)))
      baseline.add(Date.parse(date));
  const ds = await c.devices();
  if (!ds.some((d) => d.id === gpsId && d.licensePlate === plate))
    throw new Error("El GPS no corresponde a la matrícula del ensayo.");
  run.gpsBackup = ds;
  run.cleanupRequired = true;
  save(run);
  try {
    for (const d of ds)
      await c.node("tracking", `/api/gps-devices/${d.id}`, "PUT", {
        licensePlate: d.licensePlate,
        active: d.id === gpsId,
      });
    const active = await c.node<{ id: number }[]>(
      "tracking",
      "/api/gps-devices?active=true",
    );
    if (active.length !== 1 || active[0].id !== gpsId)
      throw new Error("No se pudo aislar el GPS del ensayo.");
    await c.node(
      "tracking",
      `/api/gps-devices/${gpsId}/scenario`,
      "PUT",
      { scenario: "NORMAL_A", authorizedRoutes: lines },
    );
    const prepared = Date.now();
    const started = await c.node<TrackingState>(
      "tracking",
      "/api/tracking-on",
      "PUT",
      { trackingOn: true, simulationSpeedFactor: 1 },
    );
    if (!started.trackingOn)
      throw new Error("Tracking no inició el simulador.");
    const since = started.simulatedStartAt
      ? Date.parse(started.simulatedStartAt)
      : prepared;
    if (!Number.isFinite(since))
      throw new Error("Tracking devolvió una fecha inicial inválida.");
    log(
      run,
      `${labels[key]}: simulador activo; esperando evidencia nueva en Central.`,
    );
    step.message = "Esperando evidencia nueva";
    save(run);
    const deadline = Date.now() + p.timeoutMs;
    do {
      interrupted(signal);
      for (const candidate of await c.cases(caseTypes[key], plate, guide)) {
        const evidence = await c.evidence(candidate.id);
        const dates = freshEvidence(key, evidence, {
          type: caseTypes[key],
          plate,
          guide,
          since,
          baseline,
          hashes,
        });
        if (!dates) continue;
        let positions: Position[] | undefined;
        if (key === "sin_guia") {
          positions = await c.positions(candidate.id, dates, gpsId);
          if (new Set(positions.map((v) => v.fechaHora)).size < 2) continue;
          if (
            !positions.every((v) =>
              /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                v.messageId,
              ),
            )
          )
            throw new Error(
              "La evidencia no conserva los UUID del simulador Tracking.",
            );
        }
        step.caseId = candidate.id;
        step.dates = dates;
        step.evidence = {
          ...evidence,
          ...(positions ? { posiciones: positions } : {}),
        };
        return;
      }
      await delay(p.pollMs, signal);
    } while (Date.now() < deadline);
    throw new Error(
      "No apareció evidencia nueva dentro del tiempo de espera. Revisar recorrido, guía, documentación y consumidor.",
    );
  } finally {
    await restore(run, p);
  }
}
async function weighing(run: Run, p: Profile, step: Step, signal: AbortSignal) {
  try { await weighingAttempt(run, p, step, signal); }
  catch (error) {
    if (run.resilience && run.resilience.status !== "verificado") {
      run.resilience.status = signal.aborted ? "cancelado" : "fallido";
      run.resilience.message = signal.aborted ? "Prueba cancelada; el pesaje registrado se conserva."
        : redact(error instanceof Error ? error.message : "Falló la comprobación de recuperación.", p);
      save(run);
    }
    throw error;
  }
}
async function weighingAttempt(run: Run, p: Profile, step: Step, signal: AbortSignal) {
  if (p.pollerMode === "disabled")
    throw new Error(
      "El poller no está configurado; no se registró ningún pesaje.",
    );
  const c = new Client(p, signal);
  const trip = await c.guide();
  const base = trip.vehiculo.pesoMaximoKg;
  if (!(
    base > 0 &&
    Number.isSafeInteger(p.excessKg) &&
    p.excessKg > base + Math.max(5000, base * 0.2)
  ))
    throw new Error(
      "El peso del ensayo debe superar el máximo técnico y toda tolerancia admitida (20 % / 5000 kg).",
    );
  const start = Date.now();
  const w = await c.node<{
    licensePlate: string;
    weight: number;
    datetime: string;
  }>("balanzas", `/api/scales/${p.scaleId}/weighings`, "POST", {
    licensePlate: p.plateWithGuide,
    weight: p.excessKg,
  });
  if (
    w.licensePlate !== p.plateWithGuide ||
    w.weight !== p.excessKg ||
    !Number.isFinite(Date.parse(w.datetime))
  )
    throw new Error("Balanzas devolvió un pesaje no correlacionable.");
  // Persist the exact receipt even if the poller fails, to allow manual inspection without injecting again.
  step.evidence = { pesajeRegistrado: w };
  if (run.resilience) run.resilience.weighing = w;
  save(run);
  if (run.resilience) await exerciseOutage(run, p, signal, (message) => log(run, message), async () => {
    for (const cs of await c.cases(caseTypes.carga, p.plateWithGuide, p.guideId)) {
      const evidence = await c.evidence(cs.id);
      if (evidence.pesajes?.some(v => v.pesoKg === w.weight && Date.parse(v.fechaHora) === Date.parse(w.datetime)))
        throw new Error("El pesaje ya fue consumido por otro poller; no se puede atribuir su recuperación a esta prueba.");
    }
  });
  await poller(p, signal, (message) => log(run, message));
  const deadline = Date.now() + p.timeoutMs;
  do {
    interrupted(signal);
    for (const cs of await c.cases(
      caseTypes.carga,
      p.plateWithGuide,
      p.guideId,
    )) {
      const evidence = await c.evidence(cs.id);
      const dates = freshEvidence("carga", evidence, {
        type: caseTypes.carga,
        plate: p.plateWithGuide,
        guide: p.guideId,
        since: start,
        baseline: new Set(),
        hashes: [],
        weight: w.weight,
        weighingDate: w.datetime,
      });
      if (dates) {
        step.caseId = cs.id;
        step.dates = dates;
        step.evidence = evidence;
        if (run.resilience) {
          run.resilience.status = "verificado";
          run.resilience.message = "Recuperación verificada: el pesaje original está en la evidencia de Central, sin volver a enviarlo.";
          log(run, run.resilience.message);
        }
        return;
      }
    }
    await delay(p.pollMs, signal);
  } while (Date.now() < deadline);
  throw new Error(
    "Pesaje registrado y poller ejecutado, pero no se encontró su evidencia en Central.",
  );
}
async function execute(run: Run, p: Profile, signal: AbortSignal) {
  try {
    if (run.selection === "restaurar") {
      log(run, "Deteniendo Tracking y restaurando GPS.");
      await restore(run, p);
    } else if (run.selection === "concurrencia") {
      const controls = { live: new AbortController(), detour: new AbortController() };
      g.panelJob!.controls = controls;
      try { await concurrentDemo(run, p, signal, controls, message => log(run, message)); }
      finally { await restore(run, p); }
    } else if (run.selection === "todos") {
      log(run, "Comprobando los cuatro casos y los tres vehículos de la ejecución conjunta.");
      await diagnose(run, p, signal, "todos");
      if (new Set([p.liveGps, p.gpsWithGuide, p.gpsWithoutGuide]).size !== 3
          || new Set([p.livePlate, p.plateWithGuide, p.plateWithoutGuide]).size !== 3
          || p.liveGuideId === p.guideId)
        throw new Error("La ejecución conjunta necesita tres GPS y matrículas diferentes, con guías distintas para seguimiento y desvío.");
      const controls = { live: new AbortController(), detour: new AbortController(), infractions: new AbortController() };
      g.panelJob!.controls = controls;
      try {
        log(run, "Preparando el desvío con los demás GPS detenidos. Después se iniciarán los tres vehículos.");
        await prepareDetour(run, p, signal, message => log(run, message));
        await allDemo(run, p, signal, controls,
          () => weighing(run, p, run.steps.find(s => s.scenario === "carga")!, signal),
          message => log(run, redact(message, p)));
      } finally { if (run.cleanupRequired) await restore(run, p); }
    } else {
      log(run, "Comprobando ambiente y datos del ensayo.");
      if (run.selection === "seguir_viaje") {
        await followTrip(run, p, signal, message => log(run, message));
        await restore(run, p);
      } else await diagnose(run, p, signal, run.selection);
      if (run.selection === "preparar_desvio") {
        await prepareDetour(run, p, signal, message => log(run, message));
      }
      for (const step of run.steps) {
        interrupted(signal);
        const start = Date.now();
        step.status = "ejecutando";
        step.message = "Preparando escenario";
        log(run, labels[step.scenario] + ": preparando escenario.");
        try {
          if (step.scenario === "desvio") {
            try {
              if (run.selection !== "continuar_desvio")
                await prepareDetour(run, p, signal, message => log(run, message));
              await resumeDetour(run, p, step, signal, message => log(run, message));
            } finally {
              await restore(run, p);
            }
          } else if (step.scenario === "carga") await weighing(run, p, step, signal);
          else await gps(run, p, step, signal);
          step.status = "detectado";
          step.message = step.scenario === "desvio"
            ? `Caso ${step.caseId} confirmado · GPS ${signal.aborted ? "detenido por el operador" : "finalizado"}`
            : "Evidencia nueva confirmada";
          log(
            run,
            `${labels[step.scenario]}: evidencia confirmada en expediente ${step.caseId}.`,
          );
        } catch (e) {
          if (step.status !== "detectado") step.status = signal.aborted ? "cancelado" : "fallido";
          step.message = redact(
            e instanceof Error ? e.message : "Error de escenario.",
            p,
          );
          throw e;
        } finally {
          step.durationMs = Date.now() - start;
          save(run);
        }
      }
    }
    interrupted(signal);
    run.status = run.selection === "todos" && run.steps.some(s => s.status !== "detectado") ? "cancelado" : "completado";
    log(
      run,
      run.selection === "todos" ? run.status === "completado"
        ? "Los cuatro casos quedaron confirmados; los tres GPS están detenidos y restaurados."
        : "Ejecución conjunta detenida antes de confirmar todos los casos; GPS restaurados."
      : run.selection === "concurrencia" ? "Sesión de ambos GPS finalizada; actividad restaurada."
      : run.selection === "seguir_viaje" ? "Recorrido completado; seguimiento detenido y GPS restaurados."
      : run.selection === "preparar_desvio"
        ? "Preparado: trayectoria previa confirmada en Central. Pulsar Ejecutar desvío para generar el caso en vivo."
        : run.selection === "diagnostico"
        ? "Ambiente comprobado."
        : run.selection === "restaurar"
          ? "Tracking detenido y GPS restaurados."
          : "Todos los escenarios seleccionados tienen evidencia confirmada.",
    );
  } catch (e) {
    if (run.resilience && !["verificado", "cancelado", "fallido"].includes(run.resilience.status)) {
      run.resilience.status = signal.aborted ? "cancelado" : "fallido";
      run.resilience.message = signal.aborted ? "Prueba detenida por el operador." : "No se completó la verificación de recuperación; revisar la actividad.";
    }
    const failedJointRun = run.selection === "todos" && (run.steps.some(s => s.status === "fallido")
      || Object.values(run.concurrent ?? {}).some(s => s?.status === "fallido"));
    const stoppedAfterDetection = signal.aborted && (run.selection === "todos"
      ? run.steps.every(s => s.status === "detectado")
      : run.steps.some(s => s.scenario === "desvio" && s.status === "detectado"));
    run.status = failedJointRun ? "fallido" : signal.aborted && (run.selection === "seguir_viaje" || stoppedAfterDetection) ? "completado" : signal.aborted ? "cancelado" : "fallido";
    const failureMessage = run.selection === "todos" && signal.aborted && !failedJointRun
      ? stoppedAfterDetection ? "Los cuatro casos quedaron confirmados; los GPS fueron detenidos por el operador."
        : "Ejecución conjunta detenida por el operador; se conserva la evidencia de los casos ya detectados."
      : stoppedAfterDetection
      ? "Desvío detenido por el operador; el caso y su evidencia quedaron confirmados en Central."
      : signal.aborted && run.selection === "seguir_viaje"
      ? "Seguimiento detenido por el operador." : redact(e instanceof Error ? e.message : "Falló la ejecución.", p);
    log(run, failureMessage);
    for (const step of run.steps)
      if (step.status === "pendiente") {
        step.status = "cancelado";
        step.message = "No ejecutado";
      }
    if (run.cleanupRequired) {
      try {
        await restore(run, p);
        log(run, "Ejecución detenida; actividad de los GPS restaurada.");
      } catch (cleanup) {
        log(
          run,
          "Restauración pendiente: " +
            redact(
              cleanup instanceof Error ? cleanup.message : "reintentar",
              p,
            ),
        );
      }
    }
    if (run.cleanupRequired && run.status === "completado") run.status = "fallido";
    run.message = failureMessage + (run.cleanupRequired ? " Hay una restauración pendiente." : "");
  } finally {
    run.finishedAt = new Date().toISOString();
    save(run);
    release();
    g.panelJob = undefined;
  }
}
export function start(target: Target, selection: Selection, balanzasOutage = false) {
  if (balanzasOutage && !["carga", "todos"].includes(selection))
    throw new Error("La interrupción de Balanzas se prueba con carga o con todos los casos.");
  if (g.panelJob) {
    const job = g.panelJob;
    if (selection === "continuar_desvio" && job.run.target === target && job.run.selection === "concurrencia"
        && job.run.concurrent?.detour.status === "pendiente" && job.controls?.resume) {
      job.controls.resume();
      return job.run;
    }
    throw new Error("Ya hay una ejecución activa.");
  }
  const previous = recover();
  if (selection === "seguir_viaje" && previous?.prepared && previous.status === "completado" && previous.target === target)
    selection = "concurrencia";
  if (selection === "concurrencia" && (!previous?.prepared || previous.target !== target || previous.status !== "completado"))
    throw new Error("Preparar el desvío antes de iniciar la sesión de ambos GPS.");
  if (selection === "continuar_desvio" && (!previous?.prepared || previous.target !== target || previous.status !== "completado"))
    throw new Error("Preparar el desvío en este ambiente antes de continuar.");
  if (previous?.cleanupRequired && selection !== "restaurar" && selection !== "continuar_desvio" && selection !== "concurrencia")
    throw new Error(
      "Hay una restauración pendiente. Usar Detener y restaurar en el ambiente anterior.",
    );
  if (
    selection === "restaurar" &&
    previous?.cleanupRequired &&
    previous.target !== target
  )
    throw new Error("Seleccionar el ambiente de la ejecución pendiente.");
  const p = profile(target);
  if (missing(p).length)
    throw new Error("Faltan credenciales privadas del ambiente.");
  acquire();
  try {
    const now = new Date().toISOString();
    const selected: Scenario[] =
      selection === "todos"
        ? [...scenarios]
        : ["continuar_desvio", "concurrencia"].includes(selection) ? ["desvio"] : scenarios.includes(selection as Scenario)
          ? [selection as Scenario]
          : [];
    const run: Run = {
      id: crypto.randomUUID(),
      target,
      selection,
      factor: selection === "preparar_desvio" ? 20 : 1,
      status: "ejecutando",
      message: "Iniciando",
      startedAt: now,
      updatedAt: now,
      steps: selected.map((s) => ({
        scenario: s,
        status: "pendiente",
        message: "Pendiente",
      })),
      checks: [],
      logs: [],
      cleanupRequired:
        ["restaurar", "continuar_desvio", "concurrencia"].includes(selection)
          ? (previous?.cleanupRequired ?? false)
          : false,
      ...(balanzasOutage ? { resilience: {
        status: "pendiente" as const, message: "Se registrará un pesaje y se interrumpirá Balanzas antes de consultarlo.",
        outageId: crypto.randomUUID(), restoreRequired: false,
      } } : selection === "restaurar" && previous?.resilience ? { resilience: previous.resilience } : {}),
      ...(["continuar_desvio", "concurrencia"].includes(selection) && previous?.prepared ? { prepared: previous.prepared } : {}),
      ...(["restaurar", "continuar_desvio", "concurrencia"].includes(selection) && previous?.gpsBackup
        ? { gpsBackup: previous.gpsBackup }
        : {}),
    };
    save(run);
    const controller = new AbortController();
    g.panelJob = { run, controller, promise: Promise.resolve() };
    g.panelJob.promise = execute(run, p, controller.signal);
    return run;
  } catch (e) {
    release();
    throw e;
  }
}
export function stop(stream?: StreamKey) {
  if (g.panelJob && stream) {
    const controls = g.panelJob.controls;
    if (!controls?.[stream] || !["concurrencia", "todos"].includes(g.panelJob.run.selection)) throw new Error("No hay una sesión activa para este GPS.");
    controls[stream]!.abort();
    return { message: "Parada solicitada únicamente para este GPS." };
  }
  if (g.panelJob) {
    g.panelJob.controller.abort();
    return {
      message:
        "Cancelación solicitada. Se está restaurando la actividad de los GPS.",
    };
  }
  const r = load();
  if (!r) throw new Error("Elegir un ambiente y usar Detener y restaurar.");
  return start(r.target, "restaurar");
}
