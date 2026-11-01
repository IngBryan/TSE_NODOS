/** Pure WGS84 geometry helpers. GeoJSON coordinates are [longitude, latitude]. */
export type LonLat = [longitude: number, latitude: number];
export type LineString = { type: "LineString"; coordinates: LonLat[] };

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function distanceMeters(a: LonLat, b: LonLat): number {
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(b[0] - a[0]);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Spherical interpolation: avoids using degrees as if they were metres. */
export function interpolate(a: LonLat, b: LonLat, fraction: number): LonLat {
  if (fraction <= 0) return [...a];
  if (fraction >= 1) return [...b];
  const d = distanceMeters(a, b) / EARTH_RADIUS_M;
  if (d < 1e-12) return [...a];
  const wa = Math.sin((1 - fraction) * d) / Math.sin(d);
  const wb = Math.sin(fraction * d) / Math.sin(d);
  const la = toRadians(a[1]);
  const lb = toRadians(b[1]);
  const oa = toRadians(a[0]);
  const ob = toRadians(b[0]);
  const x = wa * Math.cos(la) * Math.cos(oa) + wb * Math.cos(lb) * Math.cos(ob);
  const y = wa * Math.cos(la) * Math.sin(oa) + wb * Math.cos(lb) * Math.sin(ob);
  const z = wa * Math.sin(la) + wb * Math.sin(lb);
  return [toDegrees(Math.atan2(y, x)), toDegrees(Math.atan2(z, Math.hypot(x, y)))];
}

export function routeLengthMeters(route: LineString): number {
  return route.coordinates.slice(1).reduce(
    (total, point, i) => total + distanceMeters(route.coordinates[i], point), 0,
  );
}

/** Returns the position at a given accumulated distance, clamped to the endpoints. */
export function positionAtDistance(route: LineString, traveledMeters: number): LonLat {
  if (traveledMeters <= 0) return [...route.coordinates[0]];
  let left = traveledMeters;
  for (let i = 1; i < route.coordinates.length; i++) {
    const a = route.coordinates[i - 1];
    const b = route.coordinates[i];
    const length = distanceMeters(a, b);
    if (left <= length && length > 0) return interpolate(a, b, left / length);
    left -= length;
  }
  return [...route.coordinates[route.coordinates.length - 1]];
}

/** Small-region metric projection used only for checking the test deviation. */
export function distanceToRouteMeters(point: LonLat, route: LineString): number {
  const lat0 = toRadians(point[1]);
  const cosLat = Math.cos(lat0);
  const project = (p: LonLat): [number, number] => [
    EARTH_RADIUS_M * toRadians(p[0] - point[0]) * cosLat,
    EARTH_RADIUS_M * toRadians(p[1] - point[1]),
  ];
  let nearest = Infinity;
  for (let i = 1; i < route.coordinates.length; i++) {
    const [ax, ay] = project(route.coordinates[i - 1]);
    const [bx, by] = project(route.coordinates[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
      ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return nearest;
}
