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
import { preparationPlan } from "./preparation";
import type { TrackingEvent } from "./types";
import {
  createAcceleratedClock, wallIntervalMs, type AcceleratedClock,
  type SimulationSpeedFactor,
} from "./simulation-clock";

/** Each active, configured device follows its own real road geometry. */
const DEFAULT_INTERVAL_SECONDS = 5;
const DEFAULT_SPEED_KMH = 80;

type TrackingMessage = TrackingEvent & { licensePlate: string };
interface PendingMessage {
  /** Stable across retries. Never regenerate messageId or the GPS event on failure. */
  messageId: string;
  body: TrackingMessage;
}
interface DeviceRun {
  config: DeviceScenarioConfig;
  configurationId: string;
  preparation: ReturnType<typeof preparationPlan>;
  lastReportedMeters?: number;
  lastMessageId?: string;
  lastMeasurementAt?: string;
  emittedPoints: number;
  confirmedPoints: number;
  running: boolean;
  pausedAtBoundary: boolean;
  traveledMeters: number;
  finished: boolean;
}
interface Simulator {
  timer?: ReturnType<typeof setInterval>;
  pending: PendingMessage[];
  flushing: boolean;
  runs: Map<number, DeviceRun>;
  factor?: SimulationSpeedFactor;
  clock?: AcceleratedClock;
  stopAtMeters?: number;
  ticking?: boolean;
  pausedAtBoundary?: boolean;
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
  if (isTrackingOn() || sim.timer || sim.ticking || sim.flushing || sim.pending.length > 0) {
    throw new TrackingScenarioConflict(
      "Stop tracking and confirm all pending RabbitMQ messages before changing routes or restarting",
    );
  }
}

export function configureDeviceScenario(gpsId: number, config: DeviceScenarioConfig) {
  const previous = sim.runs.get(gpsId);
  if (previous?.running || sim.pending.some(m => m.body.gpsId === gpsId)
      || (isTrackingOn() && ((sim.factor ?? 1) !== 1 || sim.clock)))
    throw new TrackingScenarioConflict("Stop this GPS and confirm its pending messages before changing its route; accelerated preparation is exclusive");
  if (!getGpsDevice(gpsId)) throw new Error("GPS device not found");
  // The parser returned defensive coordinate copies, preventing mutation by caller.
  sim.runs.set(gpsId, { config, configurationId: randomUUID(),
    preparation: preparationPlan(config, intervalSeconds(), speedKmh()),
    traveledMeters: 0, finished: false, emittedPoints: 0, confirmedPoints: 0, running: false, pausedAtBoundary: false });
  return getDeviceScenario(gpsId);
}

export function getDeviceScenario(gpsId: number) {
  const run = sim.runs.get(gpsId);
  if (!run) return null;
  return {
    gpsId,
    scenario: run.config.scenario,
    deviationThresholdMeters: run.config.deviationThresholdMeters,
    configurationId: run.configurationId,
    preparation: run.preparation,
    lastReportedMeters: run.lastReportedMeters ?? null,
    lastMessageId: run.lastMessageId ?? null,
    lastMeasurementAt: run.lastMeasurementAt ?? null,
    emittedPoints: run.emittedPoints,
    confirmedPoints: run.confirmedPoints,
    running: run.running,
    pausedAtBoundary: run.pausedAtBoundary,
    pendingMessages: sim.pending.filter(m => m.body.gpsId === gpsId).length,
    authorizedAlternatives: run.config.authorizedRoutes.length,
    distanceMeters: Math.round(routeLengthMeters(selectedRoute(run.config))),
    traveledMeters: Math.round(run.traveledMeters),
    finished: run.finished,
  };
}

export function getTrackingStatus() {
  return {
    trackingOn: isTrackingOn(),
    capabilities: ["bounded-preparation-v1", "explicit-gps-id-v1", "per-gps-control-v1"],
    pausedAtBoundary: [...sim.runs.values()].some(r => r.pausedAtBoundary),
    stopAtMeters: sim.stopAtMeters ?? null,
    pendingMessages: sim.pending.length,
    flushing: sim.flushing,
    intervalSeconds: intervalSeconds(),
    speedKmh: speedKmh(),
    simulationSpeedFactor: isTrackingOn() ? (sim.factor ?? 1) : 1,
    simulatedStartAt: isTrackingOn() ? (sim.clock?.simulatedStartAt ?? null) : null,
    configuredDevices: [...sim.runs.keys()].map((id) => getDeviceScenario(id)),
  };
}

