import { NextResponse } from "next/server";
import { rejectDuringOutage } from "@/lib/availability";
import { deactivateScale, getScale, updateScale } from "@/lib/store";
import { errorResponse, parseId, readJson, validateScale } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

// GET /api/scales/:id
export async function GET(_request: Request, { params }: Context) {
  const fault = rejectDuringOutage();
  if (fault) return fault;
  const id = parseId((await params).id);
  const scale = id && getScale(id);
  if (!scale) return errorResponse(404, "Scale not found");
  return NextResponse.json(scale);
}

// PUT /api/scales/:id  (full replace)
export async function PUT(request: Request, { params }: Context) {
  const fault = rejectDuringOutage();
  if (fault) return fault;
  const id = parseId((await params).id);
  if (!id || !getScale(id)) return errorResponse(404, "Scale not found");

  const body = await readJson(request);
  if (!body) return errorResponse(400, "Invalid JSON body");

  const result = validateScale(body);
  if (!result.ok) return errorResponse(400, "Validation failed", result.errors);

  return NextResponse.json(updateScale(id, result.value));
}

// DELETE /api/scales/:id  (logical delete: sets active = false)
export async function DELETE(_request: Request, { params }: Context) {
  const fault = rejectDuringOutage();
  if (fault) return fault;
  const id = parseId((await params).id);
  const scale = id && deactivateScale(id);
  if (!scale) return errorResponse(404, "Scale not found");
  return NextResponse.json(scale);
}
