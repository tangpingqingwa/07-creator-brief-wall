import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RAISE_TOO_SMALL_COPY,
  claimNumberOneUsd,
  isWaffoPaidListing,
  paidListings,
  place,
  quoteCheckout,
  raise,
  rankListings,
  takesNumberOne,
  type Listing,
} from "../src/lib/rank";

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
  assert.deepEqual(raise(listingRow, 5), {
    ok: false,
    error: RAISE_TOO_SMALL_COPY,
  });
  assert.equal(raise(listingRow, 5.5).ok, false);
  assert.deepEqual(quoteCheckout(listingRow, 7), {
    ok: true,
    kind: "raise",
    bidUsd: 7,
    chargeUsd: 2,
    currentBidUsd: 5,
  });
  assert.deepEqual(quoteCheckout(undefined, 5), {
    ok: true,
    kind: "place",
    bidUsd: 5,
    chargeUsd: 5,
  });
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

test("raise-too-small guidance is provider-neutral", () => {
  const current = listing({
    id: "raiser",
    bidUsd: 5,
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  assert.deepEqual(raise(current, 5), {
    ok: false,
    error: RAISE_TOO_SMALL_COPY,
  });
  assert.deepEqual(quoteCheckout(current, 5), {
    ok: false,
    error: RAISE_TOO_SMALL_COPY,
  });
  assert.match(RAISE_TOO_SMALL_COPY, /A raise charges only the difference/);
  assert.match(RAISE_TOO_SMALL_COPY, /not a new full bid/);
  assert.match(RAISE_TOO_SMALL_COPY, /An incomplete checkout stays off the wall/);
  assert.doesNotMatch(RAISE_TOO_SMALL_COPY, /a new full bid of \$5/);
});

test("new bid must be at least current + $1, and top + $1 to become #1", () => {
  const current = listing({
    id: "raiser",
    bidUsd: 5,
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  const top = listing({
    id: "incumbent",
    bidUsd: 10,
    createdAt: "2026-08-16T00:00:00.000Z",
  });

  assert.equal(raise(current, 5).ok, false);
  assert.equal(quoteCheckout(current, 5).ok, false);
  assert.deepEqual(raise(current, 6), {
    ok: true,
    newBidUsd: 6,
    chargeUsd: 1,
  });

  assert.equal(takesNumberOne(10, top.bidUsd), false);
  assert.equal(takesNumberOne(11, top.bidUsd), true);
  assert.equal(takesNumberOne(5, undefined), true);
  assert.equal(claimNumberOneUsd(undefined), 5);
  assert.equal(claimNumberOneUsd(10), 11);

  const tied = rankListings([
    top,
    { ...current, bidUsd: 10, updatedAt: "2026-08-18T00:00:00.000Z" },
  ]);
  assert.equal(tied[0]?.id, "incumbent");
  assert.equal(tied[1]?.id, "raiser");

  const overtaken = rankListings([
    top,
    { ...current, bidUsd: 11, updatedAt: "2026-08-18T00:00:00.000Z" },
  ]);
  assert.equal(overtaken[0]?.id, "raiser");
  assert.equal(overtaken[0]?.bidUsd, 11);
});

test("unpaid stays off the plaster wall — No Terms until Waffo reports paid", () => {
  const unpaid = listing({
    id: "lst_unpaid",
    brand: "Ghost",
    terms: "Abandoned Waffo checkout.",
    briefUrl: "https://example.com/ghost",
    bidUsd: 99,
    createdAt: "",
  });
  const abandoned = listing({
    id: "lst_abandoned",
    brand: "Vapor Co",
    terms: "Epoch createdAt is not Waffo paid.",
    briefUrl: "https://example.com/vapor",
    bidUsd: 80,
    createdAt: "1970-01-01T00:00:00.000Z",
  });
  const paid = listing({
    id: "lst_paid_only",
    brand: "Acme",
    terms: "$800 flat, 1 TikTok",
    briefUrl: "https://example.com/acme",
    bidUsd: 5,
    createdAt: "2026-08-17T00:00:00.000Z",
  });

  assert.equal(isWaffoPaidListing(unpaid), false);
  assert.equal(isWaffoPaidListing(abandoned), false);
  assert.equal(isWaffoPaidListing(paid), true);
  assert.deepEqual(paidListings([unpaid, abandoned]), []);
  assert.deepEqual(rankListings([unpaid, abandoned]), []);
  const ranked = rankListings([unpaid, abandoned, paid]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, "lst_paid_only");
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.brand, "Acme");
  assert.doesNotMatch(
    ranked.map((row) => row.id).join(","),
    /lst_unpaid|lst_abandoned/,
  );
});

test("cannot steal #1 by paying only the incumbent’s difference", () => {
  const incumbent = listing({
    id: "incumbent",
    brand: "Incumbent",
    briefUrl: "https://example.com/incumbent",
    bidUsd: 20,
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  const rivalPlace = quoteCheckout(undefined, 5);
  assert.deepEqual(rivalPlace, {
    ok: true,
    kind: "place",
    bidUsd: 5,
    chargeUsd: 5,
  });
  assert.notEqual(rivalPlace.ok && rivalPlace.chargeUsd, 1);
  assert.equal(takesNumberOne(5, incumbent.bidUsd), false);

  const ranked = rankListings([
    incumbent,
    listing({
      id: "rival",
      brand: "Rival",
      briefUrl: "https://example.com/rival",
      bidUsd: 5,
      createdAt: "2026-08-18T00:00:00.000Z",
    }),
  ]);
  assert.equal(ranked[0]?.id, "incumbent");
  assert.equal(ranked[0]?.bidUsd, 20);
  assert.equal(ranked[1]?.id, "rival");
  assert.equal(ranked[1]?.bidUsd, 5);
});
