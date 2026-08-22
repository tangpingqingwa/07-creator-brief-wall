import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

export type AppDb = InstanceType<typeof Database>;

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

export function defaultDatabasePath(): string {
  return process.env.DATABASE_PATH ?? join(process.cwd(), "data", "app.sqlite");
}

export function openDatabase(dbPath: string = defaultDatabasePath()): AppDb {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  if (dbPath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  return db;
}

let cached: AppDb | undefined;
let cachedPath: string | undefined;

export function getDb(): AppDb {
  const dbPath = defaultDatabasePath();
  if (!cached || cachedPath !== dbPath) {
    cached?.close();
    cached = openDatabase(dbPath);
    cachedPath = dbPath;
  }
  return cached;
}
