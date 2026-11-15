import path from "node:path";
import os from "node:os";

// Standalone Next changes cwd; keep user paths relative to the panel directory.
export function resolvePanelPath(value) {
  if (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value))
    throw new Error("Ruta inválida en la configuración del panel.");
  const expanded = value === "~" ? os.homedir()
    : /^~[/\\]/.test(value) ? path.join(os.homedir(), value.slice(2)) : value;
  return path.resolve(process.env.PANEL_BASE_DIR ?? process.cwd(), expanded);
}
