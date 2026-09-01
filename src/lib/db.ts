import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

export type AppDb = InstanceType<typeof Database>;

/** SQLite URI spellings that keep the database in process memory. */
export function isMemoryDatabasePath(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === ":memory:") return true;
  if (!normalized.startsWith("file:")) return false;
  const [filename, query = ""] = normalized.slice("file:".length).split("?", 2);
  if (filename === ":memory:" || filename === "") return true;
  return query
    .split("&")
    .some((part) => part === "mode=memory");
}

export type ListingRow = {
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
};

export type PaymentRow = {
  id: string;
  listing_id: string | null;
  week_id: string;
  brief_url: string;
  amount_usd: number;
  kind: "place" | "raise";
  status: "pending" | "completed" | "canceled";
  polar_checkout_id: string | null;
  created_at: string;
  completed_at: string | null;
};

const SCHEMA_PATH = join(process.cwd(), "src", "db", "schema.sql");

export function defaultDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.DATABASE_PATH?.trim();
  if (env.NODE_ENV === "production") {
    if (!configured || isMemoryDatabasePath(configured)) {
      throw new Error("BLOCKED-CONFIG: DATABASE_PATH");
    }
    return configured;
  }
  return configured || join(process.cwd(), "data", "app.sqlite");
}

export function openDatabase(dbPath: string = defaultDatabasePath()): AppDb {
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.DATABASE_PATH?.trim() || isMemoryDatabasePath(dbPath))
  ) {
    throw new Error("BLOCKED-CONFIG: DATABASE_PATH");
  }
  if (!isMemoryDatabasePath(dbPath)) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  const priorForeignKeys = Boolean(db.pragma("foreign_keys", { simple: true }));
  try {
    if (!isMemoryDatabasePath(dbPath)) {
      db.pragma("journal_mode = WAL");
    }
    db.pragma("foreign_keys = ON");
    db.exec(readFileSync(SCHEMA_PATH, "utf8"));
    migrateWebhookLedger(db);
    migrateCheckoutIntents(db);
    migrateWaffoLedger(db);
    return db;
  } catch (error) {
    // A failed migration must not leak a half-open connection (or leave a
    // caller's FK setting changed). Each migration also restores its setting;
    // this outer guard covers schema/read failures before a migration starts.
    try {
      db.pragma(`foreign_keys = ${priorForeignKeys ? "ON" : "OFF"}`);
    } catch {
      // Closing is still attempted when a damaged database rejects PRAGMA.
    }
    try {
      db.close();
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  }
}

/** Run a schema migration with exception-safe foreign-key restoration. */
export function withMigrationForeignKeys<T>(db: AppDb, action: () => T): T {
  const prior = Boolean(db.pragma("foreign_keys", { simple: true }));
  let result!: T;
  let actionError: unknown;
  try {
    db.pragma("foreign_keys = OFF");
    result = action();
  } catch (error) {
    actionError = error;
  }

  let restoreError: unknown;
  try {
    db.pragma(`foreign_keys = ${prior ? "ON" : "OFF"}`);
  } catch (error) {
    restoreError = error;
  }
  if (actionError !== undefined) throw actionError;
  if (restoreError !== undefined) throw restoreError;
  return result;
}

/**
 * The first payment-boundary schema shipped with an applied-only ledger. Keep
 * already received events while upgrading that table in place; dropping event
 * identity would make a replay indistinguishable from a new payment.
 */
