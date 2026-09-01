import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase, resetDbCache, type AppDb } from "../src/lib/db";
import { listingFromRow, rankListings } from "../src/lib/rank";
import {
  applyVerifiedPaidEvent,
  CheckoutError,
  FixturePaymentPort,
  WaffoPort,
  handleCheckoutReturn,
  displayToCents,
  type ListingDraft,
  type PaidEvent,
} from "../src/lib/polar";

const WEEK = "2026-W34";
const SUCCESS_URL = "http://127.0.0.1:3000/checkout/complete";

function draft(overrides: Partial<ListingDraft> = {}): ListingDraft {
  return {
    weekId: WEEK,
    brand: "Acme",
    terms: "$800 flat, 1 TikTok",
    briefUrl: "https://example.com/acme",
    bidUsd: 5,
    ...overrides,
  };
}

function fixtureBody(
  checkoutId: string,
  listingDraft: ListingDraft,
  overrides: {
    orderId?: string;
    productId?: string;
    amountCents?: number;
    currency?: string;
    metadata?: Record<string, unknown>;
  } = {},
): string {
  const metadata = {
    brand: listingDraft.brand,
    terms: listingDraft.terms,
    briefUrl: listingDraft.briefUrl,
    bidUsd: String(listingDraft.bidUsd),
    weekId: listingDraft.weekId,
    chargeUsd: String(overrides.amountCents === undefined
      ? listingDraft.bidUsd
      : overrides.amountCents / 100),
    ...overrides.metadata,
  };
  return JSON.stringify({
    type: "order.paid",
    timestamp: new Date().toISOString(),
    data: {
      id: overrides.orderId ?? `ord_${checkoutId}`,
      checkout_id: checkoutId,
      product_id: overrides.productId ?? "fixture",
      currency: overrides.currency ?? "usd",
      total_amount: overrides.amountCents ?? listingDraft.bidUsd * 100,
      status: "paid",
      paid: true,
      metadata,
    },
  });
}

function fixtureHeaders(eventId: string): Record<string, string> {
  return { "webhook-id": eventId };
}

function expectCheckoutError(
  action: () => unknown,
  code: string,
): void {
  assert.throws(action, (error: unknown) => {
    return error instanceof CheckoutError && error.code === code;
  });
}

function close(db: AppDb): void {
  db.close();
}

const WAFFO_IDS = {
  merchant: "MER_2D5F8G3H1K4M6N9P0Q7R8S",
  store: "STO_2aUyqjCzEIiEcYMKj7TZtw",
  product: "PROD_2aUyqjCzEIiEcYMKj7TZtw",
};

const WAFFO_KEYS = (() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
})();

type WaffoEnv = Record<string, string | undefined>;

function waffoEnv(overrides: WaffoEnv = {}): WaffoEnv {
  return {
    WAFFO_MODE: "waffo-test",
    WAFFO_MERCHANT_ID: WAFFO_IDS.merchant,
    WAFFO_PRIVATE_KEY: WAFFO_KEYS.privateKey,
    WAFFO_STORE_ID: WAFFO_IDS.store,
    WAFFO_PRODUCT_ID: WAFFO_IDS.product,
    WAFFO_WEBHOOK_TEST_PUBLIC_KEY: WAFFO_KEYS.publicKey,
    PUBLIC_BASE_URL: "http://127.0.0.1:3000",
    ...overrides,
  };
}

type WaffoRequest = {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
};

let waffoSessionSequence = 0;

