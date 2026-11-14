import { NextResponse } from "next/server";
import { getTrackingStatus, setTracking, TrackingScenarioConflict } from "@/lib/tracking";
import { errorResponse, readJson } from "@/lib/validation";
import { isSimulationSpeedFactor } from "@/lib/simulation-clock";

/** GET /api/tracking-on includes pending broker messages and device scenario progress. */
export async function GET() {
  return NextResponse.json(getTrackingStatus());
}

/** PUT /api/tracking-on {trackingOn: boolean, simulationSpeedFactor?: 1|5|10|20}.
 * Missing factor keeps the original 1x behavior. */
export async function PUT(request: Request) {
  const body = await readJson(request);
  if (!body) return errorResponse(400, "Invalid JSON body");
  if (typeof body.trackingOn !== "boolean") {
    return errorResponse(400, "Validation failed", ["trackingOn is required and must be a boolean"]);
  }
  if (body.simulationSpeedFactor !== undefined
      && !isSimulationSpeedFactor(body.simulationSpeedFactor)) {
    return errorResponse(400, "simulationSpeedFactor must be one of 1, 5, 10, 20");
  }
  if (!body.trackingOn && body.simulationSpeedFactor !== undefined) {
    return errorResponse(400, "simulationSpeedFactor is only accepted when starting tracking");
  }
  if (body.resume !== undefined && typeof body.resume !== "boolean")
    return errorResponse(400, "resume must be a boolean");
  if (body.stopAtMeters !== undefined && (typeof body.stopAtMeters !== "number" || !Number.isFinite(body.stopAtMeters)))
    return errorResponse(400, "stopAtMeters must be a finite number");
  if (body.configurationId !== undefined && (typeof body.configurationId !== "string" || !body.configurationId))
    return errorResponse(400, "configurationId must be a nonempty string");
  if (!body.trackingOn && [body.resume, body.stopAtMeters, body.configurationId].some(v => v !== undefined))
    return errorResponse(400, "resume, stopAtMeters and configurationId are only accepted when starting");
  try {
    if (body.trackingOn && (body.resume || body.stopAtMeters !== undefined) && !body.configurationId)
      return errorResponse(400, "configurationId is required for preparation and resume");
    setTracking(body.trackingOn, body.simulationSpeedFactor, {
      resume: body.resume, stopAtMeters: body.stopAtMeters, configurationId: body.configurationId,
    });
    return NextResponse.json(getTrackingStatus());
  } catch (error) {
    if (error instanceof TrackingScenarioConflict) return errorResponse(409, error.message);
    if (error instanceof Error && error.message.startsWith("Simulation factor")) {
      return errorResponse(409, error.message);
    }
    throw error;
  }
}
