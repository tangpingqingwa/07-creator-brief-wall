import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getDb, openDatabase, resetDbCache, type ListingRow } from "../src/lib/db";
import {
  CheckoutError,
  FixturePaymentPort,
  applyVerifiedPaidEvent,
  findListingByBrief,
  getPaymentPort,
  handleCheckoutReturn,
  parseBidUsd,
  planCheckout,
  recordOpenCheckout,
} from "../src/lib/polar";
import { Board } from "../src/app/board";
import { AboutCopy } from "../src/lib/about-copy";
import { RulesCopy } from "../src/lib/rules-copy";
import {
  RAISE_TOO_SMALL_COPY,
  listingFromRow,
  rankListings,
} from "../src/lib/rank";
import { findLiveListingByBrief, listLiveBoard, utcWeekId } from "../src/lib/week";

const WEEK = "2026-W34";
const SUCCESS_URL = "http://127.0.0.1:3000/checkout/complete";

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

test("FixturePaymentPort $5 appears on the board after completion", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  const started = await waffo.createCheckout({
    amountUsd: 5,
    listingDraft: draft(),
    successUrl: SUCCESS_URL,
  });

  const unpaid = db.prepare("SELECT COUNT(*) AS n FROM listings").get() as {
    n: number;
  };
  assert.equal(unpaid.n, 0);

  const listing = await waffo.completeCheckout(started.checkoutId);
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

  const occupiedHtml = renderToStaticMarkup(
    createElement(Board, { listings: ranked, weekId: WEEK }),
  );
  assert.match(occupiedHtml, /data-raise-difference=""/);
  assert.match(
    occupiedHtml,
    /Raise charge: \$<span data-raise-charge-usd="">1<\/span> — only the difference, not a new full bid/,
  );
  assert.match(
    occupiedHtml,
    /same brief link already on the wall[\s\S]*pays only the difference/,
  );
  assert.match(
    occupiedHtml,
    /Only a confirmed checkout changes the ranking/,
  );
  assert.match(occupiedHtml, /data-first-click="open"/);
  assert.match(occupiedHtml, /class="terms-label">Terms/);
  // occupied checkout copy names Waffo raise-pays-difference — unpaid stays off
});

