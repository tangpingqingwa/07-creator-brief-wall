import React, { type ReactNode } from "react";
import {
  isPolarPaidListing,
  rankListings,
  type RankedListing,
} from "./rank";

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
      className="post-brief post-after-open post-after-open-first post-after-open-two post-after-open-three post-after-open-four post-after-open-five post-after-open-six"
      href="#claim"
      data-post-brief=""
      data-post-after-open=""
      data-post-after-open-first=""
      data-first-write="post"
      data-post-after-open-two=""
      data-post-after-open-three=""
      data-post-after-open-four=""
      data-post-after-open-five=""
      data-post-after-open-six=""
      aria-label="Post a brief after Open brief"
    >
      <span className="post-after-note">after Open brief</span>
      <span className="post-label">Post a brief</span>
      <span className="post-dest">Claim #1</span>
    </a>
  );
}

function OpenBriefHop({ listing }: { listing: RankedListing }) {
  const host = hostLabel(listing.briefUrl);
  if (listing.rank === 1) {
    return (
      <a
        className="brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three open-after-post-four open-after-post-five"
        href={`/r/${listing.id}`}
        data-brief-url={listing.briefUrl}
        data-open-brief=""
        data-open-after-terms=""
        data-first-click="open"
        data-open-after-post-first=""
        data-first-read="open"
        data-open-after-post-two-stamp=""
        data-open-after-post-three-stamp=""
        data-open-after-post-four-stamp=""
        data-open-after-post-five-stamp=""
        aria-label={`Open brief at ${host}`}
      >
        <span className="open-after-note">after Terms</span>
        <span className="open-label">Open brief</span>
        <span className="host">{host}</span>
      </a>
    );
  }
  return (
    <a
      className="brief-url later-open"
      href={`/r/${listing.id}`}
      data-brief-url={listing.briefUrl}
      data-open-brief=""
      data-later-open=""
      aria-label={`Open brief at ${host}`}
    >
      <span className="open-label">Open brief</span>
      <span className="host">{host}</span>
    </a>
  );
}

function OccupiedLeadFlyer({ listing }: { listing: RankedListing }) {
  if (!isPolarPaidListing(listing)) {
    return null;
  }
  const lead = true;
  const hop = <OpenBriefHop listing={listing} />;
  return (
    <li
      className="card card-lead"
      data-rank={listing.rank}
      data-id={listing.id}
      data-brand={listing.brand}
      data-bid={listing.bidUsd}
      data-polar-paid=""
    >
      <span className="tape" aria-hidden="true" />
      <span className="rank">#{listing.rank}</span>
      <span className="brand">{listing.brand}</span>
      <p
        className="terms prize-before-price"
        data-terms=""
        data-prize=""
        data-prize-before-price=""
      >
        <span className="terms-label">Terms</span>
        <span className="terms-copy">{listing.terms}</span>
      </p>
      {lead ? hop : null}
      <span className="bid later-fact" data-later-fact="">
        ${listing.bidUsd}
      </span>
      <span className="clicks later-fact" data-clicks={listing.clicks} data-later-fact="">
        {listing.clicks} clicks
      </span>
      <span className="brief-url-text">{listing.briefUrl}</span>
    </li>
  );
}

function OccupiedLaterFlyer({ listing }: { listing: RankedListing }) {
  if (!isPolarPaidListing(listing)) {
    return null;
  }
  const lead = false;
  const hop = <OpenBriefHop listing={listing} />;
  return (
    <li
      className="card later-flyer"
      data-rank={listing.rank}
      data-id={listing.id}
      data-brand={listing.brand}
      data-bid={listing.bidUsd}
      data-later-flyer=""
      data-polar-paid=""
    >
      <p className="later-rankline">
        <span className="rank">#{listing.rank}</span>
        <span className="brand later-brand">{listing.brand}</span>
      </p>
      <div className="later-slip">
        <p className="later-terms" data-terms="">
          <span className="later-terms-kicker">Terms</span>
          <span className="later-terms-copy">{listing.terms}</span>
        </p>
        <p className="later-foot">
          <span className="bid">${listing.bidUsd}</span>
          <span className="clicks" data-clicks={listing.clicks}>
            {listing.clicks} clicks
          </span>
        </p>
        {lead ? null : hop}
      </div>
      <span className="brief-url-text">{listing.briefUrl}</span>
    </li>
  );
}

export function OccupiedFlyers({ listings }: { listings: RankedListing[] }) {
  const paid = rankListings(listings);
  const lead = paid.find((listing) => listing.rank === 1);
  const later = paid.filter((listing) => listing.rank !== 1);
  if (!lead) {
    return null;
  }
  return (
    <div className="flyers">
      <ol
        className="cards cards-lead"
        aria-label="Paid briefs this week"
        data-rolling-week=""
      >
        <OccupiedLeadFlyer key={lead.id} listing={lead} />
      </ol>
      {later.length > 0 ? (
        <section className="later-pack" data-later-pack="">
          <p className="later-note">These flyers are not this week’s #1 prize</p>
          <ol className="cards cards-later" aria-label="Later briefs this week">
            {later.map((listing) => (
              <OccupiedLaterFlyer key={listing.id} listing={listing} />
            ))}
          </ol>
        </section>
      ) : null}
      <PostBriefHop />
    </div>
  );
}

export function BoardCards({ listings }: { listings: RankedListing[] }) {
  const paid = rankListings(listings);
  if (paid.length === 0) {
    return (
      <section className="plaster" aria-label="This week’s wall">
        <p className="empty" data-empty-week="true">
          This week’s board is empty. The plaster is blank.
        </p>
        <p className="empty-hint" data-empty-window="">
          No seeded briefs. Rank is the bid. Live window is rolling last 7 days from paid placement. Not Monday 00:00 UTC. Unpaid checkout stays off the board until Polar reports paid. An abandoned brief is not Terms as #1.
        </p>
      </section>
    );
  }
  return <OccupiedFlyers listings={paid} />;
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
        className={
          occupied ? "wall-stage wall-occupied" : "wall-stage wall-empty"
        }
        data-occupied={occupied ? "true" : "false"}
      >
        {children}
      </div>
      <p
        className={occupied ? "rules-note week-window" : "rules-note empty-window"}
        data-empty-window={occupied ? undefined : ""}
      >
        Rank is the bid. Minimum $5.{" "}
        {occupied
          ? "Rolling last 7 days. Not Monday 00:00 UTC."
          : "Live window is rolling last 7 days from paid placement. Not Monday 00:00 UTC."}{" "}
        <a href="/about">About</a> · <a href="/rules">Rules</a>
      </p>
    </main>
  );
}
