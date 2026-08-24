import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { openDatabase, resetDbCache, type ListingRow } from "../src/lib/db";
import {
  CheckoutError,
  FakePolarPort,
  LivePolarPort,
  POLAR_API_BASE,
  applyPaidListing,
  getPolarPort,
  handleCheckoutReturn,
  isPolarLive,
  parseBidUsd,
  planCheckout,
  polarApiBase,
} from "../src/lib/polar";
import { Board } from "../src/app/board";
import { listingFromRow, rankListings } from "../src/lib/rank";
import { listLiveBoard } from "../src/lib/week";

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

test("unpaid Polar checkout stays off the plaster until Polar reports paid", async () => {
  const db = openDatabase(":memory:");
  const polar = new FakePolarPort(db);
  const previousWeekNow = process.env.WEEK_NOW;
  process.env.WEEK_NOW = "2026-08-17T00:00:00.000Z";
  try {
    const started = await polar.createCheckout({
      amountUsd: 5,
      listingDraft: draft({
        brand: "Ghost",
        terms: "Abandoned Polar checkout.",
        briefUrl: "https://example.com/ghost",
      }),
      successUrl: SUCCESS_URL,
    });
    const leftover = listLiveBoard(db, new Date("2026-08-17T00:00:00.000Z"));
    assert.deepEqual(leftover, []);
    const leftoverHtml = renderToStaticMarkup(
      createElement(Board, { listings: leftover, weekId: WEEK }),
    );
    assert.match(leftoverHtml, /data-occupied="false"/);
    assert.match(leftoverHtml, /Claim #1 for/);
    assert.match(leftoverHtml, /data-first-click="claim"/);
    assert.match(leftoverHtml, /Then the brief URL/);
    assert.match(
      leftoverHtml,
      /Unpaid checkout stays off the board until Polar reports paid/,
    );
    assert.match(leftoverHtml, /An abandoned brief is not Terms as #1/);
    assert.doesNotMatch(leftoverHtml, /Ghost|Abandoned Polar checkout/);
    assert.doesNotMatch(leftoverHtml, /data-prize=/);
    assert.doesNotMatch(leftoverHtml, /Open brief/);
    assert.doesNotMatch(leftoverHtml, /Post a brief/);
    assert.doesNotMatch(leftoverHtml, /data-first-click="open"/);

    await polar.abandonCheckout(started.checkoutId);
    assert.equal(await polar.completeCheckout(started.checkoutId), null);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
      0,
    );
    assert.equal(polar.getCheckout(started.checkoutId)?.status, "canceled");
    assert.deepEqual(
      listLiveBoard(db, new Date("2026-08-17T00:00:00.000Z")),
      [],
    );
  } finally {
    if (previousWeekNow === undefined) {
      delete process.env.WEEK_NOW;
    } else {
      process.env.WEEK_NOW = previousWeekNow;
    }
  }
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

test("polarApiBase defaults to production and honors POLAR_API_BASE", () => {
  assert.equal(POLAR_API_BASE, "https://api.polar.sh");
  assert.equal(polarApiBase({}), POLAR_API_BASE);
  assert.equal(
    polarApiBase({ POLAR_API_BASE: "https://sandbox-api.polar.sh/" }),
    "https://sandbox-api.polar.sh",
  );
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

test("live Polar createCheckout defaults to production Polar API", async () => {
  const seen: string[] = [];
  const polar = new LivePolarPort({
    env: {
      POLAR_LIVE: "1",
      POLAR_ACCESS_TOKEN: "test-token",
      POLAR_PRODUCT_ID: "prod_test",
    },
    fetch: async (input) => {
      seen.push(String(input));
      return new Response(
        JSON.stringify({
          id: "chk_prod",
          url: "https://polar.sh/checkout/chk_prod",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
  });
  await polar.createCheckout({
    amountUsd: 5,
    listingDraft: draft(),
    successUrl: SUCCESS_URL,
  });
  assert.deepEqual(seen, [`${POLAR_API_BASE}/v1/checkouts/`]);
});

test("live Polar createCheckout uses POLAR_API_BASE override", async () => {
  const seen: string[] = [];
  const polar = new LivePolarPort({
    env: {
      POLAR_LIVE: "1",
      POLAR_ACCESS_TOKEN: "test-token",
      POLAR_PRODUCT_ID: "prod_test",
      POLAR_API_BASE: "https://sandbox-api.polar.sh",
    },
    fetch: async (input) => {
      seen.push(String(input));
      return new Response(
        JSON.stringify({
          id: "chk_sandbox",
          url: "https://sandbox.polar.sh/checkout/chk_sandbox",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
  });
  const started = await polar.createCheckout({
    amountUsd: 5,
    listingDraft: draft(),
    successUrl: SUCCESS_URL,
  });
  assert.deepEqual(seen, ["https://sandbox-api.polar.sh/v1/checkouts/"]);
  assert.equal(started.checkoutId, "chk_sandbox");
  assert.equal(started.url, "https://sandbox.polar.sh/checkout/chk_sandbox");
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
  assert.match(cancelHtml, /Polar reports paid/);
  assert.match(cancelHtml, /An abandoned brief is not Terms as #1/);
});

test("same brief URL raise charges new − current; rival pays a full bid", async () => {
  const db = openDatabase(":memory:");
  const polar = new FakePolarPort(db);
  const first = await polar.createCheckout({
    amountUsd: 5,
    listingDraft: draft(),
    successUrl: SUCCESS_URL,
  });
  const placed = await polar.completeCheckout(first.checkoutId);
  assert.ok(placed);
  assert.equal(placed.bidUsd, 5);

  const raiseQuote = planCheckout(db, draft({ bidUsd: 7 }));
  assert.deepEqual(raiseQuote, {
    ok: true,
    kind: "raise",
    bidUsd: 7,
    chargeUsd: 2,
    currentBidUsd: 5,
  });

  await assert.rejects(
    () =>
      polar.createCheckout({
        amountUsd: 7,
        listingDraft: draft({ bidUsd: 7 }),
        successUrl: SUCCESS_URL,
      }),
    (err: unknown) => {
      assert.ok(err instanceof CheckoutError);
      assert.equal(err.code, "raise_charge_mismatch");
      return true;
    },
  );

  const raisedStart = await polar.createCheckout({
    amountUsd: 2,
    listingDraft: draft({ brand: "Acme Raised", bidUsd: 7 }),
    successUrl: SUCCESS_URL,
  });
  assert.equal(polar.getCheckout(raisedStart.checkoutId)?.amountUsd, 2);
  const raised = await polar.completeCheckout(raisedStart.checkoutId);
  assert.ok(raised);
  assert.equal(raised.id, placed.id);
  assert.equal(raised.bidUsd, 7);
  assert.equal(raised.createdAt, placed.createdAt);
  assert.equal(raised.brand, "Acme Raised");

  const rivalQuote = planCheckout(
    db,
    draft({
      brand: "Rival",
      briefUrl: "https://example.com/rival",
      bidUsd: 8,
    }),
  );
  assert.deepEqual(rivalQuote, {
    ok: true,
    kind: "place",
    bidUsd: 8,
    chargeUsd: 8,
  });

  const stealStart = await polar.createCheckout({
    amountUsd: 8,
    listingDraft: draft({
      brand: "Rival",
      briefUrl: "https://example.com/rival",
      bidUsd: 8,
    }),
    successUrl: SUCCESS_URL,
  });
  assert.equal(polar.getCheckout(stealStart.checkoutId)?.amountUsd, 8);
  const rival = await polar.completeCheckout(stealStart.checkoutId);
  assert.ok(rival);
  assert.notEqual(rival.id, placed.id);
  assert.equal(rival.bidUsd, 8);

  const rows = db
    .prepare(
      `SELECT id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
       FROM listings`,
    )
    .all() as ListingRow[];
  const ranked = rankListings(rows.map(listingFromRow));
  assert.deepEqual(
    ranked.map((row) => ({ brand: row.brand, rank: row.rank, bidUsd: row.bidUsd })),
    [
      { brand: "Rival", rank: 1, bidUsd: 8 },
      { brand: "Acme Raised", rank: 2, bidUsd: 7 },
    ],
  );

  const charges = db
    .prepare(
      `SELECT amount_usd, kind, status FROM payments
       WHERE listing_id = ? AND status = 'completed' ORDER BY created_at`,
    )
    .all(placed.id) as { amount_usd: number; kind: string; status: string }[];
  assert.deepEqual(charges, [
    { amount_usd: 5, kind: "place", status: "completed" },
    { amount_usd: 2, kind: "raise", status: "completed" },
  ]);
});

test("unpaid raise does not change rank", async () => {
  const db = openDatabase(":memory:");
  const polar = new FakePolarPort(db);
  const first = await polar.createCheckout({
    amountUsd: 5,
    listingDraft: draft(),
    successUrl: SUCCESS_URL,
  });
  await polar.completeCheckout(first.checkoutId);

  const raiseStart = await polar.createCheckout({
    amountUsd: 2,
    listingDraft: draft({ bidUsd: 7 }),
    successUrl: SUCCESS_URL,
  });
  await polar.abandonCheckout(raiseStart.checkoutId);
  assert.equal(await polar.completeCheckout(raiseStart.checkoutId), null);
  const row = db
    .prepare("SELECT bid_usd FROM listings WHERE brief_url = ?")
    .get("https://example.com/acme") as { bid_usd: number };
  assert.equal(row.bid_usd, 5);
});

test("POST /checkout raise of the same brief URL charges the difference", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-raise-"));
  const dbPath = join(dir, "app.sqlite");
  const previousWeekNow = process.env.WEEK_NOW;
  process.env.WEEK_NOW = "2026-08-17T00:00:00.000Z";
  try {
  await withDatabasePath(dbPath, async () => {
    const polar = new FakePolarPort();
    const placed = await polar.createCheckout({
      amountUsd: 5,
      listingDraft: draft({ briefUrl: "https://example.com/route-raise" }),
      successUrl: SUCCESS_URL,
    });
    await polar.completeCheckout(placed.checkoutId);

    const { POST } = await import("../src/app/api/checkout/route");
    const tooSmall = await POST(
      new Request("http://127.0.0.1/checkout", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          brand: "Route Co",
          terms: "$800 flat, 1 TikTok",
          briefUrl: "https://example.com/route-raise",
          bidUsd: "5",
        }),
      }),
    );
    assert.equal(tooSmall.status, 400);
    const tooSmallBody = (await tooSmall.json()) as { code: string };
    assert.equal(tooSmallBody.code, "raise_too_small");

    const response = await POST(
      new Request("http://127.0.0.1/checkout", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          brand: "Route Co",
          terms: "$800 flat, 1 TikTok",
          briefUrl: "https://example.com/route-raise",
          bidUsd: "8",
        }),
      }),
    );
    assert.equal(response.status, 303);
    const location = response.headers.get("location");
    assert.ok(location);
    const checkoutId = new URL(location, "http://127.0.0.1").searchParams.get(
      "checkoutId",
    );
    assert.ok(checkoutId);
    const pending = polar.getCheckout(checkoutId);
    assert.equal(pending?.amountUsd, 3);
    assert.equal(pending?.listingDraft.bidUsd, 8);

    const listing = await polar.completeCheckout(checkoutId);
    assert.equal(listing?.bidUsd, 8);
    const db = openDatabase(dbPath);
    const payments = db
      .prepare(
        `SELECT amount_usd, kind FROM payments
         WHERE brief_url = ? AND status = 'completed' ORDER BY created_at`,
      )
      .all("https://example.com/route-raise") as {
      amount_usd: number;
      kind: string;
    }[];
    assert.deepEqual(payments, [
      { amount_usd: 5, kind: "place" },
      { amount_usd: 3, kind: "raise" },
    ]);
  });
  } finally {
    if (previousWeekNow === undefined) {
      delete process.env.WEEK_NOW;
    } else {
      process.env.WEEK_NOW = previousWeekNow;
    }
  }
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
