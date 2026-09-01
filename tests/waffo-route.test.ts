import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase, resetDbCache } from "../src/lib/db";
import { WaffoPort } from "../src/lib/polar";
import { POST } from "../src/app/api/webhooks/waffo/route";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const identifiers = {
  merchant: "MER_2D5F8G3H1K4M6N9P0Q7R8S",
  store: "STO_2aUyqjCzEIiEcYMKj7TZtw",
  product: "PROD_2aUyqjCzEIiEcYMKj7TZtw",
};

function eventFor(
  metadata: Record<string, string>,
  ids: { delivery: string; payment: string; order: string },
): Record<string, unknown> {
  return {
    id: ids.delivery,
    timestamp: "2026-08-27T12:00:00.000Z",
    eventType: "order.completed",
    eventId: ids.payment,
    storeId: identifiers.store,
    mode: "test",
    data: {
      orderId: ids.order,
      orderStatus: "completed",
      paymentStatus: "succeeded",
      orderMerchantExternalId: metadata.intentId,
      orderMetadata: metadata,
      currency: "USD",
      productMetadata: { productId: identifiers.product },
      productId: identifiers.product,
      amount: "5.00",
      subtotal: "5.00",
      taxAmount: "0.00",
      total: "5.00",
      paymentId: ids.payment,
    },
  };
}

function signed(bodyValue: Record<string, unknown>, timestamp = String(Date.now())) {
  const body = JSON.stringify(bodyValue);
  const signature = createSign("RSA-SHA256")
    .update(`${timestamp}.${body}`)
    .sign(privateKey, "base64");
  return {
    body,
    headers: { "x-waffo-signature": `t=${timestamp},v1=${signature}` },
  };
}

function env(path: string): Record<string, string> {
  return {
    WAFFO_MODE: "waffo-test",
    WAFFO_API_BASE: "https://api.waffo.ai",
    WAFFO_MERCHANT_ID: identifiers.merchant,
    WAFFO_PRIVATE_KEY: privateKey,
    WAFFO_STORE_ID: identifiers.store,
    WAFFO_PRODUCT_ID: identifiers.product,
    WAFFO_WEBHOOK_TEST_PUBLIC_KEY: publicKey,
    PUBLIC_BASE_URL: "http://127.0.0.1:3000",
    DATABASE_PATH: path,
  };
}

async function createIntent(path: string, brand: string): Promise<{
  metadata: Record<string, string>;
  db: ReturnType<typeof openDatabase>;
}> {
  const db = openDatabase(path);
  const requests: Array<Record<string, unknown>> = [];
  const port = new WaffoPort({
    env: env(path),
    db,
    fetch: async (_input, init) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          data: {
            sessionId: `SES_${brand}`,
            checkoutUrl: `https://pancake.waffo.ai/store/test-store/checkout/SES_${brand}`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
  });
  await port.createCheckout({
    amountUsd: 5,
    listingDraft: {
      weekId: "2026-W34",
      brand,
      terms: "$800 flat, 1 TikTok",
      briefUrl: `https://example.com/${brand}`,
      bidUsd: 5,
    },
    successUrl: "http://ignored.example/checkout/complete",
  });
  const metadata = requests[0]?.metadata;
  assert.ok(metadata && typeof metadata === "object" && !Array.isArray(metadata));
  return { metadata: metadata as Record<string, string>, db };
}

async function withProcessEnv<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const names = Object.keys(env(path));
  const previous = new Map<string, string | undefined>();
  for (const name of names) {
    previous.set(name, process.env[name]);
    process.env[name] = env(path)[name];
  }
  resetDbCache();
  try {
    return await fn();
  } finally {
    resetDbCache();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("canonical Waffo HTTP route verifies, retries, rejects bad signatures, and retries transient 5xx", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-waffo-route-"));
  const path = join(dir, "app.sqlite");
  await withProcessEnv(path, async () => {
    const first = await createIntent(path, "RouteFirst");
    first.db.close();
    const firstSigned = signed(
      eventFor(first.metadata, {
        delivery: "DEL_ROUTE_FIRST",
        payment: "PAY_ROUTE_FIRST",
        order: "ORD_ROUTE_FIRST",
      }),
    );

    const appliedResponse = await POST(
      new Request("https://briefs.example/webhooks/waffo", {
        method: "POST",
        headers: firstSigned.headers,
        body: firstSigned.body,
      }),
    );
    assert.equal(appliedResponse.status, 200);
    assert.deepEqual(await appliedResponse.json(), { received: true, applied: true });

    const replayResponse = await POST(
      new Request("https://briefs.example/webhooks/waffo", {
        method: "POST",
        headers: firstSigned.headers,
        body: firstSigned.body,
      }),
    );
    assert.equal(replayResponse.status, 200);
    assert.deepEqual(await replayResponse.json(), {
      received: true,
      applied: true,
      replayed: true,
    });

    const invalidResponse = await POST(
      new Request("https://briefs.example/webhooks/waffo", {
        method: "POST",
        headers: { "x-waffo-signature": "t=1,v1=invalid" },
        body: firstSigned.body,
      }),
    );
    assert.equal(invalidResponse.status, 400);

    resetDbCache();
    const second = await createIntent(path, "RouteRetry");
    second.db.close();
    const triggerDb = openDatabase(path);
    triggerDb.exec(`
      CREATE TRIGGER fail_route_payment_update
      BEFORE UPDATE OF status ON payments
      BEGIN SELECT RAISE(ABORT, 'transient route settlement failure'); END;
    `);
    const secondSigned = signed(
      eventFor(second.metadata, {
        delivery: "DEL_ROUTE_RETRY",
        payment: "PAY_ROUTE_RETRY",
        order: "ORD_ROUTE_RETRY",
      }),
    );
    const failedResponse = await POST(
      new Request("https://briefs.example/webhooks/waffo", {
        method: "POST",
        headers: secondSigned.headers,
        body: secondSigned.body,
      }),
    );
    assert.equal(failedResponse.status, 503);
    triggerDb.exec("DROP TRIGGER fail_route_payment_update");
    triggerDb.close();
    resetDbCache();

    const retriedResponse = await POST(
      new Request("https://briefs.example/webhooks/waffo", {
        method: "POST",
        headers: secondSigned.headers,
        body: secondSigned.body,
      }),
    );
    assert.equal(retriedResponse.status, 200);
    assert.deepEqual(await retriedResponse.json(), { received: true, applied: true });
    const verifyDb = openDatabase(path);
    assert.equal(
      (verifyDb.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
      2,
    );
    verifyDb.close();
  });
});
