import assert from "node:assert/strict";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ClickError,
  getPublicListing as getPublicListingAt,
  incrementPublicClick as incrementPublicClickAt,
} from "../src/lib/clicks";
import { Board } from "../src/app/board";
import {
  claimFloorUsd,
  isBidAmountReady,
} from "../src/app/outbid-form";
import { BoardCards, BoardChrome, OccupiedFlyers } from "../src/lib/board-markup";
import { confirmBriefHtml } from "../src/lib/confirm-brief";
import { openDatabase, type AppDb } from "../src/lib/db";
import {
  claimNumberOneUsd,
  isWaffoPaidListing,
  paidListings,
  rankListings,
  type Listing,
} from "../src/lib/rank";
import { insertFixtureListing } from "../src/lib/test-listings";
import { listLiveBoard, ROLLING_WEEK_MS } from "../src/lib/week";

const WEEK = "2026-W34";
const CONFIRMED_CHECKOUT_COPY =
  /An incomplete checkout never creates a #1 brief|Only a confirmed checkout changes the ranking/;
const formSource = readFileSync(
  join(process.cwd(), "src", "app", "outbid-form.tsx"),
  "utf8",
);
const boardMarkupSource = readFileSync(
  join(process.cwd(), "src", "lib", "board-markup.tsx"),
  "utf8",
);
const layoutSource = readFileSync(
  join(process.cwd(), "src", "app", "layout.tsx"),
  "utf8",
);
const cssSource = readFileSync(
  join(process.cwd(), "src", "app", "board.css"),
  "utf8",
);

function listing(
  partial: Partial<Listing> & Pick<Listing, "id" | "bidUsd" | "createdAt">,
): Listing {
  return {
    weekId: WEEK,
    brand: partial.brand ?? `Brand ${partial.id}`,
    terms: partial.terms ?? `Terms ${partial.id}`,
    briefUrl: partial.briefUrl ?? `https://example.com/${partial.id}`,
    clicks: partial.clicks ?? 0,
    updatedAt: partial.updatedAt ?? partial.createdAt,
    ...partial,
  };
}

function renderBoard(listings: Listing[]): string {
  return renderToStaticMarkup(
    createElement(
      BoardChrome,
      null,
      createElement(
        Fragment,
        null,
        createElement("button", { type: "submit" }, "Outbid"),
        createElement(BoardCards, { listings: rankListings(listings) }),
      ),
    ),
  );
}

const FORBIDDEN =
  /[0-9][0-9,]*\s*(followers|subscribers)|engagement rate|estimated reach|\bcpm\b|avg views/i;

// Most board fixtures use a fixed August 2026 clock. Keep the public-link
// assertions deterministic now that clicks share the live rolling predicate.
const CLICK_NOW = new Date("2026-08-19T00:00:00.000Z");

function getPublicListing(db: AppDb, listingId: string): Listing {
  return getPublicListingAt(db, listingId, CLICK_NOW);
}

function incrementPublicClick(db: AppDb, listingId: string) {
  return incrementPublicClickAt(db, listingId, CLICK_NOW);
}

test("empty board is honest and has the Outbid form fields", () => {
  const html = renderBoard([]);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /<p class="mast-mark">Rolling last 7 days · UTC<\/p>/);
  assert.match(
    html,
    /Paid briefs from the rolling last 7 days, ranked by money\. Creators see who paid to be taken\./,
  );
  assert.match(html, /aria-label="Rolling last 7 days of paid briefs"/);
  assert.match(html, /The rolling last 7 days board is empty\. The plaster is blank\./);
  assert.match(html, /plaster is blank/i);
  assert.match(html, /Outbid/);
  assert.match(formSource, /Claim #1 for/);
  assert.match(formSource, /name="brand"/);
  assert.match(formSource, /name="terms"/);
  assert.match(formSource, /name="briefUrl"/);
  assert.match(formSource, /name="bidUsd"/);
  assert.match(formSource, /Claim rank/);
  assert.match(formSource, /className="amount-stepper"/);
  assert.match(formSource, /className="brief-details-separator"/);
  assert.match(formSource, /aria-hidden="true">\s*·\s*<\/span>/);
  assert.match(formSource, /data-claim-amount/);
  assert.match(formSource, /Blank plaster/);
  assert.match(formSource, /Rolling last 7 days wall/);
  assert.match(boardMarkupSource, /The rolling last 7 days board is empty/);
  assert.match(layoutSource, /Paid briefs from the rolling last 7 days/);
  assert.doesNotMatch(html, FORBIDDEN);
  assert.doesNotMatch(formSource, FORBIDDEN);
});

