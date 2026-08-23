import type { AppDb, ListingRow } from "./db";
import { listingFromRow, type Listing } from "./rank";
import { outboundBriefUrl } from "./urls";

export class ClickError extends Error {
  readonly httpStatus: number;

  constructor(
    readonly code: "listing_not_found" | "invalid_url",
    httpStatus: number,
    message: string = code,
  ) {
    super(message);
    this.name = "ClickError";
    this.httpStatus = httpStatus;
  }
}

export type ClickHop = {
  listing: Listing;
  url: string;
};

const LISTING_SELECT = `SELECT id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
         FROM listings`;

function loadListing(db: AppDb, listingId: string): Listing | undefined {
  const row = db
    .prepare(`${LISTING_SELECT} WHERE id = ?`)
    .get(listingId) as ListingRow | undefined;
  return row ? listingFromRow(row) : undefined;
}

function outboundHop(listing: Listing): string {
  try {
    return outboundBriefUrl(listing.briefUrl);
  } catch {
    throw new ClickError("invalid_url", 400, "brief URL is not a valid https URL");
  }
}

/** Load a listing for the confirm sheet. Does not count a click. */
export function getPublicListing(db: AppDb, listingId: string): Listing {
  const id = listingId.trim();
  const listing = id ? loadListing(db, id) : undefined;
  if (!listing) {
    throw new ClickError("listing_not_found", 404);
  }
  outboundHop(listing);
  return listing;
}

/**
 * One increment per successful redirect decision. 302 target is the stored
 * canonical brief URL; we never add trackers. GET confirm does not call this.
 */
export function incrementPublicClick(db: AppDb, listingId: string): ClickHop {
  const listing = getPublicListing(db, listingId);
  const url = outboundHop(listing);

  db.prepare(`UPDATE listings SET clicks = clicks + 1 WHERE id = ?`).run(listing.id);
  const updated = loadListing(db, listing.id);
  if (!updated) {
    throw new ClickError("listing_not_found", 404);
  }
  return { listing: updated, url };
}
