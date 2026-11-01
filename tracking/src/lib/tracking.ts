import { randomUUID } from "node:crypto";
import { toUruguayIsoString } from "./datetime";
import {
  getRabbitConfig, publishJson, TRACKING_EVENT_ROUTING_KEY, TRACKING_EXCHANGE,
} from "./rabbitmq";
import {
  addTrackingEvent, getGpsDevice, isTrackingOn, listGpsDevices, setTrackingOn,
} from "./store";
import { positionAtDistance, routeLengthMeters, type LineString } from "./route-math";
import {
  selectedRoute, type DeviceScenarioConfig,
} from "./route-scenarios";
import type { TrackingEvent } from "./types";

/** Each active, configured device follows its own real road geometry. */
const DEFAULT_INTERVAL_SECONDS = 10;
const DEFAULT_SPEED_KMH = 80;

type TrackingMessage = TrackingEvent & { licensePlate: string };
interface PendingMessage {
  /** Stable across retries. Never regenerate messageId or the GPS event on failure. */
  messageId: string;
  body: TrackingMessage;
}
interface DeviceRun {
  config: DeviceScenarioConfig;
  traveledMeters: number;
  finished: boolean;
}
interface Simulator {
  timer?: ReturnType<typeof setInterval>;
  pending: PendingMessage[];
  flushing: boolean;
  runs: Map<number, DeviceRun>;
}

// Same in-memory ownership model as the original mock; persists across Next dev hot reloads.
const g = globalThis as unknown as { __trackingSimulator?: Simulator };
const sim = (g.__trackingSimulator ??= {
  pending: [], flushing: false, runs: new Map<number, DeviceRun>(),
});

function intervalSeconds(): number {
  const value = Number(process.env.TRACKING_INTERVAL_SECONDS);
  return Number.isFinite(value) && value >= 1 && value <= 3600
    ? value : DEFAULT_INTERVAL_SECONDS;
}

function speedKmh(): number {
  const value = Number(process.env.TRACKING_SPEED_KMH);
  return Number.isFinite(value) && value > 0 && value <= 140
    ? value : DEFAULT_SPEED_KMH;
}

/** Configuration changes never discard events that are awaiting broker confirmation. */
export class TrackingScenarioConflict extends Error {}

function assertSafeToChange(): void {
  if (isTrackingOn() || sim.timer || sim.flushing || sim.pending.length > 0) {
    throw new TrackingScenarioConflict(
      "Stop tracking and confirm all pending RabbitMQ messages before changing routes or restarting",
    );
  }
}

export function configureDeviceScenario(gpsId: number, config: DeviceScenarioConfig) {
  assertSafeToChange();
  if (!getGpsDevice(gpsId)) throw new Error("GPS device not found");
  // The parser returned defensive coordinate copies, preventing mutation by caller.
  sim.runs.set(gpsId, { config, traveledMeters: 0, finished: false });
  return getDeviceScenario(gpsId);
}

export function getDeviceScenario(gpsId: number) {
  const run = sim.runs.get(gpsId);
  if (!run) return null;
  return {
    gpsId,
    scenario: run.config.scenario,
    authorizedAlternatives: run.config.authorizedRoutes.length,
    distanceMeters: Math.round(routeLengthMeters(selectedRoute(run.config))),
    traveledMeters: Math.round(run.traveledMeters),
    finished: run.finished,
  };
}

export function getTrackingStatus() {
  return {
    trackingOn: isTrackingOn(),
    pendingMessages: sim.pending.length,
    flushing: sim.flushing,
    intervalSeconds: intervalSeconds(),
    speedKmh: speedKmh(),
    configuredDevices: [...sim.runs.keys()].map((id) => getDeviceScenario(id)),
  };
}

/** Same RabbitMQ message shape as before: no extra scenario/deviation flags. */
function reportPositions() {
  for (const device of listGpsDevices({ active: true })) {
    const run = sim.runs.get(device.id);
    if (!run || run.finished) continue;
    const route: LineString = selectedRoute(run.config);
    const [longitude, latitude] = positionAtDistance(route, run.traveledMeters);
    const event = addTrackingEvent({
      gpsId: device.id, latitude, longitude, datetime: toUruguayIsoString(new Date()),
    });
    sim.pending.push({
      messageId: randomUUID(),
      body: { ...event, licensePlate: device.licensePlate },
    });
    const routeLength = routeLengthMeters(route);
    if (run.traveledMeters >= routeLength) run.finished = true;
    else run.traveledMeters = Math.min(
      routeLength, run.traveledMeters + speedKmh() * intervalSeconds() / 3.6,
    );
  }
}

/** Retries pending events FIFO; does not remove an event unless the broker confirms it. */
async function flush() {
  if (sim.flushing) return;
  sim.flushing = true;
  try {
    while (sim.pending.length) {
      const { messageId, body } = sim.pending[0];
      await publishJson(TRACKING_EXCHANGE, TRACKING_EVENT_ROUTING_KEY, body, messageId);
      sim.pending.shift();
    }
  } catch (err) {
    const reason = err instanceof Error
      ? err.message || (err as { code?: string }).code || err.name : String(err);
    console.warn(`[tracking] RabbitMQ publish failed (${sim.pending.length} pending): ${reason}`);
  } finally {
    sim.flushing = false;
  }
}

async function tick() {
  reportPositions();
  await flush();
}

export function getTrackingOn(): boolean {
  return isTrackingOn();
}

export function setTracking(on: boolean): boolean {
  if (on && !isTrackingOn()) {
    assertSafeToChange();
    getRabbitConfig();
    const active = listGpsDevices({ active: true });
    if (!active.length || active.some((device) => !sim.runs.has(device.id))) {
      throw new TrackingScenarioConflict("Configure a road scenario for every active GPS device before starting");
    }
    for (const run of sim.runs.values()) {
      run.traveledMeters = 0;
      run.finished = false;
    }
    setTrackingOn(true);
    sim.timer = setInterval(() => void tick(), intervalSeconds() * 1000);
    void tick();
  } else if (!on) {
    if (sim.timer) clearInterval(sim.timer);
    sim.timer = undefined;
    setTrackingOn(false);
    void flush(); // keep pending messages on failure
  }
  return isTrackingOn();
}

/** Manual retry without creating new GPS events; allowed only while stopped. */
export async function retryPendingMessages() {
  if (isTrackingOn()) throw new TrackingScenarioConflict("Stop tracking before manually flushing");
  if (sim.flushing) throw new TrackingScenarioConflict("A publish operation is still running");
  await flush();
  return getTrackingStatus();
}
