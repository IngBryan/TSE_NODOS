import type { GpsDevice, GpsDeviceInput, TrackingEvent } from "./types";

// In-memory mock store. Data is lost on restart.
// Kept on globalThis so it survives hot reloads in `next dev`.

interface Db {
  gpsDevices: Map<number, GpsDevice>;
  /** Not exposed through the API; published to RabbitMQ (see lib/tracking.ts). */
  trackingEvents: Map<number, TrackingEvent>;
  nextGpsId: number;
  nextTrackingEventId: number;
  trackingOn: boolean;
}

function seed(): Db {
  const gpsDevices: GpsDevice[] = [
    { id: 1, licensePlate: "SBC1234", active: true },
    { id: 2, licensePlate: "STU5678", active: true },
    { id: 3, licensePlate: "AAB9012", active: false },
  ];
  const trackingEvents: TrackingEvent[] = [
    { id: 1, gpsId: 1, latitude: -34.7012, longitude: -56.412, datetime: "2026-09-29T08:00:00.000Z" },
    { id: 2, gpsId: 1, latitude: -34.6631, longitude: -56.6519, datetime: "2026-09-29T08:15:00.000Z" },
    { id: 3, gpsId: 2, latitude: -34.2956, longitude: -56.2378, datetime: "2026-09-29T11:05:00.000Z" },
  ];
  return {
    gpsDevices: new Map(gpsDevices.map((d) => [d.id, d])),
    trackingEvents: new Map(trackingEvents.map((e) => [e.id, e])),
    nextGpsId: gpsDevices.length + 1,
    nextTrackingEventId: trackingEvents.length + 1,
    trackingOn: false,
  };
}

const g = globalThis as unknown as { __trackingDb?: Db };
const db = (g.__trackingDb ??= seed());

// GPS devices

export function listGpsDevices(
  filter: { active?: boolean; licensePlate?: string } = {},
): GpsDevice[] {
  return [...db.gpsDevices.values()]
    .filter((d) => filter.active === undefined || d.active === filter.active)
    .filter((d) => !filter.licensePlate || d.licensePlate === filter.licensePlate);
}

export function getGpsDevice(id: number): GpsDevice | undefined {
  return db.gpsDevices.get(id);
}

export function createGpsDevice(input: GpsDeviceInput, requestedId?: number): GpsDevice {
  if (requestedId !== undefined && (!Number.isSafeInteger(requestedId) || requestedId < 1 || db.gpsDevices.has(requestedId)))
    throw new Error("GPS id is invalid or already exists");
  // Explicit IDs match nodes already registered in Central, without creating thousands of fillers.
  // They do not change the sequential IDs of ordinary API-created GPS devices.
  while (db.gpsDevices.has(db.nextGpsId)) db.nextGpsId++;
  const id = requestedId ?? db.nextGpsId++;
  const device: GpsDevice = { id, ...input };
  db.gpsDevices.set(device.id, device);
  return device;
}

export function updateGpsDevice(id: number, input: GpsDeviceInput): GpsDevice | undefined {
  if (!db.gpsDevices.has(id)) return undefined;
  const updated: GpsDevice = { id, ...input };
  db.gpsDevices.set(id, updated);
  return updated;
}

/** Logical delete: marks the device as inactive. Its tracking events are kept. */
export function deactivateGpsDevice(id: number): GpsDevice | undefined {
  const current = db.gpsDevices.get(id);
  if (!current) return undefined;
  const updated: GpsDevice = { ...current, active: false };
  db.gpsDevices.set(id, updated);
  return updated;
}

// Tracking events

export function addTrackingEvent(input: Omit<TrackingEvent, "id">): TrackingEvent {
  const event: TrackingEvent = { id: db.nextTrackingEventId++, ...input };
  db.trackingEvents.set(event.id, event);
  return event;
}

/** Most recent event reported by a GPS device (events are stored in chronological order). */
export function lastTrackingEvent(gpsId: number): TrackingEvent | undefined {
  let last: TrackingEvent | undefined;
  for (const event of db.trackingEvents.values()) {
    if (event.gpsId === gpsId) last = event;
  }
  return last;
}

// Global tracking switch (tracking_on), off by default

export function isTrackingOn(): boolean {
  return db.trackingOn;
}

export function setTrackingOn(value: boolean): boolean {
  db.trackingOn = value;
  return db.trackingOn;
}
