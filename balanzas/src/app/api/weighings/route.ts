import { NextResponse } from "next/server";
import { listWeighings } from "@/lib/store";
import { errorResponse, parseId } from "@/lib/validation";

// GET /api/weighings?scaleId=1&licensePlate=SBC1234&from=<ISO>&to=<ISO>
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const errors: string[] = [];

  const rawScaleId = params.get("scaleId");
  const scaleId = rawScaleId === null ? undefined : parseId(rawScaleId);
  if (scaleId === null) errors.push("scaleId must be a positive integer");

  const parseDate = (key: string) => {
    const raw = params.get(key);
    if (raw === null) return undefined;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) errors.push(`${key} must be an ISO 8601 date string`);
    return date;
  };
  const from = parseDate("from");
  const to = parseDate("to");

  if (errors.length) return errorResponse(400, "Invalid query parameters", errors);

  return NextResponse.json(
    listWeighings({
      scaleId: scaleId ?? undefined,
      licensePlate: params.get("licensePlate")?.trim().toUpperCase(),
      from,
      to,
    }),
  );
}