function migrateWebhookLedger(db: AppDb): void {
  const columns = db
    .prepare("PRAGMA table_info(polar_webhook_events)")
    .all() as Array<{ name: string }>;
  if (
    !columns.length ||
    (columns.some((column) => column.name === "outcome_code") &&
      columns.some((column) => column.name === "metadata_hash"))
  ) {
    return;
  }

  withMigrationForeignKeys(db, () => {
    db.transaction(() => {
      db.exec(`
      DROP INDEX IF EXISTS polar_webhook_events_checkout;
      DROP INDEX IF EXISTS polar_webhook_events_order;
      ALTER TABLE polar_webhook_events RENAME TO polar_webhook_events_legacy;
      CREATE TABLE polar_webhook_events (
        event_id TEXT PRIMARY KEY,
        order_id TEXT,
        checkout_id TEXT,
        intent_id TEXT,
        event_type TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        product_id TEXT,
        currency TEXT,
        amount_cents INTEGER,
        metadata_hash TEXT,
        status TEXT NOT NULL CHECK (status IN ('applied','rejected','reconciliation_required')),
        outcome_code TEXT NOT NULL,
        outcome_message TEXT NOT NULL,
        received_at TEXT NOT NULL,
        processed_at TEXT NOT NULL
      );
      INSERT INTO polar_webhook_events (
        event_id, order_id, checkout_id, intent_id, event_type, payload_hash,
        product_id, currency, amount_cents, metadata_hash,
        status, outcome_code, outcome_message, received_at, processed_at
      )
      SELECT event_id, order_id, checkout_id, NULL, event_type, payload_hash,
        NULL, NULL, NULL, NULL,
        'applied', 'applied', 'migrated applied webhook', received_at, processed_at
      FROM polar_webhook_events_legacy;
      DROP TABLE polar_webhook_events_legacy;
      CREATE INDEX polar_webhook_events_checkout
        ON polar_webhook_events (checkout_id);
      CREATE INDEX polar_webhook_events_order
        ON polar_webhook_events (order_id);
      `);
    }).immediate();
  });
}

/** Upgrade the short-lived Polar intent shape without losing its draft. */
function migrateCheckoutIntents(db: AppDb): void {
  const columns = db
    .prepare("PRAGMA table_info(checkout_intents)")
    .all() as Array<{ name: string }>;
  if (
    !columns.length ||
    columns.some((column) => column.name === "metadata_fingerprint")
  ) {
    return;
  }

  const legacyRows = db
    .prepare(
      `SELECT intent_id, week_id, brand, terms, brief_url, bid_usd, kind,
              expected_amount_usd, currency, provider_product_id,
              provider_checkout_id, provider_checkout_url, status,
              failure_code, failure_message, created_at, updated_at
       FROM checkout_intents`,
    )
    .all() as Array<{
    intent_id: string;
    week_id: string;
    brand: string;
    terms: string;
    brief_url: string;
    bid_usd: number;
    kind: "place" | "raise";
    expected_amount_usd: number;
    currency: string;
    provider_product_id: string;
    provider_checkout_id: string | null;
    provider_checkout_url: string | null;
    status: string;
    failure_code: string | null;
    failure_message: string | null;
    created_at: string;
    updated_at: string;
  }>;

  withMigrationForeignKeys(db, () => {
    db.transaction(() => {
      db.exec(`
      DROP INDEX IF EXISTS checkout_intents_provider_checkout;
      DROP INDEX IF EXISTS checkout_intents_status;
      ALTER TABLE checkout_intents RENAME TO checkout_intents_legacy;
      CREATE TABLE checkout_intents (
        intent_id TEXT PRIMARY KEY,
        intent_fingerprint TEXT,
        metadata_fingerprint TEXT,
        week_id TEXT NOT NULL,
        window_key TEXT,
        brand TEXT NOT NULL CHECK (length(brand) BETWEEN 1 AND 80),
        terms TEXT NOT NULL CHECK (length(terms) BETWEEN 1 AND 280),
        brief_url TEXT NOT NULL,
        canonical_url TEXT,
        bid_usd INTEGER NOT NULL CHECK (bid_usd >= 5 AND bid_usd <= 50000),
        target_bid_cents INTEGER,
        quote_base_bid_cents INTEGER,
        charge_cents INTEGER,
        kind TEXT NOT NULL CHECK (kind IN ('place', 'raise')),
        expected_amount_usd INTEGER NOT NULL CHECK (expected_amount_usd >= 1),
        currency TEXT NOT NULL CHECK (currency = 'usd'),
        mode TEXT,
        store_id TEXT,
        product_id TEXT,
        tax_category TEXT,
        provider_product_id TEXT NOT NULL,
        provider_checkout_id TEXT UNIQUE,
        provider_checkout_url TEXT,
        session_id TEXT UNIQUE,
        checkout_url TEXT,
        expires_at TEXT,
        status TEXT NOT NULL CHECK (
          status IN (
            'creating', 'open', 'attached', 'unknown', 'paid', 'canceled',
            'failed', 'rejected', 'reconciliation_required', 'needs_reconciliation'
          )
        ),
        failure_code TEXT,
        failure_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      `);
      const insert = db.prepare(
      `INSERT INTO checkout_intents (
        intent_id, intent_fingerprint, metadata_fingerprint, week_id, window_key,
        brand, terms, brief_url, canonical_url, bid_usd, target_bid_cents,
        quote_base_bid_cents, charge_cents, kind, expected_amount_usd, currency,
        mode, store_id, product_id, tax_category, provider_product_id,
        provider_checkout_id, provider_checkout_url, session_id, checkout_url,
        expires_at, status, failure_code, failure_message, created_at, updated_at
      ) VALUES (
        @intentId, NULL, NULL, @weekId, @windowKey, @brand, @terms, @briefUrl,
        @canonicalUrl, @bidUsd, @targetBidCents, @quoteBaseBidCents,
        @chargeCents, @kind, @expectedAmountUsd, @currency,
        NULL, NULL, NULL, 'digital_goods', @providerProductId,
        @providerCheckoutId, @providerCheckoutUrl, @sessionId, NULL, NULL,
        @status, @failureCode, @failureMessage, @createdAt, @updatedAt
      )`,
      );
      for (const row of legacyRows) {
        insert.run({
        intentId: row.intent_id,
        weekId: row.week_id,
        windowKey: row.week_id,
        brand: row.brand,
        terms: row.terms,
        briefUrl: row.brief_url,
        canonicalUrl: row.brief_url,
        bidUsd: row.bid_usd,
        targetBidCents: row.bid_usd * 100,
        quoteBaseBidCents: 0,
        chargeCents: row.expected_amount_usd * 100,
        kind: row.kind,
        expectedAmountUsd: row.expected_amount_usd,
        currency: row.currency,
        providerProductId: row.provider_product_id,
        providerCheckoutId: row.provider_checkout_id,
        providerCheckoutUrl: row.provider_checkout_url,
        sessionId: row.provider_checkout_id,
        status: row.status,
        failureCode: row.failure_code,
        failureMessage: row.failure_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        });
      }
      db.exec(`
      DROP TABLE checkout_intents_legacy;
      CREATE INDEX checkout_intents_provider_checkout
        ON checkout_intents (provider_checkout_id);
      CREATE INDEX checkout_intents_status ON checkout_intents (status);
      `);
    }).immediate();
  });
}

