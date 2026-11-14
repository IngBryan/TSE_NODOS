import { authenticated, sameOrigin } from "@/lib/auth";
import { start, stop, view } from "@/lib/runner";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!authenticated(request))
    return Response.json({ error: "Iniciar sesión." }, { status: 401 });
  try {
    return Response.json(view(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      {
        error:
          "No se pudo leer el estado. Revisar el almacenamiento del servidor.",
      },
      { status: 500 },
    );
  }
}
export async function POST(request: Request) {
  if (!authenticated(request))
    return Response.json({ error: "Iniciar sesión." }, { status: 401 });
  if (!sameOrigin(request))
    return Response.json({ error: "Origen no permitido." }, { status: 403 });
  try {
    const b = await request.json();
    if (b.action === "stop") {
      if (b.stream !== undefined && !["live", "detour", "infractions"].includes(b.stream))
        return Response.json({ error: "GPS inválido." }, { status: 400 });
      return Response.json(stop(b.stream), { status: 202 });
    }
    if (b.factor !== undefined)
      return Response.json(
        { error: "La velocidad se administra automáticamente; no es un parámetro configurable." },
        { status: 400 },
      );
    if (b.balanzasOutage !== undefined && typeof b.balanzasOutage !== "boolean")
      return Response.json({ error: "La opción de indisponibilidad debe ser booleana." }, { status: 400 });
    if (
      b.action !== "start" ||
      !["local", "elasticcloud"].includes(b.target) ||
      ![
        "diagnostico",
        "todos",
        "sin_guia",
        "habilitacion",
        "carga",
        "desvio",
        "restaurar",
        "preparar_desvio",
        "continuar_desvio",
        "seguir_viaje",
        "concurrencia",
      ].includes(b.selection)
    )
      return Response.json(
        { error: "Acción, ambiente o escenario inválido." },
        { status: 400 },
      );
    return Response.json(start(b.target, b.selection, b.balanzasOutage ?? false), {
      status: 202,
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : "No se pudo iniciar la ejecución.",
      },
      { status: 409 },
    );
  }
}
