import { NextResponse } from "next/server";
import type { ScaleInput } from "./types";

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

function isNumberInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

export function validateScale(body: Body): Result<ScaleInput> {
  const errors: string[] = [];
  const { name, latitude, longitude, active = true } = body;

  if (typeof name !== "string" || name.trim() === "") {
    errors.push("name is required and must be a non-empty string");
  }
  if (!isNumberInRange(latitude, -90, 90)) {
    errors.push("latitude is required and must be a number between -90 and 90");
  }
  if (!isNumberInRange(longitude, -180, 180)) {
    errors.push("longitude is required and must be a number between -180 and 180");
  }
  if (typeof active !== "boolean") errors.push("active must be a boolean");

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: (name as string).trim(),
      latitude: latitude as number,
      longitude: longitude as number,
      active: active as boolean,
    },
  };
}
