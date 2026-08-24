import type { ListingRow } from "./db";

export const MIN_BID_USD = 5;
export const MAX_BID_USD = 50_000;

export type Platform = "tiktok" | "youtube" | "instagram" | "twitch";

export type Listing = {
  id: string;
  weekId: string;
  brand: string;
  terms: string;
  briefUrl: string;
  platforms?: Platform[];
  bidUsd: number;
  clicks: number;
  createdAt: string;
  updatedAt: string;
};

export type RankedListing = Listing & { rank: number };

export type PlaceResult =
  | { ok: true; bidUsd: number }
  | { ok: false; error: string };

export type RaiseResult =
  | { ok: true; newBidUsd: number; chargeUsd: number }
  | { ok: false; error: string };

export type CheckoutQuote =
  | { ok: true; kind: "place"; bidUsd: number; chargeUsd: number }
  | {
      ok: true;
      kind: "raise";
      bidUsd: number;
      chargeUsd: number;
      currentBidUsd: number;
    }
  | { ok: false; error: string };

const PLATFORMS = new Set<Platform>([
  "tiktok",
  "youtube",
  "instagram",
  "twitch",
]);

export function listingFromRow(row: ListingRow): Listing {
  return {
    id: row.id,
    weekId: row.week_id,
    brand: row.brand,
    terms: row.terms,
    briefUrl: row.brief_url,
    platforms: parsePlatforms(row.platforms),
    bidUsd: row.bid_usd,
    clicks: row.clicks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parsePlatforms(raw: string | null): Platform[] | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    const platforms = parsed.filter(
      (value): value is Platform =>
        typeof value === "string" && PLATFORMS.has(value as Platform),
    );
    return platforms.length > 0 ? platforms : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Polar (or the fixture) has reported paid. Empty / epoch / unpaid
 * checkout never ranks and must not paint Terms as #1.
 */
export function isPolarPaidListing(
  listing: Pick<Listing, "createdAt">,
): boolean {
  const paidAt = listing.createdAt?.trim() ?? "";
  if (!paidAt) {
    return false;
  }
  const ms = Date.parse(paidAt);
  return Number.isFinite(ms) && ms > Date.parse("1970-01-01T00:00:00.000Z");
}

/** Paid rows only. Unpaid or abandoned checkouts never take a rank. */
export function paidListings<T extends Pick<Listing, "createdAt">>(
  listings: readonly T[],
): T[] {
  return listings.filter(isPolarPaidListing);
}

/** Rank is the bid. Equal bids: older createdAt, then lower id. Polar-paid only. */
export function rankListings(listings: readonly Listing[]): RankedListing[] {
  const ordered = [...paidListings(listings)].sort((a, b) => {
    if (a.bidUsd !== b.bidUsd) {
      return b.bidUsd - a.bidUsd;
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? -1 : 1;
    }
    if (a.id !== b.id) {
      return a.id < b.id ? -1 : 1;
    }
    return 0;
  });
  return ordered.map((listing, index) => ({ ...listing, rank: index + 1 }));
}

/** Same week + brief URL raises. A new URL always pays a full bid. */
export function quoteCheckout(
  existing: Pick<Listing, "bidUsd"> | undefined,
  newBid: number,
): CheckoutQuote {
  if (!existing) {
    const check = place(newBid);
    if (!check.ok) {
      return check;
    }
    return {
      ok: true,
      kind: "place",
      bidUsd: check.bidUsd,
      chargeUsd: check.bidUsd,
    };
  }
  const check = raise(existing, newBid);
  if (!check.ok) {
    return check;
  }
  return {
    ok: true,
    kind: "raise",
    bidUsd: check.newBidUsd,
    chargeUsd: check.chargeUsd,
    currentBidUsd: existing.bidUsd,
  };
}

/**
 * Taking #1 from someone else requires a bid strictly above the current top.
 * Equal to the top keeps the older listing higher (SPEC §6.4–5).
 */
export function takesNumberOne(
  newBidUsd: number,
  topBidUsd: number | undefined,
): boolean {
  if (topBidUsd === undefined) {
    return newBidUsd >= MIN_BID_USD;
  }
  return newBidUsd >= topBidUsd + 1;
}

/** Empty week: $5 claims #1. Occupied week: one dollar above the current top. */
export function claimNumberOneUsd(topBidUsd: number | undefined): number {
  if (topBidUsd === undefined) {
    return MIN_BID_USD;
  }
  return Math.min(MAX_BID_USD, topBidUsd + 1);
}

export function place(bidUsd: number): PlaceResult {
  if (!Number.isInteger(bidUsd)) {
    return { ok: false, error: "Bid must be a whole US dollar amount" };
  }
  if (bidUsd < MIN_BID_USD) {
    return { ok: false, error: `Minimum bid is $${MIN_BID_USD}` };
  }
  if (bidUsd > MAX_BID_USD) {
    return { ok: false, error: `Maximum bid is $${MAX_BID_USD}` };
  }
  return { ok: true, bidUsd };
}

export function raise(
  listing: Pick<Listing, "bidUsd">,
  newBid: number,
): RaiseResult {
  if (!Number.isInteger(newBid)) {
    return { ok: false, error: "Bid must be a whole US dollar amount" };
  }
  if (newBid < listing.bidUsd + 1) {
    return {
      ok: false,
      error: "New bid must be at least $1 above the current bid",
    };
  }
  if (newBid > MAX_BID_USD) {
    return { ok: false, error: `Maximum bid is $${MAX_BID_USD}` };
  }
  return {
    ok: true,
    newBidUsd: newBid,
    chargeUsd: newBid - listing.bidUsd,
  };
}
