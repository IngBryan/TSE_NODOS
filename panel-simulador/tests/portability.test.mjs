import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolvePanelPath } from "../scripts/paths.mjs";
import { profile } from "../src/lib/config.ts";
import { command } from "../src/lib/poller.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "panel paths con espacios-"));
const envKeys = ["PANEL_BASE_DIR", "PANEL_CONFIG_FILE", "LOCAL_COMPOSE_FILE", "LOCAL_SSH_IDENTITY_FILE", "LOCAL_SSH_KNOWN_HOSTS_FILE"];
test.beforeEach(t => {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.PANEL_BASE_DIR = root;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("rutas relativas, absolutas y del usuario se resuelven desde el panel", () => {
  assert.equal(resolvePanelPath("central con espacios/compose.yml"), path.join(root, "central con espacios", "compose.yml"));
  assert.equal(resolvePanelPath(root), root);
  assert.equal(resolvePanelPath("~/.ssh/private key"), path.join(os.homedir(), ".ssh", "private key"));
  for (const value of ["", "a\nb", "a\0b", undefined]) assert.throws(() => resolvePanelPath(value), /Ruta inválida/);
});

test("perfiles conservan modos, rutas privadas y prioridad de variables de entorno", () => {
  fs.writeFileSync(path.join(root, "profiles.json"), JSON.stringify({local: {
    composeFile: "central con espacios/compose.yml",
    sshIdentityFile: "~/.ssh/private key",
    sshKnownHostsFile: "ssh/known hosts",
  }}));
  process.env.PANEL_CONFIG_FILE = "profiles.json";
  assert.equal(profile("local").pollerMode, "docker");
  assert.equal(profile("elasticcloud").pollerMode, "ssh");
  assert.equal(profile("local").composeFile, path.join(root, "central con espacios", "compose.yml"));
  assert.equal(profile("local").sshIdentityFile, path.join(os.homedir(), ".ssh", "private key"));
  assert.equal(profile("local").sshKnownHostsFile, path.join(root, "ssh", "known hosts"));
  process.env.LOCAL_COMPOSE_FILE = "otro central/compose.yml";
  assert.equal(profile("local").composeFile, path.join(root, "otro central", "compose.yml"));
});

test("npm start respeta profiles.json y mantiene rutas después del cambio de cwd de Next", () => {
  const cwd = path.join(root, "standalone host");
  const standalone = path.join(cwd, ".next", "standalone");
  fs.mkdirSync(standalone, { recursive: true });
  fs.writeFileSync(path.join(cwd, "profiles.json"), JSON.stringify({local: {
    composeFile: "central privado/compose.yml", sshIdentityFile: "ssh/private key", sshKnownHostsFile: "ssh/known hosts",
  }}));
  const configUrl = new URL("../src/lib/config.ts", import.meta.url).href;
  fs.writeFileSync(path.join(standalone, "server.js"), `
    process.chdir(__dirname);
    import(${JSON.stringify(configUrl)}).then(({profile}) => {
      const p = profile('local');
      console.log(JSON.stringify({composeFile:p.composeFile, identity:p.sshIdentityFile,
        knownHosts:p.sshKnownHostsFile, state:process.env.PANEL_STATE_DIR}));
    });
  `);
  const env = { ...process.env, PANEL_CONFIG_FILE: "profiles.json", PANEL_STATE_DIR: "estado privado" };
  delete env.LOCAL_COMPOSE_FILE;
  const startScript = fileURLToPath(new URL("../scripts/start.mjs", import.meta.url));
  for (const override of [undefined, "override central/compose.yml"]) {
    if (override) env.LOCAL_COMPOSE_FILE = override;
    const result = spawnSync(process.execPath, ["--experimental-strip-types", startScript], { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      composeFile: path.join(cwd, override ?? "central privado/compose.yml"),
      identity: path.join(cwd, "ssh", "private key"),
      knownHosts: path.join(cwd, "ssh", "known hosts"),
      state: path.join(cwd, "estado privado"),
    });
  }
});

test("ejecutor conserva argumentos y stdin sin interpretación del shell", async () => {
  const args = ["ruta con espacios", "a&b", "$(literal)", "comilla'\"", path.join(root, "private key")];
  const source = "let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>console.log(JSON.stringify({args:process.argv.slice(1),input})));";
  const output = await command(process.execPath, ["-e", source, ...args], new AbortController().signal, 5000, "manifest\ncon espacios");
  assert.deepEqual(JSON.parse(output), { args, input: "manifest\ncon espacios" });
});

test("timeout y cancelación esperan al cierre del proceso", async () => {
  const pidFile = path.join(root, "child pid");
  const source = "require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);";
  for (const abort of [false, true]) {
    const controller = new AbortController();
    const promise = command(process.execPath, ["-e", source, pidFile], controller.signal, abort ? 10000 : 1500);
    const rejected = assert.rejects(promise, abort ? /cancelada/ : /tiempo agotado/);
    if (abort) {
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
      assert.ok(fs.existsSync(pidFile), "el hijo debe estar iniciado antes de cancelar");
      controller.abort();
    }
    await rejected;
    assert.ok(fs.existsSync(pidFile));
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    fs.rmSync(pidFile);
  }
});
