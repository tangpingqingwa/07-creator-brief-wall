import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../src/lib/db";

const schema = readFileSync(join(process.cwd(), "src", "db", "schema.sql"), "utf8");

test("schema defines listings and payments only", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS listings/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS payments/);
  assert.doesNotMatch(schema, /follower|subscriber|engagement|cpm|estimated.?reach/i);
});

test("memory db accepts a valid listing and payment", () => {
  const db = openDatabase(":memory:");
  db.prepare(
    `INSERT INTO listings (
      id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "lst_1",
    "2026-W34",
    "Acme",
    "$800 flat, 1 TikTok",
    "https://example.com/brief",
    null,
    5,
    0,
    "2026-08-17T00:00:00.000Z",
    "2026-08-17T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO payments (
      id, listing_id, week_id, brief_url, amount_usd, kind, status, polar_checkout_id, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "pay_1",
    "lst_1",
    "2026-W34",
    "https://example.com/brief",
    5,
    "place",
    "completed",
    null,
    "2026-08-17T00:00:00.000Z",
    "2026-08-17T00:00:00.000Z",
  );

  const listing = db
    .prepare("SELECT brand, bid_usd, clicks FROM listings WHERE id = ?")
    .get("lst_1") as { brand: string; bid_usd: number; clicks: number };
  assert.deepEqual(listing, { brand: "Acme", bid_usd: 5, clicks: 0 });
  db.close();
});

test("schema rejects a bid below $5", () => {
  const db = openDatabase(":memory:");
  assert.throws(() => {
    db.prepare(
      `INSERT INTO listings (
        id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "lst_low",
      "2026-W34",
      "Acme",
      "too low",
      "https://example.com/low",
      null,
      4,
      0,
      "2026-08-17T00:00:00.000Z",
      "2026-08-17T00:00:00.000Z",
    );
  });
  db.close();
});

test("unpaid checkout does not require a listings row", () => {
  const db = openDatabase(":memory:");
  db.prepare(
    `INSERT INTO payments (
      id, listing_id, week_id, brief_url, amount_usd, kind, status, polar_checkout_id, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "pay_pending",
    null,
    "2026-W34",
    "https://example.com/unpaid",
    5,
    "place",
    "pending",
    "polar_chk_1",
    "2026-08-17T00:00:00.000Z",
    null,
  );
  const count = db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number };
  assert.equal(count.n, 0);
  db.close();
});

test("same brief URL cannot list twice in one week", () => {
  const db = openDatabase(":memory:");
  const insert = db.prepare(
    `INSERT INTO listings (
      id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(
    "lst_a",
    "2026-W34",
    "Acme",
    "first",
    "https://example.com/brief",
    null,
    5,
    0,
    "2026-08-17T00:00:00.000Z",
    "2026-08-17T00:00:00.000Z",
  );
  assert.throws(() => {
    insert.run(
      "lst_b",
      "2026-W34",
      "Other",
      "duplicate url",
      "https://example.com/brief",
      null,
      6,
      0,
      "2026-08-17T01:00:00.000Z",
      "2026-08-17T01:00:00.000Z",
    );
  });
  db.close();
});
