import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { openDatabase, resetDbCache, type ListingRow } from "../src/lib/db";
import {
  CheckoutError,
  FakePolarPort,
  LivePolarPort,
  applyPaidListing,
  getPolarPort,
  handleCheckoutReturn,
  isPolarLive,
  parseBidUsd,
} from "../src/lib/polar";
import { listingFromRow, rankListings } from "../src/lib/rank";

const WEEK = "2026-W34";
const SUCCESS_URL = "http://127.0.0.1:3000/checkout/return";

function draft(overrides: Partial<{
  weekId: string;
  brand: string;
  terms: string;
  briefUrl: string;
  bidUsd: number;
}> = {}) {
  return {
    weekId: WEEK,
    brand: "Acme",
    terms: "$800 flat, 1 TikTok",
    briefUrl: "https://example.com/acme",
    bidUsd: 5,
    ...overrides,
  };
}

function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => void,
): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    const value = patch[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withDatabasePath(
  path: string,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path;
  resetDbCache();
  try {
    await fn();
  } finally {
    resetDbCache();
    if (previous === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previous;
    }
  }
}

test("FakePolarPort $5 appears on the board after completion", async () => {
  const db = openDatabase(":memory:");
  const polar = new FakePolarPort(db);
  const started = await polar.createCheckout({
    amountUsd: 5,
    listingDraft: draft(),
    successUrl: SUCCESS_URL,
  });

  const unpaid = db.prepare("SELECT COUNT(*) AS n FROM listings").get() as {
    n: number;
  };
  assert.equal(unpaid.n, 0);

  const listing = await polar.completeCheckout(started.checkoutId);
  assert.ok(listing);
  assert.equal(listing.brand, "Acme");
  assert.equal(listing.bidUsd, 5);
  assert.equal(listing.clicks, 0);

  const rows = db
    .prepare(
      `SELECT id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
       FROM listings`,
    )
    .all() as ListingRow[];
  const ranked = rankListings(rows.map(listingFromRow));
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 5);
  assert.equal(ranked[0]?.brand, "Acme");
});

test("unpaid session does not list", async () => {
  const db = openDatabase(":memory:");
  const polar = new FakePolarPort(db);
  const started = await polar.createCheckout({
    amountUsd: 5,
    listingDraft: draft({ brand: "Ghost", briefUrl: "https://example.com/ghost" }),
    successUrl: SUCCESS_URL,
  });
  await polar.abandonCheckout(started.checkoutId);
  assert.equal(await polar.completeCheckout(started.checkoutId), null);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    0,
  );
  assert.equal(polar.getCheckout(started.checkoutId)?.status, "canceled");
});

test("webhook / fixture completion lists; abandoned webhook does not", async () => {
  const db = openDatabase(":memory:");
  const polar = new FakePolarPort(db);
  const paidBody = JSON.stringify({
    type: "checkout.updated",
    data: {
      id: "chk_webhook_paid",
      status: "succeeded",
      metadata: {
        brand: "Webhook Co",
        terms: "$500, 1 YouTube",
        briefUrl: "https://example.com/webhook",
        bidUsd: "5",
        weekId: WEEK,
      },
    },
  });
  const paid = await polar.parseWebhook(paidBody, {});
  assert.ok(!("ignored" in paid));
  if ("ignored" in paid) {
    throw new Error("expected paid webhook");
  }
  applyPaidListing(db, paid.draft, paid.checkoutId, paid.paidAt);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    1,
  );

  const abandoned = await polar.parseWebhook(
    JSON.stringify({
      type: "checkout.updated",
      data: { id: "chk_abandoned", status: "canceled" },
    }),
    {},
  );
  assert.deepEqual(abandoned, { ignored: true });
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    1,
  );
});

test("handleCheckoutReturn pays on success and not on cancel", async () => {
  const db = openDatabase(":memory:");
  const polar = new FakePolarPort(db);
  const paid = await polar.createCheckout({
    amountUsd: 5,
    listingDraft: draft(),
    successUrl: SUCCESS_URL,
  });
  const canceled = await polar.createCheckout({
    amountUsd: 12,
    listingDraft: draft({
      brand: "Beta",
      briefUrl: "https://example.com/beta",
      bidUsd: 12,
    }),
    successUrl: SUCCESS_URL,
  });

  const success = await handleCheckoutReturn(
    { checkoutId: paid.checkoutId },
    polar,
  );
  assert.equal(success.status, "success");
  assert.equal(success.listing?.bidUsd, 5);

  const cancel = await handleCheckoutReturn(
    { checkoutId: canceled.checkoutId, status: "cancel" },
    polar,
  );
  assert.equal(cancel.status, "cancel");
  assert.equal(cancel.listing, null);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    1,
  );
});

test("POST /checkout starts fixture session; unpaid does not list", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-checkout-"));
  const dbPath = join(dir, "app.sqlite");
  await withDatabasePath(dbPath, async () => {
    const { POST } = await import("../src/app/api/checkout/route");
    const body = new URLSearchParams({
      brand: "Route Co",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://example.com/route",
      bidUsd: "5",
    });
    const response = await POST(
      new Request("http://127.0.0.1/checkout", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
    );
    assert.equal(response.status, 303);
    const location = response.headers.get("location");
    assert.ok(location);
    assert.match(location, /\/checkout\/return\?checkoutId=/);
    const db = openDatabase(dbPath);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
      0,
    );
  });
});