/** Add audit facts introduced after the first Waffo ledger deployment. */
function migrateWaffoLedger(db: AppDb): void {
  const eventColumns: Array<[string, string]> = [["product_id", "TEXT"]];
  const deliveryColumns: Array<[string, string]> = [
    ["mode", "TEXT"],
    ["store_id", "TEXT"],
    ["product_id", "TEXT"],
  ];
  const missingColumns = (table: string, columns: Array<[string, string]>) => {
    const existing = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map((column) => column.name),
    );
    return columns.filter(([name]) => !existing.has(name));
  };
  const missingEvents = missingColumns("waffo_webhook_events", eventColumns);
  const missingDeliveries = missingColumns(
    "waffo_webhook_deliveries",
    deliveryColumns,
  );
  if (!missingEvents.length && !missingDeliveries.length) return;

  withMigrationForeignKeys(db, () => {
    db.transaction(() => {
      for (const [name, definition] of missingEvents) {
        db.exec(`ALTER TABLE waffo_webhook_events ADD COLUMN ${name} ${definition}`);
      }
      for (const [name, definition] of missingDeliveries) {
        db.exec(`ALTER TABLE waffo_webhook_deliveries ADD COLUMN ${name} ${definition}`);
      }
    }).immediate();
  });
}

let cached: AppDb | undefined;
let cachedPath: string | undefined;

export function getDb(): AppDb {
  const dbPath = defaultDatabasePath();
  if (!cached || cachedPath !== dbPath) {
    cached = openDatabase(dbPath);
    cachedPath = dbPath;
  }
  return cached;
}

export function resetDbCache(): void {
  const previous = cached;
  cached = undefined;
  cachedPath = undefined;
  if (previous?.open) {
    try {
      previous.close();
    } catch {
      // A test or hot-reload caller may already have closed the connection.
    }
  }
}
