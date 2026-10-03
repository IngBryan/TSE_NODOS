import { randomUUID } from "node:crypto";
import {
  getRabbitConfig,
  publishJson,
  TRACKING_EVENT_ROUTING_KEY,
  TRACKING_EXCHANGE,
} from "./rabbitmq";
import {
  addTrackingEvent,
  isTrackingOn,
  lastTrackingEvent,
  listGpsDevices,
  setTrackingOn,
} from "./store";
import type { TrackingEvent } from "./types";

// While tracking_on is true, every interval each active GPS device reports a new
// position (simulated random walk) that is published to RabbitMQ.

const DEFAULT_INTERVAL_SECONDS = 10;
const START_POSITION = { latitude: -34.9011, longitude: -56.1645 }; // Montevideo
const MAX_STEP_DEGREES = 0.005; // ~500 m

/** Message published to the queue: the event plus the vehicle, which the central component needs. */
type TrackingMessage = TrackingEvent & { licensePlate: string };

interface PendingMessage {
  /** Stable across retries so the consumer can discard duplicates (delivery is at-least-once). */
  messageId: string;
  body: TrackingMessage;
}

interface Simulator {
  timer?: ReturnType<typeof setInterval>;
  /** Events not yet confirmed by RabbitMQ, oldest first. Kept across failures and retried. */
  pending: PendingMessage[];
  flushing: boolean;
}

// On globalThis so hot reloads in `next dev` don't start a second timer.
const g = globalThis as unknown as { __trackingSimulator?: Simulator };
const sim = (g.__trackingSimulator ??= { pending: [], flushing: false });

function intervalMs(): number {
  const seconds = Number(process.env.TRACKING_INTERVAL_SECONDS);
  return (seconds > 0 ? seconds : DEFAULT_INTERVAL_SECONDS) * 1000;
}

function step(): number {
  return (Math.random() * 2 - 1) * MAX_STEP_DEGREES;
}

function reportPositions() {
  for (const device of listGpsDevices({ active: true })) {
    const last = lastTrackingEvent(device.id) ?? START_POSITION;
    const event = addTrackingEvent({
      gpsId: device.id,
      latitude: Math.max(-90, Math.min(90, last.latitude + step())),
      longitude: Math.max(-180, Math.min(180, last.longitude + step())),
      datetime: new Date().toISOString(),
    });
    sim.pending.push({
      messageId: randomUUID(),
      body: { ...event, licensePlate: device.licensePlate },
    });
  }
}

/** Publishes pending events in order; stops at the first failure and retries on the next tick. */
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
    // Connection errors (e.g. ECONNREFUSED) can come with an empty message.
    const reason = err instanceof Error ? err.message || (err as { code?: string }).code || err.name : String(err);
    console.warn(
      `[tracking] could not publish to RabbitMQ (${sim.pending.length} event(s) pending): ${reason}`,
    );
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
  if (on) {
    getRabbitConfig(); // fail fast if RabbitMQ is not configured
    if (!sim.timer) {
      sim.timer = setInterval(() => void tick(), intervalMs());
      void tick();
    }
  } else if (sim.timer) {
    clearInterval(sim.timer);
    sim.timer = undefined;
    void flush(); // last attempt to deliver what is still pending
  }
  return setTrackingOn(on);
}
