import { NextResponse } from "next/server";
import { getTrackingOn, setTracking } from "@/lib/tracking";
import { errorResponse, readJson } from "@/lib/validation";

// GET /api/tracking-on
export async function GET() {
  return NextResponse.json({ trackingOn: getTrackingOn() });
}

// PUT /api/tracking-on  { "trackingOn": true | false }
// While on, active GPS devices report positions that are published to RabbitMQ.
export async function PUT(request: Request) {
  const body = await readJson(request);
  if (!body) return errorResponse(400, "Invalid JSON body");
  if (typeof body.trackingOn !== "boolean") {
    return errorResponse(400, "Validation failed", ["trackingOn is required and must be a boolean"]);
  }
  return NextResponse.json({ trackingOn: setTracking(body.trackingOn) });
}
