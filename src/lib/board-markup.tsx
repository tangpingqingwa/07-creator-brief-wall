import React, { type ReactNode } from "react";
import type { RankedListing } from "./rank";

function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function BoardCards({ listings }: { listings: RankedListing[] }) {
  if (listings.length === 0) {
    return (
      <section className="plaster" aria-label="This week’s wall">
        <p className="empty" data-empty-week="true">
          This week’s board is empty. The plaster is blank.
        </p>
        <p className="empty-hint">
          No seeded briefs. Rank is the bid.
        </p>
      </section>
    );
  }
  return (
    <ol className="cards" aria-label="Paid briefs this week">
      {listings.map((listing) => (
        <li
          key={listing.id}
          className={`card${listing.rank === 1 ? " card-lead" : ""}`}
          data-rank={listing.rank}
          data-id={listing.id}
          data-brand={listing.brand}
          data-bid={listing.bidUsd}
        >
          <span className="tape" aria-hidden="true" />
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
          <span className="host">{hostLabel(listing.briefUrl)}</span>
          <span className="brief-url-text">{listing.briefUrl}</span>
        </li>
      ))}
    </ol>
  );
}

export function BoardChrome({
  children,
  weekId,
  occupied = false,
}: {
  children: ReactNode;
  weekId?: string;
  occupied?: boolean;
}) {
  return (
    <main className="board" data-week-id={weekId}>
      <header className="mast">
        <p className="mast-mark">This week only · UTC</p>
        <h1>Creator Brief Wall</h1>
        <p className="lede">
          This week’s briefs, ranked by money. Creators see who paid to be taken.
        </p>
        <nav className="mast-nav" aria-label="Site">
          <a href="/">Wall</a>
          <a href="/about">About</a>
          <a href="/rules">Rules</a>
        </nav>
      </header>
      <div
        className={occupied ? "wall-stage wall-occupied" : "wall-stage"}
        data-occupied={occupied ? "true" : "false"}
      >
        {children}
      </div>
      <p className="rules-note">
        Rank is the bid. Minimum $5. The board resets Monday 00:00 UTC.{" "}
        <a href="/about">About</a> · <a href="/rules">Rules</a>
      </p>
    </main>
  );
}
