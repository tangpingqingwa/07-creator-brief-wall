import type { AppDb, ListingRow } from "./db";
import { listingFromRow, rankListings, type RankedListing } from "./rank";

/** ISO week in UTC (`YYYY-Www`). Monday 00:00:00.000 UTC starts the new week. */

export type UtcWeek = {
  weekId: string;
  startsAt: string;
  endsAt: string;
};

const DAY_MS = 86_400_000;
const WEEK_ID_RE = /^(\d{4})-W(\d{2})$/;

const LISTING_SELECT = `SELECT id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
         FROM listings`;

/**
 * Operator / test clock. `WEEK_NOW` is an ISO-8601 instant.
 * Reset is a `week_id` query filter, not a delete.
 * Read via `env["WEEK_NOW"]` so `next start` cannot inline a build-time empty
 * value; a Monday roll after restart must see the new clock.
 */
export function nowUtc(env: NodeJS.ProcessEnv = process.env): Date {
  const raw = env["WEEK_NOW"];
  if (raw === undefined || raw.trim() === "") {
    return new Date();
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid WEEK_NOW: ${raw}`);
  }
  return parsed;
}

function utcMidnight(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Monday 00:00:00.000 UTC of the ISO week that contains `now`. */
export function weekStartUtc(now: Date = nowUtc()): Date {
  const start = utcMidnight(now);
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - (day - 1));
  return start;
}

/** Next Monday 00:00:00.000 UTC (exclusive end of the current week). */
export function nextResetUtc(now: Date = nowUtc()): Date {
  return new Date(weekStartUtc(now).getTime() + 7 * DAY_MS);
}

/** ISO week id in UTC, e.g. `2026-W34`. */
export function utcWeekId(now: Date = nowUtc()): string {
  const thursday = utcMidnight(now);
  const day = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(
    ((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
  );
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function currentWeekUtc(now: Date = nowUtc()): UtcWeek {
  const starts = weekStartUtc(now);
  const ends = nextResetUtc(now);
  return {
    weekId: utcWeekId(now),
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString(),
  };
}

export function isoWeekMondayUtc(weekId: string): Date {
  const match = WEEK_ID_RE.exec(weekId);
  if (!match) {
    throw new Error(`invalid weekId: ${weekId}`);
  }
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  return new Date(week1Monday.getTime() + (week - 1) * 7 * DAY_MS);
}

export function previousWeekId(weekId: string = utcWeekId()): string {
  return utcWeekId(new Date(isoWeekMondayUtc(weekId).getTime() - 1));
}

export function isLiveWeekId(
  listingWeekId: string,
  now: Date = nowUtc(),
): boolean {
  return listingWeekId === utcWeekId(now);
}

/** Live board rows: current `weekId` only. Previous weeks stay in the table. */
export function listLiveBoard(
  db: AppDb,
  weekId: string = utcWeekId(),
): RankedListing[] {
  const rows = db
    .prepare(`${LISTING_SELECT} WHERE week_id = ?`)
    .all(weekId) as ListingRow[];
  return rankListings(rows.map(listingFromRow));
}