test("webhook route fixture completion writes the listing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-webhook-"));
  const dbPath = join(dir, "app.sqlite");
  await withDatabasePath(dbPath, async () => {
    const { POST } = await import("../src/app/api/webhooks/polar/route");
    const response = await POST(
      new Request("http://127.0.0.1/webhooks/polar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "order.paid",
          data: {
            id: "chk_route_paid",
            status: "paid",
            metadata: {
              brand: "Hook Brand",
              terms: "1 Instagram Reel",
              briefUrl: "https://example.com/hook",
              bidUsd: "5",
              weekId: WEEK,
            },
          },
        }),
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true, applied: true });
    const db = openDatabase(dbPath);
    const row = db
      .prepare("SELECT brand, bid_usd FROM listings")
      .get() as { brand: string; bid_usd: number };
    assert.deepEqual(row, { brand: "Hook Brand", bid_usd: 5 });
  });
});

test("POLAR_FIXTURE_ONLY=1 wins over POLAR_LIVE=1", () => {
  assert.equal(
    isPolarLive({ POLAR_LIVE: "1", POLAR_FIXTURE_ONLY: "1" }),
    false,
  );
  assert.equal(isPolarLive({ POLAR_LIVE: "1" }), true);
  assert.equal(isPolarLive({}), false);

  withEnv({ POLAR_LIVE: "1", POLAR_FIXTURE_ONLY: "1" }, () => {
    const db = openDatabase(":memory:");
    assert.equal(getPolarPort(db) instanceof FakePolarPort, true);
    assert.throws(() => new LivePolarPort(), /env-gated|BLOCKED-SECRET/);
  });
});

test("live Polar is unused unless POLAR_LIVE=1", () => {
  withEnv({ POLAR_LIVE: undefined, POLAR_FIXTURE_ONLY: "1" }, () => {
    assert.equal(isPolarLive(), false);
    assert.throws(() => new LivePolarPort(), /env-gated/);
    const source = readFileSync(
      join(process.cwd(), "src", "lib", "polar.ts"),
      "utf8",
    );
    assert.match(source, /unused unless POLAR_LIVE=1|env-gated/);
    assert.match(source, /class FakePolarPort/);
  });
});

test("live Polar constructor is secret-gated", () => {
  withEnv(
    {
      POLAR_LIVE: "1",
      POLAR_FIXTURE_ONLY: undefined,
      POLAR_ACCESS_TOKEN: undefined,
      POLAR_PRODUCT_ID: undefined,
    },
    () => {
      assert.throws(() => new LivePolarPort(), /BLOCKED-SECRET: POLAR_ACCESS_TOKEN/);
    },
  );
});

test("live Polar webhook verifies the signature", async () => {
  const secret = "whsec_test";
  const rawBody = JSON.stringify({
    type: "order.paid",
    data: {
      id: "chk_signed",
      status: "paid",
      metadata: {
        brand: "Signed",
        terms: "signed terms",
        briefUrl: "https://example.com/signed",
        bidUsd: "5",
        weekId: WEEK,
      },
    },
  });
  const webhookId = "msg_1";
  const timestamp = "1710000000";
  const signature = `v1,${createHmac("sha256", secret)
    .update(`${webhookId}.${timestamp}.${rawBody}`)
    .digest("base64")}`;
  const polar = new LivePolarPort({
    env: {
      POLAR_LIVE: "1",
      POLAR_ACCESS_TOKEN: "test-token",
      POLAR_PRODUCT_ID: "prod_test",
      POLAR_WEBHOOK_SECRET: secret,
    },
    fetch: async () => new Response("unused"),
  });
  const paid = await polar.parseWebhook(rawBody, {
    "webhook-id": webhookId,
    "webhook-timestamp": timestamp,
    "webhook-signature": signature,
  });
  assert.ok(!("ignored" in paid));
  await assert.rejects(
    polar.parseWebhook(rawBody, {
      "webhook-id": webhookId,
      "webhook-timestamp": timestamp,
      "webhook-signature": "v1,not-the-signature",
    }),
    /invalid Polar webhook signature/,
  );
});

test("/checkout/return markup shows success or cancel", async () => {
  const { default: ReturnPage } = await import(
    "../src/app/checkout/return/page"
  );
  const successHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ checkoutId: "missing" }),
    }),
  );
  assert.match(successHtml, /data-return="success"/);
  assert.match(successHtml, /on the board/i);
  assert.match(successHtml, /Back to the board/);

  const cancelHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({
        checkoutId: "missing",
        status: "cancel",
      }),
    }),
  );
  assert.match(cancelHtml, /data-return="cancel"/);
  assert.match(cancelHtml, /No rank change/);
  assert.match(cancelHtml, /does not list/);
});

test("parseBidUsd enforces whole dollars and SPEC min/max", () => {
  assert.equal(parseBidUsd("5"), 5);
  assert.throws(() => parseBidUsd("4.5"), (err: unknown) => {
    assert.ok(err instanceof CheckoutError);
    assert.equal(err.code, "invalid_bid");
    return true;
  });
  assert.throws(() => parseBidUsd("4"), (err: unknown) => {
    assert.ok(err instanceof CheckoutError);
    assert.equal(err.code, "bid_below_min");
    return true;
  });
  assert.throws(() => parseBidUsd("50001"), (err: unknown) => {
    assert.ok(err instanceof CheckoutError);
    assert.equal(err.code, "bid_above_max");
    return true;
  });
});
