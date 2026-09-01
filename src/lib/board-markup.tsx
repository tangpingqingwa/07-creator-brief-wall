import React, { type ReactNode } from "react";
import {
  isWaffoPaidListing,
  rankListings,
  type Platform,
  type RankedListing,
} from "./rank";

function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const FIND_RESULT_LIMIT = 6;

/** Search stays a small pure helper for integrations; the wall itself has no search chrome. */
export function findPaidBriefs(
  listings: readonly RankedListing[],
  query: string,
): RankedListing[] {
  const normalized = query.trim().toLocaleLowerCase();
  const paid = listings.filter((listing) => isWaffoPaidListing(listing));
  if (!normalized) {
    return paid.slice(0, FIND_RESULT_LIMIT);
  }
  const terms = normalized.split(/\s+/).filter(Boolean);
  return paid
    .filter((listing) => {
      const searchable = [
        listing.brand,
        hostLabel(listing.briefUrl),
        listing.terms,
      ]
        .join(" ")
        .toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    })
    .slice(0, FIND_RESULT_LIMIT);
}

const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  instagram: "Instagram",
  twitch: "Twitch",
};

function PlatformLanes({ listing }: { listing: RankedListing }) {
  const platforms = listing.platforms?.filter(
    (platform, index, all) => all.indexOf(platform) === index,
  );
  if (!platforms || platforms.length === 0) {
    return null;
  }
  return (
    <ul className="platform-lanes" data-platform-lanes="" aria-label="Creator platforms">
      {platforms.map((platform) => (
        <li className="platform-lane" data-platform={platform} key={platform}>
          {PLATFORM_LABELS[platform]}
        </li>
      ))}
    </ul>
  );
}

function PostBriefLink() {
  return (
    <a
      className="post-brief"
      href="#claim"
      data-post-brief=""
      data-first-write="post"
      aria-label="Post a brief"
    >
      <span className="post-label">Post a brief</span>
      <span className="post-dest">Claim #1</span>
    </a>
  );
}

