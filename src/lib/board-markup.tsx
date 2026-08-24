import React, { type ReactNode } from "react";
import type { RankedListing } from "./rank";

function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function PostBriefHop() {
  return (
    <a
      className="post-brief post-after-open post-after-open-first post-after-open-two post-after-open-three post-after-open-four post-after-open-five"
      href="#claim"
      data-post-brief=""
      data-post-after-open=""
      data-post-after-open-first=""
      data-first-write="post"
      data-post-after-open-two=""
      data-post-after-open-three=""
      data-post-after-open-four=""
      data-post-after-open-five=""
      aria-label="Post a brief after Open brief"
    >
      <span className="post-after-note">after Open brief</span>
      <span className="post-label">Post a brief</span>
      <span className="post-dest">Claim #1</span>
    </a>
  );
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
    <div className="flyers">
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
            <p className="terms" data-terms="">
              <span className="terms-label">Terms</span>
              <span className="terms-copy">{listing.terms}</span>
            </p>
            <a
              className={
                listing.rank === 1
                  ? "brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three open-after-post-four"
                  : "brief-url open-after-terms"
              }
              href={`/r/${listing.id}`}
              data-brief-url={listing.briefUrl}
              data-open-brief=""
              data-open-after-terms=""
              data-first-click={listing.rank === 1 ? "open" : undefined}
              data-open-after-post-first={listing.rank === 1 ? "" : undefined}
              data-first-read={listing.rank === 1 ? "open" : undefined}
              data-open-after-post-two-stamp={listing.rank === 1 ? "" : undefined}
              data-open-after-post-three-stamp={listing.rank === 1 ? "" : undefined}
              data-open-after-post-four-stamp={listing.rank === 1 ? "" : undefined}
              aria-label={`Open brief at ${hostLabel(listing.briefUrl)}`}
            >
              <span className="open-after-note">after Terms</span>
              <span className="open-label">Open brief</span>
              <span className="host">{hostLabel(listing.briefUrl)}</span>
            </a>
            <span className="bid">${listing.bidUsd}</span>
            <span className="clicks" data-clicks={listing.clicks}>
              {listing.clicks} clicks
            </span>
            <span className="brief-url-text">{listing.briefUrl}</span>
          </li>
        ))}
      </ol>
      <PostBriefHop />
    </div>
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