/** Same RabbitMQ message shape as before: no extra scenario/deviation flags. */
function reportPositions() {
  // A single measurement instant for all devices in the same tick.
  const simulatedMeasurement = sim.clock?.nextMeasurement();
  for (const device of listGpsDevices({ active: true })) {
    const run = sim.runs.get(device.id);
    if (!run || !run.running || run.finished) continue;
    const route: LineString = selectedRoute(run.config);
    const [longitude, latitude] = positionAtDistance(route, run.traveledMeters);
    const event = addTrackingEvent({
      gpsId: device.id, latitude, longitude, datetime: toUruguayIsoString(simulatedMeasurement ?? new Date()),
    });
    const messageId = randomUUID();
    run.lastReportedMeters = run.traveledMeters;
    run.lastMessageId = messageId;
    run.lastMeasurementAt = event.datetime;
    run.emittedPoints++;
    sim.pending.push({
      messageId,
      body: { ...event, licensePlate: device.licensePlate },
    });
    const routeLength = Math.min(routeLengthMeters(route), sim.stopAtMeters ?? Infinity);
    if (run.traveledMeters >= routeLength) {
      run.finished = true;
      run.running = false;
      run.pausedAtBoundary = sim.stopAtMeters !== undefined;
    }
    else {
      const next = run.traveledMeters + speedKmh() * intervalSeconds() / 3.6;
      // Avoid an extra sample caused by floating point residue at an exact GPS step.
      run.traveledMeters = next + 1e-8 >= routeLength ? routeLength : next;
    }
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
      const run = sim.runs.get(body.gpsId);
      if (run) run.confirmedPoints++;
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
  // Do not generate more samples while a previous broker-confirm operation is pending.
  if (sim.ticking || !isTrackingOn()) return;
  sim.ticking = true;
  try {
    reportPositions();
    if (![...sim.runs.values()].some(r => r.running)) {
      if (sim.timer) clearInterval(sim.timer);
      sim.timer = undefined;
      sim.pausedAtBoundary = sim.stopAtMeters !== undefined;
      setTrackingOn(false);
    }
    await flush();
  } finally {
    sim.ticking = false;
  }
}

export function getTrackingOn(): boolean {
  return isTrackingOn();
}

/** Optional factor only applies to this run; omitted means the legacy 1x mode. */
export function setTracking(on: boolean, requestedFactor?: SimulationSpeedFactor, options: { stopAtMeters?: number; resume?: boolean; configurationId?: string } = {}): boolean {
  if (on && isTrackingOn() && (options.resume || options.stopAtMeters !== undefined || options.configurationId))
    throw new TrackingScenarioConflict("Stop tracking before preparing or resuming a route");
  if (on && !isTrackingOn()) {
    assertSafeToChange();
    getRabbitConfig();
    const active = listGpsDevices({ active: true });
    if (!active.length || active.some((device) => !sim.runs.has(device.id))) {
      throw new TrackingScenarioConflict("Configure a road scenario for every active GPS device before starting");
    }
    const factor = requestedFactor ?? 1;
    const resume = options.resume === true;
    const bounded = options.stopAtMeters !== undefined;
    if ((bounded || resume) && active.length !== 1)
      throw new TrackingScenarioConflict("Preparation and resume require exactly one active GPS");
    const selected = sim.runs.get(active[0].id)!;
    if (options.configurationId && options.configurationId !== selected.configurationId)
      throw new TrackingScenarioConflict("The prepared route changed or Tracking restarted; prepare again");
    if (resume && (factor !== 1 || bounded || selected.lastReportedMeters === undefined
        || selected.lastReportedMeters >= routeLengthMeters(selectedRoute(selected.config))))
      throw new TrackingScenarioConflict("Resume requires a paused position before the endpoint and factor 1");
    if (bounded && (!Number.isFinite(options.stopAtMeters) || options.stopAtMeters! <= 0
        || options.stopAtMeters! >= routeLengthMeters(selectedRoute(selected.config))))
      throw new TrackingScenarioConflict("stopAtMeters must lie strictly inside the configured route");
    if (bounded && (!selected.preparation
        || Math.abs(options.stopAtMeters! - selected.preparation.stopAtMeters) > 0.001))
      throw new TrackingScenarioConflict("Historical preparation must stop at the validated common prefix");
    const publishEveryMs = wallIntervalMs(intervalSeconds(), factor);
    // Only the bounded prefix determines its historical window, never the entire route.
    const clock = factor === 1 ? undefined : createAcceleratedClock(
      Date.now(), bounded ? options.stopAtMeters! :
        Math.max(...active.map(device => routeLengthMeters(selectedRoute(sim.runs.get(device.id)!.config)))),
      intervalSeconds(), speedKmh(),
    );
    for (const device of active) {
      const run = sim.runs.get(device.id)!;
      run.traveledMeters = resume ? run.lastReportedMeters! : 0;
      run.finished = false;
      run.running = true;
      run.pausedAtBoundary = false;
      if (!resume) {
        run.emittedPoints = 0;
        run.confirmedPoints = 0;
        run.lastReportedMeters = undefined;
        run.lastMessageId = undefined;
        run.lastMeasurementAt = undefined;
      }
    }
    sim.stopAtMeters = options.stopAtMeters;
    sim.pausedAtBoundary = false;
    sim.factor = factor;
    sim.clock = clock;
    setTrackingOn(true);
    sim.timer = setInterval(() => void tick(), publishEveryMs);
    void tick();
  } else if (on && requestedFactor !== undefined && requestedFactor !== (sim.factor ?? 1)) {
    throw new TrackingScenarioConflict("Stop tracking before changing the simulation speed factor");
  } else if (!on) {
    for (const run of sim.runs.values()) run.running = false;
    if (sim.timer) clearInterval(sim.timer);
    sim.timer = undefined;
    setTrackingOn(false);
    sim.factor = 1;
    sim.clock = undefined;
    void flush(); // keep pending messages on failure
  }
  return isTrackingOn();
}

/** Join/leave the shared real-time clock without resetting or stopping any other GPS. */
export function setDeviceTracking(gpsId: number, on: boolean, options: { resume?: boolean; configurationId?: string } = {}) {
  const run = sim.runs.get(gpsId);
  if (!run || !getGpsDevice(gpsId)) throw new TrackingScenarioConflict("Configure this GPS before starting it");
  if (!on) {
    run.running = false;
    if (![...sim.runs.values()].some(r => r.running)) setTracking(false);
    return getDeviceScenario(gpsId);
  }
  if (!options.configurationId || options.configurationId !== run.configurationId)
    throw new TrackingScenarioConflict("The GPS configuration changed; prepare again");
  if (!getGpsDevice(gpsId)!.active) throw new TrackingScenarioConflict("Activate this GPS before starting it");
  if (run.running) throw new TrackingScenarioConflict("This GPS is already running");
  if ((isTrackingOn() && ((sim.factor ?? 1) !== 1 || sim.clock))
      || sim.pending.some(m => m.body.gpsId === gpsId))
    throw new TrackingScenarioConflict("Per-GPS control requires real-time mode and no pending messages for this GPS");
  if (options.resume && (run.lastReportedMeters === undefined || run.lastReportedMeters >= routeLengthMeters(selectedRoute(run.config))))
    throw new TrackingScenarioConflict("No paused position before the endpoint to resume");
  getRabbitConfig();
  run.traveledMeters = options.resume ? run.lastReportedMeters! : 0;
  run.finished = false;
  run.running = true;
  run.pausedAtBoundary = false;
  if (!options.resume) {
    run.emittedPoints = 0;
    run.confirmedPoints = 0;
    run.lastReportedMeters = undefined;
    run.lastMessageId = undefined;
    run.lastMeasurementAt = undefined;
  }
  sim.factor = 1;
  sim.clock = undefined;
  sim.stopAtMeters = undefined;
  if (!sim.timer) {
    setTrackingOn(true);
    sim.timer = setInterval(() => void tick(), intervalSeconds() * 1000);
    void tick();
  }
  return getDeviceScenario(gpsId);
}

/** Manual retry without creating new GPS events; allowed only while stopped. */
export async function retryPendingMessages() {
  if (isTrackingOn()) throw new TrackingScenarioConflict("Stop tracking before manually flushing");
  if (sim.flushing) throw new TrackingScenarioConflict("A publish operation is still running");
  await flush();
  return getTrackingStatus();
}
