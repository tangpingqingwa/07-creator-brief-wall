import { randomBytes } from "node:crypto";
import type { AppDb } from "./db";
import { place, raise, type Listing } from "./rank";

/** Test-only fixture money. Not a Waffo client. Do not call from production routes. */
export const TEST_ONLY_FIXTURE = true;

export type FixtureListingInput = {
  id?: string;
  weekId: string;
  brand: string;
  terms: string;
  briefUrl: string;
  bidUsd: number;
  clicks?: number;
  createdAt: string;
  updatedAt?: string;
};

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function insertFixtureListing(
  db: AppDb,
  input: FixtureListingInput,
): Listing {
  const check = place(input.bidUsd);
  if (!check.ok) {
    throw new Error(check.error);
  }
  const id = input.id ?? newId("lst");
  const updatedAt = input.updatedAt ?? input.createdAt;
  const clicks = input.clicks ?? 0;
  db.prepare(
    `INSERT INTO listings (
      id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.weekId,
    input.brand,
    input.terms,
    input.briefUrl,
    null,
    input.bidUsd,
    clicks,
    input.createdAt,
    updatedAt,
  );
  db.prepare(
    `INSERT INTO payments (
      id, listing_id, week_id, brief_url, amount_usd, kind, status, polar_checkout_id, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId("pay"),
    id,
    input.weekId,
    input.briefUrl,
    input.bidUsd,
    "place",
    "completed",
    null,
    input.createdAt,
    input.createdAt,
  );
  return {
    id,
    weekId: input.weekId,
    brand: input.brand,
    terms: input.terms,
    briefUrl: input.briefUrl,
    bidUsd: input.bidUsd,
    clicks,
    createdAt: input.createdAt,
    updatedAt,
  };
}

export function raiseFixtureListing(
  db: AppDb,
  listing: Listing,
  newBidUsd: number,
  updatedAt: string,
): Listing {
  const check = raise(listing, newBidUsd);
  if (!check.ok) {
    throw new Error(check.error);
  }
  db.prepare(
    `UPDATE listings SET bid_usd = ?, updated_at = ? WHERE id = ?`,
  ).run(newBidUsd, updatedAt, listing.id);
  db.prepare(
    `INSERT INTO payments (
      id, listing_id, week_id, brief_url, amount_usd, kind, status, polar_checkout_id, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId("pay"),
    listing.id,
    listing.weekId,
    listing.briefUrl,
    check.chargeUsd,
    "raise",
    "completed",
    null,
    updatedAt,
    updatedAt,
  );
  return { ...listing, bidUsd: newBidUsd, updatedAt };
}
