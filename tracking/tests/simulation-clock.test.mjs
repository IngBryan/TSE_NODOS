import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAcceleratedClock, isSimulationSpeedFactor, wallIntervalMs,
} from '../src/lib/simulation-clock.ts';

test('only explicit safe factors are accepted; omitted factor remains 1x', () => {
  for (const factor of [1, 5, 10, 20]) assert.equal(isSimulationSpeedFactor(factor), true);
  for (const invalid of [0, -1, 2, 50, '20', null, NaN, Infinity]) {
    assert.equal(isSimulationSpeedFactor(invalid), false);
  }
});

test('20x publishes every 500 ms for a 10-second simulated GPS interval', () => {
  assert.equal(wallIntervalMs(10, 1), 10_000);
  assert.equal(wallIntervalMs(10, 5), 2_000);
  assert.equal(wallIntervalMs(10, 10), 1_000);
  assert.equal(wallIntervalMs(10, 20), 500);
  assert.throws(() => wallIntervalMs(1, 20), /at least 200 ms/);
});

test('virtual GPS time advances by 10 sec while physical speed stays 80 km/h', () => {
  const now = Date.parse('2026-11-02T12:00:00.000Z');
  const speedKmh = 80;
  const intervalSeconds = 10;
  const distanceMeters = 22_222; // about 1,000 seconds of driving
  const clock = createAcceleratedClock(now, distanceMeters, intervalSeconds, speedKmh);
  const first = clock.nextMeasurement();
  const second = clock.nextMeasurement();
  const stepMeters = speedKmh * intervalSeconds / 3.6;
  assert.equal(second.getTime() - first.getTime(), 10_000);
  assert.ok(Math.abs((stepMeters / 1_000) / (10_000 / 3_600_000) - 80) < 1e-8);
  assert.ok(first.getTime() < now);
  const steps = Math.ceil(distanceMeters / stepMeters);
  for (let index = 2; index <= steps; index++) clock.nextMeasurement();
  assert.equal(clock.nextMeasurement().getTime(), now + 10_000); // next beyond planned final, not emitted
});

test('the final measurement of a complete route is never in the future', () => {
  const now = Date.parse('2026-11-02T12:00:00.000Z');
  const length = 125_226;
  const step = 80 * 10 / 3.6;
  const steps = Math.ceil(length / step);
  const clock = createAcceleratedClock(now, length, 10, 80);
  assert.equal(new Date(clock.simulatedStartAt).getTime(), now - steps * 10_000);
  let last;
  for (let i = 0; i <= steps; i++) last = clock.nextMeasurement();
  assert.equal(last.getTime(), now);
});

test('independent runs obtain independent clocks without global mutable state', () => {
  const a = createAcceleratedClock(500_000_000, 1_000, 10, 80);
  const b = createAcceleratedClock(500_000_000, 1_000, 10, 80);
  assert.equal(a.nextMeasurement().getTime(), b.nextMeasurement().getTime());
  const secondA = a.nextMeasurement();
  const secondB = b.nextMeasurement();
  assert.equal(secondA.getTime(), secondB.getTime());
  assert.equal(a.nextMeasurement().getTime() - secondB.getTime(), 10_000);
});

test('5-second GPS measurements remain 5 seconds apart at 20x and advance about 111 m', () => {
  assert.equal(wallIntervalMs(5, 1), 5_000);
  assert.equal(wallIntervalMs(5, 20), 250);
  const now = Date.parse('2026-11-14T12:00:00Z');
  const clock = createAcceleratedClock(now, 1_000, 5, 80);
  const first = clock.nextMeasurement();
  const second = clock.nextMeasurement();
  assert.equal(second.getTime() - first.getTime(), 5_000);
  assert.ok(Math.abs(80 * 5 / 3.6 - 111.111111) < 0.001);
  assert.ok(second.getTime() <= now);
});
