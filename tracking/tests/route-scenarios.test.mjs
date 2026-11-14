import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceMeters, distanceToRouteMeters, positionAtDistance, routeLengthMeters } from '../src/lib/route-math.ts';
import { InvalidScenario, parseScenarioConfig, selectedRoute } from '../src/lib/route-scenarios.ts';

const A = {type: 'LineString', coordinates: [[-58, -33], [-58, -33.2]]};
const B = {type: 'LineString', coordinates: [[-58, -33], [-58.02, -33.1], [-58, -33.2]]};
const DETOUR = {type: 'LineString', coordinates: [[-58, -33], [-58.08, -33.1], [-58, -33.2]]};

function config(scenario, authorizedRoutes = [A], deviationRoute = DETOUR) {
  return {scenario, authorizedRoutes, deviationRoute};
}

test('distance is metric on the globe and interpolation follows accumulated length', () => {
  const length = routeLengthMeters(A);
  assert.ok(length > 22_000 && length < 23_000);
  const middle = positionAtDistance(A, length / 2);
  assert.ok(Math.abs(middle[0] + 58) < 0.001);
  assert.ok(Math.abs(middle[1] + 33.1) < 0.001);
  assert.deepEqual(positionAtDistance(A, length + 1), A.coordinates[1]);
  assert.deepEqual(positionAtDistance(A, -50), A.coordinates[0]);
});

test('normal circulation always follows the single authorized route A', () => {
  assert.deepEqual(selectedRoute(parseScenarioConfig(config('NORMAL_A'))), A);
});

test('DESVIO uses the external detour and is >2km from every authorized route', () => {
  const parsed = parseScenarioConfig(config('DESVIO'));
  assert.deepEqual(selectedRoute(parsed), DETOUR);
  const middle = DETOUR.coordinates[1];
  assert.ok(Math.min(...parsed.authorizedRoutes.map(r => distanceToRouteMeters(middle, r))) > 2_000);
});

test('reject removed scenario NORMAL_B and multiple authorized routes', () => {
  assert.throws(() => parseScenarioConfig(config('NORMAL_B', [A])), InvalidScenario);
  assert.throws(() => parseScenarioConfig(config('NORMAL_A', [A, B])), InvalidScenario);
  assert.throws(() => parseScenarioConfig(config('DESVIO', [A, B])), InvalidScenario);
});

test('reject missing detour for DESVIO', () => {
  assert.throws(() => parseScenarioConfig({scenario:'DESVIO', authorizedRoutes:[A]}), InvalidScenario);
});

test('reject a detour that remains on an authorized route', () => {
  assert.throws(() => parseScenarioConfig(config('DESVIO', [A], A)), InvalidScenario);
});

test('reject malformed coordinates, out-of-bounds and short geometries', () => {
  assert.throws(() => parseScenarioConfig(config('NORMAL_A', [{type:'LineString', coordinates:[[185,-33],[-58,-33.2]]}])), InvalidScenario);
  assert.throws(() => parseScenarioConfig(config('NORMAL_A', [{type:'LineString', coordinates:[[-58,-33],[-58,-33]]}])), InvalidScenario);
  assert.throws(() => parseScenarioConfig(config('NORMAL_A', [{type:'LineString', coordinates:[[-58,-33,42],[-58,-33.2]]}])), InvalidScenario);
});

test('configuration clones data, no mutable aliasing with HTTP input', () => {
  const input = structuredClone(config('NORMAL_A'));
  const parsed = parseScenarioConfig(input);
  input.authorizedRoutes[0].coordinates[0][0] = -99;
  assert.equal(parsed.authorizedRoutes[0].coordinates[0][0], -58);
  assert.ok(distanceMeters(A.coordinates[0], A.coordinates[1]) > 20_000); // A unaffected except previous input edit?
});
