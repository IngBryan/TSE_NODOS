import test, { mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { start, stop, view } from "../src/lib/runner.ts";
import { save, load, stateDir } from "../src/lib/store.ts";
import { checkPoller, poller, PollerRunFailed } from "../src/lib/poller.ts";
import { profile } from "../src/lib/config.ts";
import { caseTypes } from "../src/lib/types.ts";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "panel test con espacios-"));
process.env.PANEL_STATE_DIR = path.join(temp, "state");
process.env.PANEL_CONFIG_FILE = path.join(temp, "config.json");
const originals = [
  { id: 1, licensePlate: "SBC1234", active: false },
  { id: 2, licensePlate: "STU5678", active: true },
  { id: 100001, licensePlate: "LT00001", active: false },
];
let devices = structuredClone(originals),
  tracking = false,
  configGps = 1,
  started = 0,
  dates = [],
  never = false,
  interval = 5,
  weighing = null,
  failRestore = false,
  prepared = false,
  liveDetour = false,
  staleConfiguration = false,
  recentGuide = false,
  missingPrefix = false,
  prefixDates = [],
  following = false,
  finishLive = false,
  scopedMode = false,
  scoped = new Map(),
  scopedEvents = new Map(),
  requestedFactors = [],
  weighingGps = [],
  failWeighing = false,
  missingHistoricalEnd = false,
  unavailable = false,
  outageId = null,
  outageUntil = null,
  rejectedWeighingQueries = 0,
  weighingSubmissions = 0,
  oldBalanzas = false,
  failAvailabilityRestore = false;
