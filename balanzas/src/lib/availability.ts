/** A bounded fault in the simulator's data API; it never deletes stored weighings. */
export interface Availability {
  unavailable: boolean;
  outageId: string | null;
  until: string | null;
  rejectedRequests: number;
  rejectedWeighingQueries: number;
}
const shared = globalThis as unknown as { balanzasAvailability?: Availability };
function state(): Availability {
  return shared.balanzasAvailability ??= {
    unavailable: false, outageId: null, until: null,
    rejectedRequests: 0, rejectedWeighingQueries: 0,
  };
}
export function availability(now = Date.now()): Availability {
  const s = state();
  if (s.unavailable && Date.parse(s.until!) <= now) s.unavailable = false;
  return { ...s };
}
export function setAvailability(outageId: string, durationSeconds: number, now = Date.now()): Availability {
  const current = availability(now);
  if (current.unavailable && current.outageId !== outageId)
    throw new Error("Another outage is already active");
  if (durationSeconds === 0) {
    // Never restore a fault owned by another operator.
    if (current.outageId === outageId) state().unavailable = false;
  } else if (!current.unavailable) {
    Object.assign(state(), {
      unavailable: true, outageId, until: new Date(now + durationSeconds * 1000).toISOString(),
      rejectedRequests: 0, rejectedWeighingQueries: 0,
    });
  }
  return availability(now);
}
export function rejectDuringOutage(weighingQuery = false): Response | undefined {
  const s = availability();
  if (!s.unavailable) return;
  state().rejectedRequests++;
  if (weighingQuery) state().rejectedWeighingQueries++;
  return Response.json({ error: "simulated_unavailability", outageId: s.outageId, until: s.until }, {
    status: 503,
    headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, Math.ceil((Date.parse(s.until!) - Date.now()) / 1000))) },
  });
}
