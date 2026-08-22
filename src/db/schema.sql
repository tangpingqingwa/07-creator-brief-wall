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

CREATE INDEX IF NOT EXISTS listings_week_rank
  ON listings (week_id, bid_usd DESC, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS payments_listing_status
  ON payments (listing_id, status);
