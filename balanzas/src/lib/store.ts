import type { Scale, ScaleInput, WeighingEvent } from "./types";

// In-memory mock store. Data is lost on restart.
// Demo weighings are explicitly added using POST /api/scales/:id/weighings.
// No background generator or random weights: the presenter controls each event.
// Kept on globalThis so it survives hot reloads in `next dev`.

interface Db {
  scales: Map<number, Scale>;
  weighings: Map<number, WeighingEvent>;
  nextScaleId: number;
  nextWeighingId: number;
}

function seed(): Db {
  const scales: Scale[] = [
    { id: 1, name: "Ruta 1 - Km 45", latitude: -34.6631, longitude: -56.6519, active: true },
    { id: 2, name: "Ruta 5 - Km 95", latitude: -34.2956, longitude: -56.2378, active: true },
    { id: 3, name: "Ruta 8 - Km 120", latitude: -34.4111, longitude: -55.0539, active: false },
    { id: 4, name: "Ruta 8 - Km 150", latitude: -34.1234, longitude: -55.5678, active: true }
  ];
  const weighings: WeighingEvent[] = [
    { id: 1, scaleId: 1, licensePlate: "SBC1234", datetime: "2026-09-29T08:15:00.000Z", weight: 18450 },
    { id: 2, scaleId: 1, licensePlate: "STU5678", datetime: "2026-09-29T09:42:00.000Z", weight: 32100 },
    { id: 3, scaleId: 4, licensePlate: "SBC1234", datetime: "2026-09-29T11:05:00.000Z", weight: 18390 },
    { id: 4, scaleId: 2, licensePlate: "AAB9012", datetime: "2026-09-30T07:30:00.000Z", weight: 45200 },
  ];
  return {
    scales: new Map(scales.map((s) => [s.id, s])),
    weighings: new Map(weighings.map((w) => [w.id, w])),
    nextScaleId: scales.length + 1,
    nextWeighingId: weighings.length + 1,
  };
}

const g = globalThis as unknown as { __balanzasDb?: Db };
const db = (g.__balanzasDb ??= seed());
const URUGUAY_OFFSET_MS = -3 * 60 * 60 * 1000;

// Scales

export function listScales(filter: { active?: boolean } = {}): Scale[] {
  return [...db.scales.values()].filter(
    (s) => filter.active === undefined || s.active === filter.active,
  );
}

export function getScale(id: number): Scale | undefined {
  return db.scales.get(id);
}

export function createScale(input: ScaleInput): Scale {
  const scale: Scale = { id: db.nextScaleId++, ...input };
  db.scales.set(scale.id, scale);
  return scale;
}

export function updateScale(id: number, input: ScaleInput): Scale | undefined {
  const current = db.scales.get(id);
  if (!current) return undefined;
  const updated: Scale = { ...current, ...input, id };
  db.scales.set(id, updated);
  return updated;
}

/** Logical delete: marks the scale as inactive. Its weighing events are kept. */
export function deactivateScale(id: number): Scale | undefined {
  const current = db.scales.get(id);
  if (!current) return undefined;
  const updated: Scale = { ...current, active: false };
  db.scales.set(id, updated);
  return updated;
}

// Weighing events

/**
 * Creates an independent weighing event at the time the mock received it.
 * Central identifies events by (licensePlate, datetime), NOT by external id.
 * Use distinct millisecond timestamps even for two fast requests for the same vehicle.
 */
export function createWeighing(scaleId: number, licensePlate: string, weight: number): WeighingEvent {
  const normalizedPlate = licensePlate.trim().toUpperCase().replace(/[\s-]+/g, "");
  let timestamp = Date.now();
  for (const existing of db.weighings.values()) {
    if (existing.licensePlate === normalizedPlate) {
      timestamp = Math.max(timestamp, Date.parse(existing.datetime) + 1);
    }
  }
  const weighing: WeighingEvent = {
    id: db.nextWeighingId++,
    scaleId,
    licensePlate: normalizedPlate,
    datetime: toUruguayIso(timestamp),
    weight,
  };
  db.weighings.set(weighing.id, weighing);
  return weighing;
}

export function listWeighings(
  filter: { scaleId?: number; licensePlate?: string; from?: Date; to?: Date } = {},
): WeighingEvent[] {
  return [...db.weighings.values()]
    .filter((w) => filter.scaleId === undefined || w.scaleId === filter.scaleId)
    .filter((w) => !filter.licensePlate || w.licensePlate === filter.licensePlate)
    .filter((w) => !filter.from || new Date(w.datetime) >= filter.from)
    .filter((w) => !filter.to || new Date(w.datetime) <= filter.to)
    .sort((a, b) => a.datetime.localeCompare(b.datetime));
}

//helpers
function toUruguayIso(ms: number): string {
  return new Date(ms + URUGUAY_OFFSET_MS).toISOString().replace("Z", "-03:00");
}