function responseForWaffoSession(
  sessionId: string,
  status = 201,
): Response {
  return new Response(
    JSON.stringify({
      data: {
        sessionId,
        checkoutUrl: `https://pancake.waffo.ai/store/test-store/checkout/${sessionId}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function captureWaffoFetch(
  requests: WaffoRequest[],
  behavior: "success" | "timeout" = "success",
): typeof fetch {
  return async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url: String(input), init: init as RequestInit, body });
    if (behavior === "timeout") {
      throw new TypeError("simulated Waffo timeout");
    }
    waffoSessionSequence += 1;
    return responseForWaffoSession(`SES_2aUyqjCzEIiEcYMKj7Tz${String(waffoSessionSequence).padStart(2, "0")}`);
  };
}

function signWaffo(
  event: Record<string, unknown>,
  privateKey = WAFFO_KEYS.privateKey,
  timestamp = String(Date.now()),
): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify(event);
  const signature = createSign("RSA-SHA256")
    .update(`${timestamp}.${body}`)
    .sign(privateKey, "base64");
  return {
    body,
    headers: {
      "x-waffo-signature": `t=${timestamp},v1=${signature}`,
    },
  };
}

function waffoOrder(
  metadata: Record<string, string>,
  overrides: {
    deliveryId?: string;
    eventId?: string;
    orderId?: string;
    paymentId?: string;
    amount?: string;
    subtotal?: string;
    total?: string;
    taxAmount?: string;
    mode?: string;
    storeId?: string;
    timestamp?: string;
    data?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  const amount = overrides.amount ?? "5.00";
  const data: Record<string, unknown> = {
    orderId: overrides.orderId ?? "ORD_2aUyqjCzEIiEcYMKj7Tz01",
    orderStatus: "completed",
    buyerEmail: "buyer@example.com",
    orderMerchantExternalId: metadata.intentId,
    currency: "USD",
    orderMetadata: metadata,
    amount,
    taxAmount: overrides.taxAmount ?? "0.00",
    subtotal: overrides.subtotal ?? amount,
    total: overrides.total ?? amount,
    productName: "Rank",
    productMetadata: { productId: WAFFO_IDS.product },
    paymentId: overrides.paymentId ?? "PAY_2aUyqjCzEIiEcYMKj7Tz01",
    paymentStatus: "succeeded",
    ...overrides.data,
  };
  return {
    id: overrides.deliveryId ?? "DEL_2aUyqjCzEIiEcYMKj7Tz01",
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    eventType: "order.completed",
    eventId: overrides.eventId ?? overrides.paymentId ?? "PAY_2aUyqjCzEIiEcYMKj7Tz01",
    storeId: overrides.storeId ?? WAFFO_IDS.store,
    storeName: "Creator Brief Wall",
    mode: overrides.mode ?? "test",
    data,
  };
}

async function startWaffoCheckout(
  db: AppDb,
  listingDraft: ListingDraft = draft(),
  behavior: "success" | "timeout" = "success",
  envOverrides: WaffoEnv = {},
): Promise<{
  db: AppDb;
  port: WaffoPort;
  requests: WaffoRequest[];
  started?: { checkoutId: string; url: string };
  listingDraft: ListingDraft;
  metadata?: Record<string, string>;
  intentId: string;
}> {
  const requests: WaffoRequest[] = [];
  const env = waffoEnv(envOverrides);
  const port = new WaffoPort({
    env,
    db,
    fetch: captureWaffoFetch(requests, behavior),
  });
  let started: { checkoutId: string; url: string } | undefined;
  try {
    started = await port.createCheckout({
      amountUsd: listingDraft.bidUsd,
      listingDraft,
      successUrl: SUCCESS_URL,
    });
  } catch (error) {
    if (behavior !== "timeout") throw error;
  }
  const intent = db
    .prepare("SELECT intent_id FROM checkout_intents ORDER BY created_at DESC LIMIT 1")
    .get() as { intent_id: string } | undefined;
  assert.ok(intent);
  const metadata = requests[0]?.body.metadata as Record<string, string> | undefined;
  assert.ok(metadata);
  return {
    db,
    port,
    requests,
    started,
    listingDraft,
    metadata,
    intentId: intent.intent_id,
  };
}

async function parseWaffoOrder(
  port: WaffoPort,
  metadata: Record<string, string>,
  overrides: Parameters<typeof waffoOrder>[1] = {},
): Promise<PaidEvent> {
  const signed = signWaffo(waffoOrder(metadata, overrides));
  const parsed = await port.parseWebhook(signed.body, signed.headers);
  assert.ok(!("ignored" in parsed));
  if ("ignored" in parsed) throw new Error("expected order.completed event");
  return parsed;
}

test("fixture paid webhook cannot invent an unknown checkout", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  const listingDraft = draft({ briefUrl: "https://example.com/unknown" });
  const parsed = await waffo.parseWebhook(
    fixtureBody("chk_unknown", listingDraft),
    fixtureHeaders("evt_unknown"),
  );
  assert.ok(!("ignored" in parsed));
  if ("ignored" in parsed) {
    throw new Error("expected a paid event");
  }
  expectCheckoutError(() => applyVerifiedPaidEvent(db, parsed), "unknown_checkout");
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    0,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM payments").get() as { n: number }).n,
    0,
  );
});

test("fixture order.paid reconciles checkout_id, not order data.id", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  const listingDraft = draft({
    brand: "Provider ID Co",
    briefUrl: "https://example.com/provider-id",
  });
  const started = await waffo.createCheckout({
    amountUsd: 5,
    listingDraft,
    successUrl: SUCCESS_URL,
  });
  const parsed = await waffo.parseWebhook(
    fixtureBody(started.checkoutId, listingDraft, { orderId: "ord_not_checkout" }),
    fixtureHeaders("evt_provider_id"),
  );
  assert.ok(!("ignored" in parsed));
  if ("ignored" in parsed) {
    throw new Error("expected a paid event");
  }
  assert.equal(parsed.orderId, "ord_not_checkout");
  assert.equal(parsed.checkoutId, started.checkoutId);
  const result = applyVerifiedPaidEvent(db, parsed);
  assert.equal(result.replayed, false);
  assert.equal(result.listing!.brand, "Provider ID Co");
  const ledger = db
    .prepare("SELECT order_id, checkout_id FROM polar_webhook_events")
    .get() as { order_id: string; checkout_id: string };
  assert.deepEqual(ledger, {
    order_id: "ord_not_checkout",
    checkout_id: started.checkoutId,
  });
});

test("fixture amount, currency, product, and metadata mismatch never rank", async () => {
  const cases = [
    {
      name: "amount",
      event: (id: string, listingDraft: ListingDraft) =>
        fixtureBody(id, listingDraft, { amountCents: 600 }),
      code: "amount_mismatch",
    },
    {
      name: "currency",
      event: (id: string, listingDraft: ListingDraft) =>
        fixtureBody(id, listingDraft, { currency: "eur" }),
      code: "currency_mismatch",
    },
    {
      name: "product",
      event: (id: string, listingDraft: ListingDraft) =>
        fixtureBody(id, listingDraft, { productId: "other-product" }),
      code: "product_mismatch",
    },
    {
      name: "metadata",
      event: (id: string, listingDraft: ListingDraft) =>
        fixtureBody(id, listingDraft, {
          metadata: { brand: "Tampered" },
        }),
      code: "metadata_mismatch",
    },
  ];
  for (const item of cases) {
    const db = openDatabase(":memory:");
    const waffo = new FixturePaymentPort(db);
    const listingDraft = draft({
      brand: `Mismatch ${item.name}`,
      briefUrl: `https://example.com/mismatch-${item.name}`,
    });
    const started = await waffo.createCheckout({
      amountUsd: 5,
      listingDraft,
      successUrl: SUCCESS_URL,
    });
    const parsed = await waffo.parseWebhook(
      item.event(started.checkoutId, listingDraft),
      fixtureHeaders(`evt_mismatch_${item.name}`),
    );
    assert.ok(!("ignored" in parsed));
    if ("ignored" in parsed) {
      throw new Error(`expected ${item.name} paid event`);
    }
    expectCheckoutError(() => applyVerifiedPaidEvent(db, parsed), item.code);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
      0,
    );
  }
});

test("one event settles initial or raise payment once and replays safely", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  const firstDraft = draft({ briefUrl: "https://example.com/replay" });
  const first = await waffo.createCheckout({
    amountUsd: 5,
    listingDraft: firstDraft,
    successUrl: SUCCESS_URL,
  });
  const firstEvent = await waffo.parseWebhook(
    fixtureBody(first.checkoutId, firstDraft, { orderId: "ord_initial" }),
    fixtureHeaders("evt_initial"),
  );
  assert.ok(!("ignored" in firstEvent));
  if ("ignored" in firstEvent) {
    throw new Error("expected initial paid event");
  }
  const initial = applyVerifiedPaidEvent(db, firstEvent);
  const replay = applyVerifiedPaidEvent(db, firstEvent);
  assert.equal(initial.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.listing!.id, initial.listing!.id);

  const raiseDraft = draft({ bidUsd: 7, briefUrl: firstDraft.briefUrl, brand: "Raised" });
  const raiseStart = await waffo.createCheckout({
    amountUsd: 2,
    listingDraft: raiseDraft,
    successUrl: SUCCESS_URL,
  });
  const raiseEvent = await waffo.parseWebhook(
    fixtureBody(raiseStart.checkoutId, raiseDraft, {
      orderId: "ord_raise",
      amountCents: 200,
    }),
    fixtureHeaders("evt_raise"),
  );
  assert.ok(!("ignored" in raiseEvent));
  if ("ignored" in raiseEvent) {
    throw new Error("expected raise paid event");
  }
  const raised = applyVerifiedPaidEvent(db, raiseEvent);
  const raisedReplay = applyVerifiedPaidEvent(db, raiseEvent);
  assert.equal(raised.replayed, false);
  assert.equal(raisedReplay.replayed, true);
  assert.equal(raised.listing!.id, initial.listing!.id);
  assert.equal(raised.listing!.bidUsd, 7);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    1,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM payments WHERE status = 'completed'").get() as { n: number }).n,
    2,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM polar_webhook_events").get() as { n: number }).n,
    2,
  );
});

