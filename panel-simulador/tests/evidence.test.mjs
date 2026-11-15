import test from "node:test";
import assert from "node:assert/strict";
import { freshEvidence } from "../src/lib/evidence.ts";
import { sameOrigin } from "../src/lib/origin.ts";
const now = Date.now(),
  a = new Date(now - 2000).toISOString(),
  b = new Date(now - 1000).toISOString();
const probe = {
  type: "VIAJE_SIN_GUIA",
  plate: "SBC1234",
  since: now - 3000,
  baseline: new Set(),
  hashes: ["hash"],
};
test("GPS exige dos fechas nuevas y ninguna futura", () => {
  const e = {
    tipoCaso: probe.type,
    vehiculo: { matricula: probe.plate },
    eventosTracking: [{ fechaHora: a }, { fechaHora: b }],
  };
  assert.deepEqual(freshEvidence("sin_guia", e, probe), [a, b]);
  assert.equal(
    freshEvidence("sin_guia", e, {
      ...probe,
      baseline: new Set([Date.parse(a), Date.parse(b)]),
    }),
    null,
  );
  assert.equal(
    freshEvidence("sin_guia", e, { ...probe, plate: "OTRA123" }),
    null,
  );
  assert.equal(
    freshEvidence(
      "sin_guia",
      { ...e, eventosTracking: [{ fechaHora: a }, { fechaHora: a }] },
      probe,
    ),
    null,
  );
  assert.equal(
    freshEvidence(
      "sin_guia",
      {
        ...e,
        eventosTracking: [
          { fechaHora: a },
          { fechaHora: new Date(Date.now() + 60000).toISOString() },
        ],
      },
      probe,
    ),
    null,
  );
});
test("desvío exige pareja fuera del umbral y hashes de la guía", () => {
  const p = { ...probe, type: "DESVIO_RUTA", guide: "GV1" };
  const v = {
    fechaHora: a,
    fechaPareja: b,
    distanciaConfirmanteMetros: 3000,
    distanciaParejaMetros: 3001,
    umbralMetros: 2000,
    ventanaMaximaSegundos: 30,
    hashesRutas: ["hash"],
  };
  const e = {
    tipoCaso: p.type,
    vehiculo: { matricula: p.plate },
    guia: { id: "GV1" },
    pruebasDesvio: [v],
  };
  assert.deepEqual(freshEvidence("desvio", e, p), [a, b]);
  assert.equal(freshEvidence("desvio", e, { ...p, hashes: ["otra"] }), null);
  assert.equal(
    freshEvidence(
      "desvio",
      { ...e, pruebasDesvio: [{ ...v, distanciaParejaMetros: 100 }] },
      p,
    ),
    null,
  );
  assert.equal(
    freshEvidence(
      "desvio",
      { ...e, pruebasDesvio: [{ ...v, fechaPareja: a }] },
      p,
    ),
    null,
  );
});
test("carga exige peso y fecha exactos del recibo", () => {
  const p = { ...probe, type: "EXCESO_CARGA", weight: 50000, weighingDate: a },
    e = {
      tipoCaso: p.type,
      vehiculo: { matricula: p.plate },
      pesajes: [{ fechaHora: a, pesoKg: 50000 }],
    };
  assert.deepEqual(freshEvidence("carga", e, p), [a]);
  assert.equal(freshEvidence("carga", e, { ...p, weighingDate: b }), null);
  assert.equal(freshEvidence("carga", e, { ...p, weight: 49000 }), null);
});
test("habilitación exige prueba de Tracking con documentación inválida", () => {
  const p = { ...probe, type: "VEHICULO_SIN_HABILITACION" },
    v = {
      fechaHora: a,
      origen: "TRACKING",
      estadoPermiso: "VENCIDO",
      estadoItv: "VIGENTE",
    },
    e = {
      tipoCaso: p.type,
      vehiculo: { matricula: p.plate },
      pruebasHabilitacion: [v],
    };
  assert.deepEqual(freshEvidence("habilitacion", e, p), [a]);
  assert.equal(
    freshEvidence(
      "habilitacion",
      { ...e, pruebasHabilitacion: [{ ...v, origen: "BALANZA" }] },
      p,
    ),
    null,
  );
});
test("acciones locales aceptan el origen propio sin cookies y rechazan origen externo o ausente", () => {
  const req = new Request("http://localhost:3100/api/control", {
    headers: {
      origin: "http://localhost:3100",
    },
  });
  assert.equal(sameOrigin(req), true);
  assert.equal(sameOrigin(new Request(req.url)), false);
  assert.equal(
    sameOrigin(
      new Request(req.url, { headers: { origin: "https://otro.example" } }),
    ),
    false,
  );
});

test("origen respeta el host y el puerto del panel", () => {
  const request = new Request("http://0.0.0.0:3100/api/control", {
    headers: { host: "localhost:3102", origin: "http://localhost:3102" },
  });
  assert.equal(sameOrigin(request), true);
  assert.equal(
    sameOrigin(
      new Request(request.url, {
        headers: { host: "localhost:3102", origin: "https://externo.example" },
      }),
    ),
    false,
  );
});
