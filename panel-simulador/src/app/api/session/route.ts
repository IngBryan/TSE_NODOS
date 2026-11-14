import {
  authenticated,
  cookie,
  passwordConfigured,
  sameOrigin,
  sessionValue,
  validPassword,
} from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const globalState = globalThis as unknown as {
  panelLoginAttempts?: { count: number; until: number };
};
export async function GET(request: Request) {
  return Response.json(
    { authenticated: authenticated(request), configured: passwordConfigured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Origen no permitido." }, { status: 403 });
  if (!passwordConfigured())
    return Response.json(
      {
        error:
          "Configurar PANEL_PASSWORD con al menos 12 caracteres en el servidor.",
      },
      { status: 503 },
    );
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    return Response.json(
      { error: "Solicitud demasiado grande." },
      { status: 413 },
    );
  const now = Date.now();
  if (
    !globalState.panelLoginAttempts ||
    globalState.panelLoginAttempts.until < now
  )
    globalState.panelLoginAttempts = { count: 0, until: now + 60000 };
  if (globalState.panelLoginAttempts.count >= 10)
    return Response.json(
      { error: "Demasiados intentos. Esperar un minuto." },
      { status: 429 },
    );
  try {
    const { password } = await request.json();
    if (!validPassword(password)) {
      globalState.panelLoginAttempts.count++;
      return Response.json({ error: "Clave incorrecta." }, { status: 401 });
    }
    globalState.panelLoginAttempts.count = 0;
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": cookie(request, sessionValue()),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json({ error: "Solicitud inválida." }, { status: 400 });
  }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Origen no permitido." }, { status: 403 });
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": cookie(request, "") } },
  );
}