function OpenBriefLink({ listing }: { listing: RankedListing }) {
  const host = hostLabel(listing.briefUrl);
  if (listing.rank === 1) {
    return (
      <a
        className="brief-url"
        data-slot="card-action"
        href={`/r/${listing.id}`}
        data-brief-url={listing.briefUrl}
        data-open-brief=""
        data-first-click="open"
        data-first-read="open"
        aria-label={`Open brief at ${host}`}
      >
        <span className="open-label">Open brief</span>
        <span className="host">{host}</span>
      </a>
    );
  }
  return (
    <a
      className="brief-url later-open"
      data-slot="card-action"
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
  if (!isWaffoPaidListing(listing)) {
    return null;
  }
  const lead = true;
  const openBriefLink = <OpenBriefLink listing={listing} />;
  return (
    <li
      className="card card-lead"
      data-slot="paid-card"
      data-rank={listing.rank}
      data-id={listing.id}
      data-brand={listing.brand}
      data-bid={listing.bidUsd}
      data-waffo-paid=""
    >
      <span className="tape" aria-hidden="true" />
      <span className="rank">#{listing.rank}</span>
      <span className="brand">{listing.brand}</span>
      <PlatformLanes listing={listing} />
      <p
        className="terms prize-before-price"
        data-terms=""
        data-prize=""
        data-prize-before-price=""
      >
        <span className="terms-label">Terms</span>
        <span className="terms-copy">{listing.terms}</span>
      </p>
      {lead ? openBriefLink : null}
      <span className="bid later-fact" data-later-fact="">
        ${listing.bidUsd}
      </span>
      <span
        className="clicks later-fact"
        data-clicks={listing.clicks}
        data-later-fact=""
      >
        {listing.clicks} clicks
      </span>
      <span className="brief-url-text">{listing.briefUrl}</span>
    </li>
  );
}

function OccupiedLaterFlyer({ listing }: { listing: RankedListing }) {
  if (!isWaffoPaidListing(listing)) {
    return null;
  }
  const lead = false;
  const openBriefLink = <OpenBriefLink listing={listing} />;
  return (
    <li
      className="card later-flyer"
      data-slot="paid-card"
      data-rank={listing.rank}
      data-id={listing.id}
      data-brand={listing.brand}
      data-bid={listing.bidUsd}
      data-later-flyer=""
      data-waffo-paid=""
    >
      <span className="rank">#{listing.rank}</span>
      <span className="brand later-brand">{listing.brand}</span>
      <PlatformLanes listing={listing} />
      <p className="later-terms" data-terms="">
        <span className="later-terms-kicker">Terms</span>
        <span className="later-terms-copy">{listing.terms}</span>
      </p>
      <span className="bid">${listing.bidUsd}</span>
      <span className="clicks" data-clicks={listing.clicks}>
        {listing.clicks} clicks
      </span>
      {lead ? null : openBriefLink}
      <span className="brief-url-text">{listing.briefUrl}</span>
    </li>
  );
}

export function OccupiedFlyers({ listings }: { listings: RankedListing[] }) {
  const paid = rankListings(listings);
  const [lead, ...later] = paid;
  if (!lead) {
    return null;
  }
  return (
    <div className="flyers" data-slot="paid-listings">
      <section
        className="top-three"
        data-slot="top-three"
        data-top-three=""
        aria-label="Top paid creator briefs"
      >
        <ol
          className="cards cards-lead"
          data-slot="top-three-list"
          aria-label="Paid briefs — rolling last 7 days"
          data-rolling-week=""
        >
          <OccupiedLeadFlyer key={lead.id} listing={lead} />
        </ol>
        {later.length > 0 ? (
          <section
            className="later-pack"
            data-slot="later-list"
            data-later-pack=""
          >
            <p className="later-note">
              These flyers are not #1 in the rolling last 7 days. They are still paid creator briefs.
            </p>
            <ol
              className="cards cards-later"
              data-slot="later-list"
              aria-label="Later briefs — rolling last 7 days"
            >
              {later.map((listing) => (
                <OccupiedLaterFlyer key={listing.id} listing={listing} />
              ))}
            </ol>
          </section>
        ) : null}
      </section>
      <PostBriefLink />
    </div>
  );
}

export function BoardCards({ listings }: { listings: RankedListing[] }) {
  const paid = rankListings(listings);
  if (paid.length === 0) {
    return (
      <section
        className="plaster"
        data-slot="empty-state"
        aria-label="Rolling last 7 days of paid briefs"
      >
        <p className="empty" data-empty-week="true">
          The rolling last 7 days board is empty. The plaster is blank.
        </p>
        <details className="empty-details">
          <summary>About the rolling window</summary>
          <p className="empty-hint" data-empty-window="">
            Rank is the bid. Each confirmed placement remains eligible for
            seven days, and the wall does not reset for everyone at Monday
            midnight. An incomplete checkout never creates a #1 brief.
          </p>
        </details>
      </section>
    );
  }
  return <OccupiedFlyers listings={paid} />;
}

export function HomeRail() {
  return (
    <nav
      className="home-rail"
      data-slot="wall-shortcuts"
      aria-label="Brief wall shortcuts"
    >
      <a className="home-rail-item home-rail-active" href="/">
        <span>All briefs</span>
      </a>
      <a className="home-rail-item" href="/about">
        <span>How it works</span>
      </a>
      <a className="home-rail-item" href="/rules">
        <span>Rules</span>
      </a>
    </nav>
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
    <main
      className="board creator-wall"
      data-slot="wall-shell"
      data-week-id={weekId}
      data-theme="light"
      data-identity="plaster-flyers"
    >
      <header className="mast wall-mast" data-slot="site-header">
        <a
          className="wall-brand"
          data-slot="brand"
          href="/"
          aria-label="Creator Brief Wall home"
        >
          <img
            className="brand-mark"
            src="/brand-mark.svg"
            width="28"
            height="28"
            alt=""
            aria-hidden="true"
          />
          Creator Brief Wall
        </a>
        <p className="mast-mark">Rolling last 7 days · UTC</p>
        <nav className="mast-nav" data-slot="primary-nav" aria-label="Site">
          <a className="mast-wall-link" href="/">
            Wall
          </a>
          <a href="/about">About</a>
          <a href="/rules">Rules</a>
        </nav>
        <h1>Creator Brief Wall</h1>
        <p className="lede">
          Paid briefs from the rolling last 7 days, ranked by money. Creators see who paid to be taken. Read the terms before you open the brief.
        </p>
      </header>
      <div
        className="wall-context"
        data-slot="wall-context"
        aria-label="Current board context"
      >
        <p className="wall-window" data-slot="wall-window">
          <span>Live wall</span>
          <span aria-hidden="true">·</span>
          <span>rolling 7 days · paid placement</span>
        </p>
      </div>
      <div
        className={
          occupied ? "wall-stage wall-occupied" : "wall-stage wall-empty"
        }
        data-slot="wall-content"
        id="wall"
        data-occupied={occupied ? "true" : "false"}
      >
        {children}
      </div>
      <p
        className={occupied ? "rules-note week-window" : "rules-note empty-window"}
        data-empty-window={occupied ? undefined : ""}
      >
        Rank is the bid. Minimum $5. {""}
        {occupied
          ? "Each paid brief stays live for seven days."
          : "Each confirmed brief stays live for seven days."}{" "}
        <a href="/about">About</a> · <a href="/rules">Rules</a>
      </p>
    </main>
  );
}