test("unpaid Waffo checkout stays off the plaster until Waffo reports paid", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  const previousWeekNow = process.env.WEEK_NOW;
  process.env.WEEK_NOW = "2026-08-17T00:00:00.000Z";
  try {
    const started = await waffo.createCheckout({
      amountUsd: 5,
      listingDraft: draft({
        brand: "Ghost",
        terms: "Abandoned Waffo checkout.",
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
    assert.match(leftoverHtml, /data-brief-identity=""/);
    assert.match(leftoverHtml, /name="brand"/);
    assert.match(leftoverHtml, /name="terms"/);
    assert.match(leftoverHtml, /name="briefUrl"/);
    const briefUrlAt = leftoverHtml.indexOf('name="briefUrl"');
    const identityAt = leftoverHtml.indexOf('data-brief-identity=""');
    const brandAt = leftoverHtml.indexOf('name="brand"');
    const termsAt = leftoverHtml.indexOf('name="terms"');
    const submitAt = leftoverHtml.indexOf('data-first-click="claim"');
    const outbidAt = leftoverHtml.indexOf(">Claim rank<");
    assert.ok(
      briefUrlAt >= 0 &&
        briefUrlAt < identityAt &&
        identityAt < brandAt &&
        brandAt < termsAt &&
        termsAt < submitAt &&
        submitAt <= outbidAt,
    );
    assert.doesNotMatch(
      leftoverHtml,
      /data-later-write|later-write-label|Then the brief URL|formNoValidate/,
    );
    assert.match(
      leftoverHtml,
      /An incomplete checkout never creates a #1 brief/,
    );
    assert.doesNotMatch(leftoverHtml, /data-raise-difference/);
    assert.doesNotMatch(leftoverHtml, /Waffo charges only the difference/);
    assert.doesNotMatch(leftoverHtml, /Ghost|Abandoned Waffo checkout/);
    assert.doesNotMatch(leftoverHtml, /data-prize=/);
    assert.doesNotMatch(leftoverHtml, /Open brief/);
    assert.doesNotMatch(leftoverHtml, /Post a brief/);
    assert.doesNotMatch(leftoverHtml, /data-first-click="open"/);

    await waffo.abandonCheckout(started.checkoutId);
    assert.equal(await waffo.completeCheckout(started.checkoutId), null);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
      0,
    );
    assert.equal(waffo.getCheckout(started.checkoutId)?.status, "canceled");
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

test("occupied /about keeps raise and payment copy provider-neutral", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-about-raise-"));
  const dbPath = join(dir, "app.sqlite");
  const previousWeekNow = process.env.WEEK_NOW;
  process.env.WEEK_NOW = "2026-08-17T00:00:00.000Z";
  await withDatabasePath(dbPath, async () => {
    try {
      const emptyOccupied = listLiveBoard(openDatabase(dbPath)).length > 0;
      assert.equal(emptyOccupied, false);
      const emptyHtml = renderToStaticMarkup(
        createElement(AboutCopy, { occupied: emptyOccupied }),
      );
      assert.match(emptyHtml, /data-page="about"/);
      assert.match(emptyHtml, /data-occupied="false"/);
      assert.doesNotMatch(emptyHtml, /data-about-raise/);
      assert.doesNotMatch(emptyHtml, /Waffo charges the difference on a raise/);
      assert.doesNotMatch(emptyHtml, /data-raise-difference/);
      assert.doesNotMatch(emptyHtml, /data-raise-charged/);

      const waffo = new FixturePaymentPort();
      const unpaidStart = await waffo.createCheckout({
        amountUsd: 5,
        listingDraft: draft({
          brand: "Ghost",
          terms: "Abandoned Waffo checkout.",
          briefUrl: "https://example.com/ghost-about",
        }),
        successUrl: SUCCESS_URL,
      });
      const unpaidCancel = await handleCheckoutReturn(
        { checkoutId: unpaidStart.checkoutId, status: "cancel" },
        waffo,
      );
      assert.equal(unpaidCancel.status, "cancel");
      assert.equal(unpaidCancel.listing, null);
      assert.equal(listLiveBoard(openDatabase(dbPath)).length, 0);

      const unpaidAbout = renderToStaticMarkup(
        createElement(AboutCopy, {
          occupied: listLiveBoard(openDatabase(dbPath)).length > 0,
        }),
      );
      assert.match(unpaidAbout, /data-occupied="false"/);
      assert.doesNotMatch(unpaidAbout, /data-about-raise/);
      assert.doesNotMatch(unpaidAbout, /Waffo charges the difference on a raise/);
      assert.doesNotMatch(unpaidAbout, /Ghost/);
      assert.equal(
        unpaidAbout,
        renderToStaticMarkup(createElement(AboutCopy, { occupied: false })),
      );

      const paidStart = await waffo.createCheckout({
        amountUsd: 5,
        listingDraft: draft(),
        successUrl: SUCCESS_URL,
      });
      const placed = await handleCheckoutReturn(
        { checkoutId: paidStart.checkoutId },
        waffo,
      );
      assert.equal(placed.status, "success");
      assert.equal(placed.payment?.kind, "place");
      assert.equal(placed.listing?.bidUsd, 5);
      assert.equal(listLiveBoard(openDatabase(dbPath)).length, 1);

      const occupiedAbout = renderToStaticMarkup(
        createElement(AboutCopy, {
          occupied: listLiveBoard(openDatabase(dbPath)).length > 0,
        }),
      );
      assert.match(occupiedAbout, /data-page="about"/);
      assert.match(occupiedAbout, /data-occupied="true"/);
      assert.match(occupiedAbout, /data-about-raise=""/);
      assert.match(
        occupiedAbout,
        /A raise charges the original payer only the difference/,
      );
      assert.match(
        occupiedAbout,
        /A brief appears only after payment is confirmed/,
      );
      assert.match(occupiedAbout, /Rank is the bid/);
      assert.doesNotMatch(occupiedAbout, /data-raise-difference/);
      assert.doesNotMatch(occupiedAbout, /data-raise-charged/);
      assert.doesNotMatch(occupiedAbout, /data-raise-charge=/);
      assert.equal(
        occupiedAbout,
        renderToStaticMarkup(createElement(AboutCopy, { occupied: true })),
      );
    } finally {
      if (previousWeekNow === undefined) {
        delete process.env.WEEK_NOW;
      } else {
        process.env.WEEK_NOW = previousWeekNow;
      }
    }
  });
});

test("occupied /rules keeps raise and payment copy provider-neutral", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-rules-raise-"));
  const dbPath = join(dir, "app.sqlite");
  const previousWeekNow = process.env.WEEK_NOW;
  process.env.WEEK_NOW = "2026-08-17T00:00:00.000Z";
  await withDatabasePath(dbPath, async () => {
    try {
      const emptyOccupied = listLiveBoard(openDatabase(dbPath)).length > 0;
      assert.equal(emptyOccupied, false);
      const emptyHtml = renderToStaticMarkup(
        createElement(RulesCopy, { occupied: emptyOccupied }),
      );
      assert.match(emptyHtml, /data-page="rules"/);
      assert.match(emptyHtml, /data-occupied="false"/);
      assert.match(emptyHtml, /same cleaned brief link may raise/i);
      assert.doesNotMatch(emptyHtml, /data-rules-raise/);
      assert.doesNotMatch(emptyHtml, /Waffo charges the difference on a raise/);
      assert.doesNotMatch(emptyHtml, /data-raise-difference/);
      assert.doesNotMatch(emptyHtml, /data-raise-charged/);
      assert.doesNotMatch(emptyHtml, /data-about-raise/);

      const waffo = new FixturePaymentPort();
      const unpaidStart = await waffo.createCheckout({
        amountUsd: 5,
        listingDraft: draft({
          brand: "Ghost",
          terms: "Abandoned Waffo checkout.",
          briefUrl: "https://example.com/ghost-rules",
        }),
        successUrl: SUCCESS_URL,
      });
      const unpaidCancel = await handleCheckoutReturn(
        { checkoutId: unpaidStart.checkoutId, status: "cancel" },
        waffo,
      );
      assert.equal(unpaidCancel.status, "cancel");
      assert.equal(unpaidCancel.listing, null);
      assert.equal(listLiveBoard(openDatabase(dbPath)).length, 0);

      const unpaidRules = renderToStaticMarkup(
        createElement(RulesCopy, {
          occupied: listLiveBoard(openDatabase(dbPath)).length > 0,
        }),
      );
      assert.match(unpaidRules, /data-occupied="false"/);
      assert.doesNotMatch(unpaidRules, /data-rules-raise/);
      assert.doesNotMatch(unpaidRules, /Waffo charges the difference on a raise/);
      assert.doesNotMatch(unpaidRules, /Ghost/);
      assert.equal(
        unpaidRules,
        renderToStaticMarkup(createElement(RulesCopy, { occupied: false })),
      );

      const paidStart = await waffo.createCheckout({
        amountUsd: 5,
        listingDraft: draft(),
        successUrl: SUCCESS_URL,
      });
      const placed = await handleCheckoutReturn(
        { checkoutId: paidStart.checkoutId },
        waffo,
      );
      assert.equal(placed.status, "success");
      assert.equal(placed.payment?.kind, "place");
      assert.equal(placed.listing?.bidUsd, 5);
      assert.equal(listLiveBoard(openDatabase(dbPath)).length, 1);

      const occupiedRules = renderToStaticMarkup(
        createElement(RulesCopy, {
          occupied: listLiveBoard(openDatabase(dbPath)).length > 0,
        }),
      );
      assert.match(occupiedRules, /data-page="rules"/);
      assert.match(occupiedRules, /data-occupied="true"/);
      assert.match(occupiedRules, /data-rules-raise=""/);
      assert.match(
        occupiedRules,
        /A raise charges the original payer only the difference/,
      );
      assert.match(
        occupiedRules,
        /incomplete or abandoned checkout never appears on the wall/i,
      );
      assert.match(occupiedRules, /Rank is the bid/);
      assert.match(occupiedRules, /same cleaned brief link may raise/i);
      assert.doesNotMatch(occupiedRules, /data-raise-difference/);
      assert.doesNotMatch(occupiedRules, /data-raise-charged/);
      assert.doesNotMatch(occupiedRules, /data-raise-charge=/);
      assert.doesNotMatch(occupiedRules, /data-about-raise/);
      assert.equal(
        occupiedRules,
        renderToStaticMarkup(createElement(RulesCopy, { occupied: true })),
      );
    } finally {
      if (previousWeekNow === undefined) {
        delete process.env.WEEK_NOW;
      } else {
        process.env.WEEK_NOW = previousWeekNow;
      }
    }
  });
});

test("raise-too-small guidance stays provider-neutral", () => {
  assert.match(RAISE_TOO_SMALL_COPY, /A raise charges only the difference/);
  assert.match(RAISE_TOO_SMALL_COPY, /not a new full bid/);
  assert.match(RAISE_TOO_SMALL_COPY, /An incomplete checkout stays off the wall/);
  assert.match(RAISE_TOO_SMALL_COPY, /at least \$1 above the current bid/);
});

test("webhook / fixture completion lists; abandoned webhook does not", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  const listingDraft = draft({
    brand: "Webhook Co",
    terms: "$500, 1 YouTube",
    briefUrl: "https://example.com/webhook",
  });
  const started = await waffo.createCheckout({
    amountUsd: 5,
    listingDraft,
    successUrl: SUCCESS_URL,
  });
  const paidBody = JSON.stringify({
    type: "order.paid",
    data: {
      id: "ord_webhook_paid",
      checkout_id: started.checkoutId,
      product_id: "fixture",
      currency: "usd",
      total_amount: 500,
      status: "paid",
      paid: true,
      metadata: {
        brand: listingDraft.brand,
        terms: listingDraft.terms,
        briefUrl: listingDraft.briefUrl,
        bidUsd: "5",
        weekId: WEEK,
        chargeUsd: "5",
      },
    },
  });
  const paid = await waffo.parseWebhook(paidBody, { "webhook-id": "evt_fixture_paid" });
  assert.ok(!("ignored" in paid));
  if ("ignored" in paid) {
    throw new Error("expected paid webhook");
  }
  applyVerifiedPaidEvent(db, paid);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n,
    1,
  );

  const abandoned = await waffo.parseWebhook(
    JSON.stringify({
      type: "checkout.expired",
      data: { id: "chk_abandoned", status: "expired" },
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
  const waffo = new FixturePaymentPort(db);
  const paid = await waffo.createCheckout({
    amountUsd: 5,
    listingDraft: draft(),
    successUrl: SUCCESS_URL,
  });
  const canceled = await waffo.createCheckout({
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
    waffo,
  );
  assert.equal(success.status, "success");
  assert.equal(success.listing?.bidUsd, 5);
  assert.equal(success.payment?.kind, "place");
  assert.equal(success.payment?.chargeUsd, 5);

  const cancel = await handleCheckoutReturn(
    { checkoutId: canceled.checkoutId, status: "cancel" },
    waffo,
  );
  assert.equal(cancel.status, "cancel");
  assert.equal(cancel.listing, null);
  assert.equal(cancel.payment?.kind, "place");
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
    assert.match(location, /\/checkout\/complete\?checkoutId=/);
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
    const listingDraft = draft({
      brand: "Hook Brand",
      terms: "1 Instagram Reel",
      briefUrl: "https://example.com/hook",
    });
    const fixture = new FixturePaymentPort(openDatabase(dbPath));
    const started = await fixture.createCheckout({
      amountUsd: 5,
      listingDraft,
      successUrl: SUCCESS_URL,
    });
    const { POST } = await import("../src/app/api/webhooks/waffo/route");
    const response = await POST(
      new Request("http://127.0.0.1/webhooks/waffo", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "webhook-id": "evt_route_paid",
        },
        body: JSON.stringify({
          type: "order.paid",
          data: {
            id: "ord_route_paid",
            checkout_id: started.checkoutId,
            product_id: "fixture",
            currency: "usd",
            total_amount: 500,
            status: "paid",
            paid: true,
            metadata: {
              brand: listingDraft.brand,
              terms: listingDraft.terms,
              briefUrl: listingDraft.briefUrl,
              bidUsd: "5",
              weekId: WEEK,
              chargeUsd: "5",
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

test("retired provider compatibility cannot handle webhook traffic", async () => {
  const { POST } = await import("../src/app/api/webhooks/polar/route");
  const response = await POST(new Request("http://127.0.0.1/webhooks/polar", { method: "POST", body: "{}" }));
  assert.equal(response.status, 410);
  assert.match((await response.json()).error, /retired/);
});

test("/checkout/return markup shows pending or cancel without a payment mutation", async () => {
  const { default: ReturnPage } = await import(
    "../src/app/checkout/return/page"
  );
  const successHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ intent: "missing" }),
    }),
  );
  assert.match(successHtml, /data-return="pending"/);
  assert.match(successHtml, /Payment pending/i);
  assert.match(successHtml, /Back to the board/);
  assert.doesNotMatch(successHtml, /data-raise-charged/);
  assert.doesNotMatch(successHtml, /the difference, not a new full bid/);

  const cancelHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({
        checkoutId: "missing",
        status: "cancel",
      }),
    }),
  );
  assert.match(cancelHtml, /data-return="cancel"/);
  assert.match(cancelHtml, /No rank was claimed/);
  assert.match(cancelHtml, /never creates a listing or becomes #1/);
  assert.doesNotMatch(cancelHtml, /data-raise-charged/);

  const { default: CompletePage } = await import(
    "../src/app/checkout/complete/page"
  );
  const completeHtml = renderToStaticMarkup(
    await CompletePage({
      searchParams: Promise.resolve({ intent: "missing" }),
    }),
  );
  assert.match(completeHtml, /data-return="pending"/);
  assert.match(completeHtml, /Payment pending/i);
  assert.doesNotMatch(completeHtml, /data-raise-charged/);
});

test("/checkout/return renders durable unknown, reconciliation, and rejected states truthfully", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-return-states-"));
  const dbPath = join(dir, "app.sqlite");
  await withDatabasePath(dbPath, async () => {
    const db = getDb();
    const { default: ReturnPage } = await import(
      "../src/app/checkout/return/page"
    );
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO checkout_intents (
        intent_id, intent_fingerprint, metadata_fingerprint, week_id, window_key,
        brand, terms, brief_url, canonical_url, bid_usd, target_bid_cents,
        quote_base_bid_cents, charge_cents, kind, expected_amount_usd, currency,
        mode, store_id, product_id, tax_category, provider_product_id,
        provider_checkout_id, provider_checkout_url, session_id, checkout_url,
        expires_at, status, failure_code, failure_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)`
    );
    for (const [status, marker, message] of [
      ["unknown", "unknown", /Payment status unknown/],
      ["needs_reconciliation", "reconciliation", /Payment needs review/],
      ["rejected", "rejected", /Payment not accepted/],
    ] as const) {
      const intentId = `return-${status}`;
      insert.run(
        intentId,
        `fingerprint-${status}`,
        `metadata-${status}`,
        WEEK,
        WEEK,
        `Return ${status}`,
        "one vertical video",
        `https://example.com/return-${status}`,
        `https://example.com/return-${status}`,
        5,
        500,
        0,
        500,
        "place",
        5,
        "usd",
        "test",
        "STO_fixture",
        "PROD_fixture",
        "digital_goods",
        "fixture",
        status,
        `failure-${status}`,
        `failure ${status}`,
        now,
        now,
      );
      const html = renderToStaticMarkup(
        await ReturnPage({
          searchParams: Promise.resolve({ intent: intentId }),
        }),
      );
      assert.match(html, new RegExp(`data-return="${marker}"`));
      assert.match(html, message);
      assert.doesNotMatch(html, /data-return="success"/);
      assert.match(html, /rank change/);
    }
  });
});

test("occupied /checkout/return names the raise difference without provider copy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbw-raise-return-"));
  const dbPath = join(dir, "app.sqlite");
  await withDatabasePath(dbPath, async () => {
    const waffo = new FixturePaymentPort();
    const placedStart = await waffo.createCheckout({
      amountUsd: 5,
      listingDraft: draft(),
      successUrl: SUCCESS_URL,
    });
    const placed = await handleCheckoutReturn(
      { checkoutId: placedStart.checkoutId },
      waffo,
    );
    assert.equal(placed.status, "success");
    assert.equal(placed.payment?.kind, "place");
    assert.equal(placed.listing?.bidUsd, 5);

    const { default: ReturnPage } = await import(
      "../src/app/checkout/return/page"
    );
    const placeHtml = renderToStaticMarkup(
      await ReturnPage({
        searchParams: Promise.resolve({
          checkoutId: placedStart.checkoutId,
        }),
      }),
    );
    assert.match(placeHtml, /data-return="success"/);
    assert.match(placeHtml, /Acme is listed at \$5/);
    assert.doesNotMatch(placeHtml, /data-raise-charged/);
    assert.doesNotMatch(placeHtml, /the difference, not a new full bid/);

    const raiseStart = await waffo.createCheckout({
      amountUsd: 2,
      listingDraft: draft({ bidUsd: 7 }),
      successUrl: SUCCESS_URL,
    });
    const unpaidCancel = await handleCheckoutReturn(
      { checkoutId: raiseStart.checkoutId, status: "cancel" },
      waffo,
    );
    assert.equal(unpaidCancel.status, "cancel");
    assert.equal(unpaidCancel.listing, null);
    assert.equal(unpaidCancel.payment?.kind, "raise");
    assert.equal(unpaidCancel.payment?.chargeUsd, 2);
    assert.equal(waffo.getCheckout(raiseStart.checkoutId)?.status, "canceled");
    assert.equal(
      (openDatabase(dbPath).prepare("SELECT bid_usd FROM listings").get() as {
        bid_usd: number;
      }).bid_usd,
      5,
    );

    const raiseCancelHtml = renderToStaticMarkup(
      await ReturnPage({
        searchParams: Promise.resolve({
          checkoutId: raiseStart.checkoutId,
          status: "cancel",
        }),
      }),
    );
    assert.match(raiseCancelHtml, /data-return="cancel"/);
    assert.match(raiseCancelHtml, /No rank was claimed/);
    assert.match(raiseCancelHtml, /never creates a listing or becomes #1/);
    assert.doesNotMatch(raiseCancelHtml, /data-raise-charged/);
    assert.doesNotMatch(raiseCancelHtml, /on the board/i);

    const paidRaise = await waffo.createCheckout({
      amountUsd: 2,
      listingDraft: draft({ bidUsd: 7 }),
      successUrl: SUCCESS_URL,
    });
    const raised = await handleCheckoutReturn(
      { checkoutId: paidRaise.checkoutId },
      waffo,
    );
    assert.equal(raised.status, "success");
    assert.equal(raised.payment?.kind, "raise");
    assert.equal(raised.payment?.chargeUsd, 2);
    assert.equal(raised.listing?.bidUsd, 7);

    const raiseHtml = renderToStaticMarkup(
      await ReturnPage({
        searchParams: Promise.resolve({
          checkoutId: paidRaise.checkoutId,
        }),
      }),
    );
    assert.match(raiseHtml, /data-return="success"/);
    assert.match(raiseHtml, /data-raise-charged=""/);
    assert.match(
      raiseHtml,
      /\$<span data-raise-charge-usd="">2<\/span> was charged — the difference, not a new full bid/,
    );
    assert.match(raiseHtml, /Acme is listed at \$7/);
    assert.doesNotMatch(raiseHtml, /data-return="cancel"/);
    assert.equal(
      (openDatabase(dbPath).prepare("SELECT bid_usd FROM listings").get() as {
        bid_usd: number;
      }).bid_usd,
      7,
    );
  });
});

