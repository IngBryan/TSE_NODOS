import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { preparationPlan } from '../src/lib/preparation.ts';
import { positionAtDistance, distanceMeters, distanceToRouteMeters } from '../src/lib/route-math.ts';

const A = { type: 'LineString', coordinates: [[-58, -33], [-58, -33.02], [-58, -33.2]] };
const deviationRoute = { type: 'LineString', coordinates: [[-58, -33], [-58, -33.02], [-58.08, -33.1], [-58, -33.2]] };
const config = { scenario: 'DESVIO', authorizedRoutes: [A], deviationRoute };

test('historical plan stops before departure, on a complete 5-second sample', () => {
  const plan = preparationPlan(config, 5, 80);
  assert.ok(plan.stopAtMeters > 1000);
  assert.ok(plan.stopAtMeters < plan.firstDepartureMeters);
  const step = 80 * 5 / 3.6;
  for (let i = 0; i < plan.expectedPoints; i++)
    assert.ok(distanceToRouteMeters(positionAtDistance(deviationRoute, i * step), A) <= 0.5);
  assert.equal(plan.durationSeconds, (plan.expectedPoints - 1) * 5);
  assert.equal(preparationPlan({ ...config, scenario: 'NORMAL_A' }, 5, 80), null);
  assert.equal(preparationPlan({ ...config, deviationRoute: { type: 'LineString', coordinates: [A.coordinates[0], [-58.08, -33.1], A.coordinates.at(-1)] } }, 5, 80), null);
});

// Real simulator/store with a fake broker; never opens a socket or starts a stack.
const publications = [];
let rejectPublish = false;
globalThis.__testPublish = async (...args) => {
  if (rejectPublish) throw new Error('broker unavailable');
  publications.push(args);
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes('/tracking/src/lib/') && specifier.startsWith('./') && !specifier.endsWith('.ts'))
      return nextResolve(specifier + '.ts', context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/tracking/src/lib/rabbitmq.ts')) return {
      format: 'module', shortCircuit: true,
      source: `export const TRACKING_EXCHANGE='tracking', TRACKING_EVENT_ROUTING_KEY='tracking.event';
      export const getRabbitConfig=()=>({}); export const publishJson=(...args)=>globalThis.__testPublish(...args);`,
    };
    return nextLoad(url, context);
  },
});
const { configureDeviceScenario, getTrackingStatus, setTracking, setDeviceTracking, retryPendingMessages } = await import('../src/lib/tracking.ts');
const { listGpsDevices, updateGpsDevice, createGpsDevice } = await import('../src/lib/store.ts');
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('bounded accelerated preparation pauses exactly; resume retains position and uses actual time', async t => {
  process.env.TRACKING_INTERVAL_SECONDS = '5';
  process.env.TRACKING_SPEED_KMH = '80';
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-11-14T12:00:00Z') });
  for (const d of listGpsDevices()) updateGpsDevice(d.id, { ...d, active: d.id === 2 });
  const configured = configureDeviceScenario(2, config);
  const boundary = configured.preparation.stopAtMeters;
  assert.throws(() => setTracking(true, 20, { stopAtMeters: boundary + 1 }), /validated common prefix/);
  setTracking(true, 20, { stopAtMeters: boundary, configurationId: configured.configurationId });
  const firstAt = getTrackingStatus().simulatedStartAt;
  await settle();
  for (let i = 1; i < configured.preparation.expectedPoints; i++) { t.mock.timers.tick(250); await settle(); }
  const paused = getTrackingStatus();
  assert.equal(paused.trackingOn, false);
  assert.equal(paused.pausedAtBoundary, true);
  assert.equal(paused.pendingMessages, 0);
  assert.equal(paused.configuredDevices.find(d => d.gpsId === 2).lastReportedMeters, boundary);
  assert.equal(publications.length, configured.preparation.expectedPoints);
  assert.equal(Date.parse(publications[0][2].datetime), Date.parse(firstAt));
  assert.ok(publications.every(p => Date.parse(p[2].datetime) <= Date.now()));
  for (let i = 1; i < publications.length; i++)
    assert.equal(Date.parse(publications[i][2].datetime) - Date.parse(publications[i - 1][2].datetime), 5000);
  const last = publications.at(-1)[2];
  const count = publications.length;
  t.mock.timers.tick(10000); await settle();
  assert.equal(publications.length, count); // no points beyond the boundary
  assert.throws(() => setTracking(true, 1, { resume: true, configurationId: 'stale-id' }), /changed/);
  setTracking(true, 1, { resume: true, configurationId: configured.configurationId });
  await settle();
  const resumed = publications.at(-1)[2];
  assert.deepEqual([resumed.longitude, resumed.latitude], [last.longitude, last.latitude]);
  assert.equal(Date.parse(resumed.datetime), Date.now());
  t.mock.timers.tick(5000); await settle();
  const next = publications.at(-1)[2];
  assert.equal(Date.parse(next.datetime) - Date.parse(resumed.datetime), 5000);
  assert.ok(Math.abs(distanceMeters([resumed.longitude, resumed.latitude], [next.longitude, next.latitude]) - 80 * 5 / 3.6) < 0.1);
  setTracking(false); await settle();
  // A failed confirm keeps the exact same event and blocks any restart until retried.
  rejectPublish = true;
  setTracking(true, 1, { resume: true, configurationId: configured.configurationId });
  await settle();
  setTracking(false); await settle();
  assert.equal(getTrackingStatus().pendingMessages, 1);
  assert.throws(() => setTracking(true, 1, { resume: true }), /pending RabbitMQ/);
  rejectPublish = false;
  await retryPendingMessages();
  assert.equal(getTrackingStatus().pendingMessages, 0);
  t.mock.timers.reset();
});