test("duplicate concurrent delivery and webhook-before-return have one rank write", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  const listingDraft = draft({ briefUrl: "https://example.com/concurrent" });
  const started = await waffo.createCheckout({
    amountUsd: 5,
    listingDraft,
    successUrl: SUCCESS_URL,
  });
  const event = await waffo.parseWebhook(
    fixtureBody(started.checkoutId, listingDraft, { orderId: "ord_concurrent" }),
    fixtureHeaders("evt_concurrent"),
  );
  assert.ok(!("ignored" in event));
  if ("ignored" in event) {
    throw new Error("expected concurrent paid event");
  }
  const results = [
    applyVerifiedPaidEvent(db, event),
    applyVerifiedPaidEvent(db, event),
  ];
  assert.equal(results[0].replayed, false);
  assert.equal(results[1].replayed, true);
  const returned = await waffo.completeCheckout(started.checkoutId);
  assert.equal(returned?.id, results[0].listing!.id);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    1,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM polar_webhook_events").get() as { n: number }).n,
    1,
  );
});

test("listing and ledger roll back together and retry after transient failure", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  const listingDraft = draft({ briefUrl: "https://example.com/rollback" });
  const started = await waffo.createCheckout({
    amountUsd: 5,
    listingDraft,
    successUrl: SUCCESS_URL,
  });
  const event = await waffo.parseWebhook(
    fixtureBody(started.checkoutId, listingDraft, { orderId: "ord_rollback" }),
    fixtureHeaders("evt_rollback"),
  );
  assert.ok(!("ignored" in event));
  if ("ignored" in event) {
    throw new Error("expected rollback paid event");
  }
  db.exec(
    `CREATE TRIGGER fail_payment_completion
     BEFORE UPDATE OF status ON payments
     WHEN NEW.status = 'completed'
     BEGIN SELECT RAISE(ABORT, 'transient payment write failure'); END;`,
  );
  assert.throws(() => applyVerifiedPaidEvent(db, event), /transient payment write failure/);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    0,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM polar_webhook_events").get() as { n: number }).n,
    0,
  );
  db.exec("DROP TRIGGER fail_payment_completion");
  const retry = applyVerifiedPaidEvent(db, event);
  assert.equal(retry.replayed, false);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM polar_webhook_events").get() as { n: number }).n,
    1,
  );
});

test("event ledger survives a database restart and rejects event-ID reuse", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-waffo-ledger-"));
  const path = join(dir, "app.sqlite");
  const firstDb = openDatabase(path);
  const firstWaffo = new FixturePaymentPort(firstDb);
  const listingDraft = draft({ briefUrl: "https://example.com/restart" });
  const started = await firstWaffo.createCheckout({
    amountUsd: 5,
    listingDraft,
    successUrl: SUCCESS_URL,
  });
  const body = fixtureBody(started.checkoutId, listingDraft, { orderId: "ord_restart" });
  const event = await firstWaffo.parseWebhook(body, fixtureHeaders("evt_restart"));
  assert.ok(!("ignored" in event));
  if ("ignored" in event) {
    throw new Error("expected restart event");
  }
  applyVerifiedPaidEvent(firstDb, event);
  close(firstDb);

  const secondDb = openDatabase(path);
  const replay = applyVerifiedPaidEvent(secondDb, event);
  assert.equal(replay.replayed, true);
  assert.equal(
    (secondDb.prepare("SELECT COUNT(*) AS n FROM polar_webhook_events").get() as { n: number }).n,
    1,
  );
  const changed = await new FixturePaymentPort(secondDb).parseWebhook(
    fixtureBody(started.checkoutId, listingDraft, {
      orderId: "ord_different",
      metadata: { terms: "different" },
    }),
    fixtureHeaders("evt_restart"),
  );
  assert.ok(!("ignored" in changed));
  if ("ignored" in changed) {
    throw new Error("expected changed paid event");
  }
  expectCheckoutError(
    () => applyVerifiedPaidEvent(secondDb, changed),
    "webhook_replay_mismatch",
  );
  close(secondDb);
});

test("two database instances share checkout sessions and the applied-event ledger", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-waffo-instances-"));
  const path = join(dir, "app.sqlite");
  const firstDb = openDatabase(path);
  const secondDb = openDatabase(path);
  const firstWaffo = new FixturePaymentPort(firstDb);
  const secondWaffo = new FixturePaymentPort(secondDb);
  const listingDraft = draft({ briefUrl: "https://example.com/instances" });
  const started = await firstWaffo.createCheckout({
    amountUsd: 5,
    listingDraft,
    successUrl: SUCCESS_URL,
  });
  assert.equal(secondWaffo.getCheckout(started.checkoutId)?.status, "open");
  const event = await firstWaffo.parseWebhook(
    fixtureBody(started.checkoutId, listingDraft, { orderId: "ord_instances" }),
    fixtureHeaders("evt_instances"),
  );
  assert.ok(!("ignored" in event));
  if ("ignored" in event) {
    throw new Error("expected two-instance paid event");
  }
  applyVerifiedPaidEvent(firstDb, event);
  const replay = applyVerifiedPaidEvent(secondDb, event);
  assert.equal(replay.replayed, true);
  assert.equal(secondWaffo.getCheckout(started.checkoutId)?.status, "paid");
  close(firstDb);
  close(secondDb);
});

test("fixture return-before-webhook is reconciled without a second rank write", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  const listingDraft = draft({ briefUrl: "https://example.com/return-first" });
  const started = await waffo.createCheckout({
    amountUsd: 5,
    listingDraft,
    successUrl: SUCCESS_URL,
  });
  const returned = await waffo.completeCheckout(started.checkoutId);
  assert.ok(returned);
  const event = await waffo.parseWebhook(
    fixtureBody(started.checkoutId, listingDraft, { orderId: "ord_return_first" }),
    fixtureHeaders("evt_return_first"),
  );
  assert.ok(!("ignored" in event));
  if ("ignored" in event) {
    throw new Error("expected return-first paid event");
  }
  const reconciled = applyVerifiedPaidEvent(db, event);
  assert.equal(reconciled.replayed, true);
  assert.equal(reconciled.listing!.id, returned?.id);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    1,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM polar_webhook_events").get() as { n: number }).n,
    1,
  );
});

