import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
// Load private host configuration before Next's standalone server changes cwd.
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
if (process.env.PANEL_CONFIG_FILE)
  process.env.PANEL_CONFIG_FILE = path.resolve(process.env.PANEL_CONFIG_FILE);
process.env.PANEL_STATE_DIR = path.resolve(
  process.env.PANEL_STATE_DIR ?? ".local/state",
);
process.env.LOCAL_COMPOSE_FILE = path.resolve(
  process.env.LOCAL_COMPOSE_FILE ?? "../../TSE_CENTRAL/docker-compose.yml",
);
process.env.PORT ??= "3100";
process.env.HOSTNAME = process.env.PANEL_HOST ?? "127.0.0.1";
await import(pathToFileURL(path.resolve(".next/standalone/server.js")).href);
