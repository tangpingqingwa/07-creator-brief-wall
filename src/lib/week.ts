import type { AppDb, ListingRow } from "./db";
import {
  isPolarPaidListing,
  listingFromRow,
  rankListings,
  type RankedListing,
} from "./rank";

/**
 * Public wall window is rolling last 7 days from paid placement.
 * ISO `weekId` (`YYYY-Www`) remains a Monday 00:00 UTC Polar/audit label.
 * Rank does not expire at civil Monday midnight.
 */

export type UtcWeek = {
  weekId: string;
  startsAt: string;
  endsAt: string;
};

const DAY_MS = 86_400_000;
/** Inclusive length of the public week window. Not a Monday midnight bucket. */
export const ROLLING_WEEK_MS = 7 * DAY_MS;
const WEEK_ID_RE = /^(\d{4})-W(\d{2})$/;

const LISTING_SELECT = `SELECT id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
         FROM listings`;

/** Split so Next/webpack cannot replace `process.env.WEEK_NOW` at build time. */
const WEEK_NOW_KEY = ["WEEK", "NOW"].join("_");

/**
 * Operator / test clock. `WEEK_NOW` is an ISO-8601 instant.
 * Live rank is a rolling last-7-days filter on `created_at`, not a delete.
 */
export function nowUtc(env: NodeJS.ProcessEnv = process.env): Date {
  const raw = env[WEEK_NOW_KEY];
  if (raw === undefined || raw.trim() === "") {
    return new Date();
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid ${WEEK_NOW_KEY}: ${raw}`);
  }
  return parsed;
}

function utcMidnight(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Monday 00:00:00.000 UTC of the ISO week that contains `now`. Audit label only. */
export function weekStartUtc(now: Date = nowUtc()): Date {
  const start = utcMidnight(now);
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - (day - 1));
  return start;
}

/** Next Monday 00:00:00.000 UTC. Label boundary, not public rank expiry. */
export function nextResetUtc(now: Date = nowUtc()): Date {
  return new Date(weekStartUtc(now).getTime() + 7 * DAY_MS);
}

/** Inclusive start of the rolling last-7-days window. Not civil midnight. */
export function rollingWeekStart(now: Date = nowUtc()): Date {
  return new Date(now.getTime() - ROLLING_WEEK_MS);
}

/** Paid placement still inside the rolling last-7-days window. */
export function bidInRollingWeek(
  paidAt: string,
  now: Date = nowUtc(),
): boolean {
  const paid = Date.parse(paidAt);
  if (Number.isNaN(paid)) {
    return false;
  }
  const t = now.getTime();
  return paid >= t - ROLLING_WEEK_MS && paid <= t;
}

/** ISO week id in UTC, e.g. `2026-W34`. Polar/audit label, not the live filter. */
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
  const starts = rollingWeekStart(now);
  const ends = new Date(now.getTime() + 1);
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

/** Polar (or the fixture) wrote a completed payment for this listing. */
export function hasCompletedPolarPayment(
  db: AppDb,
  listingId: string,
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM payments
       WHERE listing_id = ? AND status = 'completed' LIMIT 1`,
    )
    .get(listingId) as { ok: number } | undefined;
  return Boolean(row);
}

/**
 * Live board rows: Polar-paid `created_at` in the rolling last 7 days.
 * Unpaid / abandoned checkout never occupies the plaster.
 * `weekId` stays an audit label. Rows stay in the table after they age out.
 */
export function listLiveBoard(
  db: AppDb,
  now: Date = nowUtc(),
): RankedListing[] {
  const since = rollingWeekStart(now).toISOString();
  const until = now.toISOString();
  const rows = db
    .prepare(
      `${LISTING_SELECT}
       WHERE created_at >= ? AND created_at <= ?
         AND EXISTS (
           SELECT 1 FROM payments
           WHERE payments.listing_id = listings.id
             AND payments.status = 'completed'
         )`,
    )
    .all(since, until) as ListingRow[];
  return rankListings(
    rows
      .map(listingFromRow)
      .filter(
        (row) =>
          isPolarPaidListing(row) && bidInRollingWeek(row.createdAt, now),
      ),
  );
}

/** Same canonical brief URL still live in the rolling window is a raise. */
export function findLiveListingByBrief(
  db: AppDb,
  briefUrl: string,
  now: Date = nowUtc(),
): ReturnType<typeof listingFromRow> | undefined {
  return listLiveBoard(db, now).find((row) => row.briefUrl === briefUrl);
}