test("valid canceled, expired, or failed events never rank", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  for (const status of ["expired", "canceled", "failed"]) {
    const ignored = await waffo.parseWebhook(
      JSON.stringify({
        type: "checkout.updated",
        data: { id: `chk_${status}`, status },
      }),
      {},
    );
    assert.deepEqual(ignored, { ignored: true });
  }
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    0,
  );
});

test("Waffo checkout sends exactly one official product with an exact decimal snapshot", async () => {
  const db = openDatabase(":memory:");
  const listingDraft = draft({
    brand: "Waffo Params",
    terms: "one vertical video",
    briefUrl: "https://example.com/waffo-params",
    bidUsd: 12,
  });
  const started = await startWaffoCheckout(db, listingDraft);
  const body = started.requests[0]?.body;
  assert.ok(body);
  assert.deepEqual(Object.keys(body).sort(), [
    "currency",
    "metadata",
    "orderMerchantExternalId",
    "priceSnapshot",
    "productId",
    "successUrl",
  ]);
  assert.equal(body.productId, WAFFO_IDS.product);
  assert.equal(body.currency, "USD");
  assert.deepEqual(body.priceSnapshot, {
    amount: "12.00",
    taxCategory: "digital_goods",
  });
  assert.equal(body.successUrl?.toString().includes(`intent=${started.intentId}`), true);
  assert.equal(body.orderMerchantExternalId, started.intentId);
  const metadata = body.metadata as Record<string, unknown>;
  assert.equal(Object.values(metadata).every((value) => typeof value === "string"), true);
  assert.equal(metadata.productId, WAFFO_IDS.product);
  assert.equal(metadata.taxCategory, "digital_goods");
  assert.equal(displayToCents("12.00"), 1200);
  assert.equal(displayToCents("12.005"), undefined);
  db.close();
});

test("Waffo persists an intent before network and recovers an ambiguous timeout by signed order", async () => {
  const db = openDatabase(":memory:");
  const listingDraft = draft({
    brand: "Timeout Co",
    briefUrl: "https://example.com/waffo-timeout",
  });
  const started = await startWaffoCheckout(db, listingDraft, "timeout");
  assert.equal(started.requests.length, 1);
  const intentBefore = db
    .prepare("SELECT status, charge_cents, session_id FROM checkout_intents")
    .get() as { status: string; charge_cents: number; session_id: string | null };
  assert.deepEqual(intentBefore, {
    status: "unknown",
    charge_cents: 500,
    session_id: null,
  });
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM checkout_drafts").get() as { n: number }).n,
    0,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM payments").get() as { n: number }).n,
    0,
  );

  const event = await parseWaffoOrder(started.port, started.metadata!, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz02",
    eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz02",
    orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz02",
    paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz02",
  });
  const applied = applyVerifiedPaidEvent(db, event);
  assert.equal(applied.replayed, false);
  assert.equal(applied.listing!.brand, "Timeout Co");
  assert.equal(
    (db.prepare("SELECT status FROM checkout_intents").get() as { status: string }).status,
    "paid",
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM waffo_webhook_events WHERE status = 'applied'").get() as { n: number }).n,
    1,
  );
  db.close();
});

test("Waffo definitive provider rejection leaves a failed durable intent without a payment row", async () => {
  const db = openDatabase(":memory:");
  const requests: WaffoRequest[] = [];
  const env = waffoEnv();
  const port = new WaffoPort({
    env,
    db,
    fetch: async (input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ url: String(input), init: init as RequestInit, body });
      return new Response(
        JSON.stringify({
          data: null,
          errors: [{ message: "product is not available", layer: "checkout" }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    },
  });
  await assert.rejects(
    port.createCheckout({
      amountUsd: 5,
      listingDraft: draft({ briefUrl: "https://example.com/waffo-rejected" }),
      successUrl: SUCCESS_URL,
    }),
    (error: unknown) => error instanceof CheckoutError && error.code === "provider_rejected",
  );
  assert.equal(requests.length, 1);
  assert.equal(
    (db.prepare("SELECT status, failure_code FROM checkout_intents").get() as { status: string; failure_code: string }).status,
    "rejected",
  );
  assert.equal(
    (db.prepare("SELECT status, failure_code FROM checkout_intents").get() as { status: string; failure_code: string }).failure_code,
    "provider_rejected",
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM checkout_drafts").get() as { n: number }).n,
    0,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM payments").get() as { n: number }).n,
    0,
  );
  db.close();
});

test("Waffo malformed provider JSON remains an unknown recoverable intent", async () => {
  const db = openDatabase(":memory:");
  const port = new WaffoPort({
    env: waffoEnv(),
    db,
    fetch: async () => new Response("not-json", { status: 400 }),
  });
  await assert.rejects(
    port.createCheckout({
      amountUsd: 5,
      listingDraft: draft({ briefUrl: "https://example.com/waffo-malformed" }),
      successUrl: SUCCESS_URL,
    }),
    (error: unknown) =>
      error instanceof CheckoutError && error.code === "provider_ambiguous",
  );
  const intent = db
    .prepare("SELECT status, failure_code FROM checkout_intents")
    .get() as { status: string; failure_code: string };
  assert.deepEqual(intent, {
    status: "unknown",
    failure_code: "provider_ambiguous",
  });
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM checkout_drafts").get() as { n: number }).n,
    0,
  );
  db.close();
});

test("Waffo checkout body and transient statuses stay recoverable", async () => {
  const bodyDb = openDatabase(":memory:");
  const body = new Response(JSON.stringify({ data: {} }), { status: 201 });
  Object.defineProperty(body, "json", {
    configurable: true,
    value: () => new Promise<unknown>(() => undefined),
  });
  const bodyPort = new WaffoPort({
    env: waffoEnv({ WAFFO_REQUEST_TIMEOUT_MS: "25" }),
    db: bodyDb,
    fetch: async () => body,
  });
  const startedAt = Date.now();
  await assert.rejects(
    bodyPort.createCheckout({
      amountUsd: 5,
      listingDraft: draft({ briefUrl: "https://example.com/waffo-body-timeout" }),
      successUrl: SUCCESS_URL,
    }),
    (error: unknown) =>
      error instanceof CheckoutError && error.code === "provider_ambiguous",
  );
  assert.ok(Date.now() - startedAt < 1_000, "body parsing must obey the checkout deadline");
  assert.equal(
    (bodyDb.prepare("SELECT status FROM checkout_intents").get() as { status: string }).status,
    "unknown",
  );
  bodyDb.close();

  for (const status of [408, 409, 425, 429, 500]) {
    const db = openDatabase(":memory:");
    const port = new WaffoPort({
      env: waffoEnv(),
      db,
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: null,
            errors: [{ message: `transient ${status}`, layer: "checkout" }],
          }),
          { status, headers: { "content-type": "application/json" } },
        ),
    });
    await assert.rejects(
      port.createCheckout({
        amountUsd: 5,
        listingDraft: draft({ briefUrl: `https://example.com/waffo-status-${status}` }),
        successUrl: SUCCESS_URL,
      }),
      (error: unknown) =>
        error instanceof CheckoutError && error.code === "provider_ambiguous",
      `HTTP ${status} must remain recoverable`,
    );
    assert.equal(
      (db.prepare("SELECT status FROM checkout_intents").get() as { status: string }).status,
      "unknown",
      `HTTP ${status} must leave an unknown intent`,
    );
    db.close();
  }
});

