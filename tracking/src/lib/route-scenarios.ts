import {
  distanceMeters, distanceToRouteMeters, positionAtDistance, routeLengthMeters,
  type LineString,
} from "./route-math.ts";

export type TrackingScenario = "NORMAL_A" | "DESVIO";
export interface DeviceScenarioConfig {
  scenario: TrackingScenario;
  /** Exactly one immutable authorized line (A). Array shape preserves the API contract. */
  authorizedRoutes: LineString[];
  /** Optional OSRM driving route through a detour waypoint, never an authorized line. */
  deviationRoute?: LineString;
  /** Distance threshold supplied by the operator when configuring a detour. */
  deviationThresholdMeters?: number;
}

const MAX_COORDINATES = 20_000;
const MIN_LENGTH_METERS = 100;

export class InvalidScenario extends Error {}

function parseLineString(value: unknown, field: string): LineString {
  if (!value || typeof value !== "object") throw new InvalidScenario(`${field} must be GeoJSON LineString`);
  const data = value as Record<string, unknown>;
  if (data.type !== "LineString" || !Array.isArray(data.coordinates)
      || data.coordinates.length < 2 || data.coordinates.length > MAX_COORDINATES) {
    throw new InvalidScenario(`${field} must contain 2..${MAX_COORDINATES} GeoJSON coordinates`);
  }
  const coordinates = data.coordinates.map((value, index) => {
    if (!Array.isArray(value) || value.length !== 2
        || typeof value[0] !== "number" || typeof value[1] !== "number"
        || !Number.isFinite(value[0]) || !Number.isFinite(value[1])
        || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) {
      throw new InvalidScenario(`${field}.coordinates[${index}] must be [longitude, latitude] in WGS84`);
    }
    return [value[0], value[1]] as [number, number];
  });
  const route: LineString = { type: "LineString", coordinates };
  if (routeLengthMeters(route) < MIN_LENGTH_METERS) {
    throw new InvalidScenario(`${field} is too short (${MIN_LENGTH_METERS} m minimum)`);
  }
  return route;
}

/** Data supplied by a trusted test administrator, NOT generated from arbitrary points. */
export function parseScenarioConfig(value: unknown): DeviceScenarioConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidScenario("Body must be an object");
  }
  const data = value as Record<string, unknown>;
  if (!isTrackingScenario(data.scenario)) {
    throw new InvalidScenario("scenario must be NORMAL_A or DESVIO");
  }
  let deviationThresholdMeters: number | undefined;
  if (data.deviationThresholdMeters !== undefined) {
    const threshold = data.deviationThresholdMeters;
    if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1 || threshold > 10_000) {
      throw new InvalidScenario("deviationThresholdMeters must be an integer between 1 and 10000 metres");
    }
    deviationThresholdMeters = threshold;
  }
  if (data.scenario === "DESVIO" && deviationThresholdMeters === undefined) {
    throw new InvalidScenario("DESVIO requires deviationThresholdMeters");
  }
  if (!Array.isArray(data.authorizedRoutes) || data.authorizedRoutes.length !== 1) {
    throw new InvalidScenario("authorizedRoutes must contain exactly one authorized GeoJSON line (A)");
  }
  const authorizedRoutes = data.authorizedRoutes.map((v, i) => parseLineString(v, `authorizedRoutes[${i}]`));
  const deviationRoute = data.deviationRoute === undefined
    ? undefined : parseLineString(data.deviationRoute, "deviationRoute");
  if (data.scenario === "DESVIO" && !deviationRoute) {
    throw new InvalidScenario("DESVIO requires deviationRoute from OSRM");
  }
  if (deviationRoute) {
    const reference = authorizedRoutes[0];
    const deviationStart = deviationRoute.coordinates[0];
    const deviationEnd = deviationRoute.coordinates[deviationRoute.coordinates.length - 1];
    const referenceStart = reference.coordinates[0];
    const referenceEnd = reference.coordinates[reference.coordinates.length - 1];
    if (distanceMeters(deviationStart, referenceStart) > 3_000
        || distanceMeters(deviationEnd, referenceEnd) > 3_000) {
      throw new InvalidScenario("deviationRoute must start and finish near the authorized itinerary");
    }
    const length = routeLengthMeters(deviationRoute);
    const samples = Math.min(300, Math.max(10, Math.ceil(length / 500)));
    let maximumOffset = 0;
    for (let i = 0; i <= samples; i++) {
      const point = positionAtDistance(deviationRoute, (length * i) / samples);
      const offset = Math.min(...authorizedRoutes.map((route) => distanceToRouteMeters(point, route)));
      maximumOffset = Math.max(maximumOffset, offset);
    }
    if (deviationThresholdMeters !== undefined && maximumOffset <= deviationThresholdMeters) {
      throw new InvalidScenario(`deviationRoute must exceed the threshold of ${deviationThresholdMeters} metres`);
    }
  }
  return { scenario: data.scenario, authorizedRoutes, deviationRoute, deviationThresholdMeters };
}

export function isTrackingScenario(value: unknown): value is TrackingScenario {
  return value === "NORMAL_A" || value === "DESVIO";
}

export function selectedRoute(config: DeviceScenarioConfig): LineString {
  if (config.scenario === "DESVIO") return config.deviationRoute!;
  return config.authorizedRoutes[0];
}
