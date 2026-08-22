import assert from "node:assert/strict";
import { test } from "node:test";

test("GET /healthz returns 200 { ok: true }", async () => {
  process.env.DATABASE_PATH = ":memory:";
  const { GET } = await import("../src/app/healthz/route");
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