test("Waffo settles a lost-response intent without a provider session after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-waffo-no-session-"));
  const path = join(dir, "app.sqlite");
  const env = waffoEnv({ DATABASE_PATH: path });
  const firstDb = openDatabase(path);
  const timedOut = await startWaffoCheckout(
    firstDb,
    draft({ brand: "Lost Response", briefUrl: "https://example.com/waffo-lost-response" }),
    "timeout",
    { DATABASE_PATH: path },
  );
  assert.equal(timedOut.started, undefined);
  assert.equal(
    (firstDb.prepare("SELECT status, provider_checkout_id, session_id FROM checkout_intents").get() as {
      status: string;
      provider_checkout_id: string | null;
      session_id: string | null;
    }).session_id,
    null,
  );

  // A second connection represents a restarted process. It must use only the
  // signed order's immutable intent correlation and never call the provider.
  const secondDb = openDatabase(path);
  const second = new WaffoPort({
    env,
    db: secondDb,
    fetch: async () => {
      throw new Error("lost-response recovery must not call Waffo");
    },
  });
  const event = await parseWaffoOrder(second, timedOut.metadata!, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz90",
    eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz90",
    orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz90",
    paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz90",
  });
  assert.equal(event.checkoutId, "");
  const applied = applyVerifiedPaidEvent(secondDb, event);
  assert.equal(applied.replayed, false);
  assert.equal(applied.listing!.brand, "Lost Response");
  assert.equal(
    (secondDb.prepare("SELECT provider_checkout_id, session_id, status FROM checkout_intents").get() as {
      provider_checkout_id: string | null;
      session_id: string | null;
      status: string;
    }).status,
    "paid",
  );
  assert.equal(
    (secondDb.prepare("SELECT provider_checkout_id, session_id FROM checkout_intents").get() as {
      provider_checkout_id: string;
      session_id: string;
    }).provider_checkout_id,
    `waffo_${timedOut.intentId}`,
  );

  firstDb.close();
  secondDb.close();
  const restarted = openDatabase(path);
  const replay = applyVerifiedPaidEvent(restarted, event);
  assert.equal(replay.replayed, true);
  assert.equal(
    (restarted.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    1,
  );
  restarted.close();
});

test("Waffo intent return is read-only pending before webhook and paid after settlement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-waffo-return-intent-"));
  const path = join(dir, "app.sqlite");
  const firstDb = openDatabase(path);
  const started = await startWaffoCheckout(
    firstDb,
    draft({ brand: "Intent Return", briefUrl: "https://example.com/waffo-intent-return" }),
    "success",
    { DATABASE_PATH: path },
  );
  const event = await parseWaffoOrder(started.port, started.metadata!, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz92",
    eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz92",
    orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz92",
    paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz92",
  });
  firstDb.close();

  const previousPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path;
  resetDbCache();
  try {
    const pending = await handleCheckoutReturn({ intent: started.intentId });
    assert.equal(pending.status, "pending");
    assert.equal(pending.listing, null);
    const pendingDb = openDatabase(path);
    assert.equal(
      (pendingDb.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
      0,
    );
    pendingDb.close();

    const secondDb = openDatabase(path);
    const applied = applyVerifiedPaidEvent(secondDb, event);
    assert.equal(applied.replayed, false);
    secondDb.close();
    resetDbCache();

    const paid = await handleCheckoutReturn({ intent: started.intentId });
    assert.equal(paid.status, "success");
    assert.equal(paid.listing?.brand, "Intent Return");
  } finally {
    resetDbCache();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
  }
});

test("Waffo signed settlement requires exact mode/store/status/USD/amount/metadata facts", async () => {
  const cases: Array<{
    name: string;
    order: (metadata: Record<string, string>) => Record<string, unknown>;
    code: string;
    ledgerStatus?: string;
    intentStatus?: string;
  }> = [
    {
      name: "mode",
      order: (metadata) => waffoOrder(metadata, { mode: "prod" }),
      code: "mode_mismatch",
    },
    {
      name: "store",
      order: (metadata) => waffoOrder(metadata, { storeId: "STO_2aUyqjCzEIiEcYMKj7Tz99" }),
      code: "provider_scope_mismatch",
    },
    {
      name: "status",
      order: (metadata) => waffoOrder(metadata, { data: { orderStatus: "pending" } }),
      code: "event_status_mismatch",
    },
    {
      name: "currency",
      order: (metadata) => waffoOrder(metadata, { data: { currency: "EUR" } }),
      code: "currency_mismatch",
    },
    {
      name: "decimal",
      order: (metadata) => waffoOrder(metadata, { amount: "5.005", subtotal: "5.005" }),
      code: "amount_mismatch",
    },
    {
      name: "nonzero-tax",
      order: (metadata) =>
        waffoOrder(metadata, {
          amount: "7.00",
          subtotal: "5.00",
          taxAmount: "1.00",
          total: "6.00",
        }),
      code: "amount_mismatch",
    },
    {
      name: "nonzero-tax-without-total",
      order: (metadata) => {
        const order = waffoOrder(metadata, {
          amount: "7.00",
          subtotal: "5.00",
          taxAmount: "1.00",
        });
        const data = order.data as Record<string, unknown>;
        delete data.total;
        return order;
      },
      code: "amount_mismatch",
    },
    {
      name: "metadata",
      order: (metadata) => waffoOrder(metadata, { data: { orderMetadata: { ...metadata, terms: "tampered" } } }),
      code: "metadata_mismatch",
    },
    {
      name: "missing-product-metadata",
      order: (metadata) => waffoOrder(metadata, { data: { productMetadata: undefined } }),
      code: "product_mismatch",
    },
    {
      name: "wrong-product-metadata",
      order: (metadata) =>
        waffoOrder(metadata, {
          data: { productMetadata: { productId: "PROD_2aUyqjCzEIiEcYMKj7TZ99" } },
        }),
      code: "product_mismatch",
    },
    {
      name: "stale-event-time",
      order: (metadata) =>
        waffoOrder(metadata, { timestamp: "1970-01-01T00:00:00.000Z" }),
      code: "event_time_out_of_bounds",
      ledgerStatus: "reconciliation_required",
      intentStatus: "needs_reconciliation",
    },
    {
      name: "future-event-time",
      order: (metadata) =>
        waffoOrder(metadata, { timestamp: "2099-01-01T00:00:00.000Z" }),
      code: "event_time_out_of_bounds",
      ledgerStatus: "reconciliation_required",
      intentStatus: "needs_reconciliation",
    },
  ];
  for (const item of cases) {
    const db = openDatabase(":memory:");
    const started = await startWaffoCheckout(
      db,
      draft({
        brand: `Waffo ${item.name}`,
        briefUrl: `https://example.com/waffo-mismatch-${item.name}`,
      }),
    );
    const signed = signWaffo(item.order(started.metadata!));
    const parsed = await started.port.parseWebhook(signed.body, signed.headers);
    assert.ok(!("ignored" in parsed));
    if ("ignored" in parsed) throw new Error(`expected ${item.name} event`);
    expectCheckoutError(() => applyVerifiedPaidEvent(db, parsed), item.code);
    const outcome = db
      .prepare("SELECT status, outcome_code FROM waffo_webhook_events")
      .get() as { status: string; outcome_code: string };
    assert.equal(
      outcome.status,
      item.ledgerStatus ?? "reconciliation_required",
      item.name,
    );
    assert.equal(outcome.outcome_code, item.code, item.name);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
      0,
      item.name,
    );
    assert.equal(
      (db.prepare("SELECT status FROM checkout_intents").get() as { status: string }).status,
      item.intentStatus ?? "needs_reconciliation",
      item.name,
    );
    db.close();
  }
});

