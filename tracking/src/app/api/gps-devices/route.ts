import { NextResponse } from "next/server";
import { createGpsDevice, getGpsDevice, listGpsDevices } from "@/lib/store";
import { errorResponse, readJson, validateGpsDevice } from "@/lib/validation";

// GET /api/gps-devices?active=true|false&licensePlate=SBC1234
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const active = params.get("active");
  if (active !== null && active !== "true" && active !== "false") {
    return errorResponse(400, "active must be 'true' or 'false'");
  }
  return NextResponse.json(
    listGpsDevices({
      active: active === null ? undefined : active === "true",
      licensePlate: params.get("licensePlate")?.trim().toUpperCase(),
    }),
  );
}

// POST /api/gps-devices
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return errorResponse(400, "Invalid JSON body");

  if (body.id !== undefined && (typeof body.id !== "number" || !Number.isSafeInteger(body.id) || body.id < 1))
    return errorResponse(400, "id must be a positive safe integer");
  if (typeof body.id === "number" && getGpsDevice(body.id))
    return errorResponse(409, "GPS id already exists");
  const result = validateGpsDevice(body);
  if (!result.ok) return errorResponse(400, "Validation failed", result.errors);

  return NextResponse.json(createGpsDevice(result.value, body.id as number | undefined), { status: 201 });
}
