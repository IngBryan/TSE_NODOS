"use client";
import { useCallback, useEffect, useState } from "react";
import { labels, scenarios } from "@/lib/types";
import type { Run, Selection, StreamKey, Target } from "@/lib/types";
interface PublicProfile {
  id: Target;
  name: string;
  missing: string[];
  platformUrl: string;
  platformAccessUrl?: string;
  centralUrl?: string;
  trackingUrl?: string;
  balanzasUrl?: string;
  pollerMode: string;
  guideId?: string;
  plateWithoutGuide?: string;
  plateWithGuide?: string;
  liveGuideId?: string;
  livePlate?: string;
  liveGps?: number;
}
interface State {
  profiles: PublicProfile[];
  run: Run | null;
  running: boolean;
}
const descriptions = {
  sin_guia: "Circulación sin una guía activa.",
  habilitacion: "Circulación con documentación inválida.",
  carga: "Pesaje por encima del máximo y procesamiento del poller.",
  desvio: "Preparar el tramo dentro de A y continuar en vivo. Al detectar el caso, el GPS sigue reportando hasta que lo detengas.",
};
const statusLabel: Record<string, string> = {
  pendiente: "Pendiente",
  ejecutando: "En curso",
  detectado: "Detectado",
  fallido: "Fallido",
  cancelado: "Cancelado",
  completado: "Completado",
  interrumpido: "Interrumpido",
};
const time = (value: string) =>
  new Date(value).toLocaleTimeString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