test("claim strip defaults to the rolling window's real #1 price", () => {
  assert.equal(claimNumberOneUsd(undefined), 5);
  assert.equal(claimNumberOneUsd(7), 8);
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /data-claim-amount="5"/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /\$5 pastes the first flyer at #1/);
  assert.doesNotMatch(empty, /Need \$/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(occupied, /data-claim-amount="8"/);
  assert.match(occupied, /data-top-bid="7"/);
  assert.match(occupied, /Need \$8 to take #1/);
  assert.doesNotMatch(occupied, /Blank plaster/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("claim form keeps required details open and enforces the occupied floor", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(
    empty,
    /<details class="brief-details"[^>]*data-required-fields="" open="">/,
  );
  assert.match(empty, /class="brief-details-required">required/);
  assert.match(empty, /name="brand"/);
  assert.match(empty, /name="terms"/);
  assert.match(empty, /min="5"/);
  assert.equal(claimFloorUsd(5), 5);
  assert.equal(isBidAmountReady(4, claimFloorUsd(5)), false);
  assert.equal(isBidAmountReady(5, claimFloorUsd(5)), true);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      listings: rankListings([
        listing({
          id: "lst_floor",
          bidUsd: 20,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
      ]),
      weekId: WEEK,
    }),
  );
  assert.match(occupied, /data-claim-amount="21"/);
  assert.match(occupied, /data-amount-floor="21"/);
  assert.match(occupied, /data-top-bid="20"/);
  assert.match(occupied, /name="bidUsd"[^>]*value="21"/);
  assert.match(occupied, /type="number"/);
  assert.match(occupied, /min="21"/);
  assert.match(occupied, /aria-label="Decrease bid by one dollar" disabled=""/);
  assert.match(
    occupied,
    /<details class="brief-details"[^>]*data-required-fields="" open="">/,
  );
  assert.equal(claimFloorUsd(5, 20), 21);
  assert.equal(isBidAmountReady(20, claimFloorUsd(5, 20)), false);
  assert.equal(isBidAmountReady(21, claimFloorUsd(5, 20)), true);
  assert.match(formSource, /clampAmount\(current - 1, floor\)/);
  assert.match(formSource, /setAmount\(clampAmount\(next \|\| floor, floor\)\)/);
  assert.match(formSource, /isBidAmountReady\(effectiveAmount, floor\)/);
  assert.match(cssSource, /\.creator-wall \.brief-details\[open\]/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall keeps one obvious Open brief and one quiet Claim #1 route", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /Blank plaster/);
  assert.doesNotMatch(empty, /data-open-brief|data-post-brief|Open brief|Post a brief/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const twoStart = occupied.indexOf('data-id="lst_two"');
  const two = occupied.slice(twoStart, occupied.indexOf("</li>", twoStart));
  const terms = lead.indexOf('data-terms=""');
  const open = lead.indexOf('data-open-brief=""');
  const firstClick = lead.indexOf('data-first-click="open"');
  const bid = lead.indexOf('class="bid later-fact"');
  const clicks = lead.indexOf('data-clicks="0"');
  const post = occupied.indexOf('data-post-brief=""');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(leadStart >= 0 && terms >= 0 && open > terms);
  assert.ok(firstClick >= open);
  assert.ok(bid > open && clicks > bid);
  assert.ok(claim < leadStart && post > twoStart);
  assert.match(lead, /class="brief-url"/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(lead, /aria-label="Open brief at example.com"/);
  assert.match(occupied, /class="post-brief"[^>]*href="#claim"/);
  assert.match(occupied, /aria-label="Post a brief"/);
  assert.match(occupied, /class="post-label">Post a brief/);
  assert.match(occupied, /class="post-dest">Claim #1/);
  assert.match(two, /class="brief-url later-open"/);
  assert.match(two, /data-later-open=""/);
  assert.equal((occupied.match(/data-open-brief=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /after\s+(?:Terms|Open brief)|open-after|post-after/);
  assert.doesNotMatch(cssSource, /open-after|post-after/);
  assert.match(cssSource, /\.wall-occupied a\.post-brief \{/);
  assert.match(cssSource, /\.wall-occupied \.card \.brief-url\[data-first-click="open"\]/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall puts flyers after the claim strip", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  const emptyClaim = empty.indexOf('id="claim"');
  const plaster = empty.indexOf('data-empty-week="true"');
  assert.ok(emptyClaim >= 0 && plaster >= 0);
  assert.ok(emptyClaim < plaster);
  assert.match(empty, /data-occupied="false"/);
  assert.doesNotMatch(empty, /wall-occupied/);
  assert.match(empty, /plaster is blank/i);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const flyers = occupied.indexOf('aria-label="Paid briefs — rolling last 7 days"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && claim >= 0);
  assert.ok(claim < flyers);
  assert.match(occupied, /data-occupied="true"/);
  assert.match(occupied, /wall-occupied/);
  assert.match(occupied, /Lead Co/);
  assert.match(occupied, /Open brief/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, /Claim rank/);
  assert.match(occupied, /Need \$8 to take #1/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("empty plaster still leads with Claim #1", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.paste-rail\.empty-claim-first\[data-empty-claim-first\]/,
  );
  assert.match(css, /\[data-post-brief\]/);
  assert.match(css, /\[data-open-brief\]/);
  assert.match(css, /\[data-prize\]/);
  assert.match(css, /\.prize-before-price/);
  assert.match(css, /\[data-later-fact\]/);
  assert.match(css, /\.later-fact/);
  assert.match(css, /\[data-later-open\]/);
  assert.match(css, /\.later-open/);

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  const claim = empty.indexOf('id="claim"');
  const stamp = empty.indexOf('data-empty-claim-first=""');
  const plaster = empty.indexOf('data-empty-week="true"');
  assert.ok(claim >= 0 && stamp >= 0 && plaster >= 0);
  assert.ok(claim <= stamp && stamp < plaster);
  assert.match(empty, /class="paste-rail empty-claim-first"/);
  assert.match(empty, /class="wall-stage wall-empty"/);
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /Rolling last 7 days wall/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /\$5 pastes the first flyer at #1/);
  assert.match(empty, /data-empty-week="true"/);
  assert.match(empty, /class="plaster"/);
  assert.doesNotMatch(empty, /class="flyers"/);
  assert.doesNotMatch(empty, /wall-occupied/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /prize-before-price/);
  assert.doesNotMatch(empty, /data-later-fact/);
  assert.doesNotMatch(empty, /later-fact/);
  assert.doesNotMatch(empty, /data-later-open/);
  assert.doesNotMatch(empty, /later-open/);
  assert.doesNotMatch(empty, /cards-later/);
  assert.doesNotMatch(empty, /data-terms=/);
  assert.doesNotMatch(empty, FORBIDDEN);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.doesNotMatch(occupied, /data-empty-claim-first/);
  assert.doesNotMatch(occupied, /empty-claim-first/);
  assert.doesNotMatch(occupied, /wall-empty/);
  assert.match(occupied, /data-occupied="true"/);
  assert.match(occupied, /data-post-brief=""/);
  assert.match(occupied, /data-open-brief=""/);
  assert.match(occupied, /data-prize=""/);
  assert.match(occupied, /prize-before-price/);
  assert.match(occupied, /data-later-fact=""/);
  assert.match(occupied, /later-fact/);
  assert.doesNotMatch(occupied, /data-later-open/);
  assert.doesNotMatch(occupied, /later-open/);
  assert.doesNotMatch(occupied, /cards-later/);
  assert.match(occupied, /Post a brief in the rolling last 7 days/);
  assert.match(occupied, /Open brief/);
  assert.match(occupied, /href="\/r\/lst_lead"/);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("empty plaster stays Claim #1 with no Terms / Open leak", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const markup = readFileSync(
    join(process.cwd(), "src", "lib", "board-markup.tsx"),
    "utf8",
  );
  const board = readFileSync(join(process.cwd(), "src", "app", "board.tsx"), "utf8");
  const form = readFileSync(join(process.cwd(), "src", "app", "outbid-form.tsx"), "utf8");
  assert.match(markup, /export function OccupiedFlyers/);
  assert.match(board, /<BoardCards listings=\{paid\} \/>/);
  assert.doesNotMatch(board, /EmptyPlaster/);
  assert.match(boardMarkupSource, /data-empty-week="true"/);
  assert.match(boardMarkupSource, /The plaster is blank/);
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.paste-rail\.empty-claim-first\[data-empty-claim-first\]/,
  );
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\]\s*\{[^}]*grid-template-columns:\s*minmax\(16rem, 32rem\)/,
  );
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \[data-terms\]/,
  );
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \[data-open-brief\]/,
  );
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \[data-later-fact\]/,
  );
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \[data-later-open\]/,
  );
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.cards-later/,
  );
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.flyers/,
  );
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.plaster/,
  );
  assert.doesNotMatch(css, /empty-claim-plaster/);
  assert.doesNotMatch(markup, /empty-claim-plaster/);

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  const claim = empty.indexOf('id="claim"');
  const stamp = empty.indexOf('data-empty-claim-first=""');
  const plaster = empty.indexOf('data-empty-week="true"');
  assert.ok(claim >= 0 && stamp >= 0 && plaster >= 0);
  assert.ok(claim <= stamp && stamp < plaster);
  assert.match(empty, /class="wall-stage wall-empty"/);
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /data-empty-week="true"/);
  assert.match(empty, /class="plaster"/);
  assert.doesNotMatch(empty, /class="flyers"/);
  assert.doesNotMatch(empty, /class="card/);
  assert.doesNotMatch(empty, /data-terms=/);
  assert.doesNotMatch(empty, /class="terms-label"/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-later-fact/);
  assert.doesNotMatch(empty, /later-fact/);
  assert.doesNotMatch(empty, /data-later-open/);
  assert.doesNotMatch(empty, /later-open/);
  assert.doesNotMatch(empty, /cards-later/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /prize-before-price/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /data-empty-claim-plaster/);
  assert.doesNotMatch(empty, /empty-claim-plaster/);
  assert.doesNotMatch(empty, FORBIDDEN);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const terms = lead.indexOf('data-terms=""');
  const open = lead.indexOf('data-open-brief=""');
  const bid = lead.indexOf('class="bid later-fact"');
  const later = lead.indexOf('data-later-fact=""');
  assert.ok(terms >= 0 && open > terms);
  assert.ok(bid > open && later >= bid);
  assert.match(occupied, /class="wall-stage wall-occupied"/);
  assert.doesNotMatch(occupied, /wall-empty/);
  assert.doesNotMatch(occupied, /data-empty-claim-first/);
  assert.match(occupied, /class="terms-label">Terms/);
  assert.match(occupied, /class="open-label">Open brief/);
  assert.match(occupied, /class="bid later-fact"/);
  assert.match(occupied, /href="\/r\/lst_lead"/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("empty plaster Claim #1 uses a direct identity-to-Outbid form", () => {
  const emptyFn =
    formSource.split("function EmptyClaimFirstWrite")[1]?.split(
      "export function OutbidForm",
    )[0] ?? "";
  const identity = emptyFn.indexOf("identityMarker");
  const fields = emptyFn.indexOf("BriefIdentityFields");
  const outbid = emptyFn.indexOf('data-first-click="claim"');
  assert.ok(identity >= 0 && fields > identity && outbid > fields);
  assert.match(emptyFn, /data-first-click="claim"/);
  assert.doesNotMatch(
    emptyFn,
    /data-later-write|later-write-label|Then the brief URL|formNoValidate/,
  );

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  const claimAt = empty.indexOf('id="claim"');
  const claimCopyAt = empty.indexOf("Claim #1 for");
  const identityAt = empty.indexOf('data-brief-identity=""');
  const brandAt = empty.indexOf('name="brand"');
  const termsAt = empty.indexOf('name="terms"');
  const briefAt = empty.indexOf('name="briefUrl"');
  const firstClickAt = empty.indexOf('data-first-click="claim"');
  const outbidAt = empty.indexOf(">Claim rank<");
  assert.ok(
    claimAt >= 0 &&
      claimCopyAt > claimAt &&
      briefAt > claimCopyAt &&
      identityAt > briefAt &&
      brandAt > identityAt &&
      termsAt > brandAt &&
      firstClickAt > termsAt &&
      outbidAt > firstClickAt,
  );
  assert.match(empty, /class="paste-rail empty-claim-first"/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(empty, /aria-label="Claim #1"/);
  assert.match(empty, /data-brief-identity=""/);
  assert.match(empty, /data-first-click="claim"/);
  assert.match(empty, /name="brand"/);
  assert.match(empty, /name="terms"/);
  assert.match(empty, /name="briefUrl"/);
  assert.match(empty, /name="bidUsd"/);
  assert.match(empty, /id="bid-usd"/);
  assert.match(empty, /aria-label="Bid amount in whole US dollars"/);
  assert.match(empty, />Claim rank</);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /class="amount-field"/);
  assert.match(empty, /class="step"/);
  assert.doesNotMatch(
    empty,
    /Then the brief URL|data-later-write|later-write-label/,
  );
  assert.doesNotMatch(empty, /Post a brief|Open brief|data-prize=/);
  assert.doesNotMatch(empty, /data-first-click="open"|data-post-brief/);
  assert.doesNotMatch(empty, /data-later-open|cards-later|data-later-fact/);
  assert.doesNotMatch(empty, FORBIDDEN);
  assert.match(
    cssSource,
    /\.amount-field input:focus-visible[\s\S]*outline:\s*2px solid var\(--bid\)/,
  );
  assert.match(
    cssSource,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.paste-rail\.empty-claim-first\[data-empty-claim-first\] \.outbid\[data-first-click="claim"\]/,
  );
  assert.doesNotMatch(
    cssSource,
    /data-later-write|later-write-label|Then the brief URL/,
  );
  assert.doesNotMatch(
    formSource,
    /data-later-write|later-write-label|Then the brief URL|formNoValidate/,
  );
});

test("empty plaster stays Claim #1 with no later-open / cards-later leak", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const markup = readFileSync(
    join(process.cwd(), "src", "lib", "board-markup.tsx"),
    "utf8",
  );
  const board = readFileSync(join(process.cwd(), "src", "app", "board.tsx"), "utf8");
  assert.match(css, /\.wall-occupied \.cards-later/);
  assert.match(
    css,
    /\.wall-occupied \.cards-later \.brief-url\.later-open\[data-later-open\]/,
  );
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.cards-later/,
  );
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \[data-later-open\]/,
  );
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.later-open/,
  );
  assert.doesNotMatch(css, /^[^.\n]*\.cards-later \{/m);
  assert.doesNotMatch(css, /^[^.\n]*\.brief-url\.later-open/m);
  assert.doesNotMatch(board, /OccupiedFlyers listings=\{listings\} \/>[\s\S]*listings\.length === 0/);
  assert.match(board, /<BoardCards listings=\{paid\} \/>/);
  assert.match(markup, /className="cards cards-later"/);
  assert.doesNotMatch(markup, /empty-claim-plaster/);
  assert.doesNotMatch(css, /empty-claim-plaster/);

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /class="wall-stage wall-empty"/);
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.doesNotMatch(empty, /class="flyers"/);
  assert.doesNotMatch(empty, /cards-later/);
  assert.doesNotMatch(empty, /cards-lead/);
  assert.doesNotMatch(empty, /data-later-open/);
  assert.doesNotMatch(empty, /later-open/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-terms=/);
  assert.doesNotMatch(empty, /class="terms-label"/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /prize-before-price/);
  assert.doesNotMatch(empty, /data-later-fact/);
  assert.doesNotMatch(empty, FORBIDDEN);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(occupied, /class="wall-stage wall-occupied"/);
  assert.match(occupied, /class="cards cards-later"/);
  assert.match(occupied, /data-later-open=""/);
  assert.match(occupied, /class="brief-url later-open"/);
  assert.match(occupied, /data-first-click="open"/);
  assert.doesNotMatch(occupied, /wall-empty/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("card has brand, terms, $, clicks; no follower fields", () => {
  const html = renderBoard([
    listing({
      id: "lst_acme",
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://example.com/acme",
      bidUsd: 5,
      clicks: 3,
      createdAt: "2026-08-17T00:00:00.000Z",
    }),
  ]);
  assert.match(html, /Acme/);
  assert.match(html, /class="terms-label">Terms/);
  assert.match(html, /\$800 flat, 1 TikTok/);
  assert.match(html, /\$5/);
  assert.match(html, /3 clicks/);
  assert.match(html, /Open brief/);
  assert.match(html, /href="\/r\/lst_acme"/);
  assert.match(html, /data-brief-url="https:\/\/example.com\/acme"/);
  assert.match(html, /https:\/\/example.com\/acme/);
  assert.doesNotMatch(html, FORBIDDEN);
  assert.doesNotMatch(html, /data-followers/);
});

test("one flyer names Terms as the prize before $bid", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_acme",
          brand: "Acme",
          terms: "$800 flat, 1 TikTok",
          briefUrl: "https://briefs.example.com/acme?id=9",
          bidUsd: 5,
          clicks: 3,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const cardStart = html.indexOf('data-id="lst_acme"');
  const card = html.slice(cardStart, html.indexOf("</li>", cardStart));
  const brand = card.indexOf('class="brand">Acme');
  const termsMark = card.indexOf('data-terms=""');
  const termsLabel = card.indexOf('class="terms-label">Terms');
  const termsCopy = card.indexOf('class="terms-copy">$800 flat, 1 TikTok');
  const hop = card.indexOf('data-open-brief=""');
  const open = card.indexOf('class="open-label">Open brief');
  const later = card.indexOf('data-later-fact=""');
  const bid = card.indexOf('class="bid later-fact"');
  const clicks = card.indexOf("3 clicks");
  assert.ok(brand >= 0 && termsMark > brand);
  assert.ok(termsLabel > termsMark && termsCopy > termsLabel);
  assert.ok(hop > termsCopy && open > hop && bid > open && later >= bid && clicks > later);
  assert.match(card, /data-terms=""/);
  assert.match(card, /class="terms-label">Terms/);
  assert.match(card, /\$800 flat, 1 TikTok/);
  assert.match(card, /Open brief/);
  assert.match(card, /class="bid later-fact"/);
  assert.match(card, /data-later-fact=""/);
  assert.match(card, /\$5/);
  assert.doesNotMatch(html, FORBIDDEN);
});

test("occupied #1 Terms reads first and larger than $bid and clicks", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const prizeSize = css.match(
    /\.card-lead \.terms\.prize-before-price \.terms-copy\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const bidSize = css.match(/\.card-lead \.bid\s*\{[^}]*font-size:\s*([\d.]+)rem/);
  const clickSize = css.match(
    /\.card-lead \.clicks\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(prizeSize);
  assert.ok(bidSize);
  assert.ok(clickSize);
  assert.ok(Number(prizeSize[1]) > Number(bidSize[1]));
  assert.ok(Number(prizeSize[1]) > Number(clickSize[1]));
  assert.match(css, /\.card-lead \.bid\.later-fact\[data-later-fact\]/);
  assert.match(css, /\.card-lead \.bid\.later-fact\[data-later-fact\]\s*\{[^}]*color:\s*var\(--muted\)/);
  assert.match(css, /\.card-lead \.bid\.later-fact\[data-later-fact\]\s*\{[^}]*font-weight:\s*500/);

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /prize-before-price/);
  assert.doesNotMatch(empty, /data-later-fact/);
  assert.doesNotMatch(empty, /later-fact/);
  assert.doesNotMatch(empty, /data-later-open/);
  assert.doesNotMatch(empty, /later-open/);
  assert.doesNotMatch(empty, /data-terms=/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /Blank plaster/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const twoStart = occupied.indexOf('data-id="lst_two"');
  const two = occupied.slice(twoStart, occupied.indexOf("</li>", twoStart));
  const prize = lead.indexOf('data-prize=""');
  const prizeStamp = lead.indexOf('data-prize-before-price=""');
  const termsCopy = lead.indexOf('class="terms-copy">already #1');
  const hop = lead.indexOf('data-open-brief=""');
  const later = lead.indexOf('data-later-fact=""');
  const bid = lead.indexOf('class="bid later-fact"');
  const clicks = lead.indexOf("0 clicks");
  assert.ok(prize >= 0 && prizeStamp >= 0 && termsCopy > prizeStamp);
  assert.ok(hop > termsCopy && bid > hop && later >= bid && clicks > later);
  assert.match(lead, /class="terms prize-before-price"/);
  assert.match(lead, /data-prize=""/);
  assert.match(lead, /data-prize-before-price=""/);
  assert.match(lead, /class="bid later-fact"/);
  assert.match(lead, /data-later-fact=""/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(occupied, /data-confirm-brief|Leave to the brief|\/r\/lst_lead/);
  assert.match(two, /data-terms=""/);
  assert.match(two, /class="later-terms-kicker">Terms/);
  assert.match(two, /class="bid">\$5/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.match(two, /data-later-flyer=""/);
  assert.doesNotMatch(two, /class="terms-label">Terms/);
  assert.doesNotMatch(two, /data-prize=/);
  assert.doesNotMatch(two, /prize-before-price/);
  assert.doesNotMatch(two, /data-later-fact/);
  assert.doesNotMatch(two, /class="bid later-fact"/);
  assert.doesNotMatch(lead, /data-later-open/);
  assert.doesNotMatch(lead, /later-open/);
  assert.equal((occupied.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-prize-before-price=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/prize-before-price/g) ?? []).length, 2);
  assert.equal((occupied.match(/data-later-fact=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/class="bid later-fact"/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="clicks later-fact"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-later-open=""/g) ?? []).length, 1);
  assert.doesNotMatch(empty, FORBIDDEN);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied #1 $bid stays a later fact and does not shout beside Terms", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const prizeSize = css.match(
    /\.card-lead \.terms\.prize-before-price \.terms-copy\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const bidSize = css.match(/\.card-lead \.bid\s*\{[^}]*font-size:\s*([\d.]+)rem/);
  const clickSize = css.match(
    /\.card-lead \.clicks\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(prizeSize);
  assert.ok(bidSize);
  assert.ok(clickSize);
  assert.ok(Number(prizeSize[1]) > Number(bidSize[1]));
  assert.ok(Number(prizeSize[1]) > Number(clickSize[1]));
  assert.match(css, /\.card-lead \.bid\.later-fact\[data-later-fact\]/);
  assert.match(
    css,
    /\.card-lead \.bid\.later-fact\[data-later-fact\]\s*\{[^}]*color:\s*var\(--muted\)/,
  );
  assert.doesNotMatch(
    css,
    /\.card-lead \.bid\.later-fact\[data-later-fact\]\s*\{[^}]*color:\s*var\(--bid\)/,
  );

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-later-fact/);
  assert.doesNotMatch(empty, /later-fact/);
  assert.doesNotMatch(empty, /data-later-open/);
  assert.doesNotMatch(empty, /later-open/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /prize-before-price/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /data-empty-claim-first=""/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const twoStart = occupied.indexOf('data-id="lst_two"');
  const two = occupied.slice(twoStart, occupied.indexOf("</li>", twoStart));
  const terms = lead.indexOf('data-prize=""');
  const hop = lead.indexOf('data-open-brief=""');
  const later = lead.indexOf('data-later-fact=""');
  const bidClass = lead.indexOf('class="bid later-fact"');
  const bid = lead.indexOf("$7");
  const clicks = lead.indexOf("0 clicks");
  assert.ok(terms >= 0 && hop > terms);
  assert.ok(bidClass > hop && later >= bidClass && bid > later && clicks > bid);
  assert.match(lead, /class="terms prize-before-price"/);
  assert.match(lead, /class="bid later-fact"/);
  assert.match(lead, /data-later-fact=""/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(two, /class="bid">\$5/);
  assert.match(two, /class="later-terms-kicker">Terms/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.match(two, /data-later-flyer=""/);
  assert.doesNotMatch(two, /class="terms-label">Terms/);
  assert.doesNotMatch(two, /data-later-fact/);
  assert.doesNotMatch(two, /class="bid later-fact"/);
  assert.doesNotMatch(two, /data-prize=/);
  assert.doesNotMatch(lead, /data-later-open/);
  assert.doesNotMatch(lead, /later-open/);
  assert.equal((occupied.match(/data-later-fact=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/class="bid later-fact"/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="clicks later-fact"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-later-open=""/g) ?? []).length, 1);
  assert.doesNotMatch(empty, FORBIDDEN);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied #1 clicks stay a later fact after Terms and do not shout beside Terms", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const prizeSize = css.match(
    /\.card-lead \.terms\.prize-before-price \.terms-copy\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const bidSize = css.match(/\.card-lead \.bid\s*\{[^}]*font-size:\s*([\d.]+)rem/);
  const clickSize = css.match(
    /\.card-lead \.clicks\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(prizeSize);
  assert.ok(bidSize);
  assert.ok(clickSize);
  assert.ok(Number(prizeSize[1]) > Number(bidSize[1]));
  assert.ok(Number(prizeSize[1]) > Number(clickSize[1]));
  assert.ok(Number(clickSize[1]) <= Number(bidSize[1]));
  assert.match(css, /\.card-lead \.clicks\.later-fact\[data-later-fact\]/);
  assert.match(
    css,
    /\.card-lead \.clicks\.later-fact\[data-later-fact\]\s*\{[^}]*color:\s*var\(--muted\)/,
  );
  assert.match(
    css,
    /\.card-lead \.clicks\.later-fact\[data-later-fact\]\s*\{[^}]*font-weight:\s*500/,
  );
  assert.doesNotMatch(
    css,
    /\.card-lead \.clicks\.later-fact\[data-later-fact\]\s*\{[^}]*color:\s*var\(--bid\)/,
  );

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-later-fact/);
  assert.doesNotMatch(empty, /later-fact/);
  assert.doesNotMatch(empty, /class="clicks later-fact"/);
  assert.doesNotMatch(empty, /data-later-open/);
  assert.doesNotMatch(empty, /later-open/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /prize-before-price/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(
    empty,
    CONFIRMED_CHECKOUT_COPY,
  );

  const unpaid = listing({
    id: "lst_ghost",
    brand: "Ghost Co",
    terms: "Abandoned Waffo checkout.",
    bidUsd: 50,
    clicks: 9,
    createdAt: "",
  });
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        unpaid,
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          clicks: 4,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          clicks: 11,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const twoStart = occupied.indexOf('data-id="lst_two"');
  const two = occupied.slice(twoStart, occupied.indexOf("</li>", twoStart));
  const terms = lead.indexOf('data-prize=""');
  const termsCopy = lead.indexOf('class="terms-copy">already #1');
  const hop = lead.indexOf('data-open-brief=""');
  const firstClick = lead.indexOf('data-first-click="open"');
  const bidClass = lead.indexOf('class="bid later-fact"');
  const bidLater = lead.indexOf('data-later-fact=""');
  const clicksClass = lead.indexOf('class="clicks later-fact"');
  const clicksLater = lead.indexOf('data-later-fact=""', clicksClass);
  const clicks = lead.indexOf("4 clicks");
  assert.ok(terms >= 0 && hop > terms && firstClick > termsCopy);
  assert.ok(bidClass > hop && bidLater >= bidClass);
  assert.ok(clicksClass > bidClass && clicksLater >= clicksClass && clicks > clicksLater);
  assert.match(lead, /class="terms prize-before-price"/);
  assert.match(lead, /class="bid later-fact"/);
  assert.match(lead, /class="clicks later-fact"/);
  assert.match(lead, /data-later-fact=""/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(two, /class="bid">\$5/);
  assert.match(two, /class="clicks"/);
  assert.match(two, /11 clicks/);
  assert.match(two, /class="later-terms-kicker">Terms/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.match(two, /data-later-flyer=""/);
  assert.doesNotMatch(two, /class="terms-label">Terms/);
  assert.doesNotMatch(two, /data-later-fact/);
  assert.doesNotMatch(two, /class="bid later-fact"/);
  assert.doesNotMatch(two, /class="clicks later-fact"/);
  assert.doesNotMatch(two, /data-prize=/);
  assert.doesNotMatch(lead, /data-later-open/);
  assert.doesNotMatch(lead, /later-open/);
  assert.doesNotMatch(occupied, /Ghost Co|Abandoned Waffo checkout/);
  assert.doesNotMatch(occupied, /data-id="lst_ghost"/);
  assert.doesNotMatch(occupied, /9 clicks/);
  assert.equal((occupied.match(/data-later-fact=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/class="bid later-fact"/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="clicks later-fact"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-later-open=""/g) ?? []).length, 1);
  assert.doesNotMatch(empty, FORBIDDEN);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied later-rank Open stays quieter so #1 Open is the first click", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const markup = readFileSync(
    join(process.cwd(), "src", "lib", "board-markup.tsx"),
    "utf8",
  );
  const laterSize = css.match(
    /\.wall-occupied \.cards-later \.brief-url\.later-open\[data-later-open\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const baseSize = css.match(
    /\.wall-occupied \.card \.brief-url \{\n[^}]*font-size:\s*([\d.]+)rem/,
  );
  const leadSize = css.match(
    /\.wall-occupied \.card \.brief-url\[data-first-click="open"\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(laterSize);
  assert.ok(baseSize);
  assert.ok(leadSize);
  assert.ok(Number(laterSize[1]) < Number(baseSize[1]));
  assert.ok(Number(laterSize[1]) < Number(leadSize[1]));
  assert.match(css, /\.wall-occupied \.cards-later \.brief-url\.later-open\[data-later-open\]/);
  assert.match(
    css,
    /\.wall-occupied \.cards-later \.brief-url\.later-open\[data-later-open\]\s*\{[^}]*color:\s*var\(--muted\)/,
  );
  assert.match(
    css,
    /\.wall-occupied \.cards-later \.brief-url\.later-open\[data-later-open\]\s*\{[^}]*border:\s*0/,
  );
  assert.doesNotMatch(
    css,
    /\.wall-occupied \.cards-later \.brief-url\.later-open\[data-later-open\]\s*\{[^}]*color:\s*var\(--ink\)/,
  );
  assert.match(css, /\.wall-occupied \.cards-later \.card \{/);
  assert.doesNotMatch(css, /\.wall-occupied \.cards-later \.wall-occupied \.card/);
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \[data-later-open\]/,
  );
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.cards-later/,
  );
  assert.match(markup, /function OpenBriefLink/);
  assert.match(markup, /className="cards cards-lead"/);
  assert.match(markup, /className="cards cards-later"/);
  assert.match(markup, /className="brief-url later-open"/);
  assert.match(markup, /data-later-open=""/);
  assert.doesNotMatch(markup, /open-later-rank|data-later-rank[^-]/);
  assert.doesNotMatch(css, /open-later-rank|data-later-rank[^-]/);

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-later-open/);
  assert.doesNotMatch(empty, /later-open/);
  assert.doesNotMatch(empty, /cards-later/);
  assert.doesNotMatch(empty, /cards-lead/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /data-empty-claim-first=""/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadList = occupied.indexOf('aria-label="Paid briefs — rolling last 7 days"');
  const laterList = occupied.indexOf('aria-label="Later briefs — rolling last 7 days"');
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const twoStart = occupied.indexOf('data-id="lst_two"');
  const two = occupied.slice(twoStart, occupied.indexOf("</li>", twoStart));
  const firstClick = lead.indexOf('data-first-click="open"');
  const leadOpen = lead.indexOf('class="open-label">Open brief');
  const laterOpenMark = two.indexOf('data-later-open=""');
  const laterOpen = two.indexOf('class="open-label">Open brief');
  const laterClass = two.indexOf("later-open");
  const laterTerms = two.indexOf('class="later-terms-kicker">Terms');
  const laterBid = two.indexOf('class="bid">$5');
  const post = occupied.indexOf('data-post-brief=""');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(leadList >= 0 && laterList > leadList);
  assert.ok(firstClick >= 0 && leadOpen > firstClick);
  assert.ok(laterOpenMark >= 0 && laterClass >= 0 && laterOpen > laterOpenMark);
  assert.ok(laterTerms >= 0 && laterBid > laterTerms && laterOpenMark > laterBid);
  assert.ok(twoStart > laterList && laterList > leadStart);
  assert.ok(claim < leadStart && post > twoStart);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /data-open-brief=""/);
  assert.match(lead, /class="open-label">Open brief/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.doesNotMatch(lead, /data-later-open/);
  assert.doesNotMatch(lead, /later-open/);
  assert.doesNotMatch(lead, /cards-later/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.match(two, /data-open-brief=""/);
  assert.match(two, /class="open-label">Open brief/);
  assert.match(two, /href="\/r\/lst_two"/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /data-first-read="open"/);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-later-open=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="brief-url later-open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-brief=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/class="open-label">Open brief/g) ?? []).length, 2);
  assert.equal((occupied.match(/aria-label="Paid briefs — rolling last 7 days"/g) ?? []).length, 1);
  assert.equal((occupied.match(/aria-label="Later briefs — rolling last 7 days"/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /open-later-rank|data-later-rank[^-]/);
  assert.doesNotMatch(empty, FORBIDDEN);
  assert.doesNotMatch(occupied, FORBIDDEN);

  const solo = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(solo, /aria-label="Paid briefs — rolling last 7 days"/);
  assert.match(solo, /data-first-click="open"/);
  assert.doesNotMatch(solo, /cards-later/);
  assert.doesNotMatch(solo, /Later briefs — rolling last 7 days/);
  assert.doesNotMatch(solo, /data-later-open/);
  assert.doesNotMatch(solo, /later-open/);
});

test("occupied Terms stay the prize and later Open stays after #1 Open", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const markup = readFileSync(
    join(process.cwd(), "src", "lib", "board-markup.tsx"),
    "utf8",
  );
  assert.match(css, /\.wall-occupied \.cards-later \.card \{/);
  assert.match(css, /\.creator-wall\s*\{[^}]*min-width:\s*0[^}]*overflow-x:\s*clip/);
  assert.match(css, /\.creator-wall \.brief-details-separator/);
  assert.match(
    css,
    /\.wall-occupied \.cards-later \.card\s*\{[^}]*grid-template-areas:[\s\S]*"bid bid clicks"[\s\S]*"url url url"/,
  );
  assert.match(
    css,
    /\.wall-occupied \.card \{\n[^}]*grid-template-areas:[\s\S]*"url url url"[\s\S]*"bid bid clicks"/,
  );
  assert.doesNotMatch(css, /\.wall-occupied \.cards-later \.wall-occupied \.card/);
  assert.match(markup, /\{lead \? openBriefLink : null\}/);
  assert.match(markup, /\{lead \? null : openBriefLink\}/);
  assert.match(markup, /function OpenBriefLink/);
  assert.doesNotMatch(markup, /open-later-rank|data-later-rank[^-]/);

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.doesNotMatch(empty, /data-later-open/);
  assert.doesNotMatch(empty, /later-open/);
  assert.doesNotMatch(empty, /cards-later/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-terms=/);
  assert.doesNotMatch(empty, /class="terms-label"/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadList = occupied.indexOf('aria-label="Paid briefs — rolling last 7 days"');
  const laterList = occupied.indexOf('aria-label="Later briefs — rolling last 7 days"');
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const twoStart = occupied.indexOf('data-id="lst_two"');
  const two = occupied.slice(twoStart, occupied.indexOf("</li>", twoStart));
  const leadTerms = lead.indexOf('class="terms-label">Terms');
  const leadOpen = lead.indexOf('class="open-label">Open brief');
  const leadBid = lead.indexOf('class="bid later-fact"');
  const laterTerms = two.indexOf('class="later-terms-kicker">Terms');
  const laterBid = two.indexOf('class="bid">$5');
  const laterOpenMark = two.indexOf('data-later-open=""');
  const laterOpen = two.indexOf('class="open-label">Open brief');
  const firstClick = lead.indexOf('data-first-click="open"');
  assert.ok(leadList >= 0 && laterList > leadList);
  assert.ok(leadTerms >= 0 && leadOpen > leadTerms && leadBid > leadOpen);
  assert.ok(laterTerms >= 0 && laterBid > laterTerms);
  assert.ok(laterOpenMark > laterBid && laterOpen > laterOpenMark);
  assert.ok(firstClick >= 0 && twoStart > laterList && laterList > leadStart);
  assert.match(lead, /data-prize=""/);
  assert.match(lead, /data-first-click="open"/);
  assert.doesNotMatch(lead, /data-later-open/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.match(two, /data-open-brief=""/);
  assert.match(two, /href="\/r\/lst_two"/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /data-prize=/);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-later-open=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /open-later-rank|data-later-rank[^-]/);
  assert.doesNotMatch(empty, FORBIDDEN);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied later flyers stay quieter than #1 Terms — prize stays first", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const markup = readFileSync(
    join(process.cwd(), "src", "lib", "board-markup.tsx"),
    "utf8",
  );
  const prizeSize = css.match(
    /\.wall-occupied \.card-lead \.terms\.prize-before-price \.terms-copy\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterTermsSize = css.match(
    /\.wall-occupied \.cards-later \.card\.later-flyer\[data-later-flyer\] \.later-terms-copy\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterBrandSize = css.match(
    /\.wall-occupied \.cards-later \.card\.later-flyer\[data-later-flyer\] \.later-brand\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterOpenSize = css.match(
    /\.wall-occupied \.cards-later \.brief-url\.later-open\[data-later-open\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const leadOpenSize = css.match(
    /\.wall-occupied \.card \.brief-url\[data-first-click="open"\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterSlip =
    css.match(
      /\.wall-occupied \.cards-later \.card\.later-flyer\[data-later-flyer\]\s*\{[^}]*\}/,
    )?.[0] ?? "";
  const laterPack =
    css.match(
      /\.wall-occupied \.later-pack\[data-later-pack\]\s*\{[^}]*\}/,
    )?.[0] ?? "";
  assert.ok(prizeSize);
  assert.ok(laterTermsSize);
  assert.ok(laterBrandSize);
  assert.ok(laterOpenSize);
  assert.ok(leadOpenSize);
  assert.ok(Number(prizeSize[1]) > Number(laterTermsSize[1]));
  assert.ok(Number(prizeSize[1]) > Number(laterBrandSize[1]));
  assert.ok(Number(leadOpenSize[1]) > Number(laterOpenSize[1]));
  assert.match(laterPack, /border-top:\s*1px dashed var\(--line\)/);
  assert.match(
    laterSlip,
    /grid-template-columns:\s*minmax\(3\.25rem, auto\) minmax\(0, 1fr\) auto minmax\(7\.5rem, auto\)/,
  );
  assert.match(laterSlip, /"rank brand brand brand"/);
  assert.match(laterSlip, /"terms terms terms terms"/);
  assert.match(laterSlip, /"bid clicks url url"/);
  assert.match(laterSlip, /min-width:\s*0/);
  assert.match(css, /\.wall-occupied \.cards-later \.card \.later-terms\s*\{[^}]*grid-area:\s*terms/);
  assert.match(css, /\.later-terms-copy\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(
    css,
    /\.creator-wall \.wall-occupied \.cards-later \.card\.later-flyer\[data-later-flyer\] \.brief-url\s*\{[^}]*justify-self:\s*end/,
  );
  assert.match(
    css,
    /@media \(max-width: 820px\)[\s\S]*\.creator-wall \.wall-occupied \.later-pack \.later-flyer\[data-later-flyer\]\s*\{[\s\S]*grid-template-columns:\s*minmax\(3\.25rem, auto\) minmax\(0, 1fr\)[\s\S]*"terms terms"[\s\S]*"bid clicks"[\s\S]*"url url"/,
  );
  assert.match(laterSlip, /box-shadow:\s*none/);
  assert.match(laterSlip, /border:\s*1px dashed var\(--line\)/);
  assert.doesNotMatch(laterSlip, /outline:\s*2px solid var\(--bid\)/);
  assert.match(markup, /function OccupiedLaterFlyer/);
  assert.match(markup, /function OccupiedLeadFlyer/);
  assert.match(markup, /className="card later-flyer"/);
  assert.match(markup, /data-later-flyer=""/);
  assert.match(markup, /data-later-pack=""/);
  assert.match(markup, /These flyers are not #1 in the rolling last 7 days/);
  assert.match(markup, /className="later-terms-kicker"/);
  assert.match(markup, /className="later-terms-copy"/);
  assert.match(markup, /\{lead \? openBriefLink : null\}/);
  assert.match(markup, /\{lead \? null : openBriefLink\}/);
  assert.doesNotMatch(markup, /open-later-rank|data-later-rank[^-]|data-later-quiet|data-later-rank-quiet/);
  assert.doesNotMatch(css, /open-later-rank|data-later-rank[^-]|data-later-quiet|0\.78rem --muted/);

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(empty, /data-first-click="claim"/);
  assert.doesNotMatch(empty, /data-later-flyer/);
  assert.doesNotMatch(empty, /later-flyer/);
  assert.doesNotMatch(empty, /data-later-pack/);
  assert.doesNotMatch(empty, /later-pack/);
  assert.doesNotMatch(empty, /These flyers are not #1 in the rolling last 7 days/);
  assert.doesNotMatch(empty, /data-later-open/);
  assert.doesNotMatch(empty, /later-open/);
  assert.doesNotMatch(empty, /cards-later/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-terms=/);
  assert.doesNotMatch(empty, /class="terms-label"/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, FORBIDDEN);

  const solo = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(solo, /aria-label="Paid briefs — rolling last 7 days"/);
  assert.match(solo, /data-prize=""/);
  assert.match(solo, /data-first-click="open"/);
  assert.match(solo, /class="terms-label">Terms/);
  assert.doesNotMatch(solo, /data-later-flyer/);
  assert.doesNotMatch(solo, /later-flyer/);
  assert.doesNotMatch(solo, /data-later-pack/);
  assert.doesNotMatch(solo, /These flyers are not #1 in the rolling last 7 days/);
  assert.doesNotMatch(solo, /cards-later/);
  assert.doesNotMatch(solo, /data-later-open/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
        listing({
          id: "lst_three",
          brand: "Three Co",
          terms: "third rank",
          bidUsd: 5,
          createdAt: "2026-08-19T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const prizeAt = occupied.indexOf('data-prize=""');
  const firstClickAt = occupied.indexOf('data-first-click="open"');
  const leadOpenAt = occupied.indexOf('class="open-label">Open brief');
  const packAt = occupied.indexOf('data-later-pack=""');
  const laterListAt = occupied.indexOf('aria-label="Later briefs — rolling last 7 days"');
  const postAt = occupied.indexOf('data-post-brief=""');
  const claimAt = occupied.indexOf('id="claim"');
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const twoStart = occupied.indexOf('data-id="lst_two"');
  const threeStart = occupied.indexOf('data-id="lst_three"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const two = occupied.slice(twoStart, occupied.indexOf("</li>", twoStart));
  const three = occupied.slice(threeStart, occupied.indexOf("</li>", threeStart));
  const laterTerms = two.indexOf('class="later-terms-kicker">Terms');
  const laterBid = two.indexOf('class="bid">$5');
  const laterOpen = two.indexOf('data-later-open=""');
  assert.ok(prizeAt >= 0 && firstClickAt > prizeAt && leadOpenAt > firstClickAt);
  assert.ok(packAt > leadOpenAt && laterListAt > packAt);
  assert.ok(twoStart > laterListAt && threeStart > twoStart);
  assert.ok(claimAt < leadStart && postAt > threeStart);
  assert.match(occupied, /class="card card-lead"/);
  assert.match(lead, /data-prize=""/);
  assert.match(lead, /class="terms prize-before-price"/);
  assert.match(lead, /class="terms-label">Terms/);
  assert.match(lead, /class="terms-copy">already #1/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /class="bid later-fact"/);
  assert.doesNotMatch(lead, /later-flyer/);
  assert.doesNotMatch(lead, /data-later-flyer/);
  assert.doesNotMatch(lead, /later-terms-kicker/);
  assert.match(occupied, /These flyers are not #1 in the rolling last 7 days/);
  assert.match(occupied, /class="later-pack"/);
  assert.match(occupied, /class="card later-flyer"/);
  assert.match(two, /data-later-flyer=""/);
  assert.match(two, /class="brand later-brand">Two Co/);
  assert.match(two, /class="later-terms-kicker">Terms/);
  assert.match(two, /class="later-terms-copy">later rank/);
  assert.match(two, /class="bid">\$5/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.match(two, /Open brief/);
  assert.ok(laterTerms >= 0 && laterBid > laterTerms && laterOpen > laterBid);
  assert.doesNotMatch(two, /data-prize=/);
  assert.doesNotMatch(two, /prize-before-price/);
  assert.doesNotMatch(two, /class="terms-label"/);
  assert.doesNotMatch(two, /class="terms-copy"/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /card-lead/);
  assert.match(three, /data-later-flyer=""/);
  assert.match(three, /class="later-terms-copy">third rank/);
  assert.match(three, /data-later-open=""/);
  assert.doesNotMatch(three, /data-prize=/);
  assert.doesNotMatch(three, /class="terms-label"/);
  assert.equal((occupied.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-later-flyer=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/class="card later-flyer"/g) ?? []).length, 2);
  assert.equal((occupied.match(/data-later-pack=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-later-open=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/class="terms-label">Terms/g) ?? []).length, 1);
  assert.doesNotMatch(occupied.slice(0, packAt), /data-later-flyer/);
  assert.doesNotMatch(occupied.slice(twoStart), /data-prize=/);
  assert.doesNotMatch(occupied, /data-later-quiet|data-later-rank-quiet|open-later-rank|data-later-rank[^-]/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Claim rank</);
  assert.doesNotMatch(empty, FORBIDDEN);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("cards sort by bid; older wins ties", () => {
  const html = renderBoard([
    listing({
      id: "lst_new",
      brand: "Newer Eight",
      terms: "newer equal bid",
      bidUsd: 8,
      createdAt: "2026-08-19T00:00:00.000Z",
    }),
    listing({
      id: "lst_five",
      brand: "Five Dollar",
      terms: "first place",
      bidUsd: 5,
      createdAt: "2026-08-17T00:00:00.000Z",
    }),
    listing({
      id: "lst_old",
      brand: "Older Eight",
      terms: "older equal bid",
      bidUsd: 8,
      createdAt: "2026-08-18T00:00:00.000Z",
    }),
  ]);
  const first = html.indexOf('data-id="lst_old"');
  const second = html.indexOf('data-id="lst_new"');
  const third = html.indexOf('data-id="lst_five"');
  assert.ok(first >= 0 && second >= 0 && third >= 0);
  assert.ok(first < second && second < third);
  assert.match(html, /data-rank="1"/);
  assert.match(html, /\$8/);
  assert.match(html, /\$5/);
  assert.doesNotMatch(html, FORBIDDEN);
});

test("GET confirm sheet puts terms and the brief URL before the leave hop", () => {
  const html = confirmBriefHtml(
    listing({
      id: "lst_acme",
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://briefs.example.com/acme?id=9",
      bidUsd: 5,
      clicks: 3,
      createdAt: "2026-08-17T00:00:00.000Z",
    }),
  );
  const uncounted = html.indexOf('data-confirm-uncounted=""');
  const uncountedCopy = html.indexOf("Opening this flyer has not counted a hop.");
  const terms = html.indexOf("$800 flat, 1 TikTok");
  const url = html.indexOf("https://briefs.example.com/acme?id=9");
  const leave = html.indexOf('data-leave-brief=""');
  const bid = html.indexOf('class="confirm-bid later-fact"');
  const hops = html.indexOf("3 public hops — not reach");
  assert.ok(uncounted >= 0 && uncountedCopy >= 0 && uncounted <= uncountedCopy);
  assert.ok(terms >= 0 && uncounted > terms && url > uncountedCopy && leave > url);
  assert.ok(bid > leave && hops > bid);
  assert.match(html, /class="confirm-bid later-fact"/);
  assert.match(html, /data-later-fact="">\$5/);
  assert.match(html, /data-confirm-brief=""/);
  assert.match(html, /data-confirm-before-leave=""/);
  assert.match(html, /class="confirm-sheet confirm-before-leave"/);
  assert.match(html, /data-page="confirm-brief"/);
  assert.match(html, /data-clicks="3"/);
  assert.match(html, /Confirm this brief/);
  assert.match(html, /Leave to the brief/);
  assert.match(html, /method="post"/);
  assert.match(html, /action="\/r\/lst_acme"/);
  assert.doesNotMatch(html, /href="https:\/\/briefs\.example\.com/);
  assert.doesNotMatch(html, FORBIDDEN);
});

test("GET confirm-before-leave does not increment clicks", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  assert.match(
    css,
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-uncounted\[data-confirm-uncounted\]/,
  );
  assert.match(css, /confirm-before-leave/);
  assert.match(css, /data-confirm-uncounted/);

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(empty, /Claim #1 for/);
  assert.doesNotMatch(empty, /data-confirm-before-leave/);
  assert.doesNotMatch(empty, /Opening this flyer has not counted a hop/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, FORBIDDEN);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(occupied, /href="\/r\/lst_lead"/);
  assert.match(occupied, /data-open-brief=""/);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-confirm-before-leave/);
  assert.doesNotMatch(occupied, FORBIDDEN);

  const db = openDatabase(":memory:");
  try {
    insertFixtureListing(db, {
      id: "lst_preview",
      weekId: WEEK,
      brand: "Preview Co",
      terms: "opening is not a hop",
      briefUrl: "https://example.com/preview",
      bidUsd: 5,
      clicks: 0,
      createdAt: "2026-08-17T00:00:00.000Z",
    });
    const preview = getPublicListing(db, "lst_preview");
    assert.equal(preview.clicks, 0);
    const stillZero = listLiveBoard(
      db,
      new Date("2026-08-17T00:00:00.000Z"),
    );
    assert.equal(stillZero[0]?.clicks, 0);
    const html = confirmBriefHtml(preview);
    assert.match(html, /data-confirm-before-leave=""/);
    assert.match(html, /data-confirm-uncounted=""/);
    assert.match(html, /Opening this flyer has not counted a hop/);
    assert.match(html, /data-clicks="0"/);
    assert.match(html, /Leave to the brief/);
    assert.match(html, /method="post"/);
    assert.match(html, /action="\/r\/lst_preview"/);
    assert.equal(getPublicListing(db, "lst_preview").clicks, 0);
    const counted = incrementPublicClick(db, "lst_preview");
    assert.equal(counted.listing.clicks, 1);
    assert.equal(counted.url, "https://example.com/preview");
  } finally {
    db.close();
  }
});

test("occupied confirm hops stay a later fact after terms and do not shout beside the prize", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const termsSize = css.match(/\.confirm-terms\s*\{[^}]*font-size:\s*([\d.]+)rem/);
  const hopsSize = css.match(
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-clicks\.later-fact\[data-later-fact\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const hopsBlock = css.match(
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-clicks\.later-fact\[data-later-fact\]\s*\{[^}]*\}/,
  );
  assert.ok(termsSize);
  assert.ok(hopsSize);
  assert.ok(hopsBlock);
  assert.ok(Number(termsSize[1]) > Number(hopsSize[1]));
  assert.match(hopsBlock[0], /flex-basis:\s*100%/);
  assert.match(hopsBlock[0], /color:\s*var\(--muted\)/);
  assert.match(hopsBlock[0], /font-weight:\s*500/);
  assert.doesNotMatch(hopsBlock[0], /color:\s*var\(--bid\)/);
  assert.doesNotMatch(
    css,
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-clicks\.later-fact\[data-later-fact\]\s*\{[^}]*color:\s*var\(--bid\)/,
  );

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(
    empty,
    CONFIRMED_CHECKOUT_COPY,
  );
  assert.doesNotMatch(empty, /confirm-clicks/);
  assert.doesNotMatch(empty, /public hops — not reach/);
  assert.doesNotMatch(empty, /data-later-fact/);
  assert.doesNotMatch(empty, /later-fact/);
  assert.doesNotMatch(empty, /data-confirm-before-leave/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, FORBIDDEN);

  const unpaid = listing({
    id: "lst_ghost",
    brand: "Ghost Co",
    terms: "Abandoned Waffo checkout.",
    bidUsd: 50,
    clicks: 9,
    createdAt: "",
  });
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        unpaid,
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          clicks: 4,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          clicks: 11,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const terms = lead.indexOf('data-prize=""');
  const hop = lead.indexOf('data-open-brief=""');
  const firstClick = lead.indexOf('data-first-click="open"');
  assert.ok(terms >= 0 && hop > terms && firstClick > terms);
  assert.match(lead, /class="terms prize-before-price"/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.doesNotMatch(occupied, /Ghost Co|Abandoned Waffo checkout/);
  assert.doesNotMatch(occupied, /data-id="lst_ghost"/);
  assert.doesNotMatch(occupied, /9 clicks/);
  assert.doesNotMatch(occupied, /confirm-clicks/);
  assert.doesNotMatch(occupied, /public hops — not reach/);
  assert.doesNotMatch(occupied, FORBIDDEN);

  const html = confirmBriefHtml(
    listing({
      id: "lst_acme",
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://briefs.example.com/acme?id=9",
      bidUsd: 5,
      clicks: 3,
      createdAt: "2026-08-17T00:00:00.000Z",
    }),
  );
  const termsCopy = html.indexOf("$800 flat, 1 TikTok");
  const url = html.indexOf("https://briefs.example.com/acme?id=9");
  const leave = html.indexOf('data-leave-brief=""');
  const bid = html.indexOf('class="confirm-bid later-fact"');
  const hopsClass = html.indexOf('class="confirm-clicks later-fact"');
  const hopsLater = html.indexOf('data-later-fact=""', hopsClass);
  const hops = html.indexOf("3 public hops — not reach");
  assert.ok(termsCopy >= 0 && url > termsCopy && leave > url);
  assert.ok(bid > leave && hopsClass > bid && hopsLater >= hopsClass && hops > hopsLater);
  assert.match(html, /class="confirm-clicks later-fact"/);
  assert.match(html, /data-later-fact=""/);
  assert.match(html, /data-confirm-before-leave=""/);
  assert.match(html, /Leave to the brief/);
  assert.equal((html.match(/class="confirm-clicks later-fact"/g) ?? []).length, 1);
  assert.equal((html.match(/data-later-fact=""/g) ?? []).length, 2);
  assert.doesNotMatch(html, FORBIDDEN);

  const db = openDatabase(":memory:");
  try {
    insertFixtureListing(db, {
      id: "lst_ghost_row",
      weekId: WEEK,
      brand: "Ghost Co",
      terms: "Abandoned Waffo checkout.",
      briefUrl: "https://example.com/ghost",
      bidUsd: 50,
      clicks: 9,
      createdAt: "",
    });
    insertFixtureListing(db, {
      id: "lst_paid_row",
      weekId: WEEK,
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://example.com/acme",
      bidUsd: 5,
      clicks: 3,
      createdAt: "2026-08-17T00:00:00.000Z",
    });
    assert.throws(
      () => getPublicListing(db, "lst_ghost_row"),
      (error: unknown) =>
        error instanceof ClickError && error.code === "listing_not_found",
    );
    const paid = getPublicListing(db, "lst_paid_row");
    assert.equal(paid.clicks, 3);
    const confirm = confirmBriefHtml(paid);
    assert.match(confirm, /class="confirm-clicks later-fact"/);
    assert.match(confirm, /data-later-fact=""/);
    assert.match(confirm, /3 public hops — not reach/);
    assert.doesNotMatch(confirm, /Ghost Co|Abandoned Waffo checkout/);
    assert.equal(getPublicListing(db, "lst_paid_row").clicks, 3);
  } finally {
    db.close();
  }
});

test("occupied confirm $bid stays a later fact after terms and does not shout beside the prize", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const termsSize = css.match(/\.confirm-terms\s*\{[^}]*font-size:\s*([\d.]+)rem/);
  const bidSize = css.match(
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-bid\.later-fact\[data-later-fact\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const bidBlock = css.match(
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-bid\.later-fact\[data-later-fact\]\s*\{[^}]*\}/,
  );
  assert.ok(termsSize);
  assert.ok(bidSize);
  assert.ok(bidBlock);
  assert.ok(Number(termsSize[1]) > Number(bidSize[1]));
  assert.match(bidBlock[0], /flex-basis:\s*100%/);
  assert.match(bidBlock[0], /color:\s*var\(--muted\)/);
  assert.match(bidBlock[0], /font-weight:\s*500/);
  assert.doesNotMatch(bidBlock[0], /color:\s*var\(--bid\)/);
  assert.doesNotMatch(
    css,
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-bid\.later-fact\[data-later-fact\]\s*\{[^}]*color:\s*var\(--bid\)/,
  );

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(
    empty,
    CONFIRMED_CHECKOUT_COPY,
  );
  assert.doesNotMatch(empty, /confirm-bid/);
  assert.doesNotMatch(empty, /class="confirm-bid later-fact"/);
  assert.doesNotMatch(empty, /data-later-fact/);
  assert.doesNotMatch(empty, /later-fact/);
  assert.doesNotMatch(empty, /data-confirm-before-leave/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, FORBIDDEN);

  const unpaid = listing({
    id: "lst_ghost",
    brand: "Ghost Co",
    terms: "Abandoned Waffo checkout.",
    bidUsd: 50,
    clicks: 9,
    createdAt: "",
  });
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        unpaid,
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          clicks: 4,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          clicks: 11,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const terms = lead.indexOf('data-prize=""');
  const hop = lead.indexOf('data-open-brief=""');
  const firstClick = lead.indexOf('data-first-click="open"');
  const leadBid = lead.indexOf('class="bid later-fact"');
  assert.ok(terms >= 0 && hop > terms && firstClick > terms);
  assert.ok(leadBid > terms);
  assert.match(lead, /class="terms prize-before-price"/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.doesNotMatch(occupied, /Ghost Co|Abandoned Waffo checkout/);
  assert.doesNotMatch(occupied, /data-id="lst_ghost"/);
  assert.doesNotMatch(occupied, /class="confirm-bid later-fact"/);
  assert.doesNotMatch(occupied, FORBIDDEN);

  const html = confirmBriefHtml(
    listing({
      id: "lst_acme",
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://briefs.example.com/acme?id=9",
      bidUsd: 5,
      clicks: 3,
      createdAt: "2026-08-17T00:00:00.000Z",
    }),
  );
  const termsCopy = html.indexOf("$800 flat, 1 TikTok");
  const url = html.indexOf("https://briefs.example.com/acme?id=9");
  const leave = html.indexOf('data-leave-brief=""');
  const bidClass = html.indexOf('class="confirm-bid later-fact"');
  const bidLater = html.indexOf('data-later-fact=""', bidClass);
  const bid = html.indexOf('data-later-fact="">$5', bidClass);
  const hopsClass = html.indexOf('class="confirm-clicks later-fact"');
  const hopsLater = html.indexOf('data-later-fact=""', hopsClass);
  const hops = html.indexOf("3 public hops — not reach");
  assert.ok(termsCopy >= 0 && url > termsCopy && leave > url);
  assert.ok(
    bidClass > leave &&
      bidLater >= bidClass &&
      bid >= bidClass &&
      hopsClass > bid &&
      hopsLater >= hopsClass &&
      hops > hopsLater,
  );
  assert.match(html, /class="confirm-bid later-fact"/);
  assert.match(html, /class="confirm-clicks later-fact"/);
  assert.match(html, /data-later-fact=""/);
  assert.match(html, /data-confirm-before-leave=""/);
  assert.match(html, /Leave to the brief/);
  assert.equal((html.match(/class="confirm-bid later-fact"/g) ?? []).length, 1);
  assert.equal((html.match(/class="confirm-clicks later-fact"/g) ?? []).length, 1);
  assert.equal((html.match(/data-later-fact=""/g) ?? []).length, 2);
  assert.doesNotMatch(html, FORBIDDEN);

  const db = openDatabase(":memory:");
  try {
    insertFixtureListing(db, {
      id: "lst_ghost_row",
      weekId: WEEK,
      brand: "Ghost Co",
      terms: "Abandoned Waffo checkout.",
      briefUrl: "https://example.com/ghost",
      bidUsd: 50,
      clicks: 9,
      createdAt: "",
    });
    insertFixtureListing(db, {
      id: "lst_paid_row",
      weekId: WEEK,
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://example.com/acme",
      bidUsd: 5,
      clicks: 3,
      createdAt: "2026-08-17T00:00:00.000Z",
    });
    assert.throws(
      () => getPublicListing(db, "lst_ghost_row"),
      (error: unknown) =>
        error instanceof ClickError && error.code === "listing_not_found",
    );
    const paid = getPublicListing(db, "lst_paid_row");
    assert.equal(paid.clicks, 3);
    const confirm = confirmBriefHtml(paid);
    assert.match(confirm, /class="confirm-bid later-fact"/);
    assert.match(confirm, /data-later-fact=""/);
    assert.match(confirm, /data-later-fact="">\$5/);
    assert.match(confirm, /class="confirm-clicks later-fact"/);
    assert.doesNotMatch(confirm, /Ghost Co|Abandoned Waffo checkout/);
    assert.equal(getPublicListing(db, "lst_paid_row").clicks, 3);
  } finally {
    db.close();
  }
});

test("occupied confirm Terms stay the prize over brand and do not let brand shout", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const brandBlock = css.match(
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-brand\s*\{[^}]*\}/,
  );
  const termsCopyBlock = css.match(
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-terms-copy\s*\{[^}]*\}/,
  );
  const brandSize = brandBlock?.[0].match(/font-size:\s*([\d.]+)rem/);
  const termsCopySize = termsCopyBlock?.[0].match(/font-size:\s*([\d.]+)rem/);
  assert.ok(brandBlock);
  assert.ok(termsCopyBlock);
  assert.ok(brandSize);
  assert.ok(termsCopySize);
  assert.ok(Number(termsCopySize[1]) > Number(brandSize[1]));
  assert.match(brandBlock[0], /color:\s*var\(--muted\)/);
  assert.match(brandBlock[0], /font-weight:\s*500/);
  assert.doesNotMatch(brandBlock[0], /color:\s*var\(--bid\)/);
  assert.doesNotMatch(brandBlock[0], /clamp\(/);
  assert.match(termsCopyBlock[0], /font-weight:\s*700/);
  assert.match(termsCopyBlock[0], /color:\s*var\(--ink\)/);
  assert.doesNotMatch(
    css,
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-brand\s*\{[^}]*color:\s*var\(--bid\)/,
  );

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(
    empty,
    CONFIRMED_CHECKOUT_COPY,
  );
  assert.doesNotMatch(empty, /confirm-terms-label/);
  assert.doesNotMatch(empty, /confirm-terms-copy/);
  assert.doesNotMatch(empty, /data-confirm-before-leave/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, FORBIDDEN);

  const unpaid = listing({
    id: "lst_ghost",
    brand: "Ghost Co",
    terms: "Abandoned Waffo checkout.",
    bidUsd: 50,
    clicks: 9,
    createdAt: "",
  });
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        unpaid,
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          clicks: 4,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          clicks: 11,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const terms = lead.indexOf('data-prize=""');
  const hop = lead.indexOf('data-open-brief=""');
  const firstClick = lead.indexOf('data-first-click="open"');
  const leadBid = lead.indexOf('class="bid later-fact"');
  assert.ok(terms >= 0 && hop > terms && firstClick > terms);
  assert.ok(leadBid > terms);
  assert.match(lead, /class="terms prize-before-price"/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.doesNotMatch(occupied, /Ghost Co|Abandoned Waffo checkout/);
  assert.doesNotMatch(occupied, /data-id="lst_ghost"/);
  assert.doesNotMatch(occupied, /confirm-terms-label/);
  assert.doesNotMatch(occupied, /confirm-terms-copy/);
  assert.doesNotMatch(occupied, FORBIDDEN);

  const html = confirmBriefHtml(
    listing({
      id: "lst_acme",
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://briefs.example.com/acme?id=9",
      bidUsd: 5,
      clicks: 3,
      createdAt: "2026-08-17T00:00:00.000Z",
    }),
  );
  const brandClass = html.indexOf('class="confirm-brand"');
  const brandCopy = html.indexOf("Acme", brandClass);
  const prize = html.indexOf('data-prize=""');
  const termsLabel = html.indexOf('class="confirm-terms-label">Terms');
  const termsCopyClass = html.indexOf('class="confirm-terms-copy"');
  const termsCopy = html.indexOf("$800 flat, 1 TikTok");
  const url = html.indexOf("https://briefs.example.com/acme?id=9");
  const leave = html.indexOf('data-leave-brief=""');
  const bidClass = html.indexOf('class="confirm-bid later-fact"');
  const hopsClass = html.indexOf('class="confirm-clicks later-fact"');
  assert.ok(brandClass >= 0 && brandCopy >= brandClass);
  assert.ok(prize > brandCopy && termsLabel >= prize && termsCopyClass > termsLabel);
  assert.ok(termsCopy > termsCopyClass && url > termsCopy && leave > url);
  assert.ok(bidClass > leave && hopsClass > bidClass);
  assert.match(html, /<p class="confirm-brand">Acme<\/p>/);
  assert.match(html, /<h1 class="confirm-terms" data-terms="" data-prize="">/);
  assert.match(html, /class="confirm-terms-label">Terms/);
  assert.match(html, /class="confirm-terms-copy">\$800 flat, 1 TikTok/);
  assert.match(html, /class="confirm-bid later-fact"/);
  assert.match(html, /class="confirm-clicks later-fact"/);
  assert.match(html, /data-confirm-before-leave=""/);
  assert.match(html, /Leave to the brief/);
  assert.equal((html.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((html.match(/class="confirm-bid later-fact"/g) ?? []).length, 1);
  assert.equal((html.match(/class="confirm-clicks later-fact"/g) ?? []).length, 1);
  assert.equal((html.match(/data-later-fact=""/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<h1 class="confirm-brand">/);
  assert.doesNotMatch(html, FORBIDDEN);

  const db = openDatabase(":memory:");
  try {
    insertFixtureListing(db, {
      id: "lst_ghost_row",
      weekId: WEEK,
      brand: "Ghost Co",
      terms: "Abandoned Waffo checkout.",
      briefUrl: "https://example.com/ghost",
      bidUsd: 50,
      clicks: 9,
      createdAt: "",
    });
    insertFixtureListing(db, {
      id: "lst_paid_row",
      weekId: WEEK,
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://example.com/acme",
      bidUsd: 5,
      clicks: 3,
      createdAt: "2026-08-17T00:00:00.000Z",
    });
    assert.throws(
      () => getPublicListing(db, "lst_ghost_row"),
      (error: unknown) =>
        error instanceof ClickError && error.code === "listing_not_found",
    );
    const paid = getPublicListing(db, "lst_paid_row");
    assert.equal(paid.clicks, 3);
    const confirm = confirmBriefHtml(paid);
    assert.match(confirm, /<p class="confirm-brand">Acme<\/p>/);
    assert.match(confirm, /<h1 class="confirm-terms" data-terms="" data-prize="">/);
    assert.match(confirm, /class="confirm-terms-label">Terms/);
    assert.match(confirm, /class="confirm-terms-copy">\$800 flat, 1 TikTok/);
    assert.match(confirm, /class="confirm-bid later-fact"/);
    assert.match(confirm, /class="confirm-clicks later-fact"/);
    assert.doesNotMatch(confirm, /<h1 class="confirm-brand">/);
    assert.doesNotMatch(confirm, /Ghost Co|Abandoned Waffo checkout/);
    assert.equal(getPublicListing(db, "lst_paid_row").clicks, 3);
  } finally {
    db.close();
  }
});

test("occupied confirm uncounted preview recedes after terms and does not shout over the prize", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const uncountedBlock = css.match(
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-uncounted\[data-confirm-uncounted\]\s*\{[^}]*\}/,
  );
  const termsCopyBlock = css.match(
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-terms-copy\s*\{[^}]*\}/,
  );
  const uncountedSize = uncountedBlock?.[0].match(/font-size:\s*([\d.]+)rem/);
  const termsCopySize = termsCopyBlock?.[0].match(/font-size:\s*([\d.]+)rem/);
  assert.ok(uncountedBlock);
  assert.ok(termsCopyBlock);
  assert.ok(uncountedSize);
  assert.ok(termsCopySize);
  assert.ok(Number(termsCopySize[1]) > Number(uncountedSize[1]));
  assert.match(uncountedBlock[0], /color:\s*var\(--muted\)/);
  assert.match(uncountedBlock[0], /font-weight:\s*500/);
  assert.doesNotMatch(uncountedBlock[0], /color:\s*var\(--ink\)/);
  assert.doesNotMatch(uncountedBlock[0], /color:\s*var\(--bid\)/);
  assert.doesNotMatch(uncountedBlock[0], /font-weight:\s*700/);
  assert.match(termsCopyBlock[0], /font-weight:\s*700/);
  assert.match(termsCopyBlock[0], /color:\s*var\(--ink\)/);
  assert.doesNotMatch(
    css,
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-uncounted\[data-confirm-uncounted\]\s*\{[^}]*color:\s*var\(--ink\)/,
  );

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(
    empty,
    CONFIRMED_CHECKOUT_COPY,
  );
  assert.doesNotMatch(empty, /Opening this flyer has not counted a hop/);
  assert.doesNotMatch(empty, /data-confirm-uncounted/);
  assert.doesNotMatch(empty, /data-confirm-before-leave/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, FORBIDDEN);

  const unpaid = listing({
    id: "lst_ghost",
    brand: "Ghost Co",
    terms: "Abandoned Waffo checkout.",
    bidUsd: 50,
    clicks: 9,
    createdAt: "",
  });
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        unpaid,
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          clicks: 4,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          clicks: 11,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const terms = lead.indexOf('data-prize=""');
  const hop = lead.indexOf('data-open-brief=""');
  const firstClick = lead.indexOf('data-first-click="open"');
  const leadBid = lead.indexOf('class="bid later-fact"');
  assert.ok(terms >= 0 && hop > terms && firstClick > terms);
  assert.ok(leadBid > terms);
  assert.match(lead, /class="terms prize-before-price"/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.doesNotMatch(occupied, /Ghost Co|Abandoned Waffo checkout/);
  assert.doesNotMatch(occupied, /data-id="lst_ghost"/);
  assert.doesNotMatch(occupied, /Opening this flyer has not counted a hop/);
  assert.doesNotMatch(occupied, /data-confirm-uncounted/);
  assert.doesNotMatch(occupied, FORBIDDEN);

  const html = confirmBriefHtml(
    listing({
      id: "lst_acme",
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://briefs.example.com/acme?id=9",
      bidUsd: 5,
      clicks: 3,
      createdAt: "2026-08-17T00:00:00.000Z",
    }),
  );
  const prize = html.indexOf('data-prize=""');
  const termsLabel = html.indexOf('class="confirm-terms-label">Terms');
  const termsCopyClass = html.indexOf('class="confirm-terms-copy"');
  const termsCopy = html.indexOf("$800 flat, 1 TikTok");
  const uncounted = html.indexOf('data-confirm-uncounted=""');
  const uncountedCopy = html.indexOf("Opening this flyer has not counted a hop.");
  const url = html.indexOf("https://briefs.example.com/acme?id=9");
  const leave = html.indexOf('data-leave-brief=""');
  const bidClass = html.indexOf('class="confirm-bid later-fact"');
  const hopsClass = html.indexOf('class="confirm-clicks later-fact"');
  assert.ok(prize >= 0 && termsLabel >= prize && termsCopyClass > termsLabel);
  assert.ok(termsCopy > termsCopyClass);
  assert.ok(uncounted > termsCopy && uncountedCopy >= uncounted);
  assert.ok(url > uncountedCopy && leave > url);
  assert.ok(bidClass > leave && hopsClass > bidClass);
  assert.match(html, /<h1 class="confirm-terms" data-terms="" data-prize="">/);
  assert.match(html, /class="confirm-terms-label">Terms/);
  assert.match(html, /class="confirm-terms-copy">\$800 flat, 1 TikTok/);
  assert.match(html, /data-confirm-uncounted="">Opening this flyer has not counted a hop/);
  assert.match(html, /class="confirm-bid later-fact"/);
  assert.match(html, /class="confirm-clicks later-fact"/);
  assert.match(html, /data-confirm-before-leave=""/);
  assert.match(html, /Leave to the brief/);
  assert.equal((html.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-confirm-uncounted=""/g) ?? []).length, 1);
  assert.equal((html.match(/class="confirm-bid later-fact"/g) ?? []).length, 1);
  assert.equal((html.match(/class="confirm-clicks later-fact"/g) ?? []).length, 1);
  assert.equal((html.match(/data-later-fact=""/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<h1 class="confirm-brand">/);
  assert.doesNotMatch(html, FORBIDDEN);

  const db = openDatabase(":memory:");
  try {
    insertFixtureListing(db, {
      id: "lst_ghost_row",
      weekId: WEEK,
      brand: "Ghost Co",
      terms: "Abandoned Waffo checkout.",
      briefUrl: "https://example.com/ghost",
      bidUsd: 50,
      clicks: 9,
      createdAt: "",
    });
    insertFixtureListing(db, {
      id: "lst_paid_row",
      weekId: WEEK,
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://example.com/acme",
      bidUsd: 5,
      clicks: 3,
      createdAt: "2026-08-17T00:00:00.000Z",
    });
    assert.throws(
      () => getPublicListing(db, "lst_ghost_row"),
      (error: unknown) =>
        error instanceof ClickError && error.code === "listing_not_found",
    );
    const paid = getPublicListing(db, "lst_paid_row");
    assert.equal(paid.clicks, 3);
    const confirm = confirmBriefHtml(paid);
    assert.match(confirm, /<h1 class="confirm-terms" data-terms="" data-prize="">/);
    assert.match(confirm, /class="confirm-terms-label">Terms/);
    assert.match(confirm, /class="confirm-terms-copy">\$800 flat, 1 TikTok/);
    const paidTerms = confirm.indexOf("$800 flat, 1 TikTok");
    const paidUncounted = confirm.indexOf("Opening this flyer has not counted a hop.");
    assert.ok(paidTerms >= 0 && paidUncounted > paidTerms);
    assert.match(confirm, /data-confirm-uncounted=""/);
    assert.match(confirm, /class="confirm-bid later-fact"/);
    assert.match(confirm, /class="confirm-clicks later-fact"/);
    assert.doesNotMatch(confirm, /<h1 class="confirm-brand">/);
    assert.doesNotMatch(confirm, /Ghost Co|Abandoned Waffo checkout/);
    assert.equal(getPublicListing(db, "lst_paid_row").clicks, 3);
  } finally {
    db.close();
  }
});

test("occupied confirm brief URL recedes after terms and does not shout over the prize", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const urlBlock = css.match(
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-url\[data-brief-url\]\s*\{[^}]*\}/,
  );
  const termsCopyBlock = css.match(
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-terms-copy\s*\{[^}]*\}/,
  );
  const urlSize = urlBlock?.[0].match(/font-size:\s*([\d.]+)rem/);
  const termsCopySize = termsCopyBlock?.[0].match(/font-size:\s*([\d.]+)rem/);
  assert.ok(urlBlock);
  assert.ok(termsCopyBlock);
  assert.ok(urlSize);
  assert.ok(termsCopySize);
  assert.ok(Number(termsCopySize[1]) > Number(urlSize[1]));
  assert.match(urlBlock[0], /color:\s*var\(--muted\)/);
  assert.match(urlBlock[0], /font-weight:\s*500/);
  assert.doesNotMatch(urlBlock[0], /color:\s*var\(--ink\)/);
  assert.doesNotMatch(urlBlock[0], /color:\s*var\(--bid\)/);
  assert.doesNotMatch(urlBlock[0], /font-weight:\s*700/);
  assert.match(termsCopyBlock[0], /font-weight:\s*700/);
  assert.match(termsCopyBlock[0], /color:\s*var\(--ink\)/);
  assert.doesNotMatch(
    css,
    /\.confirm-sheet\.confirm-before-leave\[data-confirm-before-leave\] \.confirm-url\[data-brief-url\]\s*\{[^}]*color:\s*var\(--ink\)/,
  );

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(
    empty,
    CONFIRMED_CHECKOUT_COPY,
  );
  assert.doesNotMatch(empty, /class="confirm-url"/);
  assert.doesNotMatch(empty, /data-confirm-before-leave/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, FORBIDDEN);

  const unpaid = listing({
    id: "lst_ghost",
    brand: "Ghost Co",
    terms: "Abandoned Waffo checkout.",
    bidUsd: 50,
    clicks: 9,
    createdAt: "",
  });
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        unpaid,
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          clicks: 4,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          clicks: 11,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const lead = occupied.slice(leadStart, occupied.indexOf("</li>", leadStart));
  const terms = lead.indexOf('data-prize=""');
  const hop = lead.indexOf('data-open-brief=""');
  const firstClick = lead.indexOf('data-first-click="open"');
  const leadBid = lead.indexOf('class="bid later-fact"');
  assert.ok(terms >= 0 && hop > terms && firstClick > terms);
  assert.ok(leadBid > terms);
  assert.match(lead, /class="terms prize-before-price"/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.doesNotMatch(occupied, /Ghost Co|Abandoned Waffo checkout/);
  assert.doesNotMatch(occupied, /data-id="lst_ghost"/);
  assert.doesNotMatch(occupied, /class="confirm-url"/);
  assert.doesNotMatch(occupied, FORBIDDEN);

  const html = confirmBriefHtml(
    listing({
      id: "lst_acme",
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://briefs.example.com/acme?id=9",
      bidUsd: 5,
      clicks: 3,
      createdAt: "2026-08-17T00:00:00.000Z",
    }),
  );
  const prize = html.indexOf('data-prize=""');
  const termsLabel = html.indexOf('class="confirm-terms-label">Terms');
  const termsCopyClass = html.indexOf('class="confirm-terms-copy"');
  const termsCopy = html.indexOf("$800 flat, 1 TikTok");
  const uncounted = html.indexOf('data-confirm-uncounted=""');
  const uncountedCopy = html.indexOf("Opening this flyer has not counted a hop.");
  const urlClass = html.indexOf('class="confirm-url"');
  const url = html.indexOf("https://briefs.example.com/acme?id=9");
  const leave = html.indexOf('data-leave-brief=""');
  const bidClass = html.indexOf('class="confirm-bid later-fact"');
  const hopsClass = html.indexOf('class="confirm-clicks later-fact"');
  assert.ok(prize >= 0 && termsLabel >= prize && termsCopyClass > termsLabel);
  assert.ok(termsCopy > termsCopyClass);
  assert.ok(uncounted > termsCopy && uncountedCopy >= uncounted);
  assert.ok(urlClass > uncountedCopy && url > urlClass && leave > url);
  assert.ok(bidClass > leave && hopsClass > bidClass);
  assert.match(html, /<h1 class="confirm-terms" data-terms="" data-prize="">/);
  assert.match(html, /class="confirm-terms-label">Terms/);
  assert.match(html, /class="confirm-terms-copy">\$800 flat, 1 TikTok/);
  assert.match(html, /class="confirm-url" data-brief-url="/);
  assert.match(html, /data-confirm-uncounted="">Opening this flyer has not counted a hop/);
  assert.match(html, /class="confirm-bid later-fact"/);
  assert.match(html, /class="confirm-clicks later-fact"/);
  assert.match(html, /data-confirm-before-leave=""/);
  assert.match(html, /Leave to the brief/);
  assert.equal((html.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((html.match(/class="confirm-url"/g) ?? []).length, 1);
  assert.equal((html.match(/data-confirm-uncounted=""/g) ?? []).length, 1);
  assert.equal((html.match(/class="confirm-bid later-fact"/g) ?? []).length, 1);
  assert.equal((html.match(/class="confirm-clicks later-fact"/g) ?? []).length, 1);
  assert.equal((html.match(/data-later-fact=""/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<h1 class="confirm-brand">/);
  assert.doesNotMatch(html, FORBIDDEN);

  const db = openDatabase(":memory:");
  try {
    insertFixtureListing(db, {
      id: "lst_ghost_row",
      weekId: WEEK,
      brand: "Ghost Co",
      terms: "Abandoned Waffo checkout.",
      briefUrl: "https://example.com/ghost",
      bidUsd: 50,
      clicks: 9,
      createdAt: "",
    });
    insertFixtureListing(db, {
      id: "lst_paid_row",
      weekId: WEEK,
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://example.com/acme",
      bidUsd: 5,
      clicks: 3,
      createdAt: "2026-08-17T00:00:00.000Z",
    });
    assert.throws(
      () => getPublicListing(db, "lst_ghost_row"),
      (error: unknown) =>
        error instanceof ClickError && error.code === "listing_not_found",
    );
    const paid = getPublicListing(db, "lst_paid_row");
    assert.equal(paid.clicks, 3);
    const confirm = confirmBriefHtml(paid);
    assert.match(confirm, /<h1 class="confirm-terms" data-terms="" data-prize="">/);
    assert.match(confirm, /class="confirm-terms-label">Terms/);
    assert.match(confirm, /class="confirm-terms-copy">\$800 flat, 1 TikTok/);
    const paidTerms = confirm.indexOf("$800 flat, 1 TikTok");
    const paidUncounted = confirm.indexOf("Opening this flyer has not counted a hop.");
    const paidUrl = confirm.indexOf('class="confirm-url"');
    const paidLeave = confirm.indexOf('data-leave-brief=""');
    assert.ok(paidTerms >= 0 && paidUncounted > paidTerms);
    assert.ok(paidUrl > paidUncounted && paidLeave > paidUrl);
    assert.match(confirm, /class="confirm-url" data-brief-url="/);
    assert.match(confirm, /data-confirm-uncounted=""/);
    assert.match(confirm, /class="confirm-bid later-fact"/);
    assert.match(confirm, /class="confirm-clicks later-fact"/);
    assert.doesNotMatch(confirm, /<h1 class="confirm-brand">/);
    assert.doesNotMatch(confirm, /Ghost Co|Abandoned Waffo checkout/);
    assert.equal(getPublicListing(db, "lst_paid_row").clicks, 3);
  } finally {
    db.close();
  }
});

test("public brief-URL clicks increment once per hop and 302 without trackers", async () => {
  const db = openDatabase(":memory:");
  try {
    insertFixtureListing(db, {
      id: "lst_click",
      weekId: WEEK,
      brand: "Click Co",
      terms: "count public hops",
      briefUrl: "https://example.com/brief?id=99",
      bidUsd: 5,
      clicks: 0,
      createdAt: "2026-08-17T00:00:00.000Z",
    });

    const preview = getPublicListing(db, "lst_click");
    assert.equal(preview.clicks, 0);
    assert.equal(preview.briefUrl, "https://example.com/brief?id=99");

    const stillZero = listLiveBoard(
      db,
      new Date("2026-08-17T00:00:00.000Z"),
    );
    assert.equal(stillZero[0]?.clicks, 0);

    const first = incrementPublicClick(db, "lst_click");
    assert.equal(first.listing.clicks, 1);
    assert.equal(first.url, "https://example.com/brief?id=99");
    assert.doesNotMatch(first.url, /utm_|fbclid|gclid/);

    const second = incrementPublicClick(db, "lst_click");
    assert.equal(second.listing.clicks, 2);

    const live = listLiveBoard(db, new Date("2026-08-17T00:00:00.000Z"));
    assert.equal(live[0]?.clicks, 2);
    assert.match(renderBoard(live), /data-clicks="2"/);

    assert.throws(
      () => incrementPublicClick(db, "missing"),
      (error: unknown) =>
        error instanceof ClickError && error.code === "listing_not_found",
    );
    assert.throws(
      () => getPublicListing(db, "missing"),
      (error: unknown) =>
        error instanceof ClickError && error.code === "listing_not_found",
    );
  } finally {
    db.close();
  }
});

test("expired public brief URL is unavailable at exact rolling boundary and never increments", () => {
  const db = openDatabase(":memory:");
  const paidAt = "2026-08-17T00:00:00.000Z";
  const exactBoundary = new Date(Date.parse(paidAt) + ROLLING_WEEK_MS);
  const activeJustBefore = new Date(exactBoundary.getTime() - 1);
  try {
    insertFixtureListing(db, {
      id: "lst_expired_click",
      weekId: WEEK,
      brand: "Expired Click Co",
      terms: "expired brief stays read-only",
      briefUrl: "https://example.com/expired-click",
      bidUsd: 5,
      clicks: 0,
      createdAt: paidAt,
    });

    assert.equal(
      getPublicListingAt(db, "lst_expired_click", activeJustBefore).clicks,
      0,
    );
    const activeHop = incrementPublicClickAt(
      db,
      "lst_expired_click",
      activeJustBefore,
    );
    assert.equal(activeHop.listing.clicks, 1);
    assert.equal(
      listLiveBoard(db, activeJustBefore).some(
        (listing) => listing.id === "lst_expired_click",
      ),
      true,
    );

    assert.throws(
      () => getPublicListingAt(db, "lst_expired_click", exactBoundary),
      (error: unknown) =>
        error instanceof ClickError &&
        error.code === "listing_not_found" &&
        error.httpStatus === 404,
    );
    assert.throws(
      () => incrementPublicClickAt(db, "lst_expired_click", exactBoundary),
      (error: unknown) =>
        error instanceof ClickError &&
        error.code === "listing_not_found" &&
        error.httpStatus === 404,
    );
    assert.equal(listLiveBoard(db, exactBoundary).length, 0);
    assert.equal(
      (db.prepare("SELECT clicks FROM listings WHERE id = ?").get("lst_expired_click") as { clicks: number })
        .clicks,
      1,
    );
  } finally {
    db.close();
  }
});

test("previous week rows are absent from the live board", () => {
  const db = openDatabase(":memory:");
  try {
    insertFixtureListing(db, {
      id: "lst_old",
      weekId: "2026-W33",
      brand: "Last Week",
      terms: "expired brief",
      briefUrl: "https://example.com/old",
      bidUsd: 50,
      clicks: 9,
      createdAt: "2026-08-10T00:00:01.000Z",
    });
    insertFixtureListing(db, {
      id: "lst_live",
      weekId: WEEK,
      brand: "This Week",
      terms: "current brief",
      briefUrl: "https://example.com/live",
      bidUsd: 5,
      clicks: 1,
      createdAt: "2026-08-17T00:00:00.001Z",
    });

    const live = listLiveBoard(db, new Date("2026-08-17T00:00:00.002Z"));
    assert.equal(live.length, 2);
    assert.equal(live[0]?.id, "lst_old");
    assert.equal(live[1]?.id, "lst_live");
    const laterMonday = listLiveBoard(
      db,
      new Date("2026-08-24T00:00:00.000Z"),
    );
    assert.equal(laterMonday.length, 1);
    assert.equal(laterMonday[0]?.id, "lst_live");
    assert.equal(
      listLiveBoard(db, new Date("2026-08-24T00:00:01.000Z")).length,
      0,
    );

    const stored = db.prepare("SELECT COUNT(*) AS n FROM listings").get() as {
      n: number;
    };
    assert.equal(stored.n, 2);
  } finally {
    db.close();
  }
});

test("occupied week window is rolling last-7-days — not Monday 00:00 UTC", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(empty, /data-first-click="claim"/);
  assert.doesNotMatch(empty, /data-rolling-week/);
  assert.doesNotMatch(empty, /The board resets Monday 00:00 UTC/);
  assert.doesNotMatch(empty, /Rolling last 7 days\. Not Monday 00:00 UTC\./);
  assert.match(
    empty,
    /Each confirmed brief stays live for seven days/,
  );
  assert.match(empty, /data-empty-window=""/);
  assert.match(empty, /class="rules-note empty-window"/);
  assert.doesNotMatch(empty, /class="rules-note week-window"/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /24h lock/);
  assert.doesNotMatch(empty, FORBIDDEN);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-16T12:00:00.000Z",
        }),
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          bidUsd: 5,
          createdAt: "2026-08-16T18:00:00.000Z",
        }),
      ]),
    }),
  );
  const prizeAt = occupied.indexOf('data-prize=""');
  const firstClickAt = occupied.indexOf('data-first-click="open"');
  const laterOpenAt = occupied.indexOf('data-later-open=""');
  const postAt = occupied.indexOf('data-post-brief=""');
  const windowAt = occupied.indexOf('data-rolling-week=""');
  const claimAt = occupied.indexOf('id="claim"');
  const flyersAt = occupied.indexOf('aria-label="Paid briefs — rolling last 7 days"');
  assert.ok(prizeAt >= 0 && firstClickAt > prizeAt);
  assert.ok(laterOpenAt > firstClickAt && postAt > laterOpenAt);
  assert.ok(flyersAt >= 0 && windowAt >= flyersAt && firstClickAt > windowAt);
  assert.ok(claimAt < flyersAt);
  assert.match(occupied, /data-occupied="true"/);
  assert.match(occupied, /data-rolling-week=""/);
  assert.match(occupied, /Each paid brief stays live for seven days/);
  assert.match(occupied, /class="terms-label">Terms/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /data-later-flyer=""/);
  assert.match(occupied, /Post a brief/);
  assert.doesNotMatch(occupied, /data-empty-claim-first/);
  assert.doesNotMatch(occupied, /24h lock/);
  assert.doesNotMatch(occupied, FORBIDDEN);

  const css = cssSource;
  assert.match(css, /\.wall-occupied \.cards-lead\[data-rolling-week\]/);
  assert.match(
    css,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \[data-rolling-week\]/,
  );
  assert.doesNotMatch(css, /background:\s*var\(--bid-ink\)/);
});

test("empty wall copy is a rolling last-7-days window — not Monday 00:00 UTC", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  const claimAt = empty.indexOf("Claim #1 for");
  const outbidAt = empty.indexOf(">Claim rank<");
  const windowAt = empty.indexOf('data-empty-window=""');
  const plasterAt = empty.indexOf('data-empty-week="true"');
  assert.ok(claimAt >= 0 && plasterAt > claimAt && windowAt > plasterAt);
  assert.ok(outbidAt > claimAt && plasterAt > outbidAt && windowAt > plasterAt);
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /data-first-click="claim"/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /data-empty-window=""/);
  assert.match(empty, /class="rules-note empty-window"/);
  assert.match(
    empty,
    /Each confirmed brief stays live for seven days/,
  );
  assert.doesNotMatch(empty, /The board resets Monday 00:00 UTC/);
  assert.doesNotMatch(empty, /Rolling last 7 days\. Not Monday 00:00 UTC\./);
  assert.doesNotMatch(empty, /data-rolling-week/);
  assert.doesNotMatch(empty, /class="rules-note week-window"/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /24h lock/);
  assert.doesNotMatch(empty, /data-unpaid-off/);
  assert.doesNotMatch(empty, FORBIDDEN);
  assert.match(boardMarkupSource, /data-empty-window=""/);
  assert.match(
    boardMarkupSource,
    /Each confirmed brief stays live for seven days/,
  );
  assert.doesNotMatch(boardMarkupSource, /The board resets Monday 00:00 UTC/);
  assert.match(
    cssSource,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.paste-rail\.empty-claim-first\[data-empty-claim-first\] \.empty-hint\[data-empty-window\]/,
  );
  assert.match(cssSource, /\.rules-note\.empty-window\[data-empty-window\]/);
  assert.match(
    cssSource,
    /\.wall-occupied \.empty-hint\[data-empty-window\]/,
  );
  assert.doesNotMatch(cssSource, /background:\s*var\(--bid-ink\)/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-16T12:00:00.000Z",
        }),
      ]),
    }),
  );
  const prizeAt = occupied.indexOf('data-prize=""');
  const firstClickAt = occupied.indexOf('data-first-click="open"');
  const rollingAt = occupied.indexOf('data-rolling-week=""');
  assert.ok(prizeAt >= 0 && firstClickAt > prizeAt);
  assert.ok(rollingAt >= 0 && firstClickAt > rollingAt);
  assert.match(occupied, /class="terms-label">Terms/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /Each paid brief stays live for seven days/);
  assert.match(occupied, /class="rules-note week-window"/);
  assert.doesNotMatch(occupied, /data-empty-window/);
  assert.doesNotMatch(occupied, /class="rules-note empty-window"/);
  assert.doesNotMatch(occupied, /The board resets Monday 00:00 UTC/);
  assert.doesNotMatch(occupied, /Each confirmed brief stays live for seven days/);
  assert.doesNotMatch(occupied, /24h lock/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("unpaid stays off the plaster wall — No Terms until Waffo reports paid", () => {
  const markup = readFileSync(
    join(process.cwd(), "src", "lib", "board-markup.tsx"),
    "utf8",
  );
  const board = readFileSync(join(process.cwd(), "src", "app", "board.tsx"), "utf8");
  const week = readFileSync(join(process.cwd(), "src", "lib", "week.ts"), "utf8");
  const clicks = readFileSync(join(process.cwd(), "src", "lib", "clicks.ts"), "utf8");
  const rank = readFileSync(join(process.cwd(), "src", "lib", "rank.ts"), "utf8");
  assert.match(rank, /export function isWaffoPaidListing/);
  assert.match(rank, /export function paidListings/);
  assert.match(rank, /paidListings\(listings\)/);
  assert.match(board, /const paid = rankListings\(listings\)/);
  assert.match(board, /<BoardCards listings=\{paid\} \/>/);
  assert.match(markup, /if \(!isWaffoPaidListing\(listing\)\) \{\n    return null;/);
  assert.match(markup, /data-waffo-paid=""/);
  assert.match(markup, /const paid = rankListings\(listings\)/);
  assert.match(week, /hasCompletedWaffoPayment/);
  assert.match(week, /AND payments.status = 'completed'/);
  assert.match(clicks, /isWaffoPaidListing/);
  assert.match(clicks, /hasCompletedWaffoPayment/);
  assert.match(formSource, CONFIRMED_CHECKOUT_COPY);
  assert.match(cssSource, /\.wall-occupied \.card:not\(\[data-waffo-paid\]\)/);
  assert.match(
    cssSource,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.card:not\(\[data-waffo-paid\]\)/,
  );
  const unpaidHide = cssSource.match(
    /\.wall-occupied \.card:not\(\[data-waffo-paid\]\),\s*\.wall-stage\.wall-empty\[data-occupied="false"\] \.card:not\(\[data-waffo-paid\]\)\s*\{([^}]*)\}/,
  );
  assert.ok(unpaidHide);
  assert.match(unpaidHide[1], /display:\s*none/);
  assert.doesNotMatch(unpaidHide[1], /background:|var\(--bid-ink\)/);
  assert.doesNotMatch(cssSource, /data-unpaid-off|data-unpaid-off-board/);
  assert.match(markup, /data-prize=/);
  assert.match(markup, /data-first-click="open"/);
  assert.match(markup, /Open brief/);
  assert.match(markup, /Post a brief/);
  assert.match(formSource, /Claim #1 for/);
  assert.match(formSource, /className="amount-field"/);
  assert.match(formSource, /className="step"/);
  assert.match(formSource, /Claim rank/);
  assert.match(markup, /className="plaster"/);

  const unpaid = listing({
    id: "lst_ghost",
    brand: "Ghost",
    terms: "Abandoned Waffo checkout.",
    briefUrl: "https://example.com/ghost",
    bidUsd: 99,
    createdAt: "",
  });
  const abandoned = listing({
    id: "lst_abandoned",
    brand: "Vapor Co",
    terms: "Epoch createdAt is not Waffo paid.",
    briefUrl: "https://example.com/vapor",
    bidUsd: 80,
    createdAt: "1970-01-01T00:00:00.000Z",
  });
  const paid = listing({
    id: "lst_paid_only",
    brand: "Acme",
    terms: "$800 flat, 1 TikTok",
    briefUrl: "https://example.com/acme",
    bidUsd: 5,
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  const laterPaid = listing({
    id: "lst_later",
    brand: "Hopper Co",
    terms: "later rank",
    briefUrl: "https://example.com/hopper",
    bidUsd: 5,
    createdAt: "2026-08-18T00:00:00.000Z",
  });

  assert.equal(isWaffoPaidListing(unpaid), false);
  assert.equal(isWaffoPaidListing(abandoned), false);
  assert.equal(isWaffoPaidListing(paid), true);
  assert.deepEqual(paidListings([unpaid, abandoned]), []);
  assert.deepEqual(rankListings([unpaid, abandoned]), []);
  const rankedPaid = rankListings([unpaid, abandoned, paid, laterPaid]);
  assert.equal(rankedPaid.length, 2);
  assert.equal(rankedPaid[0]?.id, "lst_paid_only");
  assert.equal(rankedPaid[0]?.rank, 1);
  assert.doesNotMatch(
    rankedPaid.map((row) => row.id).join(","),
    /lst_ghost|lst_abandoned/,
  );

  const leftover = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: [
        { ...unpaid, rank: 1 },
        { ...abandoned, rank: 2 },
      ],
    }),
  );
  assert.match(leftover, /data-occupied="false"/);
  assert.match(leftover, /class="wall-stage wall-empty"/);
  assert.match(leftover, /Claim #1 for/);
  assert.match(leftover, /data-first-click="claim"/);
  assert.match(leftover, /Blank plaster/);
  assert.match(leftover, CONFIRMED_CHECKOUT_COPY);
  assert.match(
    leftover,
    /Each confirmed brief stays live for seven days/,
  );
  assert.doesNotMatch(leftover, /The board resets Monday 00:00 UTC/);
  assert.match(leftover, />Claim rank</);
  const leftoverClaim = leftover.indexOf("Claim #1 for");
  const leftoverOutbid = leftover.indexOf(">Claim rank<");
  assert.ok(leftoverClaim >= 0 && leftoverOutbid > leftoverClaim);
  assert.doesNotMatch(leftover, /Ghost|Vapor Co|Abandoned Waffo checkout|Epoch createdAt/);
  assert.doesNotMatch(leftover, /data-bid="99"|data-bid="80"/);
  assert.doesNotMatch(leftover, />\$99<|>\$80</);
  assert.doesNotMatch(leftover, /data-prize=/);
  assert.doesNotMatch(leftover, /data-open-brief/);
  assert.doesNotMatch(leftover, /Open brief/);
  assert.doesNotMatch(leftover, /Post a brief/);
  assert.doesNotMatch(leftover, /data-first-click="open"/);
  assert.doesNotMatch(leftover, /data-later-flyer/);
  assert.doesNotMatch(leftover, /data-later-pack/);
  assert.doesNotMatch(leftover, /data-rolling-week/);
  assert.doesNotMatch(leftover, /data-unpaid-off/);
  assert.doesNotMatch(leftover, FORBIDDEN);

  const leftoverCards = renderBoard([unpaid, abandoned]);
  assert.match(leftoverCards, /data-empty-week="true"/);
  assert.match(leftoverCards, /The plaster is blank/);
  assert.match(leftoverCards, CONFIRMED_CHECKOUT_COPY);
  assert.doesNotMatch(leftoverCards, /Ghost|Vapor Co|data-prize=|Open brief|Post a brief/);

  const leftoverFlyer = renderToStaticMarkup(
    createElement(OccupiedFlyers, {
      listings: [{ ...unpaid, rank: 1 }, { ...abandoned, rank: 2 }],
    }),
  );
  assert.equal(leftoverFlyer, "");

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.match(empty, CONFIRMED_CHECKOUT_COPY);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /data-unpaid-off/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: [
        { ...unpaid, rank: 1 },
        ...rankListings([paid, laterPaid]),
      ],
    }),
  );
  const prizeAt = occupied.indexOf('data-prize=""');
  const firstClickAt = occupied.indexOf('data-first-click="open"');
  const laterOpenAt = occupied.indexOf('data-later-open=""');
  const postAt = occupied.indexOf('data-post-brief=""');
  const windowAt = occupied.indexOf('data-rolling-week=""');
  const claimAt = occupied.indexOf('id="claim"');
  assert.ok(prizeAt >= 0 && firstClickAt > prizeAt);
  assert.ok(laterOpenAt > firstClickAt && postAt > laterOpenAt);
  assert.ok(windowAt >= 0 && firstClickAt > windowAt);
  assert.ok(claimAt < windowAt);
  assert.match(occupied, /data-occupied="true"/);
  assert.match(occupied, /data-waffo-paid=""/);
  assert.match(occupied, /class="terms-label">Terms/);
  assert.match(occupied, /\$800 flat, 1 TikTok/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /data-later-flyer=""/);
  assert.match(occupied, /Post a brief/);
  assert.match(occupied, CONFIRMED_CHECKOUT_COPY);
  assert.match(occupied, /Each paid brief stays live for seven days/);
  assert.doesNotMatch(occupied, /Ghost|Vapor Co|Abandoned Waffo checkout/);
  assert.doesNotMatch(occupied, /data-empty-claim-first/);
  assert.doesNotMatch(occupied, /data-unpaid-off/);
  assert.equal((occupied.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, FORBIDDEN);

  const db = openDatabase(":memory:");
  try {
    db.prepare(
      `INSERT INTO listings (
        id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "lst_ghost_row",
      WEEK,
      "Ghost",
      "Abandoned Waffo checkout.",
      "https://example.com/ghost-row",
      null,
      99,
      4,
      "2026-08-17T00:00:00.000Z",
      "2026-08-17T00:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO payments (
        id, listing_id, week_id, brief_url, amount_usd, kind, status, polar_checkout_id, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "pay_ghost_pending",
      "lst_ghost_row",
      WEEK,
      "https://example.com/ghost-row",
      99,
      "place",
      "pending",
      "chk_ghost",
      "2026-08-17T00:00:00.000Z",
      null,
    );
    insertFixtureListing(db, {
      id: "lst_paid_row",
      weekId: WEEK,
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://example.com/acme-row",
      bidUsd: 5,
      createdAt: "2026-08-17T01:00:00.000Z",
    });
    const live = listLiveBoard(db, new Date("2026-08-17T12:00:00.000Z"));
    assert.equal(live.length, 1);
    assert.equal(live[0]?.id, "lst_paid_row");
    assert.doesNotMatch(live.map((row) => row.id).join(","), /lst_ghost_row/);
    assert.throws(
      () => getPublicListing(db, "lst_ghost_row"),
      (error: unknown) =>
        error instanceof ClickError && error.code === "listing_not_found",
    );
    assert.equal(getPublicListing(db, "lst_paid_row").brand, "Acme");
    const stillZero = getPublicListing(db, "lst_paid_row");
    assert.equal(stillZero.clicks, 0);
  } finally {
    db.close();
  }
});

test("occupied checkout copy explains full bids and raise differences without provider copy", () => {
  assert.match(formSource, /data-raise-difference=""/);
  assert.match(formSource, /Raise charge: \$/);
  assert.match(formSource, /data-raise-charge-usd=""/);
  assert.match(formSource, /only the difference, not a new full bid/);
  assert.match(formSource, /A raise charges only the difference/);
  assert.match(formSource, /A new brief pays the full amount/);
  assert.match(
    formSource,
    /same brief link already on the wall[\s\S]*pays only the difference/,
  );
  assert.match(
    formSource,
    CONFIRMED_CHECKOUT_COPY,
  );
  assert.match(formSource, /Claim #1 for/);
  assert.match(formSource, /className="amount-field"/);
  assert.match(formSource, /className="step"/);
  assert.match(formSource, /Claim rank/);
  const markup = readFileSync(
    join(process.cwd(), "src", "lib", "board-markup.tsx"),
    "utf8",
  );
  assert.match(markup, /data-prize=/);
  assert.match(markup, /data-first-click="open"/);
  assert.match(markup, /Open brief/);
  assert.match(markup, /Post a brief/);
  assert.match(markup, /Each confirmed brief stays live for seven days/);
  assert.doesNotMatch(markup, /data-raise-difference|data-raise-charge/);

  const raiseCss = cssSource.match(
    /\/\* Occupied checkout: Waffo charges the difference on a raise\. Unpaid stays off\. \*\/([\s\S]*?)\.wall-occupied \.card \.open-label/,
  );
  assert.ok(raiseCss);
  assert.match(
    raiseCss[1],
    /\.wall-occupied \.paste-rail \.claim-note\[data-raise-difference\]/,
  );
  assert.match(
    raiseCss[1],
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.claim-note\[data-raise-difference\]/,
  );
  assert.doesNotMatch(raiseCss[1], /background:|var\(--bid-ink\)/);

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.match(empty, /Blank plaster/);
  assert.match(
    empty,
    /Each confirmed brief stays live for seven days/,
  );
  assert.doesNotMatch(empty, /data-raise-difference/);
  assert.doesNotMatch(empty, /data-raise-charge/);
  assert.doesNotMatch(empty, /Waffo charges the difference/);
  assert.doesNotMatch(empty, /Waffo charges only the difference/);
  assert.doesNotMatch(empty, /Open brief|Post a brief|data-prize=/);
  const emptyClaim = empty.indexOf("Claim #1 for");
  const emptyOutbid = empty.indexOf(">Claim rank<");
  assert.ok(emptyClaim >= 0 && emptyOutbid > emptyClaim);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      weekId: WEEK,
      listings: rankListings([
        listing({
          id: "lst_lead",
          brand: "Lead Co",
          terms: "already #1",
          bidUsd: 7,
          createdAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_later",
          brand: "Later Co",
          terms: "later rank",
          bidUsd: 5,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const prizeAt = occupied.indexOf('data-prize=""');
  const firstClickAt = occupied.indexOf('data-first-click="open"');
  const raiseAt = occupied.indexOf('data-raise-difference=""');
  const laterOpenAt = occupied.indexOf('data-later-open=""');
  const postAt = occupied.indexOf('data-post-brief=""');
  const claimAt = occupied.indexOf('id="claim"');
  assert.ok(prizeAt >= 0 && firstClickAt > prizeAt);
  assert.ok(laterOpenAt > firstClickAt && postAt > laterOpenAt);
  assert.ok(claimAt < raiseAt);
  assert.match(occupied, /data-occupied="true"/);
  assert.match(occupied, /class="terms-label">Terms/);
  assert.match(occupied, /already #1/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /Need \$8 to take #1/);
  assert.match(occupied, /\$8 is the public bid — this flyer is first/);
  assert.match(
    occupied,
    /Raise charge: \$<span data-raise-charge-usd="">1<\/span> — only the difference, not a new full bid/,
  );
  assert.match(occupied, /data-current-usd="7"/);
  assert.match(occupied, /A new brief pays the full amount/);
  assert.match(
    occupied,
    /same brief link already on the wall[\s\S]*pays only the difference/,
  );
  assert.match(
    occupied,
    CONFIRMED_CHECKOUT_COPY,
  );
  assert.match(occupied, /Each paid brief stays live for seven days/);
  assert.doesNotMatch(occupied, /data-empty-claim-first/);
  assert.doesNotMatch(occupied, /data-unpaid-off/);
  assert.doesNotMatch(occupied, /The board resets Monday 00:00 UTC/);
  assert.equal((occupied.match(/data-raise-difference=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-prize=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, FORBIDDEN);
});
