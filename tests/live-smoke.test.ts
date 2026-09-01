import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("operator smoke accepts only non-secret framework 5xx readiness failures", () => {
  const script = readFileSync(join(process.cwd(), "scripts", "live-smoke.sh"), "utf8");

  assert.ok(script.includes("is_non_secret_5xx()"));
  assert.ok(script.includes('[[ "$code" =~ ^5[0-9][0-9]$ ]]'));
  assert.ok(script.includes("non_secret_body()"));
  for (const route of ["live_health_code", "live_page_code", "live_click_code"]) {
    assert.ok(script.includes(`is_non_secret_5xx "$${route}"`));
  }
  assert.ok(script.includes("non-secret 5xx"));
  assert.ok(script.includes("BLOCKED-SECRET: WAFFO_MERCHANT_ID"));
  assert.ok(!script.includes('live_health_code" == "503"'));

  assert.ok(script.includes('[[ "$health_code" == "200" ]]'));
  assert.ok(script.includes('[[ "$board0_code" != "200" ]]'));
  assert.ok(script.includes("provider calls=0"));
});