test("Waffo signed canonical aliases reject malformed values and reconcile a known capture", async () => {
  assert.equal(displayToCents("5.00"), 500);
  assert.equal(displayToCents(" 5.00 "), undefined);
  assert.equal(displayToCents("5.005"), undefined);

  const db = openDatabase(":memory:");
  const started = await startWaffoCheckout(
    db,
    draft({ brand: "Canonical Waffo", briefUrl: "https://example.com/waffo-canonical" }),
  );
  const malformedProduct = await parseWaffoOrder(started.port, started.metadata!, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz98",
    eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz98",
    orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz98",
    paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz98",
    data: { productId: " " },
  });
  assert.equal(malformedProduct.validationError?.code, "product_mismatch");
  expectCheckoutError(
    () => applyVerifiedPaidEvent(db, malformedProduct),
    "product_mismatch",
  );
  assert.deepEqual(
    db.prepare("SELECT status, outcome_code FROM waffo_webhook_events").get(),
    { status: "reconciliation_required", outcome_code: "product_mismatch" },
  );
  assert.equal(
    (db.prepare("SELECT status FROM checkout_intents").get() as { status: string }).status,
    "needs_reconciliation",
  );
  assert.deepEqual(applyVerifiedPaidEvent(db, malformedProduct), {
    listing: null,
    replayed: true,
    applied: false,
  });

  const nonCanonicalTimestamp = await parseWaffoOrder(
    started.port,
    started.metadata!,
    {
      deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz99",
      eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz99",
      orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz99",
      paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz99",
      timestamp: "2026-08-28T00:00:00Z",
    },
  );
  assert.equal(nonCanonicalTimestamp.validationError?.code, "invalid_webhook");
  db.close();
});

test("Waffo rejected and reconciliation outcomes acknowledge exact retries without rank", async () => {
  const rejectedDb = openDatabase(":memory:");
  const rejected = await startWaffoCheckout(
    rejectedDb,
    draft({ brand: "Rejected Retry", briefUrl: "https://example.com/waffo-rejected-retry" }),
  );
  const rejectedEvent = await parseWaffoOrder(rejected.port, rejected.metadata!, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz96",
    eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz96",
    orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz96",
    paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz96",
    data: { currency: "EUR" },
  });
  expectCheckoutError(
    () => applyVerifiedPaidEvent(rejectedDb, rejectedEvent),
    "currency_mismatch",
  );
  const rejectedRetry = applyVerifiedPaidEvent(rejectedDb, rejectedEvent);
  assert.deepEqual(rejectedRetry, { listing: null, replayed: true, applied: false });
  assert.equal(
    (rejectedDb.prepare("SELECT COUNT(*) AS n FROM waffo_webhook_events").get() as { n: number }).n,
    1,
  );
  assert.equal(
    (rejectedDb.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    0,
  );
  rejectedDb.close();

  const reconciliationDb = openDatabase(":memory:");
  const reconciliation = await startWaffoCheckout(
    reconciliationDb,
    draft({ brand: "Reconciliation Retry", briefUrl: "https://example.com/waffo-reconciliation-retry" }),
  );
  const reconciliationEvent = await parseWaffoOrder(
    reconciliation.port,
    reconciliation.metadata!,
    {
      deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz97",
      eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz97",
      orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz97",
      paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz97",
      timestamp: "1970-01-01T00:00:00.000Z",
    },
  );
  expectCheckoutError(
    () => applyVerifiedPaidEvent(reconciliationDb, reconciliationEvent),
    "event_time_out_of_bounds",
  );
  const reconciliationRetry = applyVerifiedPaidEvent(reconciliationDb, reconciliationEvent);
  assert.deepEqual(reconciliationRetry, { listing: null, replayed: true, applied: false });
  assert.equal(
    (reconciliationDb.prepare("SELECT status FROM waffo_webhook_events").get() as { status: string }).status,
    "reconciliation_required",
  );
  assert.equal(
    (reconciliationDb.prepare("SELECT status FROM checkout_intents").get() as { status: string }).status,
    "needs_reconciliation",
  );
  assert.equal(
    (reconciliationDb.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    0,
  );
  reconciliationDb.close();
});

test("Waffo accepts an exact tax-exclusive subtotal and preserves provider event time", async () => {
  const db = openDatabase(":memory:");
  const started = await startWaffoCheckout(
    db,
    draft({ brand: "Taxed Waffo", briefUrl: "https://example.com/waffo-tax" }),
  );
  const providerTime = "2026-08-20T03:04:05.000Z";
  const event = await parseWaffoOrder(started.port, started.metadata!, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz91",
    eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz91",
    orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz91",
    paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz91",
    timestamp: providerTime,
    amount: "6.00",
    subtotal: "5.00",
    taxAmount: "1.00",
    total: "6.00",
  });
  const applied = applyVerifiedPaidEvent(db, event);
  assert.equal(applied.listing!.bidUsd, 5);
  assert.equal(applied.listing!.createdAt, providerTime);
  assert.equal(
    (db.prepare("SELECT amount_usd FROM payments WHERE status = 'completed'").get() as { amount_usd: number }).amount_usd,
    5,
  );
  db.close();
});

