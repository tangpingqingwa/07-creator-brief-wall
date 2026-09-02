import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { Board } from "../src/app/board";
import { type Listing, rankListings } from "../src/lib/rank";

const boardCss = readFileSync(
  join(process.cwd(), "src", "app", "board.css"),
  "utf8",
);
const layoutSource = readFileSync(
  join(process.cwd(), "src", "app", "layout.tsx"),
  "utf8",
);
const pageSource = readFileSync(
  join(process.cwd(), "src", "app", "page.tsx"),
  "utf8",
);
const markupSource = readFileSync(
  join(process.cwd(), "src", "lib", "board-markup.tsx"),
  "utf8",
);

function listing(
  partial: Partial<Listing> & Pick<Listing, "id" | "bidUsd" | "createdAt">,
): Listing {
  return {
    weekId: "2026-W35",
    brand: `Brand ${partial.id}`,
    terms: `Terms ${partial.id}`,
    briefUrl: `https://example.com/${partial.id}`,
    clicks: 0,
    updatedAt: partial.createdAt,
    ...partial,
  };
}

test("creator wall uses the ordinary plaster-flyer identity", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      weekId: "2026-W35",
      listings: rankListings([
        listing({
          id: "creator_lead",
          brand: "Northstar Studio",
          terms: "$800 flat + product, one short video",
          briefUrl: "https://example.com/brief/northstar",
          bidUsd: 17,
          clicks: 39,
          platforms: ["youtube", "tiktok"],
          createdAt: "2026-08-27T10:00:00.000Z",
        }),
        listing({
          id: "creator_later",
          brand: "Framehouse",
          terms: "$600 flat, two deliverables",
          bidUsd: 16,
          clicks: 8,
          createdAt: "2026-08-27T11:00:00.000Z",
        }),
        listing({
          id: "creator_third",
          brand: "Field Notes",
          terms: "$450 flat, usage for 30 days",
          bidUsd: 15,
          clicks: 2,
          createdAt: "2026-08-27T12:00:00.000Z",
        }),
      ]),
    }),
  );

  assert.match(html, /class="board creator-wall"/);
  assert.match(html, /data-identity="plaster-flyers"/);
  assert.match(html, /Creator Brief Wall/);
  assert.match(html, /class="mast-mark">Rolling last 7 days · UTC/);
  assert.match(html, /class="mast-nav"/);
  assert.match(html, /class="wall-context"/);
  assert.match(html, /class="wall-stage wall-occupied"/);
  assert.match(html, /aria-label="Paid briefs — rolling last 7 days"/);
  assert.equal((html.match(/data-slot="paid-card"/g) ?? []).length, 3);
  assert.match(html, /class="card card-lead"/);
  assert.match(html, /class="card later-flyer"/);
  assert.match(html, /class="terms prize-before-price"/);
  assert.match(html, /class="terms-copy">\$800 flat \+ product, one short video/);
  assert.match(html, /data-platform="youtube"/);
  assert.match(html, /data-platform="tiktok"/);
  assert.match(html, /data-open-brief=""/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /class="bid later-fact"/);
  assert.match(html, /class="clicks later-fact"/);
  assert.match(html, /class="post-brief"/);
  assert.match(html, /class="outbid-label">Claim rank/);
  assert.match(html, /data-auction-action="Outbid"/);
  assert.match(html, /aria-label="Claim rank"/);
  assert.match(html, />Claim rank</);
  assert.doesNotMatch(html, /home-board|home-window-tab|home-find|home-theme|today-ranking|latest-activity/);
  assert.doesNotMatch(html, /picks\.daily|DTC Picks|Morning edition|online|visitors|Choose category/);

  const leadStart = html.indexOf('<li class="card card-lead"');
  const leadEnd = html.indexOf("</li></ol>", leadStart) + "</li>".length;
  const lead = html.slice(leadStart, leadEnd);
  assert.ok(lead.indexOf('data-terms=""') < lead.indexOf('data-open-brief=""'));
  assert.ok(lead.indexOf('data-open-brief=""') < lead.indexOf('class="bid later-fact"'));
  assert.ok(lead.indexOf('class="bid later-fact"') < lead.indexOf('class="clicks later-fact"'));
});

test("empty creator wall stays blank and starts with Claim #1", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { weekId: "2026-W35", listings: [] }),
  );
  assert.match(html, /class="wall-stage wall-empty"/);
  assert.match(html, /class="paste-rail empty-claim-first"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /Blank plaster/);
  assert.match(html, /\$5 pastes the first flyer at #1/);
  assert.match(html, /data-first-click="claim"/);
  assert.match(html, /class="outbid-label">Claim rank/);
  assert.match(html, /data-auction-action="Outbid"/);
  assert.match(html, /aria-label="Claim rank"/);
  assert.doesNotMatch(html, /data-open-brief|data-prize|data-later-fact|data-post-brief|class="card/);
  assert.ok(html.indexOf('id="claim"') < html.indexOf('data-empty-week="true"'));
});

test("identity source removes the shared reference fork and flat homepage layer", () => {
  assert.doesNotMatch(pageSource, /OutbidReference|outbid-reference|listings\.slice\(0, 3\)/);
  assert.doesNotMatch(layoutSource, /home\.css/);
  assert.doesNotMatch(markupSource, /FindPopover|ThemeToggle|PeriodTabs|TodayTopRanking|LatestActivity/);
  assert.doesNotMatch(boardCss, /--home-|background:\s*var\(--home-|border-radius:\s*44px/);
  assert.match(boardCss, /radial-gradient/);
  assert.match(boardCss, /repeating-linear-gradient/);
  assert.match(boardCss, /--plaster:/);
  assert.match(boardCss, /--paper:/);
  assert.match(boardCss, /\.creator-wall \.wall-mast/);
  assert.match(boardCss, /grid-template-areas:[\s\S]*"flyers claim"/);
  assert.match(boardCss, /\.creator-wall \.wall-occupied \.card \.platform-lanes/);
  assert.match(boardCss, /\.tape/);
  assert.match(boardCss, /\.card-lead \.terms\.prize-before-price/);
});

test("platform lanes only render supplied enum values", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      weekId: "2026-W35",
      listings: [
        ...rankListings([
          listing({
          id: "platformed",
          bidUsd: 12,
          platforms: ["instagram"],
          createdAt: "2026-08-27T10:00:00.000Z",
          }),
          listing({
          id: "untyped",
          bidUsd: 11,
          createdAt: "2026-08-27T11:00:00.000Z",
          }),
        ]),
      ],
    }),
  );
  assert.match(html, /data-platform="instagram"/);
  assert.equal((html.match(/data-platform-lanes=""/g) ?? []).length, 1);
  assert.doesNotMatch(html, /data-platform="facebook"|data-platform="twitter"/);
});
