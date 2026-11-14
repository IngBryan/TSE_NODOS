/**
 * Optional time compression for development demos. It changes wall-clock emission
 * cadence, NEVER vehicle speed or the interval between GPS measurements.
 *
 * A run is anchored in the past so its *last* planned GPS measurement is no
 * later than the instant the run starts. This avoids publishing future GPS
 * timestamps when simulating a long itinerary in a few minutes.
 *
 * The selected guide must already have been assigned before simulatedStartAt.
 * Tracking cannot validate that domain precondition: the Central owns guides.
 */
export const SIMULATION_SPEED_FACTORS = [1, 5, 10, 20] as const;
export type SimulationSpeedFactor = typeof SIMULATION_SPEED_FACTORS[number];
const MIN_WALL_INTERVAL_MS = 200;

export function isSimulationSpeedFactor(value: unknown): value is SimulationSpeedFactor {
  return typeof value === "number" && SIMULATION_SPEED_FACTORS.some((factor) => factor === value);
}

/** Reject unbounded emission rates rather than silently changing the GPS cadence. */
export function wallIntervalMs(gpsIntervalSeconds: number, factor: SimulationSpeedFactor): number {
  const ms = (gpsIntervalSeconds * 1_000) / factor;
  if (!Number.isFinite(ms) || ms < MIN_WALL_INTERVAL_MS) {
    throw new Error(`Simulation factor ${factor}x requires at least ${MIN_WALL_INTERVAL_MS} ms between publications`);
  }
  return ms;
}

export interface AcceleratedClock {
  readonly simulatedStartAt: string;
  nextMeasurement(): Date;
}

/**
 * Clock shared by all active GPS devices for one run. Position advancement
 * remains speedKmh * gpsIntervalSeconds / 3.6 meters per measurement.
 */
export function createAcceleratedClock(
  nowMs: number,
  maxRouteMeters: number,
  gpsIntervalSeconds: number,
  speedKmh: number,
): AcceleratedClock {
  const stepMeters = speedKmh * gpsIntervalSeconds / 3.6;
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxRouteMeters) || maxRouteMeters < 0
      || !Number.isFinite(stepMeters) || stepMeters <= 0) {
    throw new Error("Invalid simulation clock parameters");
  }
  // First position is the origin; final position is emitted after ceil(L/step) intervals.
  const steps = Math.ceil(maxRouteMeters / stepMeters - 1e-9);
  const startMs = nowMs - steps * gpsIntervalSeconds * 1_000;
  if (!Number.isFinite(startMs) || !Number.isFinite(new Date(startMs).getTime())) {
    throw new Error("Simulated itinerary is too long for a valid timestamp");
  }
  let emitted = 0;
  return {
    simulatedStartAt: new Date(startMs).toISOString(),
    nextMeasurement() {
      return new Date(startMs + emitted++ * gpsIntervalSeconds * 1_000);
    },
  };
}