test("Waffo accepts a tax-inclusive amount when the immutable subtotal is exact", async () => {
  const db = openDatabase(":memory:");
  const started = await startWaffoCheckout(
    db,
    draft({ brand: "Tax Inclusive Waffo", briefUrl: "https://example.com/waffo-tax-inclusive" }),
  );
  const event = await parseWaffoOrder(started.port, started.metadata!, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz95",
    eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz95",
    orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz95",
    paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz95",
    amount: "6.00",
    subtotal: "5.00",
    taxAmount: "1.00",
  });
  const applied = applyVerifiedPaidEvent(db, event);
  assert.equal(applied.listing!.bidUsd, 5);
  assert.equal(
    (db.prepare("SELECT amount_usd FROM payments WHERE status = 'completed'").get() as { amount_usd: number }).amount_usd,
    5,
  );
  db.close();
});

test("Waffo provider-time offset beats webhook arrival order for equal bids", async () => {
  const db = openDatabase(":memory:");
  const requests: WaffoRequest[] = [];
  const port = new WaffoPort({
    env: waffoEnv(),
    db,
    fetch: captureWaffoFetch(requests),
  });
  const old = await port.createCheckout({
    amountUsd: 5,
    listingDraft: draft({ brand: "Provider Old", briefUrl: "https://example.com/provider-old" }),
    successUrl: SUCCESS_URL,
  });
  const oldMetadata = requests[0]?.body.metadata as Record<string, string>;
  const recent = await port.createCheckout({
    amountUsd: 5,
    listingDraft: draft({ brand: "Provider Recent", briefUrl: "https://example.com/provider-recent" }),
    successUrl: SUCCESS_URL,
  });
  const recentMetadata = requests[1]?.body.metadata as Record<string, string>;
  const oldEvent = await parseWaffoOrder(port, oldMetadata, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz93",
    eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz93",
    orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz93",
    paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz93",
    timestamp: "2026-08-20T03:04:05.000Z",
  });
  const recentEvent = await parseWaffoOrder(port, recentMetadata, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz94",
    eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz94",
    orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz94",
    paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz94",
    timestamp: "2026-08-21T03:04:05.000Z",
  });

  // Deliver the newer payment first. The older provider timestamp must still
  // win an equal-bid tie when the board ranks the two completed payments.
  applyVerifiedPaidEvent(db, recentEvent);
  applyVerifiedPaidEvent(db, oldEvent);
  const rows = db
    .prepare(
      `SELECT id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks,
              created_at, updated_at
       FROM listings`,
    )
    .all() as Array<{
    id: string;
    week_id: string;
    brand: string;
    terms: string;
    brief_url: string;
    platforms: string | null;
    bid_usd: number;
    clicks: number;
    created_at: string;
    updated_at: string;
  }>;
  const ranked = rankListings(rows.map((row) => listingFromRow(row)));
  assert.deepEqual(ranked.map((listing) => listing.brand), ["Provider Old", "Provider Recent"]);
  assert.equal(old.checkoutId.length > 0, true);
  assert.equal(recent.checkoutId.length > 0, true);
  db.close();
});

test("Waffo order.completed requires a distinct payment ID matching eventId", async () => {
  const db = openDatabase(":memory:");
  const started = await startWaffoCheckout(
    db,
    draft({ briefUrl: "https://example.com/waffo-payment-id" }),
  );
  const missingPayment = signWaffo(
    waffoOrder(started.metadata!, {
      deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz06",
      eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz06",
      data: { paymentId: undefined },
    }),
  );
  const missing = await started.port.parseWebhook(
    missingPayment.body,
    missingPayment.headers,
  );
  assert.ok(!("ignored" in missing));
  if ("ignored" in missing) throw new Error("expected missing-payment event");
  expectCheckoutError(
    () => applyVerifiedPaidEvent(db, missing),
    "invalid_webhook",
  );

  const second = await startWaffoCheckout(
    db,
    draft({ briefUrl: "https://example.com/waffo-payment-id-mismatch" }),
  );
  const mismatched = signWaffo(
    waffoOrder(second.metadata!, {
      deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz07",
      eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz07",
      orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz07",
      paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz08",
    }),
  );
  const mismatch = await started.port.parseWebhook(
    mismatched.body,
    mismatched.headers,
  );
  assert.ok(!("ignored" in mismatch));
  if ("ignored" in mismatch) throw new Error("expected mismatched-payment event");
  expectCheckoutError(
    () => applyVerifiedPaidEvent(db, mismatch),
    "identity_mismatch",
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    0,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM waffo_webhook_events WHERE status = 'rejected'").get() as { n: number }).n,
    2,
  );
  db.close();
});

test("Waffo exact delivery retry and same business event on another delivery are no-ops; changed reuse is rejected durably", async () => {
  const db = openDatabase(":memory:");
  const listingDraft = draft({
    brand: "Replay Co",
    briefUrl: "https://example.com/waffo-replay",
  });
  const started = await startWaffoCheckout(db, listingDraft);
  const first = await parseWaffoOrder(started.port, started.metadata!);
  const applied = applyVerifiedPaidEvent(db, first);
  assert.equal(applied.replayed, false);
  const exactRetry = applyVerifiedPaidEvent(db, first);
  assert.equal(exactRetry.replayed, true);

  const secondDelivery = await parseWaffoOrder(started.port, started.metadata!, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz02",
    timestamp: first.paidAt,
  });
  const duplicate = applyVerifiedPaidEvent(db, secondDelivery);
  assert.equal(duplicate.replayed, true);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    1,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM waffo_webhook_deliveries").get() as { n: number }).n,
    2,
  );

  const changedAmountOnly = await parseWaffoOrder(started.port, started.metadata!, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz09",
    timestamp: first.paidAt,
    data: { amount: "6.00", subtotal: "5.00", total: "5.00" },
  });
  expectCheckoutError(
    () => applyVerifiedPaidEvent(db, changedAmountOnly),
    "webhook_replay_mismatch",
  );

  const changed = await parseWaffoOrder(started.port, started.metadata!, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz01",
    timestamp: first.paidAt,
    data: { amount: "6.00", subtotal: "6.00", total: "6.00" },
  });
  expectCheckoutError(
    () => applyVerifiedPaidEvent(db, changed),
    "webhook_replay_mismatch",
  );
  const attempt = db
    .prepare("SELECT status, outcome_code FROM waffo_webhook_attempts WHERE delivery_id = ?")
    .get("DEL_2aUyqjCzEIiEcYMKj7Tz01") as { status: string; outcome_code: string };
  assert.deepEqual(attempt, { status: "rejected", outcome_code: "webhook_replay_mismatch" });
  assert.equal(
    (db.prepare("SELECT bid_usd FROM listings").get() as { bid_usd: number }).bid_usd,
    5,
  );
  db.close();
});