const line = {
  type: "LineString",
  coordinates: [
    [-56.2, -34.9],
    [-56.18, -34.88],
  ],
};
const summaries = Object.entries(caseTypes).map(([scenario, tipoCaso], i) => ({
  id: i + 1,
  tipoCaso,
  matricula: ["carga", "desvio"].includes(scenario) ? "STU5678" : "SBC1234",
  idGuia: ["carga", "desvio"].includes(scenario) ? "GV-FISC001" : undefined,
}));
const old = [
  new Date(Date.now() - 500000).toISOString(),
  new Date(Date.now() - 490000).toISOString(),
];
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const b of req) raw += b;
  const body = raw ? JSON.parse(raw) : {},
    url = new URL(req.url, "http://test");
  let data = {},
    status = 200;
  if (unavailable && url.pathname.startsWith("/api/scales")) {
    if (req.method === "GET" && url.pathname.endsWith("/weighings")) rejectedWeighingQueries++;
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "simulated_unavailability", outageId }));
    return;
  }
  if (url.pathname.includes("oauth/token"))
    data = { access_token: "test-token", expires_in: 3600 };
  else if (url.pathname === "/api/simulation/availability") {
    if (oldBalanzas) { status = 404; data = { error: "not-found" }; }
    else {
      if (req.method === "PUT") {
        if (!body.durationSeconds && failAvailabilityRestore) {
          status = 503; data = { error: "restore-failed" };
        } else {
          unavailable = body.durationSeconds > 0;
          outageId = body.outageId;
          if (unavailable) {
            outageUntil = new Date(Date.now() + body.durationSeconds * 1000).toISOString();
            rejectedWeighingQueries = 0;
            fs.writeFileSync(path.join(temp, "outage"), base);
          } else fs.rmSync(path.join(temp, "outage"), { force: true });
        }
      }
      if (status === 200) data = { unavailable, outageId, until: outageUntil, rejectedWeighingQueries };
    }
  }
  else if (url.pathname.endsWith("/health")) data = { status: "ok" };
  else if (url.pathname === "/api/tracking-on") {
    if (req.method === "PUT") {
      if (body.trackingOn) requestedFactors.push(body.simulationSpeedFactor);
      if (body.trackingOn && body.stopAtMeters !== undefined) {
        tracking = false;
        prepared = true;
        started = Date.now();
        prefixDates = [0, 1, 2].map(i => new Date(started - 10000 + i * 5000).toISOString());
        scoped.set(2, { gpsId: 2, configurationId: "configured-id", lastReportedMeters: 222,
          lastMessageId: "prefix-last", emittedPoints: 3, confirmedPoints: 3,
          lastMeasurementAt: prefixDates.at(-1), running: false, pausedAtBoundary: true, pendingMessages: 0 });
      } else if (body.trackingOn) {
        tracking = true;
        following = configGps === 100001 && devices.find(d => d.id === 100001).licensePlate === "LT00001";
        if (body.resume) { liveDetour = true; prepared = false; }
        started = Date.now();
        dates = [
          new Date(body.resume || following ? started : started - 500).toISOString(),
          new Date(body.resume || following ? started + 1 : started - 250).toISOString(),
        ];
      } else { tracking = false; for (const device of scoped.values()) device.running = false; }
    }
    if (following && finishLive) tracking = false;
    if (scopedMode) {
      for (const device of scoped.values()) if (device.running) {
        const event = { gpsId: device.gpsId, messageId: crypto.randomUUID(), fechaHora: new Date().toISOString() };
        const events = scopedEvents.get(device.gpsId) ?? [];
        events.push(event); scopedEvents.set(device.gpsId, events);
        device.emittedPoints++; device.confirmedPoints++; device.lastMessageId = event.messageId;
        if (device.gpsId === 2) dates = events.slice(-2).map(e => e.fechaHora);
      }
      tracking = [...scoped.values()].some(d => d.running);
    }
    data = {
      trackingOn: tracking,
      capabilities: ["bounded-preparation-v1", "explicit-gps-id-v1", "per-gps-control-v1"],
      pausedAtBoundary: prepared,
      pendingMessages: 0,
      flushing: false,
      intervalSeconds: interval,
      speedKmh: 80,
      configuredDevices: scopedMode || prepared ? [...scoped.values()].map(d => ({ ...d,
        configurationId: staleConfiguration ? "stale" : d.configurationId,
      })) : [{ gpsId: configGps, distanceMeters: 1000,
        configurationId: staleConfiguration ? "stale" : "configured-id",
        lastReportedMeters: 222, lastMessageId: following ? "live-last" : "prefix-last", emittedPoints: 3,
        lastMeasurementAt: prefixDates.at(-1),
      }],
      simulatedStartAt: prepared ? prefixDates[0] : new Date(started - 1000).toISOString(),
    };
  } else if (/^\/api\/gps-devices\/\d+\/simulation$/.test(url.pathname)) {
    scopedMode = true;
    const id = Number(url.pathname.split("/")[3]);
    const device = scoped.get(id) ?? { gpsId: id, configurationId: "configured-id", emittedPoints: 0, confirmedPoints: 0, pendingMessages: 0 };
    device.running = body.running;
    if (body.running) {
      device.pausedAtBoundary = false;
      if (id === 2) { liveDetour = true; prepared = false; }
      else following = true;
    }
    scoped.set(id, device);
    tracking = [...scoped.values()].some(d => d.running);
    data = { configuration: device };
  } else if (url.pathname === "/api/gps-devices" && req.method === "POST") {
    data = { id: body.id, licensePlate: body.licensePlate, active: body.active };
    devices.push(data);
  } else if (url.pathname === "/api/gps-devices")
    data =
      url.searchParams.get("active") === "true"
        ? devices.filter((d) => d.active)
        : devices;
  else if (/^\/api\/gps-devices\/\d+\/scenario$/.test(url.pathname)) {
    configGps = Number(url.pathname.split("/")[3]);
    if (scopedMode || prepared) scoped.set(configGps, {
      gpsId: configGps, configurationId: "configured-id", emittedPoints: 0, confirmedPoints: 0, pendingMessages: 0, running: false,
    });
    data = { configuration: { gpsId: configGps, configurationId: "configured-id",
      preparation: { stopAtMeters: 222, durationSeconds: 10, expectedPoints: 3 },
    } };
  } else if (/^\/api\/gps-devices\/\d+$/.test(url.pathname)) {
    if (
      failRestore &&
      body.active === true &&
      Number(url.pathname.split("/")[3]) === 2
    ) {
      status = 503;
      data = { error: "restore-failed" };
    } else {
      const d = devices.find(
        (d) => d.id === Number(url.pathname.split("/")[3]),
      );
      Object.assign(d, body);
      data = d;
    }
  } else if (url.pathname === "/casos")
    data = { casos: summaries.filter(s => s.tipoCaso !== "DESVIO_RUTA" || liveDetour), totalPaginas: 1 };
  else if (/^\/casos\/\d+\/evidencia$/.test(url.pathname)) {
    const s = summaries[Number(url.pathname.split("/")[2]) - 1],
      ds = never || !started ? old
        : scopedMode && ["VIAJE_SIN_GUIA", "VEHICULO_SIN_HABILITACION"].includes(s.tipoCaso)
          ? (scopedEvents.get(1) ?? []).map(e => e.fechaHora) : dates;
    data = {
      tipoCaso: s.tipoCaso,
      vehiculo: { matricula: s.matricula },
      guia: s.idGuia ? { id: s.idGuia } : undefined,
      eventosTracking: ds.map((fechaHora) => ({ fechaHora })),
      pruebasHabilitacion: ds.map((fechaHora) => ({
        fechaHora,
        origen: "TRACKING",
        estadoPermiso: "VENCIDO",
        estadoItv: "VIGENTE",
      })),
      pruebasDesvio: [
        {
          fechaHora: ds[0],
          fechaPareja: ds[1],
          distanciaConfirmanteMetros: 3000,
          distanciaParejaMetros: 3001,
          umbralMetros: 2000,
          ventanaMaximaSegundos: 30,
          hashesRutas: ["hash"],
        },
      ],
      pesajes:
        weighing && fs.existsSync(path.join(temp, "polled"))
          ? [{ fechaHora: weighing.datetime, pesoKg: weighing.weight }]
          : [],
    };
  } else if (/^\/casos\/\d+\/gps$/.test(url.pathname))
    data = {
      posiciones: scopedMode ? (scopedEvents.get(1) ?? []) : dates.map((fechaHora) => ({
        fechaHora,
        gpsId: 1,
        messageId: crypto.randomUUID(),
      })),
      siguienteIndice: null,
    };
  else if (url.pathname === "/viajes/GV-LT00001/rutas-autorizadas") data = [];
  else if (url.pathname === "/viajes/GV-LT00001/gps")
    data = { posiciones: missingPrefix ? [] : scopedMode ? (scopedEvents.get(100001) ?? []) : dates.map((fechaHora, i) => ({ fechaHora, gpsId: 100001,
      messageId: i ? "live-last" : "live-first", latitud: -34.9 + i * .001, longitud: -56.2 + i * .001,
    })), hayMas: false, siguienteDesde: null };
  else if (url.pathname.endsWith("/rutas-autorizadas"))
    data = [
      {
        alternativa: 1,
        geometriaGeoJson: JSON.stringify(line),
        sha256: "hash",
      },
    ];
  else if (url.pathname === "/viajes" && missingHistoricalEnd && url.searchParams.get("matricula") === "SBC1234" && url.searchParams.get("estado") === "FINALIZADA")
    data = { viajes: [{ id: "GV-HIST-SBC" }], total: 1 };
  else if (url.pathname === "/viajes")
    data = { viajes: url.searchParams.get("estado") === "EN_CURSO" && url.searchParams.get("matricula") !== "SBC1234"
      ? [{ id: url.searchParams.get("matricula") === "LT00001" ? "GV-LT00001" : "GV-FISC001" }] : [],
      total: url.searchParams.get("estado") === "EN_CURSO" && url.searchParams.get("matricula") !== "SBC1234" ? 1 : 0 };
  else if (url.pathname === "/viajes/GV-FISC001/gps")
    data = { posiciones: missingPrefix ? [] : scopedMode ? (scopedEvents.get(2) ?? []) : prefixDates.map((fechaHora, i) => ({
      fechaHora, gpsId: 2, messageId: i === 2 ? "prefix-last" : "prefix-" + i,
    })), hayMas: false, siguienteDesde: null };
  else if (url.pathname === "/viajes/GV-LT00001")
    data = { estado: "EN_CURSO", fechaAsignacion: new Date(Date.now() - 86400000).toISOString(),
      vehiculo: { matricula: "LT00001", pesoMaximoKg: 35000 } };
  else if (url.pathname.startsWith("/viajes/"))
    data = {
      estado: "ASIGNADA",
      fechaAsignacion: new Date(Date.now() - (recentGuide ? 0 : 86400000)).toISOString(),
      vehiculo: { matricula: "STU5678", pesoMaximoKg: 36200 },
    };
  else if (url.pathname === "/api/scales/4/weighings") {
    weighingSubmissions++;
    weighingGps = [...scoped.values()].filter(d => d.running).map(d => d.gpsId).sort((a,b) => a-b);
    if (failWeighing) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "balanza-no-disponible" }));
      return;
    }
    status = 201;
    weighing = {
      licensePlate: body.licensePlate,
      weight: body.weight,
      datetime: new Date().toISOString(),
    };
    data = weighing;
  } else if (url.pathname === "/api/scales/4") data = { active: true };
  else if (url.pathname.startsWith("/route/"))
    data = { code: "Ok", routes: [{ geometry: line, distance: 2000 }] };
  else {
    status = 404;
    data = { error: "unknown " + url.pathname };
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
});
const bin = path.join(temp, "bin");
fs.mkdirSync(bin);
// Launch fixtures with Node, without Unix shebangs, chmod or Windows command shells.
const realSpawn = childProcess.spawn;
const spawnMock = mock.method(childProcess, "spawn", (binary, args, options) =>
  ["ssh", "docker"].includes(binary)
    ? realSpawn(process.execPath, [path.join(bin, binary + ".cjs"), ...args], options)
    : realSpawn(binary, args, options));
