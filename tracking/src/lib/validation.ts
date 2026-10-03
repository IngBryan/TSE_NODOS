import { NextResponse } from "next/server";
import type { GpsDeviceInput } from "./types";

type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

type Body = Record<string, unknown>;

export function errorResponse(status: number, message: string, details?: string[]) {
  return NextResponse.json({ error: message, ...(details && { details }) }, { status });
}

export async function readJson(request: Request): Promise<Body | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function validateGpsDevice(body: Body): Result<GpsDeviceInput> {
  const errors: string[] = [];
  const { licensePlate, active = true } = body;

  if (typeof licensePlate !== "string" || licensePlate.trim() === "") {
    errors.push("licensePlate is required and must be a non-empty string");
  }
  if (typeof active !== "boolean") errors.push("active must be a boolean");

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      licensePlate: (licensePlate as string).trim().toUpperCase(),
      active: active as boolean,
    },
  };
}