test("Waffo settlement rolls back listing, payment, intent, and ledgers together", async () => {
  const db = openDatabase(":memory:");
  const started = await startWaffoCheckout(
    db,
    draft({ briefUrl: "https://example.com/waffo-rollback" }),
  );
  const event = await parseWaffoOrder(started.port, started.metadata!);
  db.exec(
    `CREATE TRIGGER fail_waffo_payment_completion
     BEFORE UPDATE OF status ON payments
     WHEN NEW.status = 'completed'
     BEGIN SELECT RAISE(ABORT, 'Waffo payment write failure'); END;`,
  );
  assert.throws(() => applyVerifiedPaidEvent(db, event), /Waffo payment write failure/);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    0,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM waffo_webhook_events").get() as { n: number }).n,
    0,
  );
  assert.equal(
    (db.prepare("SELECT status FROM checkout_intents").get() as { status: string }).status,
    "attached",
  );
  db.exec("DROP TRIGGER fail_waffo_payment_completion");
  const retry = applyVerifiedPaidEvent(db, event);
  assert.equal(retry.replayed, false);
  db.close();
});

test("Waffo event and intent survive restart/two instances, while live return never settles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-waffo-restart-"));
  const path = join(dir, "app.sqlite");
  const env = waffoEnv({ DATABASE_PATH: path });
  const firstDb = openDatabase(path);
  const requests: WaffoRequest[] = [];
  const first = new WaffoPort({
    env,
    db: firstDb,
    fetch: captureWaffoFetch(requests),
  });
  const listingDraft = draft({
    brand: "Restart Co",
    briefUrl: "https://example.com/waffo-restart",
  });
  const started = await first.createCheckout({
    amountUsd: 5,
    listingDraft,
    successUrl: SUCCESS_URL,
  });
  const metadata = requests[0]?.body.metadata as Record<string, string>;
  const event = await parseWaffoOrder(first, metadata);
  const secondDb = openDatabase(path);
  const second = new WaffoPort({
    env,
    db: secondDb,
    fetch: async () => {
      throw new Error("restart test must not call provider");
    },
  });
  const returned = await handleCheckoutReturn({ checkoutId: started.checkoutId }, second);
  assert.equal(returned.listing, null);
  assert.equal(
    (secondDb.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    0,
  );
  const applied = applyVerifiedPaidEvent(firstDb, event);
  assert.equal(applied.replayed, false);
  close(firstDb);
  const replay = applyVerifiedPaidEvent(secondDb, event);
  assert.equal(replay.replayed, true);
  assert.equal(second.getCheckout(started.checkoutId)?.status, "paid");
  assert.equal(
    (secondDb.prepare("SELECT COUNT(*) AS n FROM waffo_webhook_events").get() as { n: number }).n,
    1,
  );
  close(secondDb);
});

test("two Waffo raises quoted from the same old bid never turn a stale capture into $19", async () => {
  const db = openDatabase(":memory:");
  const requests: WaffoRequest[] = [];
  const env = waffoEnv();
  const port = new WaffoPort({
    env,
    db,
    fetch: captureWaffoFetch(requests),
  });
  const initialDraft = draft({
    brand: "Initial Co",
    briefUrl: "https://example.com/waffo-stale-raise",
  });
  const initial = await port.createCheckout({
    amountUsd: 5,
    listingDraft: initialDraft,
    successUrl: SUCCESS_URL,
  });
  const initialMetadata = requests[0]?.body.metadata as Record<string, string>;
  applyVerifiedPaidEvent(db, await parseWaffoOrder(port, initialMetadata, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz03",
    eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz03",
    orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz03",
    paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz03",
  }));
  assert.equal(initial.checkoutId.length > 0, true);

  const raiseDraft: ListingDraft = {
    ...initialDraft,
    brand: "Raise Co",
    bidUsd: 12,
  };
  const raiseOne = await port.createCheckout({
    amountUsd: 7,
    listingDraft: raiseDraft,
    successUrl: SUCCESS_URL,
  });
  const raiseOneMetadata = requests[1]?.body.metadata as Record<string, string>;
  const raiseTwo = await port.createCheckout({
    amountUsd: 7,
    listingDraft: raiseDraft,
    successUrl: SUCCESS_URL,
  });
  const raiseTwoMetadata = requests[2]?.body.metadata as Record<string, string>;
  const firstRaiseEvent = await parseWaffoOrder(port, raiseOneMetadata, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz04",
    eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz04",
    orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz04",
    paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz04",
    amount: "7.00",
    subtotal: "7.00",
    total: "7.00",
  });
  const secondRaiseEvent = await parseWaffoOrder(port, raiseTwoMetadata, {
    deliveryId: "DEL_2aUyqjCzEIiEcYMKj7Tz05",
    eventId: "PAY_2aUyqjCzEIiEcYMKj7Tz05",
    orderId: "ORD_2aUyqjCzEIiEcYMKj7Tz05",
    paymentId: "PAY_2aUyqjCzEIiEcYMKj7Tz05",
    amount: "7.00",
    subtotal: "7.00",
    total: "7.00",
  });
  const raised = applyVerifiedPaidEvent(db, firstRaiseEvent);
  assert.equal(raised.listing!.bidUsd, 12);
  expectCheckoutError(
    () => applyVerifiedPaidEvent(db, secondRaiseEvent),
    "raise_too_small",
  );
  const listing = db.prepare("SELECT bid_usd FROM listings").get() as { bid_usd: number };
  assert.equal(listing.bid_usd, 12);
  const stale = db
    .prepare("SELECT status, outcome_code FROM waffo_webhook_events WHERE event_id = ?")
    .get("PAY_2aUyqjCzEIiEcYMKj7Tz05") as { status: string; outcome_code: string };
  assert.deepEqual(stale, { status: "reconciliation_required", outcome_code: "raise_too_small" });
  const staleIntent = db
    .prepare("SELECT status FROM checkout_intents WHERE intent_id = ?")
    .get(raiseTwoMetadata.intentId) as { status: string };
  assert.equal(staleIntent.status, "needs_reconciliation");
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM payments WHERE status = 'completed'").get() as { n: number }).n,
    2,
  );
  assert.equal(raiseTwo.checkoutId !== raiseOne.checkoutId, true);
  db.close();
});
