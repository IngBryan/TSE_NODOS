import { NextResponse } from "next/server";
import { createGpsDevice, listGpsDevices } from "@/lib/store";
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

  const result = validateGpsDevice(body);
  if (!result.ok) return errorResponse(400, "Validation failed", result.errors);

  return NextResponse.json(createGpsDevice(result.value), { status: 201 });
}
