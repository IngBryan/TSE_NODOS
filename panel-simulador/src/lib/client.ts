import { setTimeout as sleep } from "node:timers/promises";
import type {
  Profile,
  TrackingState,
  Device,
  Guide,
  CaseSummary,
  Evidence,
  Line,
  Position,
} from "./types.ts";
export const delay = (ms: number, signal?: AbortSignal) =>
  sleep(ms, undefined, { signal });
export class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export class Client {
  private tokens = new Map<string, { token: string; expires: number }>();
  readonly config: Profile;
  readonly signal?: AbortSignal;
  constructor(config: Profile, signal?: AbortSignal) {
    this.config = config;
    this.signal = signal;
  }
  async request<T>(
    base: string,
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.config.requestTimeoutMs),
      ...(this.signal ? [this.signal] : []),
    ]);
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          ...headers,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        cache: "no-store",
        redirect: "error",
      });
    } catch (e) {
      if (this.signal?.aborted) throw new Error("Ejecución cancelada.");
      throw new Error(
        `${new URL(base).host}: no se pudo conectar (${e instanceof Error && e.name === "TimeoutError" ? "tiempo agotado" : "red o servicio no disponible"}).`,
      );
    }
    if (!res.ok) {
      let detail = "";
      try {
        const data = await res.json();
        detail =
          typeof data.detalle === "string"
            ? data.detalle
            : typeof data.error === "string"
              ? data.error
              : "";
      } catch {}
      throw new HttpError(
        `${method} ${new URL(base).host}${path.split("?")[0]}: HTTP ${res.status}${detail ? " — " + detail.slice(0, 240) : ""}`,
        res.status,
      );
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error(`${new URL(base).host}: respuesta JSON inválida.`);
    }
  }
  central<T>(path: string) {
    return this.request<T>(this.config.centralUrl, path, "GET", undefined, {
      "X-Api-Key": this.config.apiKey,
      "X-Usuario-Ci": this.config.funcionarioCi,
      "X-Correlation-Id": "panel-" + crypto.randomUUID(),
    });
  }
  async node<T>(
    node: "tracking" | "balanzas",
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const base =
      node === "tracking" ? this.config.trackingUrl : this.config.balanzasUrl;
    let t = this.tokens.get(node);
    if (!t || t.expires < Date.now()) {
      const id =
        node === "tracking"
          ? this.config.trackingClientId
          : this.config.balanzasClientId;
      const secret =
        node === "tracking"
          ? this.config.trackingClientSecret
          : this.config.balanzasClientSecret;
      const r = await this.request<{
        access_token: string;
        expires_in?: number;
      }>(base, "/api/oauth/token", "POST", {
        grant_type: "client_credentials",
        client_id: id,
        client_secret: secret,
      });
      if (typeof r.access_token !== "string" || !r.access_token)
        throw new Error(`${node}: respuesta OAuth inválida.`);
      t = {
        token: r.access_token,
        expires: Date.now() + Math.max(1, (r.expires_in ?? 300) - 20) * 1000,
      };
      this.tokens.set(node, t);
    }
    return this.request<T>(base, path, method, body, {
      Authorization: "Bearer " + t.token,
    });
  }
  state() {
    return this.node<TrackingState>("tracking", "/api/tracking-on");
  }
  devices() {
    return this.node<Device[]>("tracking", "/api/gps-devices");
  }
  guide(id = this.config.guideId) {
    return this.central<Guide>(
      "/viajes/" + encodeURIComponent(id),
    );
  }
  async cases(type: string, plate: string, guide?: string) {
    const found: CaseSummary[] = [];
    let page = 1,
      pages = 1;
    do {
      const r = await this.central<{
        casos: CaseSummary[];
        totalPaginas: number;
      }>(`/casos?pagina=${page}&tamanio=100`);
      if (
        !Array.isArray(r.casos) ||
        !Number.isInteger(r.totalPaginas) ||
        r.totalPaginas < 0 ||
        r.totalPaginas > 10000
      )
        throw new Error("Bandeja del Central inválida.");
      pages = r.totalPaginas;
      found.push(
        ...r.casos.filter(
          (c) =>
            c.tipoCaso === type &&
            c.matricula === plate &&
            (!guide || c.idGuia === guide),
        ),
      );
      page++;
    } while (page <= pages);
    return found;
  }
  evidence(id: number) {
    return this.central<Evidence>(`/casos/${id}/evidencia`);
  }
  async positions(id: number, dates: string[] | undefined, gps: number) {
    const found: Position[] = [];
    let index: number | null = 0;
    const visited = new Set<number>();
    do {
      if (visited.has(index)) throw new Error("Paginación GPS repetida.");
      visited.add(index);
      const p: { posiciones: Position[]; siguienteIndice: number | null } =
        await this.central<{
          posiciones: Position[];
          siguienteIndice: number | null;
        }>(`/casos/${id}/gps?indice=${index}&limite=500`);
      found.push(
        ...p.posiciones.filter(
          (p) =>
            p.gpsId === gps &&
            (!dates || dates.some((d) => Date.parse(d) === Date.parse(p.fechaHora))),
        ),
      );
      index = p.siguienteIndice;
    } while (index !== null && index !== undefined);
    return found;
  }
  async route(points: [number, number][]): Promise<Line> {
    const route = await this.request<{
      code: string;
      routes: { geometry: Line; distance: number }[];
    }>(
      this.config.osrmUrl,
      "/route/v1/driving/" +
        points.map((p) => p.join(",")).join(";") +
        "?overview=full&geometries=geojson&steps=false",
    );
    const r = route.routes?.[0];
    if (
      route.code !== "Ok" ||
      !r ||
      r.geometry.type !== "LineString" ||
      r.geometry.coordinates.length < 2 ||
      r.distance < 100
    )
      throw new Error("OSRM no devolvió un recorrido vial válido.");
    return r.geometry;
  }
  async tripPositions(from: string, until: string, guideId = this.config.guideId) {
    const found: Position[] = [];
    let next: string | null = from;
    const visited = new Set<string>();
    while (next) {
      if (visited.has(next) || visited.size > 2000) throw new Error("Paginación del viaje inválida.");
      visited.add(next);
      const page: { posiciones: Position[]; hayMas: boolean; siguienteDesde: string | null } =
        await this.central(`/viajes/${encodeURIComponent(guideId)}/gps?desde=${encodeURIComponent(next)}&hasta=${encodeURIComponent(until)}&limite=500`);
      if (!Array.isArray(page.posiciones)) throw new Error("Historial GPS inválido.");
      found.push(...page.posiciones);
      if (!page.hayMas) break;
      if (!page.siguienteDesde || Date.parse(page.siguienteDesde) <= Date.parse(next))
        throw new Error("El historial GPS no avanzó de página.");
      next = page.siguienteDesde;
    }
    return found;
  }
  async stopGps(gpsId: number) {
    await this.node("tracking", `/api/gps-devices/${gpsId}/simulation`, "PUT", { running: false });
    const deadline = Date.now() + 30000;
    do {
      const state = await this.state();
      const device = state.configuredDevices.find(d => d.gpsId === gpsId);
      if (!device?.running && !device?.pendingMessages) return;
      if (Date.now() > deadline) throw new Error(`GPS ${gpsId} sigue con mensajes pendientes; restaurar al terminar.`);
      if (!state.trackingOn && !state.flushing && state.pendingMessages)
        await this.node("tracking", "/api/tracking-on/flush", "POST", {});
      await delay(500, this.signal);
    } while (true);
  }
  async stop() {
    let s = await this.node<TrackingState>(
      "tracking",
      "/api/tracking-on",
      "PUT",
      { trackingOn: false },
    );
    const deadline = Date.now() + 30000;
    while (s.pendingMessages || s.flushing) {
      if (Date.now() > deadline)
        throw new Error(
          "Tracking sigue con pendientes; repetir Detener y restaurar.",
        );
      if (!s.flushing && s.pendingMessages)
        await this.node("tracking", "/api/tracking-on/flush", "POST", {});
      await delay(500, this.signal);
      s = await this.state();
    }
  }
}
