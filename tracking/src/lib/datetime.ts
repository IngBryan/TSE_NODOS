// Uruguay is UTC-3 all year (no daylight saving time since 2015).
const URUGUAY_OFFSET_MS = -3 * 60 * 60 * 1000;

/** ISO 8601 in Uruguay time, e.g. 2026-10-12T17:41:00.000-03:00 (same instant as toISOString()). */
export function toUruguayIsoString(date: Date): string {
  return new Date(date.getTime() + URUGUAY_OFFSET_MS).toISOString().replace("Z", "-03:00");
}
