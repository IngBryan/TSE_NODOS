export function sameOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const expected = host ? `${url.protocol}//${host}` : url.origin;
  return request.headers.get("origin") === expected;
}
