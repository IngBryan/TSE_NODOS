import { availability, setAvailability } from "@/lib/availability";
import { errorResponse, readJson } from "@/lib/validation";

export const dynamic = "force-dynamic";
// OAuth is enforced by proxy.ts. Control and OAuth remain accessible during the fault.
export async function GET() {
  return Response.json(availability(), { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(request: Request) {
  const body = await readJson(request);
  if (!body || typeof body.outageId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(body.outageId)
      || !Number.isInteger(body.durationSeconds) || (body.durationSeconds as number) < 0 || (body.durationSeconds as number) > 180)
    return errorResponse(400, "outageId and durationSeconds (0-180) are required");
  try {
    return Response.json(setAvailability(body.outageId, body.durationSeconds as number), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse(409, "Another outage is already active");
  }
}
