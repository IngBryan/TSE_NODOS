import { jwtVerify, SignJWT } from "jose";

// Mock OAuth 2.0 (client_credentials). Credentials come from env vars:
// `.env` in development (loaded by Next), real environment variables in production.
const ISSUER = "tracking";
const AUDIENCE = "tracking-api";
const DEFAULT_TOKEN_TTL_SECONDS = 3600;

interface AuthConfig {
  clientId: string;
  clientSecret: string;
  signingKey: Uint8Array;
  tokenTtlSeconds: number;
}

let config: AuthConfig | undefined;

// Read lazily (not at import time) so `next build` works without the secrets.
export function getAuthConfig(): AuthConfig {
  if (config) return config;

  const { OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, JWT_SECRET, OAUTH_TOKEN_TTL_SECONDS } = process.env;
  const missing = Object.entries({ OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, JWT_SECRET })
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  if (JWT_SECRET!.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long");
  }

  config = {
    clientId: OAUTH_CLIENT_ID!,
    clientSecret: OAUTH_CLIENT_SECRET!,
    signingKey: new TextEncoder().encode(JWT_SECRET),
    tokenTtlSeconds: Number(OAUTH_TOKEN_TTL_SECONDS) || DEFAULT_TOKEN_TTL_SECONDS,
  };
  return config;
}

export async function issueAccessToken(clientId: string): Promise<string> {
  const { signingKey, tokenTtlSeconds } = getAuthConfig();
  return new SignJWT({ client_id: clientId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(clientId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${tokenTtlSeconds}s`)
    .sign(signingKey);
}

/** Returns true if the token is a valid, unexpired JWT issued by this service. */
export async function verifyAccessToken(token: string): Promise<boolean> {
  const { signingKey } = getAuthConfig();
  try {
    await jwtVerify(token, signingKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    return true;
  } catch {
    return false;
  }
}