test('explicit GPS id preserves existing assignments and automatic ID allocation', () => {
  const before = structuredClone(listGpsDevices());
  const dedicated = createGpsDevice({ licensePlate: 'LT00001', active: false }, 100001);
  assert.equal(dedicated.id, 100001);
  assert.deepEqual(listGpsDevices().filter(d => d.id !== 100001), before);
  assert.throws(() => createGpsDevice({ licensePlate: 'OTHER', active: true }, 100001), /already exists/);
  assert.throws(() => createGpsDevice({ licensePlate: 'OTHER', active: true }, -1), /invalid/);
  const ordinary = createGpsDevice({ licensePlate: 'TEST001', active: false });
  assert.equal(ordinary.id, 4);
});

test('prepare 20x, start normal GPS, resume detour 1x, then stop either without stopping the other', async t => {
  publications.length = 0;
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-11-14T15:00:00Z') });
  for (const d of listGpsDevices()) updateGpsDevice(d.id, { ...d, active: d.id === 2 });
  const detour = configureDeviceScenario(2, config);
  setTracking(true, 20, { stopAtMeters: detour.preparation.stopAtMeters, configurationId: detour.configurationId });
  await settle();
  assert.throws(() => setDeviceTracking(2, true, { resume: true, configurationId: detour.configurationId }), /already running/);
  for (let i = 1; i < detour.preparation.expectedPoints; i++) { t.mock.timers.tick(250); await settle(); }
  const boundary = publications.at(-1)[2];
  updateGpsDevice(100001, { licensePlate: 'LT00001', active: true });
  const normal = configureDeviceScenario(100001, { scenario: 'NORMAL_A', authorizedRoutes: [A] });
  setDeviceTracking(100001, true, { configurationId: normal.configurationId }); await settle();
  assert.equal(getTrackingStatus().configuredDevices.find(d => d.gpsId === 2).pausedAtBoundary, true);
  setDeviceTracking(2, true, { resume: true, configurationId: detour.configurationId });
  const count = gps => publications.filter(p => p[2].gpsId === gps).length;
  const before = [count(2), count(100001)];
  t.mock.timers.tick(5000); await settle();
  assert.deepEqual([count(2), count(100001)], before.map(n => n + 1));
  const resumed = publications.filter(p => p[2].gpsId === 2).at(-1)[2];
  assert.deepEqual([resumed.longitude, resumed.latitude], [boundary.longitude, boundary.latitude]);
  assert.equal(Date.parse(resumed.datetime), Date.now());
  assert.throws(() => setTracking(true, 20), /Stop tracking/);
  const both = [count(2), count(100001)];
  setDeviceTracking(2, false);
  t.mock.timers.tick(5000); await settle();
  assert.deepEqual([count(2), count(100001)], [both[0], both[1] + 1]);
  assert.equal(getTrackingStatus().trackingOn, true);
  const liveState = getTrackingStatus().configuredDevices.find(d => d.gpsId === 100001);
  assert.equal(liveState.confirmedPoints, liveState.emittedPoints);
  setDeviceTracking(2, true, { resume: true, configurationId: detour.configurationId });
  setDeviceTracking(100001, false); await settle();
  const reverse = [count(2), count(100001)];
  t.mock.timers.tick(5000); await settle();
  assert.deepEqual([count(2), count(100001)], [reverse[0] + 1, reverse[1]]);
  assert.equal(getTrackingStatus().trackingOn, true);
  setDeviceTracking(2, false); await settle();
  assert.equal(getTrackingStatus().trackingOn, false);
  const total = publications.length;
  t.mock.timers.tick(10000); await settle();
  assert.equal(publications.length, total);
  t.mock.timers.reset();
});
