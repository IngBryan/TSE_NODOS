export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    { status: "ok", service: "panel-simulador" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