test("same brief URL raise charges new − current; rival pays a full bid", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  const first = await waffo.createCheckout({
    amountUsd: 5,
    listingDraft: draft(),
    successUrl: SUCCESS_URL,
  });
  const placed = await waffo.completeCheckout(first.checkoutId);
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
      waffo.createCheckout({
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

  const raisedStart = await waffo.createCheckout({
    amountUsd: 2,
    listingDraft: draft({ brand: "Acme Raised", bidUsd: 7 }),
    successUrl: SUCCESS_URL,
  });
  assert.equal(waffo.getCheckout(raisedStart.checkoutId)?.amountUsd, 2);
  const raised = await waffo.completeCheckout(raisedStart.checkoutId);
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

  const stealStart = await waffo.createCheckout({
    amountUsd: 8,
    listingDraft: draft({
      brand: "Rival",
      briefUrl: "https://example.com/rival",
      bidUsd: 8,
    }),
    successUrl: SUCCESS_URL,
  });
  assert.equal(waffo.getCheckout(stealStart.checkoutId)?.amountUsd, 8);
  const rival = await waffo.completeCheckout(stealStart.checkoutId);
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

test("same brief still inside last-7-days raises after the UTC week label rolls", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  const previousWeekNow = process.env.WEEK_NOW;
  const url = "https://example.com/sunday-raise";
  try {
    process.env.WEEK_NOW = "2026-08-16T12:00:00.000Z";
    const first = await waffo.createCheckout({
      amountUsd: 5,
      listingDraft: draft({ weekId: "2026-W33", briefUrl: url }),
      successUrl: SUCCESS_URL,
    });
    const placed = await waffo.completeCheckout(first.checkoutId);
    assert.ok(placed);
    assert.equal(placed.weekId, "2026-W33");
    assert.equal(placed.createdAt, "2026-08-16T12:00:00.000Z");

    process.env.WEEK_NOW = "2026-08-17T00:00:00.000Z";
    assert.equal(utcWeekId(), "2026-W34");
    assert.equal(findListingByBrief(db, "2026-W34", url), undefined);
    const live = findLiveListingByBrief(db, url);
    assert.equal(live?.id, placed.id);
    assert.equal(live?.weekId, "2026-W33");
    assert.equal(listLiveBoard(db).length, 1);

    const raiseQuote = planCheckout(
      db,
      draft({ weekId: "2026-W34", briefUrl: url, bidUsd: 7 }),
    );
    assert.deepEqual(raiseQuote, {
      ok: true,
      kind: "raise",
      bidUsd: 7,
      chargeUsd: 2,
      currentBidUsd: 5,
    });

    const raisedStart = await waffo.createCheckout({
      amountUsd: 2,
      listingDraft: draft({
        weekId: "2026-W34",
        brand: "Sunday Raised",
        briefUrl: url,
        bidUsd: 7,
      }),
      successUrl: SUCCESS_URL,
    });
    const raised = await waffo.completeCheckout(raisedStart.checkoutId);
    assert.ok(raised);
    assert.equal(raised.id, placed.id);
    assert.equal(raised.weekId, "2026-W33");
    assert.equal(raised.bidUsd, 7);
    assert.equal(raised.createdAt, placed.createdAt);

    process.env.WEEK_NOW = "2026-08-23T12:00:01.000Z";
    assert.equal(findLiveListingByBrief(db, url), undefined);
    const agedQuote = planCheckout(
      db,
      draft({ weekId: "2026-W34", briefUrl: url, bidUsd: 5 }),
    );
    assert.deepEqual(agedQuote, {
      ok: true,
      kind: "place",
      bidUsd: 5,
      chargeUsd: 5,
    });
  } finally {
    if (previousWeekNow === undefined) {
      delete process.env.WEEK_NOW;
    } else {
      process.env.WEEK_NOW = previousWeekNow;
    }
  }
});

test("unpaid raise does not change rank", async () => {
  const db = openDatabase(":memory:");
  const waffo = new FixturePaymentPort(db);
  const first = await waffo.createCheckout({
    amountUsd: 5,
    listingDraft: draft(),
    successUrl: SUCCESS_URL,
  });
  await waffo.completeCheckout(first.checkoutId);

  const raiseStart = await waffo.createCheckout({
    amountUsd: 2,
    listingDraft: draft({ bidUsd: 7 }),
    successUrl: SUCCESS_URL,
  });
  await waffo.abandonCheckout(raiseStart.checkoutId);
  assert.equal(await waffo.completeCheckout(raiseStart.checkoutId), null);
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
    const waffo = new FixturePaymentPort();
    const placed = await waffo.createCheckout({
      amountUsd: 5,
      listingDraft: draft({ briefUrl: "https://example.com/route-raise" }),
      successUrl: SUCCESS_URL,
    });
    await waffo.completeCheckout(placed.checkoutId);

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
    assert.equal(tooSmall.status, 303);
    assert.match(
      tooSmall.headers.get("location") ?? "",
      /\/checkout\/raise-too-small$/,
    );

    const tooSmallJson = await POST(
      new Request("http://127.0.0.1/checkout", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          brand: "Route Co",
          terms: "$800 flat, 1 TikTok",
          briefUrl: "https://example.com/route-raise",
          bidUsd: 5,
        }),
      }),
    );
    assert.equal(tooSmallJson.status, 400);
    const tooSmallBody = (await tooSmallJson.json()) as {
      code: string;
      error: string;
    };
    assert.equal(tooSmallBody.code, "raise_too_small");
    assert.equal(tooSmallBody.error, RAISE_TOO_SMALL_COPY);
    assert.match(tooSmallBody.error, /A raise charges only the difference/);
    assert.match(tooSmallBody.error, /not a new full bid/);

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
    const pending = waffo.getCheckout(checkoutId);
    assert.equal(pending?.amountUsd, 3);
    assert.equal(pending?.listingDraft.bidUsd, 8);

    const listing = await waffo.completeCheckout(checkoutId);
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
