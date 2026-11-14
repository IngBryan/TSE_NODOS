import { NextResponse } from "next/server";
import { getGpsDevice } from "@/lib/store";
import { setDeviceTracking, TrackingScenarioConflict } from "@/lib/tracking";
import { errorResponse, parseId, readJson } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

/** Per-GPS real-time control; accelerated preparation stays exclusive. */
export async function PUT(request: Request, { params }: Context) {
  const id = parseId((await params).id);
  if (!id || !getGpsDevice(id)) return errorResponse(404, "GPS device not found");
  const b = await readJson(request);
  if (!b || typeof b.running !== "boolean"
      || (b.resume !== undefined && typeof b.resume !== "boolean")
      || (b.configurationId !== undefined && typeof b.configurationId !== "string")
      || b.simulationSpeedFactor !== undefined || b.stopAtMeters !== undefined
      || (!b.running && (b.resume !== undefined || b.configurationId !== undefined)))
    return errorResponse(400, "Use running, and optionally resume/configurationId when starting; this endpoint only runs at 1x");
  try {
    return NextResponse.json({ configuration: setDeviceTracking(id, b.running, {
      resume: b.resume as boolean | undefined, configurationId: b.configurationId as string | undefined,
    }) });
  } catch (e) {
    if (e instanceof TrackingScenarioConflict) return errorResponse(409, e.message);
    throw e;
  }
}
