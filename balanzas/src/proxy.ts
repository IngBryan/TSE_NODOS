import { NextResponse, type NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/auth";

// Endpoints reachable without a token.
const PUBLIC_PATHS = new Set(["/api/health", "/api/oauth/token"]);

// RFC 6750 §3: no error code when the request carries no token at all.
function unauthorized(message: string, invalidToken: boolean) {
  const challenge = invalidToken
    ? `Bearer realm="balanzas", error="invalid_token", error_description="${message}"`
    : 'Bearer realm="balanzas"';
  return NextResponse.json(
    { error: "Unauthorized", details: [message] },
    { status: 401, headers: { "WWW-Authenticate": challenge } },
  );
}

export async function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();

  const match = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return unauthorized("Missing bearer token", false);

  if (!(await verifyAccessToken(match[1]))) {
    return unauthorized("Invalid or expired token", true);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
