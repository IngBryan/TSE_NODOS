import { distanceToRouteMeters, positionAtDistance, routeLengthMeters } from "./route-math.ts";
import { selectedRoute, type DeviceScenarioConfig } from "./route-scenarios.ts";

/** Only GPS samples on the common prefix are eligible for historical preparation.
 * Half a metre is below Central's smallest configurable deviation threshold (1m).
 * Leave two additional on-route measurements before the first departing measurement.
 */
export function preparationPlan(config: DeviceScenarioConfig, intervalSeconds: number, speedKmh: number) {
  if (config.scenario !== "DESVIO") return null;
  const route = selectedRoute(config);
  const step = speedKmh * intervalSeconds / 3.6;
  const length = routeLengthMeters(route);
  const steps = Math.ceil(length / step);
  if (!Number.isFinite(step) || step <= 0 || steps > 50_000) return null;
  for (let index = 0; index <= steps; index++) {
    const distance = Math.min(length, index * step);
    if (distanceToRouteMeters(positionAtDistance(route, distance), config.authorizedRoutes[0]) > 0.5) {
      const stopIndex = index - 3;
      if (stopIndex < 1) return null;
      return {
        stopAtMeters: stopIndex * step,
        durationSeconds: stopIndex * intervalSeconds,
        expectedPoints: stopIndex + 1,
        firstDepartureMeters: distance,
      };
    }
  }
  return null;
}
