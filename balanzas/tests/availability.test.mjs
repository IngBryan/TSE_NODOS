import test from "node:test";
import assert from "node:assert/strict";
import { availability, setAvailability, rejectDuringOutage } from "../src/lib/availability.ts";

test("la interrupción devuelve 503 con Retry-After y cuenta las consultas de pesajes", async () => {
  const id = "test-http";
  setAvailability(id, 30);
  const response = rejectDuringOutage(true);
  assert.equal(response.status, 503);
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
  assert.equal((await response.json()).outageId, id);
  assert.equal(availability().rejectedWeighingQueries, 1);
  setAvailability(id, 0);
  assert.equal(rejectDuringOutage(), undefined);
  assert.equal(availability().rejectedWeighingQueries, 1, "recuperar conserva la constancia de consultas rechazadas");
});
test("se recupera automáticamente aunque el panel desaparezca", () => {
  const now = Date.now();
  setAvailability("test-expiry", 30, now);
  assert.equal(availability(now + 29999).unavailable, true);
  assert.equal(availability(now + 30000).unavailable, false);
});
test("otra ejecución no puede renovar ni levantar una caída activa", () => {
  setAvailability("owner", 30);
  assert.throws(() => setAvailability("another", 0), /already active/);
  assert.throws(() => setAvailability("another", 30), /already active/);
  const until = availability().until;
  setAvailability("owner", 30, Date.now() + 5000);
  assert.equal(availability().until, until, "repetir el PUT no extiende la interrupción");
  setAvailability("owner", 0);
});