syncBuiltinESMExports();
const composeFile = path.join(temp, "central compose.yml");
fs.writeFileSync(composeFile, "services: {}\n");
const sshIdentityFile = path.join(temp, "private identity");
const sshKnownHostsFile = path.join(temp, "known hosts");
fs.writeFileSync(sshIdentityFile, "test-key", { mode: 0o600 });
fs.writeFileSync(sshKnownHostsFile, "test-host");
const sshMock = `
  const fs=require('fs'),path=require('path'),dir=${JSON.stringify(temp)},argv=process.argv.slice(2);
  fs.appendFileSync(path.join(dir,'sshcalls'),JSON.stringify(argv)+'\\n');
  const a=[...argv.at(-1).matchAll(/'([^']*)'/g)].map(m=>m[1]),verb=a[4],resource=a[5];
  const has=name=>fs.existsSync(path.join(dir,name));
  const emit=data=>console.log(JSON.stringify(data));
  if(has('ssh-failure'))process.exit(255);
  if(verb==='auth')console.log(has('ssh-denied')?'no':'yes');
  else if(verb==='get'&&resource==='cronjob')emit({spec:{suspend:true}});
  else if(verb==='get'&&resource==='jobs')emit({items:has('busy-job')?[{metadata:{name:'fiscalizacionautomatica-poller-external'},status:{active:1}}]:[]});
  else if(a.includes('--dry-run=client'))emit({metadata:{name:a[6]},spec:{backoffLimit:0,template:{spec:{restartPolicy:'Never'}}}});
  else if(verb==='create'&&resource==='-f'){
    const manifest=JSON.parse(fs.readFileSync(0,'utf8'));
    fs.writeFileSync(path.join(dir,'job-manifest.json'),JSON.stringify(manifest));
    fs.writeFileSync(path.join(dir,'remote-job'),manifest.metadata.name);
    fs.appendFileSync(path.join(dir,'pollcalls'),'run\\n');
    if(has('poll-infra-failure'))process.exit(255);
    if(has('outage'))fetch(fs.readFileSync(path.join(dir,'outage'),'utf8')+'/api/scales/4/weighings')
      .then(()=>fs.writeFileSync(path.join(dir,'failed-job'),'yes'));
    else fs.writeFileSync(path.join(dir,'polled'),'yes');
  }else if(verb==='get'&&resource==='job'){
    if(has('disconnect-job'))process.exit(255);
    emit({status:has('waiting-job')?{}:{conditions:[{type:has('failed-job')?'Failed':'Complete',status:'True'}]}});
  }else if(verb==='delete'&&resource==='job'){
    fs.appendFileSync(path.join(dir,'deleted-job'),a[6]+'\\n');
    fs.rmSync(path.join(dir,'remote-job'),{force:true});fs.rmSync(path.join(dir,'failed-job'),{force:true});
  }else process.exit(2);
`;
const dockerMock = `
  const fs=require('fs'),path=require('path'),dir=${JSON.stringify(temp)},a=process.argv.slice(2);
  fs.appendFileSync(path.join(dir,'dockercalls'),JSON.stringify(a)+'\\n');
  const has=name=>fs.existsSync(path.join(dir,name));
  if(a[0]==='compose'&&a.includes('config'))console.log(has('docker-no-poller')?'wildfly\\nmongodb':'wildfly\\nmongodb\\nfiscalizacionautomatica-poller');
  else if(a[0]==='compose'&&a.includes('ps'))console.log(has('docker-incomplete')?'wildfly':'wildfly\\nmongodb');
  else if(a[0]==='ps'){if(has('docker-busy'))console.log('external-poller');}
  else if(a.includes('run')){
    fs.writeFileSync(path.join(dir,'local-job'),'yes');
    if(has('docker-fail'))process.exit(1);
    if(has('docker-wait'))setInterval(()=>{},1000);
    else if(has('outage'))fetch(fs.readFileSync(path.join(dir,'outage'),'utf8')+'/api/scales/4/weighings')
      .then(()=>{process.exitCode=1;});
    else fs.writeFileSync(path.join(dir,'polled'),'yes');
  }else if(a[0]==='rm')fs.rmSync(path.join(dir,'local-job'),{force:true});
  else process.exit(2);
`;
let base;
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  const run = load();
  throw new Error("timeout waiting for test: " + JSON.stringify({ status: run?.status, message: run?.message,
    steps: run?.steps.map(({scenario,status,message}) => ({scenario,status,message})), concurrent: run?.concurrent }));
}
function configure(extra = {}) {
  fs.writeFileSync(
    process.env.PANEL_CONFIG_FILE,
    JSON.stringify({
      local: {
        centralUrl: base,
        trackingUrl: base,
        balanzasUrl: base,
        osrmUrl: base,
        platformUrl: base,
        apiKey: "private-key",
        trackingClientSecret: "private-tracking",
        balanzasClientSecret: "private-balanzas",
        timeoutMs: 1500,
        deviationTimeoutMs: 15000,
        pollMs: 100,
        requestTimeoutMs: 1000,
        pollerMode: "ssh",
        composeFile,
        sshHost: "gate.elasticloud.uy",
        sshUser: "6255-648",
        sshIdentityFile,
        sshKnownHostsFile,
        ...extra,
      },
    }),
  );
}
function reset() {
  devices = structuredClone(originals);
  tracking = false;
  started = 0;
  dates = [];
  never = false;
  interval = 5;
  weighing = null;
  failRestore = false;
  prepared = liveDetour = staleConfiguration = recentGuide = missingPrefix = false;
  prefixDates = [];
  following = finishLive = false;
  scopedMode = false; scoped = new Map(); scopedEvents = new Map(); requestedFactors = [];
  weighingGps = []; failWeighing = false; missingHistoricalEnd = false;
  unavailable = oldBalanzas = failAvailabilityRestore = false;
  outageId = outageUntil = null; rejectedWeighingQueries = weighingSubmissions = 0;
  fs.rmSync(process.env.PANEL_STATE_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(temp, "polled"), { force: true });
  for (const file of ["outage", "pollcalls", "poll-infra-failure", "sshcalls", "job-manifest.json", "remote-job", "deleted-job", "failed-job", "ssh-failure", "ssh-denied", "busy-job", "waiting-job", "disconnect-job", "dockercalls", "docker-incomplete", "docker-no-poller", "docker-busy", "docker-fail", "docker-wait", "local-job"]) fs.rmSync(path.join(temp, file), { force: true });
  fs.writeFileSync(path.join(bin, "ssh.cjs"), sshMock);
  fs.writeFileSync(path.join(bin, "docker.cjs"), dockerMock);
  configure();
}
test.before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
});
test.after(async () => {
  spawnMock.mock.restore();
  syncBuiltinESMExports();
  server.close();
  await once(server, "close");
  fs.rmSync(temp, { recursive: true, force: true });
});
test.afterEach(async () => {
  if (view().running) {
    stop();
    await waitFor(() => !view().running);
  }
});
test("un botón prepara a 20x y ejecuta los cuatro casos con tres GPS y pesaje concurrentes", async () => {
  reset();
  start("local", "todos");
  assert.throws(() => start("local", "sin_guia"), /activa/);
  await waitFor(() => load()?.steps.every(s => s.status === "detectado"));
  assert.equal(view().running, true);
  assert.equal(tracking, true);
  assert.deepEqual([...scoped.values()].filter(d => d.running).map(d => d.gpsId).sort((a,b) => a-b), [1, 2, 100001]);
  assert.deepEqual(weighingGps, [1, 2, 100001], "el pesaje se registra mientras los tres GPS reportan");
  const before = Object.fromEntries(Object.entries(load().concurrent).map(([k,s]) => [k,s.received ?? 0]));
  await waitFor(() => Object.entries(load().concurrent).every(([k,s]) => (s.received ?? 0) > before[k]));
  stop("infractions");
  await waitFor(() => !scoped.get(1).running && load().concurrent.infractions.status === "completado");
  assert.equal(scoped.get(2).running, true);
  assert.equal(scoped.get(100001).running, true);
  stop();
  await waitFor(() => !view().running);
  const run = load();
  assert.equal(run.status, "completado", JSON.stringify(run));
  assert.deepEqual(
    run.steps.map((s) => s.status),
    ["detectado", "detectado", "detectado", "detectado"],
  );
  assert.ok(run.steps.every((s) => s.caseId));
  assert.equal(run.factor, 1);
  assert.deepEqual(requestedFactors, [20], "sólo la preparación usa reloj global; los tres GPS usan control individual en vivo");
  assert.deepEqual(devices, originals);
  assert.equal(tracking, false);
  assert.equal(run.cleanupRequired, false);
  assert.ok(fs.existsSync(path.join(temp, "polled")));
  assert.equal(JSON.stringify(view()).includes("private-key"), false);
});
test("la caída de Balanzas falla el primer poll, mantiene tres GPS y recupera el pesaje sin reenviarlo", async () => {
  reset();
  start("local", "todos", true);
  await waitFor(() => load()?.resilience?.failedPollVerified);
  assert.equal(unavailable, true);
  assert.equal(fs.existsSync(path.join(temp, "polled")), false);
  assert.equal(weighingSubmissions, 1);
  const before = Object.fromEntries(Object.entries(load().concurrent).map(([k,s]) => [k,s.received ?? 0]));
  await waitFor(() => Object.entries(load().concurrent).every(([k,s]) => (s.received ?? 0) > before[k]));
  assert.equal(load().resilience.status, "indisponible");
  assert.ok([1,2,100001].every(id => scoped.get(id)?.running));
  await waitFor(() => load()?.resilience?.status === "verificado", 40000);
  assert.equal(unavailable, false);
  assert.equal(load().resilience.restoreRequired, false);
  assert.equal(weighingSubmissions, 1);
  assert.equal(fs.readFileSync(path.join(temp, "pollcalls"), "utf8").trim().split("\n").length, 2);
  assert.equal(load().resilience.weighing.datetime, weighing.datetime);
  assert.ok(load().steps.every(s => s.status === "detectado"));
  assert.ok([1,2,100001].every(id => scoped.get(id)?.running));
  stop(); await waitFor(() => !view().running);
  assert.equal(load().status, "completado");
  assert.equal(load().cleanupRequired, false);
});
test("cancelar durante el 503 recupera Balanzas y conserva el único pesaje", async () => {
  reset(); start("local", "carga", true);
  await waitFor(() => load()?.resilience?.failedPollVerified);
  stop(); await waitFor(() => !view().running);
  assert.equal(unavailable, false);
  assert.equal(weighingSubmissions, 1);
  assert.equal(load().resilience.status, "cancelado");
  assert.equal(load().cleanupRequired, false);
  assert.equal(fs.existsSync(path.join(temp, "polled")), false);
});
test("un error de infraestructura sin consultas 503 no aprueba la resiliencia", async () => {
  reset(); fs.writeFileSync(path.join(temp, "poll-infra-failure"), "yes");
  start("local", "carga", true); await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.equal(load().resilience.status, "fallido");
  assert.equal(load().resilience.failedPollVerified, undefined);
  assert.equal(unavailable, false);
  assert.equal(weighingSubmissions, 1);
});
test("si falla recuperar Balanzas se persiste la obligación y Restaurar la reintenta", async () => {
  reset(); start("local", "carga", true);
  await waitFor(() => load()?.resilience?.failedPollVerified);
  failAvailabilityRestore = true;
  stop(); await waitFor(() => !view().running);
  assert.equal(load().cleanupRequired, true);
  assert.equal(load().resilience.restoreRequired, true);
  assert.throws(() => start("local", "carga"), /restauración/);
  failAvailabilityRestore = false;
  start("local", "restaurar"); await waitFor(() => !view().running);
  assert.equal(load().cleanupRequired, false);
  assert.equal(unavailable, false);
});
test("Balanzas antiguo bloquea la prueba antes de registrar pesajes", async () => {
  reset(); oldBalanzas = true;
  start("local", "carga", true); await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.match(load().checks.find(c => c.name === "Resiliencia de Balanzas").message, /actualizar Balanzas/);
  assert.equal(weighingSubmissions, 0);
  assert.equal(unavailable, false);
});
test("cancelar interrumpe espera y restaura dispositivos", async () => {
  reset();
  never = true;
  start("local", "sin_guia");
  await waitFor(() => tracking);
  stop();
  await waitFor(() => !view().running);
  assert.equal(load().status, "cancelado");
  assert.deepEqual(devices, originals);
  assert.equal(tracking, false);
  assert.equal(load().cleanupRequired, false);
});
test("la ejecución conjunta rechaza GPS compartidos antes de publicar o pesar", async () => {
  reset();
  configure({ liveGps: 1 });
  start("local", "todos");
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.match(load().message, /tres GPS/);
  assert.equal(started, 0);
  assert.equal(weighing, null);
  assert.deepEqual(devices, originals);
});
test("historial finalizado sin FIN bloquea la demo antes de publicar GPS o pesajes", async () => {
  reset(); missingHistoricalEnd = true;
  start("local", "todos");
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.ok(load().checks.some(c => !c.ok && c.message.includes("NO_DETERMINABLE")));
  assert.equal(started, 0);
  assert.equal(weighing, null);
  assert.deepEqual(devices, originals);
});
test("detener toda la demo antes de confirmar conserva resultados parciales y restaura los tres GPS", async () => {
  reset(); never = true;
  start("local", "todos");
  await waitFor(() => [1,2,100001].every(id => scoped.get(id)?.running));
  stop("infractions");
  await waitFor(() => !scoped.get(1).running);
  assert.equal(scoped.get(2).running, true);
  assert.equal(scoped.get(100001).running, true);
  stop();
  await waitFor(() => !view().running);
  assert.equal(load().status, "cancelado", JSON.stringify(load()));
  assert.equal(tracking, false);
  assert.deepEqual(devices, originals);
  assert.equal(load().cleanupRequired, false);
});
test("fallar el pesaje no interrumpe los tres GPS y la parada no oculta el error", async () => {
  reset(); failWeighing = true;
  start("local", "todos");
  await waitFor(() => load()?.steps.find(s => s.scenario === "carga")?.status === "fallido");
  assert.ok([1,2,100001].every(id => scoped.get(id)?.running));
  assert.equal(view().running, true);
  stop();
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.match(load().steps.find(s => s.scenario === "carga").message, /balanza-no-disponible/);
  assert.deepEqual(devices, originals);
});
test("10 segundos falla sin modificar el simulador", async () => {
  reset();
  interval = 10;
  start("local", "sin_guia");
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.ok(load().checks.some((c) => !c.ok && c.message.includes("5 s")));
  assert.equal(started, 0);
  assert.deepEqual(devices, originals);
});
test("evidencia vieja no aprueba; timeout restaura GPS", async () => {
  reset();
  never = true;
  configure({ timeoutMs: 150 });
  start("local", "sin_guia");
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.equal(load().steps[0].caseId, undefined);
  assert.deepEqual(devices, originals);
});
test("restauración fallida bloquea ensayos hasta recuperación explícita", async () => {
  reset();
  failRestore = true;
  start("local", "sin_guia");
  await waitFor(() => !view().running);
  assert.equal(load().cleanupRequired, true);
  assert.throws(() => start("local", "carga"), /restauración/);
  failRestore = false;
  start("local", "restaurar");
  await waitFor(() => !view().running);
  assert.equal(load().cleanupRequired, false);
  assert.deepEqual(devices, originals);
});
test("reinicio conserva snapshot y exige restauración", async () => {
  reset();
  const now = new Date().toISOString();
  save({
    id: "interrupted",
    concurrent: { live: { status: "ejecutando", message: "running" }, detour: { status: "pendiente", message: "paused" } },
    target: "local",
    selection: "sin_guia",
    factor: 1,
    status: "ejecutando",
    startedAt: now,
    updatedAt: now,
    message: "old",
    checks: [],
    steps: [],
    logs: [],
    gpsBackup: originals,
    cleanupRequired: true,
  });
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(
    path.join(stateDir(), "execution.lock"),
    JSON.stringify({ pid: 999999999, boot: 0 }),
  );
  assert.equal(view().run.status, "interrumpido");
  assert.equal(view().run.concurrent.live.status, "fallido");
  assert.equal(view().run.concurrent.detour.status, "fallido");
  assert.throws(() => start("local", "sin_guia"), /restauración/);
  start("local", "restaurar");
  await waitFor(() => !view().running);
  assert.equal(load().status, "completado");
  assert.deepEqual(devices, originals);
});
for (const selection of ["diagnostico", "carga", "todos"]) {
  test(`${selection} sin poller conserva el bloqueo con diagnóstico coherente y sin efectos`, async () => {
    reset();
    configure({ pollerMode: "disabled" });
    start("local", selection);
    await waitFor(() => !view().running);
    assert.equal(load().status, "fallido");
    assert.equal(weighingSubmissions, 0);
    assert.equal(started, 0);
    assert.deepEqual(devices, originals);
    const check = load().checks.find(c => c.name === "Poller");
    assert.equal(check.ok, false);
    assert.match(check.message, /deshabilitado.*LOCAL_POLLER_MODE=docker/);
    assert.doesNotMatch(check.message, /Falta configurar SSH/);
    assert.equal(fs.existsSync(path.join(temp, "sshcalls")), false);
    assert.equal(fs.existsSync(path.join(temp, "dockercalls")), false);
    await assert.rejects(poller(profile("local"), new AbortController().signal, () => {}), /deshabilitado/);
  });
}
test("Docker local comprueba Central, ejecuta el poller y limpia sin usar SSH", async () => {
  reset();
  const p={...profile('local'),pollerMode:'docker'};
  await checkPoller(p,new AbortController().signal);
  await poller(p,new AbortController().signal,()=>{});
  const calls=fs.readFileSync(path.join(temp,'dockercalls'),'utf8').trim().split('\n').map(JSON.parse);
  const run=calls.find(a=>a.includes('run'));
  assert.ok(run.includes('--no-deps')&&run.includes('--rm')&&run.includes('-T'));
  assert.equal(run[run.indexOf('-f')+1],p.composeFile);
  assert.equal(run.at(-1),'fiscalizacionautomatica-poller');
  assert.equal(calls.find(a=>a[0]==='rm').at(-1),run[run.indexOf('--name')+1]);
  assert.equal(fs.existsSync(path.join(temp,'sshcalls')),false);
  assert.equal(fs.existsSync(path.join(temp,'local-job')),false);
});
test("Docker local rechaza servicios incompletos u otro poller activo", async () => {
  reset(); const p={...profile('local'),pollerMode:'docker'};
  fs.writeFileSync(path.join(temp,'docker-incomplete'),'yes');
  await assert.rejects(checkPoller(p,new AbortController().signal),/WildFly y MongoDB/);
  fs.rmSync(path.join(temp,'docker-incomplete'));fs.writeFileSync(path.join(temp,'docker-busy'),'yes');
  await assert.rejects(poller(p,new AbortController().signal,()=>{}),/Ya hay un poller/);
  assert.equal(fs.existsSync(path.join(temp,'local-job')),false);
});
test("Compose ausente o sin servicio poller bloquea la demo antes de modificar GPS o pesar", async () => {
  for (const absent of [true, false]) {
    reset();
    configure({ pollerMode: "docker", ...(absent ? { composeFile: path.join(temp, "missing.yml") } : {}) });
    if (!absent) fs.writeFileSync(path.join(temp, "docker-no-poller"), "yes");
    start("local", "todos");
    await waitFor(() => !view().running);
    assert.equal(load().status, "fallido");
    const check = load().checks.find(c => c.name === "Poller");
    assert.equal(check.ok, false);
    assert.match(check.message, /LOCAL_COMPOSE_FILE/);
    assert.equal(started, 0);
    assert.equal(weighingSubmissions, 0);
    assert.deepEqual(devices, originals);
  }
});
test("carga local usa Docker y confirma el único pesaje en Central", async () => {
  reset(); configure({ pollerMode: "docker" });
  start("local", "carga");
  await waitFor(() => !view().running);
  assert.equal(load().status, "completado", JSON.stringify(load()));
  assert.equal(load().steps[0].status, "detectado");
  assert.equal(weighingSubmissions, 1);
  assert.equal(fs.existsSync(path.join(temp, "sshcalls")), false);
  assert.equal(fs.existsSync(path.join(temp, "local-job")), false);
});
test("503 del poller Docker conserva el pesaje y cancelar recupera Balanzas", async () => {
  reset(); configure({ pollerMode: "docker" });
  start("local", "carga", true);
  await waitFor(() => load()?.resilience?.failedPollVerified);
  assert.equal(unavailable, true);
  assert.equal(weighingSubmissions, 1);
  assert.equal(fs.existsSync(path.join(temp, "local-job")), false);
  stop(); await waitFor(() => !view().running);
  assert.equal(load().status, "cancelado");
  assert.equal(load().cleanupRequired, false);
  assert.equal(unavailable, false);
  assert.equal(weighingSubmissions, 1);
});
test("fallo, timeout y cancelación del poller Docker limpian sólo su contenedor", async () => {
  for(const reason of ['fail','timeout','abort']){
    reset();fs.writeFileSync(path.join(temp,reason==='fail'?'docker-fail':'docker-wait'),'yes');
    const controller=new AbortController();
    const promise=poller({...profile('local'),pollerMode:'docker',pollerTimeoutMs:1500},controller.signal,()=>{});
    if(reason==='abort'){await waitFor(()=>fs.existsSync(path.join(temp,'local-job')));controller.abort();}
    await assert.rejects(promise,e=>reason==='fail'?e instanceof PollerRunFailed:!(e instanceof PollerRunFailed));
    assert.equal(fs.existsSync(path.join(temp,'local-job')),false);
  }
});

