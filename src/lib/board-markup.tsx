import React, { type ReactNode } from "react";
import type { RankedListing } from "./rank";

export function BoardCards({ listings }: { listings: RankedListing[] }) {
  if (listings.length === 0) {
    return (
      <p className="empty" data-empty-week="true">
        This week’s board is empty. No brand has paid to list a brief yet. We do
        not seed listings or invent follower counts.
      </p>
    );
  }
  return (
    <ol className="cards">
      {listings.map((listing) => (
        <li
          key={listing.id}
          className="card"
          data-rank={listing.rank}
          data-id={listing.id}
          data-brand={listing.brand}
          data-bid={listing.bidUsd}
        >
          <span className="rank">#{listing.rank}</span>
          <span className="brand">{listing.brand}</span>
          <p className="terms">{listing.terms}</p>
          <span className="bid">${listing.bidUsd}</span>
          <span className="clicks" data-clicks={listing.clicks}>
            {listing.clicks} clicks
          </span>
          <a
            className="brief-url"
            href={`/r/${listing.id}`}
            data-brief-url={listing.briefUrl}
          >
            Open brief
          </a>
        </li>
      ))}
    </ol>
  );
}

export function BoardChrome({
  children,
  weekId,
}: {
  children: ReactNode;
  weekId?: string;
}) {
  return (
    <main className="board" data-week-id={weekId}>
      <h1>Creator Brief Wall</h1>
      <p className="lede">This week’s briefs, ranked by money.</p>
      {children}
      <p className="rules-note">
        Rank is the bid. Minimum $5. The board resets Monday 00:00 UTC.{" "}
        <a href="/about">About</a> · <a href="/rules">Rules</a>
      </p>
    </main>
  );
}
