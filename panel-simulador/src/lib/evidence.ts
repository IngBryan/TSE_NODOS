import type { Evidence, Scenario } from "./types.ts";
export function evidenceDates(e: Evidence): string[] {
  return [
    ...(e.eventosTracking ?? []).map((p) => p.fechaHora),
    ...(e.pruebasHabilitacion ?? []).map((p) => p.fechaHora),
    ...(e.pruebasDesvio ?? []).flatMap((p) => [p.fechaHora, p.fechaPareja]),
  ];
}
export function freshEvidence(
  scenario: Scenario,
  e: Evidence,
  p: {
    type: string;
    plate: string;
    guide?: string;
    since: number;
    baseline: Set<number>;
    hashes: string[];
    weight?: number;
    weighingDate?: string;
  },
): string[] | null {
  if (
    e.tipoCaso !== p.type ||
    e.vehiculo?.matricula !== p.plate ||
    (p.guide && e.guia?.id !== p.guide)
  )
    return null;
  const fresh = (d: string) => {
    const t = Date.parse(d);
    return (
      Number.isFinite(t) &&
      t >= p.since &&
      t <= Date.now() &&
      !p.baseline.has(t)
    );
  };
  if (scenario === "carga") {
    const w = e.pesajes?.find(
      (w) =>
        w.pesoKg === p.weight &&
        Date.parse(w.fechaHora) === Date.parse(p.weighingDate ?? ""),
    );
    return w ? [w.fechaHora] : null;
  }
  if (scenario === "habilitacion") {
    const invalid = ["VENCIDO", "AUN_NO_VIGENTE", "SIN_REGISTRO"];
    const found = e.pruebasHabilitacion?.find(
      (v) =>
        fresh(v.fechaHora) &&
        v.origen === "TRACKING" &&
        (invalid.includes(v.estadoPermiso) || invalid.includes(v.estadoItv)),
    );
    return found ? [found.fechaHora] : null;
  }
  if (scenario === "desvio") {
    const found = e.pruebasDesvio?.find(
      (v) =>
        fresh(v.fechaHora) &&
        fresh(v.fechaPareja) &&
        v.distanciaConfirmanteMetros > v.umbralMetros &&
        v.distanciaParejaMetros > v.umbralMetros &&
        Math.abs(Date.parse(v.fechaHora) - Date.parse(v.fechaPareja)) > 0 &&
        Math.abs(Date.parse(v.fechaHora) - Date.parse(v.fechaPareja)) <=
          v.ventanaMaximaSegundos * 1000 &&
        v.hashesRutas?.length &&
        v.hashesRutas.every((h) => p.hashes.includes(h)),
    );
    return found ? [found.fechaHora, found.fechaPareja] : null;
  }
  const dates = [
    ...new Set(e.eventosTracking?.map((v) => v.fechaHora).filter(fresh) ?? []),
  ];
  return dates.length >= 2 ? dates : null;
}
