import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { openDatabase, withMigrationForeignKeys } from "../src/lib/db";

const schema = readFileSync(join(process.cwd(), "src", "db", "schema.sql"), "utf8");

test("schema defines listings, payments, and webhook ledger", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS listings/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS payments/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS checkout_provider_sessions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS checkout_intents/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS waffo_webhook_events/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS waffo_webhook_events/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS waffo_webhook_deliveries/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS waffo_webhook_attempts/);
  assert.match(schema, /tax_category/);
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
    "waffo_chk_1",
    "2026-08-17T00:00:00.000Z",
    null,
  );
  const count = db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number };
  assert.equal(count.n, 0);
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
});

test("migration failure restores foreign keys and rolls back before close", () => {
  const memory = openDatabase(":memory:");
  memory.pragma("foreign_keys = ON");
  assert.throws(
    () =>
      withMigrationForeignKeys(memory, () => {
        assert.equal(memory.pragma("foreign_keys", { simple: true }), 0);
        throw new Error("intentional migration failure");
      }),
    /intentional migration failure/,
  );
  assert.equal(memory.pragma("foreign_keys", { simple: true }), 1);
  memory.close();

  const dir = mkdtempSync(join(tmpdir(), "cbw-migration-failure-"));
  const path = join(dir, "app.sqlite");
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE checkout_intents (
      intent_id TEXT PRIMARY KEY,
      week_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      terms TEXT NOT NULL,
      brief_url TEXT NOT NULL,
      bid_usd INTEGER NOT NULL,
      kind TEXT NOT NULL,
      expected_amount_usd INTEGER NOT NULL,
      currency TEXT NOT NULL,
      provider_product_id TEXT NOT NULL,
      provider_checkout_id TEXT,
      provider_checkout_url TEXT,
      status TEXT NOT NULL,
      failure_code TEXT,
      failure_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  legacy.prepare(
    `INSERT INTO checkout_intents (
      intent_id, week_id, brand, terms, brief_url, bid_usd, kind,
      expected_amount_usd, currency, provider_product_id, provider_checkout_id,
      provider_checkout_url, status, failure_code, failure_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "int_legacy",
    "2026-W34",
    "Legacy",
    "terms",
    "https://example.com/legacy",
    5,
    "place",
    5,
    "eur",
    "PROD_legacy",
    null,
    null,
    "creating",
    null,
    null,
    "2026-08-27T00:00:00.000Z",
    "2026-08-27T00:00:00.000Z",
  );
  legacy.close();

  assert.throws(() => openDatabase(path), /CHECK constraint failed/);
  const afterFailure = new Database(path);
  assert.equal(
    (afterFailure.prepare("SELECT currency FROM checkout_intents").get() as { currency: string }).currency,
    "eur",
  );
  afterFailure.prepare("UPDATE checkout_intents SET currency = 'usd'").run();
  afterFailure.close();

  const reopened = openDatabase(path);
  assert.equal(
    (reopened.prepare("SELECT metadata_fingerprint FROM checkout_intents").get() as { metadata_fingerprint: string | null }).metadata_fingerprint,
    null,
  );
  assert.equal(reopened.pragma("foreign_keys", { simple: true }), 1);
  reopened.close();
});
