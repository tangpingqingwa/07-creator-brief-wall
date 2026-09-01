import assert from "node:assert/strict";
import { test } from "node:test";
import nextConfig from "../next.config";

test("preview config hides dev chrome and preserves local routing seams", async () => {
  assert.equal(nextConfig.devIndicators, false);
  assert.deepEqual(nextConfig.serverExternalPackages, ["better-sqlite3"]);
  assert.deepEqual(await nextConfig.rewrites?.(), [
    { source: "/checkout", destination: "/api/checkout" },
    { source: "/webhooks/waffo", destination: "/api/webhooks/waffo" },
    { source: "/webhooks/polar", destination: "/api/webhooks/polar" },
  ]);
});
