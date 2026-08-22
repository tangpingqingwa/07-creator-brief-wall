import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/lib/db";
import {
  listingFromRow,
  place,
  raise,
  rankListings,
  type Listing,
} from "../src/lib/rank";
import {
  insertFixtureListing,
  raiseFixtureListing,
} from "../src/lib/test-listings";

const WEEK = "2026-W34";

function listing(
  partial: Partial<Listing> & Pick<Listing, "id" | "bidUsd" | "createdAt">,
): Listing {
  return {
    weekId: WEEK,
    brand: partial.brand ?? `Brand ${partial.id}`,
    terms: partial.terms ?? `Terms ${partial.id}`,
    briefUrl: partial.briefUrl ?? `https://example.com/${partial.id}`,
    clicks: partial.clicks ?? 0,
    updatedAt: partial.updatedAt ?? partial.createdAt,
    ...partial,
  };
}

test("$5 lists; $6 is #1", () => {
  const first = place(5);
  const second = place(6);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const ranked = rankListings([
    listing({ id: "five", bidUsd: 5, createdAt: "2026-08-17T00:00:00.000Z" }),
    listing({ id: "six", bidUsd: 6, createdAt: "2026-08-18T00:00:00.000Z" }),
  ]);
  assert.deepEqual(
    ranked.map((row) => ({ id: row.id, rank: row.rank, bidUsd: row.bidUsd })),
    [
      { id: "six", rank: 1, bidUsd: 6 },
      { id: "five", rank: 2, bidUsd: 5 },
    ],
  );
});

test("equal bids keep older higher", () => {
  const ranked = rankListings([
    listing({
      id: "newer",
      bidUsd: 8,
      createdAt: "2026-08-18T00:00:00.000Z",
      clicks: 40,
    }),
    listing({
      id: "older",
      bidUsd: 8,
      createdAt: "2026-08-17T00:00:00.000Z",
      clicks: 0,
    }),
  ]);
  assert.equal(ranked[0]?.id, "older");
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[1]?.id, "newer");
  assert.equal(ranked[1]?.rank, 2);
});

test("equal createdAt falls back to id ASC", () => {
  const ranked = rankListings([
    listing({ id: "b", bidUsd: 5, createdAt: "2026-08-17T00:00:00.000Z" }),
    listing({ id: "a", bidUsd: 5, createdAt: "2026-08-17T00:00:00.000Z" }),
  ]);
  assert.deepEqual(
    ranked.map((row) => row.id),
    ["a", "b"],
  );
});

test("place rejects non-integer, below $5, and above $50,000", () => {
  assert.equal(place(4.9).ok, false);
  assert.equal(place(5.5).ok, false);
  assert.equal(place(4).ok, false);
  assert.equal(place(50_001).ok, false);
  assert.deepEqual(place(5), { ok: true, bidUsd: 5 });
  assert.deepEqual(place(50_000), { ok: true, bidUsd: 50_000 });
});

test("raise pays difference only", () => {
  const listingRow = listing({
    id: "raise-me",
    bidUsd: 5,
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  assert.deepEqual(raise(listingRow, 7), {
    ok: true,
    newBidUsd: 7,
    chargeUsd: 2,
  });
  assert.equal(raise(listingRow, 5).ok, false);
  assert.equal(raise(listingRow, 5.5).ok, false);
});

test("raise that matches an older equal bid still sorts below it", () => {
  const older = listing({
    id: "incumbent",
    bidUsd: 8,
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  const challenger = listing({
    id: "challenger",
    bidUsd: 5,
    createdAt: "2026-08-18T00:00:00.000Z",
  });
  const raised = raise(challenger, 8);
  assert.equal(raised.ok, true);
  const ranked = rankListings([
    older,
    { ...challenger, bidUsd: 8, updatedAt: "2026-08-18T01:00:00.000Z" },
  ]);
  assert.equal(ranked[0]?.id, "incumbent");
  assert.equal(ranked[1]?.id, "challenger");
});

test("fixture insert + raise: $5 lists, $6 is #1, raise to $7 pays $2 difference", () => {
  const db = openDatabase(":memory:");
  const five = insertFixtureListing(db, {
    id: "lst_five",
    weekId: WEEK,
    brand: "Acme",
    terms: "$800 flat, 1 TikTok",
    briefUrl: "https://example.com/acme",
    bidUsd: 5,
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  insertFixtureListing(db, {
    id: "lst_six",
    weekId: WEEK,
    brand: "Beta",
    terms: "$900 + product",
    briefUrl: "https://example.com/beta",
    bidUsd: 6,
    createdAt: "2026-08-18T00:00:00.000Z",
  });
  const raised = raiseFixtureListing(
    db,
    five,
    7,
    "2026-08-18T02:00:00.000Z",
  );
  assert.equal(raised.bidUsd, 7);

  const rows = db
    .prepare(
      `SELECT id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
       FROM listings`,
    )
    .all() as Parameters<typeof listingFromRow>[0][];
  const ranked = rankListings(rows.map(listingFromRow));
  assert.deepEqual(
    ranked.map((row) => ({ id: row.id, rank: row.rank, bidUsd: row.bidUsd })),
    [
      { id: "lst_five", rank: 1, bidUsd: 7 },
      { id: "lst_six", rank: 2, bidUsd: 6 },
    ],
  );

  const charges = db
    .prepare(
      `SELECT amount_usd, kind FROM payments WHERE listing_id = ? ORDER BY created_at`,
    )
    .all("lst_five") as { amount_usd: number; kind: string }[];
  assert.deepEqual(charges, [
    { amount_usd: 5, kind: "place" },
    { amount_usd: 2, kind: "raise" },
  ]);
  db.close();
});
