import { NextResponse } from "next/server";
import { getTrackingStatus, setTracking, TrackingScenarioConflict } from "@/lib/tracking";
import { errorResponse, readJson } from "@/lib/validation";

/** GET /api/tracking-on includes pending broker messages and device scenario progress. */
export async function GET() {
  return NextResponse.json(getTrackingStatus());
}

/** PUT /api/tracking-on { trackingOn: boolean } — unchanged request contract. */
export async function PUT(request: Request) {
  const body = await readJson(request);
  if (!body) return errorResponse(400, "Invalid JSON body");
  if (typeof body.trackingOn !== "boolean") {
    return errorResponse(400, "Validation failed", ["trackingOn is required and must be a boolean"]);
  }
  try {
    setTracking(body.trackingOn);
    return NextResponse.json(getTrackingStatus());
  } catch (error) {
    if (error instanceof TrackingScenarioConflict) return errorResponse(409, error.message);
    throw error;
  }
}
