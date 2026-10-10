import { NextResponse } from "next/server";
import { getScale, listWeighings } from "@/lib/store";
import { errorResponse, parseId } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

// GET /api/scales/:id/weighings?from=<ISO>&to=<ISO>&licensePlate=SBC1234
// Weighings of a scale in a date range (inclusive), optionally for a single vehicle.
export async function GET(request: Request, { params }: Context) {
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
