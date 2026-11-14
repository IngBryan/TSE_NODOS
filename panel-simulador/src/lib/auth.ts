import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
const name = "panel_session";
export function passwordConfigured() {
  return (process.env.PANEL_PASSWORD?.length ?? 0) >= 12;
}
function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function signature(value: string) {
  return createHmac(
    "sha256",
    process.env.PANEL_SESSION_SECRET ?? process.env.PANEL_PASSWORD ?? "",
  )
    .update(value)
    .digest("hex");
}
export function validPassword(password: unknown) {
  return (
    passwordConfigured() &&
    typeof password === "string" &&
    equal(signature(password), signature(process.env.PANEL_PASSWORD!))
  );
}
export function sessionValue() {
  const payload =
    Date.now() + 8 * 3600000 + "." + randomBytes(16).toString("hex");
  return payload + "." + signature(payload);
}
export function authenticated(request: Request) {
  if (!passwordConfigured()) return false;
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1);
  if (!value) return false;
  const [expiry, nonce, sig] = value.split(".");
  return (
    !!nonce &&
    !!sig &&
    Number(expiry) > Date.now() &&
    Number(expiry) <= Date.now() + 8 * 3600000 &&
    equal(signature(expiry + "." + nonce), sig)
  );
}
export function cookie(request: Request, value: string) {
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value ? 28800 : 0}${process.env.PANEL_COOKIE_SECURE === "true" || new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export function sameOrigin(request: Request) {
  const url = new URL(request.url);
  const expected =
    process.env.PANEL_PUBLIC_ORIGIN ??
    (request.headers.get("host")
      ? `${url.protocol}//${request.headers.get("host")}`
      : url.origin);
  return request.headers.get("origin") === expected;
}
