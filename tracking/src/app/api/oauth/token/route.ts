import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthConfig, issueAccessToken } from "@/lib/auth";

// OAuth 2.0 errors (RFC 6749 §5.2). Responses must not be cached.
function oauthError(status: number, error: string, description: string) {
  return NextResponse.json(
    { error, error_description: description },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(status === 401 && { "WWW-Authenticate": 'Basic realm="tracking"' }),
      },
    },
  );
}

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

async function readParams(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = await request.json();
      return body && typeof body === "object" ? body : {};
    }
    return Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    return {};
  }
}

// Client credentials via HTTP Basic (preferred by the RFC) or in the body.
function readClientCredentials(request: Request, params: Record<string, string>) {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString();
    const sep = decoded.indexOf(":");
    if (sep !== -1) {
      return {
        clientId: decodeURIComponent(decoded.slice(0, sep)),
        clientSecret: decodeURIComponent(decoded.slice(sep + 1)),
      };
    }
  }
  return { clientId: params.client_id, clientSecret: params.client_secret };
}

// POST /api/oauth/token  grant_type=client_credentials
export async function POST(request: Request) {
  const params = await readParams(request);

  if (!params.grant_type) {
    return oauthError(400, "invalid_request", "grant_type is required");
  }
  if (params.grant_type !== "client_credentials") {
    return oauthError(400, "unsupported_grant_type", "Only client_credentials is supported");
  }

  const config = getAuthConfig();
  const { clientId, clientSecret } = readClientCredentials(request, params);
  if (
    typeof clientId !== "string" ||
    typeof clientSecret !== "string" ||
    !safeEqual(clientId, config.clientId) ||
    !safeEqual(clientSecret, config.clientSecret)
  ) {
    return oauthError(401, "invalid_client", "Invalid client credentials");
  }

  return NextResponse.json(
    {
      access_token: await issueAccessToken(clientId),
      token_type: "Bearer",
      expires_in: config.tokenTtlSeconds,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
