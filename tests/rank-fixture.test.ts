import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/lib/db";
import { listingFromRow, rankListings } from "../src/lib/rank";
import {
  insertFixtureListing,
  raiseFixtureListing,
} from "../src/lib/test-listings";

const WEEK = "2026-W34";

test("fixture insert + raise: $5 lists, $6 is #1, raise to $7 pays $2 difference", () => {
  const db = openDatabase(":memory:");
  try {
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
  } finally {
    db.close();
  }
});
