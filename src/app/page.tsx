import type { ListingRow } from "../lib/db";
import { getDb } from "../lib/db";
import { listingFromRow, rankListings } from "../lib/rank";
import { Board } from "./board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function loadRankedListings() {
  const rows = getDb()
    .prepare(
      `SELECT id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
       FROM listings`,
    )
    .all() as ListingRow[];
  return rankListings(rows.map(listingFromRow));
}

export default function HomePage() {
  return <Board listings={loadRankedListings()} />;
}
