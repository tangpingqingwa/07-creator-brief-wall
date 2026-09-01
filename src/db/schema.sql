-- Portable SQLite / Postgres-friendly DDL. Honest listing + payment fields only.

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  week_id TEXT NOT NULL,
  brand TEXT NOT NULL CHECK (length(brand) BETWEEN 1 AND 80),
  terms TEXT NOT NULL CHECK (length(terms) BETWEEN 1 AND 280),
  brief_url TEXT NOT NULL,
  platforms TEXT,
  bid_usd INTEGER NOT NULL CHECK (bid_usd >= 5 AND bid_usd <= 50000),
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (week_id, brief_url)
);

-- listing_id is set when a completed payment claims rank; unpaid rows stay off the board
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  listing_id TEXT,
  week_id TEXT NOT NULL,
  brief_url TEXT NOT NULL,
  amount_usd INTEGER NOT NULL CHECK (amount_usd >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('place', 'raise')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'canceled')),
  polar_checkout_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (listing_id) REFERENCES listings (id)
);

-- Draft for an open Waffo / fixture session. Rank is written only after paid.
CREATE TABLE IF NOT EXISTS checkout_drafts (
  checkout_id TEXT PRIMARY KEY,
  week_id TEXT NOT NULL,
  brand TEXT NOT NULL CHECK (length(brand) BETWEEN 1 AND 80),
  terms TEXT NOT NULL CHECK (length(terms) BETWEEN 1 AND 280),
  brief_url TEXT NOT NULL,
  bid_usd INTEGER NOT NULL CHECK (bid_usd >= 5 AND bid_usd <= 50000),
  status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'canceled')),
  listing_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (listing_id) REFERENCES listings (id)
);

-- Durable local payment intent. The normalized draft, quote and provider
-- boundary are immutable facts; only provider attachment/state fields move.
CREATE TABLE IF NOT EXISTS checkout_intents (
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

-- Provider identity is part of the local checkout session, never webhook metadata.
CREATE TABLE IF NOT EXISTS checkout_provider_sessions (
  checkout_id TEXT PRIMARY KEY,
  provider_product_id TEXT NOT NULL,
  FOREIGN KEY (checkout_id) REFERENCES checkout_drafts (checkout_id) ON DELETE CASCADE
);

-- Legacy compatibility ledger for older deliveries. New Waffo events use the
-- append-only ledgers below; event_id remains the old delivery identity.
CREATE TABLE IF NOT EXISTS polar_webhook_events (
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
  status TEXT NOT NULL CHECK (status IN ('applied', 'rejected', 'reconciliation_required')),
  outcome_code TEXT NOT NULL,
  outcome_message TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS listings_week_rank
  ON listings (week_id, bid_usd DESC, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS payments_listing_status
  ON payments (listing_id, status);

CREATE INDEX IF NOT EXISTS checkout_drafts_status
  ON checkout_drafts (status);

CREATE INDEX IF NOT EXISTS checkout_intents_provider_checkout
  ON checkout_intents (provider_checkout_id);

CREATE INDEX IF NOT EXISTS checkout_intents_status
  ON checkout_intents (status);

-- Waffo delivery ledger is split into business events and deliveries. A
-- business event is unique by provider event identity/payment/order/intent;
-- deliveries retain every distinct delivery id so exact retries are no-ops
-- without sacrificing an auditable rejection.
CREATE TABLE IF NOT EXISTS waffo_webhook_events (
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payment_id TEXT UNIQUE,
  order_id TEXT UNIQUE,
  intent_id TEXT UNIQUE,
  delivery_id TEXT,
  mode TEXT,
  store_id TEXT,
  product_id TEXT,
  payload_hash TEXT NOT NULL,
  event_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'rejected', 'reconciliation_required')),
  outcome_code TEXT NOT NULL,
  outcome_message TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  PRIMARY KEY (event_type, event_id)
);

CREATE TABLE IF NOT EXISTS waffo_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payment_id TEXT,
  order_id TEXT,
  intent_id TEXT,
  mode TEXT,
  store_id TEXT,
  product_id TEXT,
  payload_hash TEXT NOT NULL,
  event_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'rejected', 'reconciliation_required')),
  outcome_code TEXT NOT NULL,
  outcome_message TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS waffo_webhook_events_intent
  ON waffo_webhook_events (intent_id);

CREATE INDEX IF NOT EXISTS waffo_webhook_deliveries_event
  ON waffo_webhook_deliveries (event_type, event_id);

-- A reused delivery ID cannot overwrite its original accepted/rejected row.
-- Keep a separate append-only attempt record for a changed signed payload so
-- the replay rejection remains auditable without rolling event identity back.
CREATE TABLE IF NOT EXISTS waffo_webhook_attempts (
  attempt_id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payment_id TEXT,
  order_id TEXT,
  intent_id TEXT,
  mode TEXT,
  store_id TEXT,
  product_id TEXT,
  payload_hash TEXT NOT NULL,
  event_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'rejected', 'reconciliation_required')),
  outcome_code TEXT NOT NULL,
  outcome_message TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS waffo_webhook_attempts_delivery
  ON waffo_webhook_attempts (delivery_id);

CREATE INDEX IF NOT EXISTS polar_webhook_events_checkout
  ON polar_webhook_events (checkout_id);

CREATE INDEX IF NOT EXISTS polar_webhook_events_order
  ON polar_webhook_events (order_id);