export default function Home() {
  const [data, setData] = useState<State | null>(null),
    [target, setTarget] = useState<Target>("elasticcloud"),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(true);
  const [balanzasOutage, setBalanzasOutage] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/control", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const next = (await res.json()) as State;
      setData(next);
      if (next.run && (next.running || next.run.cleanupRequired))
        setTarget(next.run.target);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);
  async function act(selection: Selection | "stop", stream?: StreamKey) {
    setPending(true);
    setError("");
    try {
      const r = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          selection === "stop"
            ? { action: "stop", ...(stream ? { stream } : {}) }
            : { action: "start", target, selection, ...(["carga", "todos"].includes(selection) ? { balanzasOutage } : {}) },
        ),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo ejecutar.");
    } finally {
      setPending(false);
    }
  }
  const p = data?.profiles.find((p) => p.id === target),
    run = data?.run,
    busy = pending || !!data?.running || run?.status === "ejecutando",
    same = run?.target === target;
  const prepared = same && run?.status === "completado" && !!run.prepared;
  const pausedDetour = same && !!run?.prepared && (prepared || run.concurrent?.detour.status === "pendiente");
  const canStartLive = prepared && !busy && connected && !p?.missing.length;
  const blocked =
    busy || !!p?.missing.length || !!run?.cleanupRequired || !connected;
  if (!data)
    return (
      <main className="shell">
        <h1>Panel de nodos periféricos</h1>
        <p role="status">{connected ? "Conectando al panel…" : "No se pudo conectar al panel. Reintentando…"}</p>
      </main>
    );
  return (
    <main className="shell">
      <header>
        <div>
          <span className="eyebrow">TSE · NODOS PERIFÉRICOS</span>
          <h1>Panel de nodos periféricos</h1>
        </div>
      </header>
      <section className="toolbar" aria-label="Configuración de ejecución">
        <label>
          Ambiente
          <select
            value={target}
            disabled={busy || !!run?.cleanupRequired}
            onChange={(e) => setTarget(e.target.value as Target)}
          >
            <option value="elasticcloud">Elastic Cloud</option>
            <option value="local">Local</option>
          </select>
        </label>
        <div className="cadence">
          <strong>Mediciones GPS cada 5 s</strong>
          <span>Publicación en tiempo real.</span>
        </div>
        <a
          className="link"
          href={p?.platformAccessUrl || "#"}
          target="_blank"
          rel="noreferrer"
        >
          Abrir plataforma ↗
        </a>
      </section>
      {!connected && (
        <div className="notice error" role="alert">
          Se perdió la conexión al panel. La ejecución continúa en el servidor;
          reconectando…
        </div>
      )}
      {p?.missing.length ? (
        <div className="notice">
          Ambiente sin configurar. Completar en el servidor:{" "}
          {p.missing.join(", ")}.
        </div>
      ) : null}
      {run?.cleanupRequired && !prepared && !data?.running && (
        <div className="notice error">
          Hay una restauración pendiente en{" "}
          {run.target === "local" ? "Local" : "Elastic Cloud"}. Usá Detener y
          restaurar antes de ejecutar otro escenario.
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {pausedDetour && run?.prepared && (
        <section className="notice">
          <strong>Desvío preparado · {(run.prepared.stopAtMeters / 1000).toFixed(2)} km recorridos</strong>
          <p>{run.prepared.expectedPoints} posiciones confirmadas en Central, desde {time(run.prepared.firstAt)} hasta {time(run.prepared.lastAt)}.
            El GPS del desvío está pausado. Podés mostrar el tramo previo en Central y ejecutar el desvío cuando quieras.</p>
          <a className="link" href={`${p?.platformUrl}/viajes/${encodeURIComponent(p?.guideId ?? "")}`} target="_blank" rel="noreferrer">Abrir viaje del desvío en Central ↗</a>{" "}
          <button disabled={pending || !connected || (busy && !run.concurrent)} onClick={() => void act("continuar_desvio")}>
            Ejecutar desvío
          </button>
        </section>
      )}
      <section className="actions">
        <button
          className="secondary"
          disabled={
            busy || !connected || !!p?.missing.length || !!run?.cleanupRequired
          }
          onClick={() => void act("diagnostico")}
        >
          Comprobar ambiente
        </button>
        <button disabled={blocked} onClick={() => void act("todos")}>
          Ejecutar todos en paralelo
        </button>
        <button
          className="danger"
          disabled={pending || !connected || !!p?.missing.length}
          onClick={() => void act(data?.running ? "stop" : "restaurar")}
        >
          {data?.running ? (run?.concurrent ? "Detener todos y restaurar" : run?.live ? "Detener seguimiento"
            : run?.steps.some(s => s.scenario === "desvio" && ["ejecutando", "detectado"].includes(s.status)) ? "Detener desvío" : "Detener ejecución") : "Detener y restaurar"}
        </button>
      </section>
      <p className="hint">La ejecución conjunta prepara el desvío, inicia tres GPS y registra el pesaje mientras reportan.
        Los casos se confirman de forma independiente y los GPS continúan hasta que los detengas.</p>
      <section className="execution" aria-label="Resiliencia de Balanzas">
        <label className="fault-option">
          <input type="checkbox" checked={balanzasOutage} disabled={busy || !!run?.cleanupRequired}
            onChange={e => setBalanzasOutage(e.target.checked)} />
          Incluir caída y recuperación de Balanzas
        </label>
        <p>Se aplica a Exceso de carga y a Ejecutar todos en paralelo. Registra un pesaje, simula una caída de la API con respuestas 503 durante al menos 30 s
          y ejecuta el poller antes y después de recuperar el nodo, sin reenviar el pesaje. Los GPS continúan.</p>
        {same && run?.resilience && <div aria-live="polite">
          <strong>{run.resilience.status === "verificado" ? "✓ Recuperación verificada"
            : run.resilience.status === "indisponible" ? "Balanzas indisponible · HTTP 503"
            : run.resilience.status === "recuperando" ? "Balanzas recuperada · comprobando evidencia"
            : statusLabel[run.resilience.status]}</strong>
          <p>{run.resilience.message}</p>
          {run.resilience.failedPollVerified && <small>Intento fallido comprobado · {run.resilience.rejectedWeighingQueries} consultas de pesajes rechazadas.</small>}
        </div>}
      </section>
      <section className="execution" aria-label="Viaje de seguimiento">
        <div className="sectionheading">
          <h2>Viaje de seguimiento</h2>
          <button className="secondary" disabled={blocked && !canStartLive} onClick={() => void act("seguir_viaje")}>Ejecutar viaje de seguimiento</button>
        </div>
        <p>{p?.livePlate} · {p?.liveGuideId} · GPS {p?.liveGps}. El recorrido se sigue desde Central.</p>
        <a className="link" href={`${p?.platformUrl}/viajes/${encodeURIComponent(p?.liveGuideId ?? "")}`} target="_blank" rel="noreferrer">Abrir viaje de seguimiento en Central ↗</a>
        {same && run?.live && <p aria-live="polite">{run.live.receivedCount} posiciones confirmadas en Central.
          {run.live.lastAt && ` Última medición: ${time(run.live.lastAt)}.`}</p>}
      </section>
      {same && run?.concurrent && <section className="execution" aria-label="Control de GPS">
        <h2>GPS en ejecución</h2>
        {(["live", "detour", "infractions"] as const).map(key => {
          const stream = run.concurrent![key];
          if (!stream) return null;
          const name = key === "live" ? "Seguimiento" : key === "detour" ? "Desvío" : "Sin guía y sin habilitación";
          const plate = key === "live" ? p?.livePlate : key === "detour" ? p?.plateWithGuide : p?.plateWithoutGuide;
          return <div className="stream-control" key={key}>
            <div><strong>{name} · {plate} · {statusLabel[stream.status]}</strong>
              <p>{stream.message}</p>
              <small>Generados: {stream.emitted ?? 0} · Confirmados por RabbitMQ: {stream.brokerConfirmed ?? 0} · Recibidos en Central: {stream.received ?? 0}
                {stream.lastAt && ` · Última medición: ${time(stream.lastAt)}`}</small>
            </div>
            <button className="danger" disabled={pending || !connected || !data?.running || !["pendiente", "ejecutando"].includes(stream.status)}
              onClick={() => void act("stop", key)}>Detener {key === "live" ? "seguimiento" : key === "detour" ? "desvío" : "GPS de infracciones"}</button>
          </div>;
        })}
        <p>Abrí la plataforma para ver los viajes y el caso. Cada parada afecta únicamente al GPS indicado.</p>
      </section>}
      <section className="cards" aria-label="Escenarios">
        {scenarios.map((s, i) => {
          const step = same
            ? run?.steps.find((v) => v.scenario === s)
            : undefined;
          return (
            <article key={s} className={"card " + (step?.status ?? "")}>
              <div className="cardtop">
                <span className="number">0{i + 1}</span>
                <span className={"badge " + (step?.status ?? "pendiente")}>
                  {step ? statusLabel[step.status] : "Preparado"}
                </span>
              </div>
              <h2>{labels[s]}</h2>
              <p>{descriptions[s]}</p>
              <div className="result" aria-live="polite">
                {step ? (
                  <>
                    <strong>
                      {step.caseId ? `Expediente ${step.caseId}` : step.message}
                    </strong>
                    {step.caseId && <span>{step.message}</span>}
                    {step.durationMs !== undefined && (
                      <small>
                        {(step.durationMs / 1000).toFixed(1)} segundos
                      </small>
                    )}
                  </>
                ) : (
                  <span>
                    {s === "sin_guia" || s === "habilitacion"
                      ? p?.plateWithoutGuide
                      : p?.plateWithGuide}
                    {s === "carga" || s === "desvio"
                      ? ` · ${p?.guideId ?? ""}`
                      : ""}
                  </span>
                )}
              </div>
              <button
                className="secondary"
                disabled={blocked}
                onClick={() => void act(s === "desvio" ? "preparar_desvio" : s)}
              >
                {s === "desvio" ? "Preparar desvío" : "Ejecutar escenario"}
              </button>
              {step?.evidence !== undefined && (
                <details>
                  <summary>Ver evidencia de la ejecución</summary>
                  <pre>{JSON.stringify(step.evidence, null, 2)}</pre>
                </details>
              )}
            </article>
          );
        })}
      </section>
      {same && run && (
        <section className="execution">
          <div className="sectionheading">
            <h2>Última ejecución</h2>
            <span className={"badge " + run.status}>
              {statusLabel[run.status]}
            </span>
          </div>
          <p className="message" aria-live="polite">
            {run.message}
          </p>
          <small>
            {time(run.startedAt)} · {run.factor}x · {run.id.slice(0, 8)}
          </small>
          {run.checks.length > 0 && (
            <ul className="checks">
              {run.checks.map((c) => (
                <li key={c.name}>
                  <span className={c.ok ? "ok" : "error"}>
                    {c.ok ? "✓" : "×"}
                  </span>
                  <div>
                    <strong>{c.name}</strong>
                    <span>{c.message}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <details open={!!data?.running}>
            <summary>Actividad</summary>
            <ol className="logs">
              {run.logs.map((l, i) => (
                <li key={i}>
                  <time>{time(l.time)}</time>
                  <span>{l.message}</span>
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}
      <footer>
        <span>
          Los ensayos generan datos persistentes en el ambiente seleccionado. La
          parada restaura matrícula y actividad; el recorrido del GPS usado
          queda configurado.
        </span>
        <details>
          <summary>Conexiones del ambiente</summary>
          <p>
            Central: {p?.centralUrl}
            <br />
            Tracking: {p?.trackingUrl}
            <br />
            Balanzas: {p?.balanzasUrl}
            <br />
            Poller: {p?.pollerMode}
          </p>
        </details>
      </footer>
    </main>
  );
}
