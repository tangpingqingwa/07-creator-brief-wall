import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { Board } from "../src/app/board";
import { type Listing, rankListings } from "../src/lib/rank";

const pageSource = readFileSync(
  join(process.cwd(), "src", "app", "page.tsx"),
  "utf8",
);
const fixtureSource = readFileSync(
  join(process.cwd(), "scripts", "visual-fixture.ts"),
  "utf8",
);

const fixtureRows: Listing[] = [
  {
    id: "lst_visual_one",
    weekId: "2026-W35",
    brand: "Juniper House",
    terms: "Flat fee; 1 TikTok video; deliver by Sep 12",
    briefUrl: "https://example.com/creator-briefs/juniper-house-fall-drop",
    bidUsd: 17_000,
    clicks: 148,
    createdAt: "2026-08-29T01:00:00.000Z",
    updatedAt: "2026-08-29T01:00:00.000Z",
  },
  {
    id: "lst_visual_two",
    weekId: "2026-W35",
    brand: "Good Form Skin",
    terms: "Flat fee and product; 1 Instagram Reel; publish by Sep 13",
    briefUrl: "https://example.com/creator-briefs/good-form-skin-routine",
    bidUsd: 16_000,
    clicks: 92,
    createdAt: "2026-08-29T02:00:00.000Z",
    updatedAt: "2026-08-29T02:00:00.000Z",
  },
  {
    id: "lst_visual_three",
    weekId: "2026-W35",
    brand: "Field Note Coffee",
    terms: "Flat fee; 1 YouTube Short; deliver by Sep 15",
    briefUrl: "https://example.com/creator-briefs/field-note-coffee-morning",
    bidUsd: 14_028,
    clicks: 64,
    createdAt: "2026-08-29T03:00:00.000Z",
    updatedAt: "2026-08-29T03:00:00.000Z",
  },
  {
    id: "lst_visual_four",
    weekId: "2026-W35",
    brand: "Arc and Alder Home",
    terms: "Flat fee; 2 TikTok videos; publish by Sep 18",
    briefUrl: "https://example.com/creator-briefs/arc-alder-studio",
    bidUsd: 13_005,
    clicks: 48,
    createdAt: "2026-08-29T04:00:00.000Z",
    updatedAt: "2026-08-29T04:00:00.000Z",
  },
  {
    id: "lst_visual_five",
    weekId: "2026-W35",
    brand: "Rally Outdoor Co.",
    terms: "Flat fee and product; 1 Twitch segment; stream by Sep 20",
    briefUrl: "https://example.com/creator-briefs/rally-outdoor-weekend",
    bidUsd: 12_080,
    clicks: 27,
    createdAt: "2026-08-29T05:00:00.000Z",
    updatedAt: "2026-08-29T05:00:00.000Z",
  },
  {
    id: "lst_visual_six",
    weekId: "2026-W35",
    brand: "Moss and Metric",
    terms: "Flat fee; 3 Instagram story frames; deliver by Sep 22",
    briefUrl: "https://example.com/creator-briefs/moss-metric-desk-reset",
    bidUsd: 11_004,
    clicks: 12,
    createdAt: "2026-08-29T06:00:00.000Z",
    updatedAt: "2026-08-29T06:00:00.000Z",
  },
];

test("the six-row visual seed uses the ordinary creator wall", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      weekId: "2026-W35",
      listings: rankListings(fixtureRows),
    }),
  );

  assert.match(html, /class="board creator-wall"/);
  assert.equal((html.match(/data-slot="paid-card"/g) ?? []).length, fixtureRows.length);
  for (const row of fixtureRows) {
    assert.match(html, new RegExp(`data-id="${row.id}"`));
    assert.match(html, new RegExp(`data-brand="${row.brand}"`));
    assert.match(html, new RegExp(`class="(?:terms|later-terms)-copy">${row.terms}`));
    assert.match(html, new RegExp(`data-bid="${row.bidUsd}"`));
    assert.match(html, new RegExp(`href="/r/${row.id}"`));
  }
  assert.doesNotMatch(html, /outbid-reference-root|picks\.daily|DTC Picks|Today['’]s top ranking|Latest activity/);
  assert.doesNotMatch(html, /online|visitors|Choose category|productUrl|whyTestThisToday|venueName/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-post-brief=""/g) ?? []).length, 1);
});

test("page source has no visual fork and fixture seeding stays private/offline", () => {
  assert.doesNotMatch(pageSource, /OutbidReference|outbid-reference|referenceFixture|WAFFO_MODE.*fixture|listings\.slice\(0, 3\)/);
  assert.match(fixtureSource, /startsWith\("\/private\/tmp\/"\)/);
  assert.match(fixtureSource, /VISUAL_FIXTURE_NOW/);
  assert.match(fixtureSource, /insertFixtureListing/);
  assert.doesNotMatch(fixtureSource, /api\.waffo\.ai|waffo-prod|fetch\(/);
});
