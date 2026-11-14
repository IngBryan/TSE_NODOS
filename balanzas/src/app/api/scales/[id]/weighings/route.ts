import { NextResponse } from "next/server";
import { rejectDuringOutage } from "@/lib/availability";
import { createWeighing, getScale, listWeighings } from "@/lib/store";
import { errorResponse, parseId, readJson } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

// GET /api/scales/:id/weighings?from=<ISO>&to=<ISO>&licensePlate=SBC1234
// Weighings of a scale in a date range (inclusive), optionally for a single vehicle.
export async function GET(request: Request, { params }: Context) {
  const fault = rejectDuringOutage(true);
  if (fault) return fault;
  const id = parseId((await params).id);
  if (!id || !getScale(id)) return errorResponse(404, "Scale not found");

  const query = new URL(request.url).searchParams;
  const errors: string[] = [];

  const parseDate = (key: string) => {
    const raw = query.get(key);
    if (raw === null) {
      errors.push(`${key} is required`);
      return undefined;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      errors.push(`${key} must be an ISO 8601 date string`);
      return undefined;
    }
    return date;
  };
  const from = parseDate("from");
  const to = parseDate("to");
  if (from && to && from > to) errors.push("from must not be after to");

  if (errors.length) return errorResponse(400, "Invalid query parameters", errors);

  return NextResponse.json(
    listWeighings({
      scaleId: id,
      licensePlate: query.get("licensePlate")?.trim().toUpperCase(),
      from,
      to,
    }),
  );
}

// POST /api/scales/:id/weighings
// Inject an explicit weighing into the in-memory peripheral mock for demos.
// The standard GET contract and the Central poller remain unchanged.
// Body: { "licensePlate": "STU5678", "weight": 39000 }
export async function POST(request: Request, { params }: Context) {
  const fault = rejectDuringOutage();
  if (fault) return fault;
  const id = parseId((await params).id);
  const scale = id && getScale(id);
  if (!scale) return errorResponse(404, "Scale not found");
  if (!scale.active) return errorResponse(409, "Scale is inactive");

  const body = await readJson(request);
  if (!body) return errorResponse(400, "Invalid JSON body");

  const { licensePlate, weight } = body;
  const normalizedPlate = typeof licensePlate === "string"
    ? licensePlate.trim().toUpperCase().replace(/[\s-]+/g, "")
    : "";
  const errors: string[] = [];
  if (!/^[A-Z0-9]{6,8}$/.test(normalizedPlate)) {
    errors.push("licensePlate must be 6-8 letters/numbers");
  }
  if (!Number.isSafeInteger(weight) || (weight as number) <= 0) {
    errors.push("weight must be a positive integer in kg");
  }
  if (errors.length) return errorResponse(400, "Validation failed", errors);

  return NextResponse.json(createWeighing(id, normalizedPlate, weight as number), { status: 201 });
}
