import { NextResponse } from "next/server";
import { getGpsDevice } from "@/lib/store";
import { configureDeviceScenario, getDeviceScenario, TrackingScenarioConflict } from "@/lib/tracking";
import { InvalidScenario, parseScenarioConfig } from "@/lib/route-scenarios";
import { errorResponse, parseId, readJson } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

/** GET /api/gps-devices/{id}/scenario: configuration/progress, never the full geometry. */
export async function GET(_request: Request, { params }: Context) {
  const id = parseId((await params).id);
  if (!id || !getGpsDevice(id)) return errorResponse(404, "GPS device not found");
  return NextResponse.json({ configuration: getDeviceScenario(id) });
}

/** PUT /api/gps-devices/{id}/scenario: exact authorized GeoJSON plus optional OSRM detour. */
export async function PUT(request: Request, { params }: Context) {
  const id = parseId((await params).id);
  if (!id || !getGpsDevice(id)) return errorResponse(404, "GPS device not found");
  const body = await readJson(request);
  if (!body) return errorResponse(400, "Invalid JSON body");
  try {
    const config = parseScenarioConfig(body);
    return NextResponse.json({ configuration: configureDeviceScenario(id, config) });
  } catch (error) {
    if (error instanceof InvalidScenario) return errorResponse(400, error.message);
    if (error instanceof TrackingScenarioConflict) return errorResponse(409, error.message);
    throw error;
  }
}
