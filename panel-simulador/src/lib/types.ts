export const scenarios = [
  "sin_guia",
  "habilitacion",
  "carga",
  "desvio",
] as const;
export type Scenario = (typeof scenarios)[number];
export type Target = "local" | "elasticcloud";
export type Selection = Scenario | "todos" | "diagnostico" | "restaurar" | "preparar_desvio" | "continuar_desvio" | "seguir_viaje" | "concurrencia";
export type Factor = 1 | 20;
export type StreamKey = "live" | "detour" | "infractions";
export const labels: Record<Scenario, string> = {
  sin_guia: "Viaje sin guía",
  habilitacion: "Sin habilitación",
  carga: "Exceso de carga",
  desvio: "Desvío de ruta",
};
export const caseTypes: Record<Scenario, string> = {
  sin_guia: "VIAJE_SIN_GUIA",
  habilitacion: "VEHICULO_SIN_HABILITACION",
  carga: "EXCESO_CARGA",
  desvio: "DESVIO_RUTA",
};
export interface Device {
  id: number;
  licensePlate: string;
  active: boolean;
}
export interface Line {
  type: "LineString";
  coordinates: [number, number][];
}
export interface Step {
  scenario: Scenario;
  status: "pendiente" | "ejecutando" | "detectado" | "fallido" | "cancelado";
  message: string;
  caseId?: number;
  dates?: string[];
  evidence?: unknown;
  durationMs?: number;
}
export interface Check {
  name: string;
  ok: boolean;
  message: string;
}
export interface Run {
  id: string;
  target: Target;
  selection: Selection;
  factor: Factor;
  status:
    "ejecutando" | "completado" | "fallido" | "cancelado" | "interrumpido";
  message: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  steps: Step[];
  checks: Check[];
  logs: { time: string; message: string }[];
  gpsBackup?: Device[];
  cleanupRequired: boolean;
  resilience?: {
    status: "pendiente" | "indisponible" | "recuperando" | "verificado" | "fallido" | "cancelado";
    message: string;
    outageId: string;
    restoreRequired: boolean;
    until?: string;
    rejectedWeighingQueries?: number;
    failedPollVerified?: boolean;
    weighing?: unknown;
  };
  prepared?: PreparedDetour;
  live?: LiveTrip;
  concurrent?: { live: StreamResult; detour: StreamResult; infractions?: StreamResult };
}
export interface LiveTrip {
  guideId: string;
  plate: string;
  gpsId: number;
  lastAt?: string;
  receivedCount: number;
  startedAt: string;
  guideState: string;
}
export interface StreamResult {
  startedAt?: string;
  emittedOffset?: number;
  status: "pendiente" | "ejecutando" | "completado" | "cancelado" | "fallido";
  message: string;
  emitted?: number;
  brokerConfirmed?: number;
  received?: number;
  lastAt?: string;
}
export interface PreparedDetour {
  context: string;
  configurationId: string;
  gpsId: number;
  stopAtMeters: number;
  expectedPoints: number;
  firstAt: string;
  lastAt: string;
  lastMessageId: string;
  hashes: string[];
}
export interface Profile {
  centralUrl: string;
  trackingUrl: string;
  balanzasUrl: string;
  platformUrl: string;
  apiKey: string;
  funcionarioCi: string;
  trackingClientId: string;
  trackingClientSecret: string;
  balanzasClientId: string;
  balanzasClientSecret: string;
  osrmUrl: string;
  gpsWithoutGuide: number;
  plateWithoutGuide: string;
  gpsWithGuide: number;
  plateWithGuide: string;
  guideId: string;
  liveGuideId: string;
  livePlate: string;
  liveGps: number;
  liveOrigin: [number, number];
  liveDestination: [number, number];
  scaleId: number;
  excessKg: number;
  origin: [number, number];
  destination: [number, number];
  waypoint: [number, number];
  timeoutMs: number;
  deviationTimeoutMs: number;
  pollMs: number;
  requestTimeoutMs: number;
  pollerMode: "disabled" | "docker" | "ssh";
  composeFile: string;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshIdentityFile: string;
  sshKnownHostsFile: string;
  namespace: string;
  cronjob: string;
  pollerTimeoutMs: number;
}
export interface TrackingState {
  trackingOn: boolean;
  capabilities?: string[];
  pausedAtBoundary?: boolean;
  pendingMessages: number;
  flushing: boolean;
  intervalSeconds: number;
  speedKmh: number;
  simulatedStartAt?: string;
  configuredDevices: {
    gpsId: number;
    distanceMeters: number;
    configurationId?: string;
    preparation?: { stopAtMeters: number; durationSeconds: number; expectedPoints: number } | null;
    lastReportedMeters?: number | null;
    lastMeasurementAt?: string | null;
    lastMessageId?: string | null;
    emittedPoints?: number;
    confirmedPoints?: number;
    running?: boolean;
    pausedAtBoundary?: boolean;
    pendingMessages?: number;
  }[];
}
export interface Guide {
  estado: string;
  fechaAsignacion: string;
  fin?: string;
  inicio?: string;
  vehiculo: { matricula: string; pesoMaximoKg: number };
}
export interface CaseSummary {
  id: number;
  tipoCaso: string;
  matricula: string;
  idGuia?: string;
}
export interface Evidence {
  tipoCaso: string;
  vehiculo?: { matricula: string };
  guia?: { id: string };
  eventosTracking?: { fechaHora: string }[];
  pruebasHabilitacion?: {
    fechaHora: string;
    origen: string;
    estadoPermiso: string;
    estadoItv: string;
  }[];
  pruebasDesvio?: {
    fechaHora: string;
    fechaPareja: string;
    distanciaConfirmanteMetros: number;
    distanciaParejaMetros: number;
    umbralMetros: number;
    ventanaMaximaSegundos: number;
    hashesRutas: string[];
  }[];
  pesajes?: { fechaHora: string; pesoKg: number }[];
}
export interface Position {
  fechaHora: string;
  gpsId: number;
  messageId: string;
  latitud?: number;
  longitud?: number;
}
