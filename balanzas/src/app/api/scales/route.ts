import { NextResponse } from "next/server";
import { createScale, listScales } from "@/lib/store";
import { errorResponse, readJson, validateScale } from "@/lib/validation";

// GET /api/scales?active=true|false
export async function GET(request: Request) {
  const active = new URL(request.url).searchParams.get("active");
  if (active !== null && active !== "true" && active !== "false") {
    return errorResponse(400, "active must be 'true' or 'false'");
  }
  return NextResponse.json(listScales({ active: active === null ? undefined : active === "true" }));
}

// POST /api/scales
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return errorResponse(400, "Invalid JSON body");

  const result = validateScale(body);
  if (!result.ok) return errorResponse(400, "Validation failed", result.errors);

  return NextResponse.json(createScale(result.value), { status: 201 });
}