test("SSH usa el nodo directo, crea el Job por stdin y limpia sólo ese Job", async () => {
  reset();
  await checkPoller(profile("local"), new AbortController().signal);
  await poller(profile("local"), new AbortController().signal, () => {});
  const calls = fs.readFileSync(path.join(temp, "sshcalls"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(calls.every(a => a.includes("6255-648@gate.elasticloud.uy") && a[a.indexOf("-p") + 1] === "3022"));
  assert.ok(calls.every(a => a.includes("-T") && a.includes("BatchMode=yes") && a.includes("StrictHostKeyChecking=yes")));
  assert.ok(calls.every(a => a[a.indexOf("-F") + 1] === "none"));
  const knownHosts = process.platform === "win32" ? sshKnownHostsFile.replace(/\\/g, "/") : sshKnownHostsFile;
  assert.ok(calls.every(a => a.includes("UserKnownHostsFile=" + JSON.stringify(knownHosts))));
  assert.ok(calls.every(a => a[a.indexOf("-i") + 1] === sshIdentityFile));
  assert.ok(calls.some(a => a.at(-1).includes("'create' '-f' '-'")));
  const manifest = JSON.parse(fs.readFileSync(path.join(temp, "job-manifest.json"), "utf8"));
  assert.equal(manifest.spec.activeDeadlineSeconds, 180);
  assert.equal(fs.readFileSync(path.join(temp, "deleted-job"), "utf8").trim(), manifest.metadata.name);
  assert.equal(fs.existsSync(path.join(temp, "remote-job")), false);
});
test("el intento de caída por SSH crea un Job sin reintentos", async () => {
  reset(); fs.writeFileSync(path.join(temp, "failed-job"), "yes");
  await assert.rejects(poller(profile('local'), new AbortController().signal, () => {}, { singleAttempt: true }), PollerRunFailed);
  const manifest = JSON.parse(fs.readFileSync(path.join(temp, 'job-manifest.json'), 'utf8'));
  assert.equal(manifest.spec.backoffLimit, 0);
  assert.ok(manifest.spec.activeDeadlineSeconds > 0);
});
test("SSH sin clave, known_hosts, acceso o permisos falla antes de registrar pesajes", async () => {
  for (const extra of [{sshIdentityFile:'/missing-key'}, {sshKnownHostsFile:'/missing-hosts'}, {flag:'ssh-failure'}, {flag:'ssh-denied'}]) {
    reset(); const {flag,...config}=extra; configure(config);
    if(flag)fs.writeFileSync(path.join(temp,flag),'yes');
    start('local','carga'); await waitFor(()=>!view().running);
    assert.equal(load().status,'fallido'); assert.equal(weighingSubmissions,0);
    assert.ok(load().checks.some(c=>c.name==='Poller'&&!c.ok));
  }
});
test("SSH rechaza un Job activo y los argumentos de destino inválidos", async () => {
  reset();
  for(const bad of [{sshHost:'-oProxyCommand=evil'},{sshUser:'root;evil'},{namespace:'tse;evil'},{cronjob:"x'evil"}])
    await assert.rejects(checkPoller({...profile('local'),...bad},new AbortController().signal),/inválido/);
  assert.equal(fs.existsSync(path.join(temp,'sshcalls')),false);
  fs.writeFileSync(path.join(temp,'busy-job'),'yes');
  await assert.rejects(poller(profile('local'),new AbortController().signal,()=>{}),/pendiente o ejecutándose/);
  assert.equal(fs.existsSync(path.join(temp,'job-manifest.json')),false);
});
test("perder la respuesta SSH de creación limpia el Job sin reenviarlo", async () => {
  reset(); fs.writeFileSync(path.join(temp,'poll-infra-failure'),'yes');
  await assert.rejects(poller(profile('local'),new AbortController().signal,()=>{}),e=>!(e instanceof PollerRunFailed));
  assert.equal(fs.readFileSync(path.join(temp,'pollcalls'),'utf8').trim().split('\n').length,1);
  assert.equal(fs.existsSync(path.join(temp,'remote-job')),false);
});
test("timeout, cancelación y desconexión SSH limpian el Job sin confundirse con un fallo del poller", async () => {
  for(const reason of ['timeout','abort','disconnect']) {
    reset(); fs.writeFileSync(path.join(temp,reason==='disconnect'?'disconnect-job':'waiting-job'),'yes');
    const controller=new AbortController();
    const promise=poller({...profile('local'),pollerTimeoutMs:1500},controller.signal,()=>{});
    if(reason==='abort') { await waitFor(()=>fs.existsSync(path.join(temp,'remote-job'))); controller.abort(); }
    await assert.rejects(promise,e=>!(e instanceof PollerRunFailed));
    assert.equal(fs.existsSync(path.join(temp,'remote-job')),false);
  }
});

test("preparar pausa sin caso; detectar mantiene GPS activo hasta la parada manual", async () => {
  reset();
  configure({ pollerMode: "disabled" });
  start("local", "preparar_desvio");
  await waitFor(() => !view().running);
  const ready = load();
  assert.equal(ready.status, "completado", JSON.stringify(ready));
  assert.equal(ready.prepared.expectedPoints, 3);
  assert.equal(ready.factor, 20);
  assert.equal(ready.cleanupRequired, true);
  assert.equal(tracking, false);
  assert.equal(liveDetour, false);
  assert.deepEqual(devices.filter(d => d.active).map(d => d.id), [2]);
  assert.throws(() => start("local", "sin_guia"), /restauración/);
  configure({ pollerMode: "disabled", deviationTimeoutMs: 150 });
  start("local", "continuar_desvio");
  await waitFor(() => load()?.steps[0]?.status === "detectado");
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(view().running, true, "la detección no detiene el ensayo ni aplica el timeout previo al caso");
  assert.equal(tracking, true);
  assert.match(load().steps[0].message, /sigue reportando/);
  stop();
  await waitFor(() => !view().running);
  const completed = load();
  assert.equal(completed.status, "completado", JSON.stringify(completed));
  assert.equal(completed.factor, 1);
  assert.equal(completed.steps[0].caseId, 4);
  assert.equal(completed.prepared, undefined);
  assert.equal(completed.cleanupRequired, false);
  assert.deepEqual(devices, originals);
  const before = started;
  start("local", "preparar_desvio");
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.match(load().message, /ya tiene un caso/);
  assert.equal(started, before);
});
test("guía reciente bloquea la preparación antes de publicar", async () => {
  reset(); recentGuide = true;
  start("local", "preparar_desvio");
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.match(load().message, /antigüedad/);
  assert.equal(started, 0);
  assert.deepEqual(devices, originals);
});
test("el timeout del desvío sigue aplicando mientras no haya evidencia nueva", async () => {
  reset();
  start("local", "preparar_desvio");
  await waitFor(() => !view().running);
  never = true;
  configure({ deviationTimeoutMs: 150 });
  start("local", "continuar_desvio");
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.match(load().message, /No apareció un caso nuevo/);
  assert.equal(load().steps[0].caseId, undefined);
  assert.equal(tracking, false);
  assert.deepEqual(devices, originals);
});
test("no anuncia preparado hasta confirmar el prefijo completo en Central", async () => {
  reset(); missingPrefix = true; configure({ timeoutMs: 150 });
  start("local", "preparar_desvio");
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.equal(load().prepared, undefined);
  assert.match(load().message, /confirmó todos los puntos/);
  assert.deepEqual(devices, originals);
});
test("Tracking reiniciado invalida continuar y restaura sin generar puntos nuevos", async () => {
  reset();
  start("local", "preparar_desvio");
  await waitFor(() => !view().running);
  assert.ok(load().prepared);
  const before = started;
  staleConfiguration = true;
  start("local", "continuar_desvio");
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.match(load().message, /reinició/);
  assert.equal(started, before);
  assert.deepEqual(devices, originals);
  assert.equal(load().prepared, undefined);
});
test("descartar preparación restaura GPS y elimina continuación pendiente", async () => {
  reset();
  start("local", "preparar_desvio");
  await waitFor(() => !view().running);
  assert.ok(load().prepared);
  stop();
  await waitFor(() => !view().running);
  assert.deepEqual(devices, originals);
  assert.equal(load().prepared, undefined);
  assert.throws(() => start("local", "continuar_desvio"), /Preparar/);
});

test("seguimiento usa otro vehículo, confirma GPS en Central y restaura al detener", async () => {
  reset();
  start("local", "seguir_viaje");
  await waitFor(() => load()?.live?.receivedCount === 2);
  assert.equal(load().factor, 1);
  assert.equal(load().live.plate, "LT00001");
  assert.equal(load().live.guideId, "GV-LT00001");
  assert.equal(load().live.gpsId, 100001);
  assert.equal(devices.find(d => d.id === 2).active, false);
  assert.equal(devices.find(d => d.id === 100001).licensePlate, "LT00001");
  assert.equal(devices.find(d => d.id === 1).licensePlate, "SBC1234");
  await new Promise(r => setTimeout(r, 150));
  assert.equal(load().live.receivedCount, 2); // overlapping pages don't duplicate positions
  assert.throws(() => start("local", "preparar_desvio"), /activa/);
  stop(); await waitFor(() => !view().running);
  assert.equal(load().status, "completado");
  assert.equal(load().cleanupRequired, false);
  assert.deepEqual(devices, originals);
});
test("seguimiento rechaza el GPS del desvío sin tocar dispositivos", async () => {
  reset(); configure({ liveGps: 2 });
  start("local", "seguir_viaje");
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.match(load().message, /otro GPS/);
  assert.equal(started, 0);
  assert.deepEqual(devices, originals);
});
test("seguimiento no confirma puntos si Central no los recibió", async () => {
  reset(); missingPrefix = true; configure({ timeoutMs: 150 });
  start("local", "seguir_viaje");
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.equal(load().live.receivedCount, 0);
  assert.deepEqual(devices, originals);
});
test("seguimiento termina cuando Central confirma la última posición del recorrido", async () => {
  reset(); finishLive = true;
  start("local", "seguir_viaje");
  await waitFor(() => !view().running);
  assert.equal(load().status, "completado", JSON.stringify(load()));
  assert.equal(load().live.receivedCount, 2);
  assert.deepEqual(devices, originals);
});

test("seguimiento crea su GPS dedicado inactivo si falta, sin reasignar los existentes", async () => {
  reset(); devices = devices.filter(d => d.id !== 100001);
  start("local", "seguir_viaje");
  await waitFor(() => load()?.live?.receivedCount === 2);
  assert.equal(devices.find(d => d.id === 1).licensePlate, "SBC1234");
  assert.equal(devices.find(d => d.id === 100001).licensePlate, "LT00001");
  stop(); await waitFor(() => !view().running);
  assert.deepEqual(devices, originals);
});
test("GPS dedicado con otra matrícula bloquea el seguimiento sin reasignarlo", async () => {
  reset(); devices.find(d => d.id === 100001).licensePlate = "OTR1234";
  start("local", "seguir_viaje");
  await waitFor(() => !view().running);
  assert.equal(load().status, "fallido");
  assert.match(load().message, /no lo reasigna/);
  assert.equal(devices.find(d => d.id === 100001).licensePlate, "OTR1234");
  assert.equal(started, 0);
});

test("preparar, ejecutar seguimiento, reanudar desvío y detenerlo sin interrumpir el otro GPS", async () => {
  reset(); never = true;
  start("local", "preparar_desvio");
  await waitFor(() => !view().running);
  assert.ok(load().prepared);
  start("local", "seguir_viaje");
  await waitFor(() => (load()?.live?.receivedCount ?? 0) >= 2);
  assert.equal(load().selection, "concurrencia");
  assert.equal(scoped.get(2).running, false);
  assert.equal(load().concurrent.detour.status, "pendiente");
  start("local", "continuar_desvio");
  await waitFor(() => (load()?.concurrent?.detour?.received ?? 0) >= 2);
  assert.equal(scoped.get(2).running, true);
  assert.equal(scoped.get(100001).running, true);
  const before = load().live.receivedCount;
  stop("detour");
  await waitFor(() => load().concurrent.detour.status === "cancelado" && !scoped.get(2).running);
  assert.equal(scoped.get(2).running, false);
  await waitFor(() => load().live.receivedCount > before);
  assert.equal(scoped.get(100001).running, true);
  stop("live"); await waitFor(() => !view().running);
  assert.equal(load().status, "completado", JSON.stringify(load()));
  assert.deepEqual(devices, originals);
});
test("confirmar desvío mantiene ambos GPS publicando; detener desvío conserva el seguimiento y la evidencia", async () => {
  reset();
  start("local", "preparar_desvio");
  await waitFor(() => !view().running);
  start("local", "seguir_viaje");
  await waitFor(() => (load()?.live?.receivedCount ?? 0) >= 1);
  start("local", "continuar_desvio");
  await waitFor(() => load()?.steps[0]?.status === "detectado");
  assert.equal(load().steps[0].caseId, 4);
  assert.equal(load().concurrent.detour.status, "ejecutando");
  const detourCount = load().concurrent.detour.received;
  const liveCount = load().concurrent.live.received;
  await waitFor(() => load().concurrent.detour.received > detourCount && load().concurrent.live.received > liveCount);
  assert.equal(scoped.get(2).running, true);
  assert.equal(scoped.get(100001).running, true);
  stop("detour");
  await waitFor(() => load().concurrent.detour.status === "completado" && !scoped.get(2).running);
  assert.equal(scoped.get(2).running, false);
  assert.equal(scoped.get(100001).running, true);
  assert.equal(load().steps[0].status, "detectado");
  assert.ok(load().steps[0].evidence);
  stop("live"); await waitFor(() => !view().running);
  assert.deepEqual(devices, originals);
});
test("detener seguimiento tras detectar no detiene el GPS del desvío", async () => {
  reset();
  start("local", "preparar_desvio");
  await waitFor(() => !view().running);
  start("local", "seguir_viaje");
  await waitFor(() => (load()?.live?.receivedCount ?? 0) >= 1);
  start("local", "continuar_desvio");
  await waitFor(() => load()?.steps[0]?.status === "detectado");
  stop("live");
  await waitFor(() => load().concurrent.live.status === "cancelado" && !scoped.get(100001).running);
  const before = load().concurrent.detour.received;
  await waitFor(() => load().concurrent.detour.received > before);
  assert.equal(scoped.get(100001).running, false);
  assert.equal(scoped.get(2).running, true);
  stop("detour"); await waitFor(() => !view().running);
  assert.equal(load().steps[0].status, "detectado");
  assert.equal(load().status, "completado");
  assert.deepEqual(devices, originals);
});
test("detener seguimiento con desvío pausado conserva la preparación hasta decidir reanudar o descartar", async () => {
  reset();
  start("local", "preparar_desvio");
  await waitFor(() => !view().running);
  start("local", "seguir_viaje");
  await waitFor(() => (load()?.live?.receivedCount ?? 0) >= 1);
  stop("live");
  await waitFor(() => load().concurrent.live.status === "cancelado" && !scoped.get(100001).running);
  assert.ok(load().prepared);
  assert.equal(load().concurrent.detour.status, "pendiente");
  stop(); await waitFor(() => !view().running);
  assert.equal(load().status, "cancelado");
  assert.deepEqual(devices, originals);
});
