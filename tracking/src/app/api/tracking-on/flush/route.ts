import { NextResponse } from "next/server";
import { retryPendingMessages, TrackingScenarioConflict } from "@/lib/tracking";
import { errorResponse } from "@/lib/validation";

/** POST /api/tracking-on/flush: retry only already generated GPS events. */
export async function POST() {
  try {
    return NextResponse.json(await retryPendingMessages());
  } catch (error) {
    if (error instanceof TrackingScenarioConflict) return errorResponse(409, error.message);
    throw error;
  }
}
