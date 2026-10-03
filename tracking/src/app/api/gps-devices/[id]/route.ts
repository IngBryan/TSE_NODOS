import { NextResponse } from "next/server";
import { deactivateGpsDevice, getGpsDevice, updateGpsDevice } from "@/lib/store";
import { errorResponse, parseId, readJson, validateGpsDevice } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

// GET /api/gps-devices/:id
export async function GET(_request: Request, { params }: Context) {
  const id = parseId((await params).id);
  const device = id && getGpsDevice(id);
  if (!device) return errorResponse(404, "GPS device not found");
  return NextResponse.json(device);
}

// PUT /api/gps-devices/:id  (full replace)
export async function PUT(request: Request, { params }: Context) {
  const id = parseId((await params).id);
  if (!id || !getGpsDevice(id)) return errorResponse(404, "GPS device not found");

  const body = await readJson(request);
  if (!body) return errorResponse(400, "Invalid JSON body");

  const result = validateGpsDevice(body);
  if (!result.ok) return errorResponse(400, "Validation failed", result.errors);

  return NextResponse.json(updateGpsDevice(id, result.value));
}

// DELETE /api/gps-devices/:id  (logical delete: sets active = false)
export async function DELETE(_request: Request, { params }: Context) {
  const id = parseId((await params).id);
  const device = id && deactivateGpsDevice(id);
  if (!device) return errorResponse(404, "GPS device not found");
  return NextResponse.json(device);
}
