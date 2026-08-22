import assert from "node:assert/strict";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ClickError, incrementPublicClick } from "../src/lib/clicks";
import { BoardCards, BoardChrome } from "../src/lib/board-markup";
import { openDatabase } from "../src/lib/db";
import { rankListings, type Listing } from "../src/lib/rank";
import { insertFixtureListing } from "../src/lib/test-listings";
import { listLiveBoard } from "../src/lib/week";

const WEEK = "2026-W34";
const formSource = readFileSync(
  join(process.cwd(), "src", "app", "outbid-form.tsx"),
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

test("empty board is honest and has the Outbid form fields", () => {
  const html = renderBoard([]);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /board is empty/i);
  assert.match(html, /Outbid/);
  assert.match(formSource, /name="brand"/);
  assert.match(formSource, /name="terms"/);
  assert.match(formSource, /name="briefUrl"/);
  assert.match(formSource, /name="bidUsd"/);
  assert.match(formSource, /Outbid/);
  assert.doesNotMatch(html, FORBIDDEN);
  assert.doesNotMatch(formSource, FORBIDDEN);
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

    const first = incrementPublicClick(db, "lst_click");
    assert.equal(first.listing.clicks, 1);
    assert.equal(first.url, "https://example.com/brief?id=99");
    assert.doesNotMatch(first.url, /utm_|fbclid|gclid/);

    const second = incrementPublicClick(db, "lst_click");
    assert.equal(second.listing.clicks, 2);

    const live = listLiveBoard(db, WEEK);
    assert.equal(live[0]?.clicks, 2);
    assert.match(renderBoard(live), /data-clicks="2"/);

    assert.throws(
      () => incrementPublicClick(db, "missing"),
      (error: unknown) =>
        error instanceof ClickError && error.code === "listing_not_found",
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
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    insertFixtureListing(db, {
      id: "lst_live",
      weekId: WEEK,
      brand: "This Week",
      terms: "current brief",
      briefUrl: "https://example.com/live",
      bidUsd: 5,
      clicks: 1,
      createdAt: "2026-08-17T00:00:00.000Z",
    });

    const live = listLiveBoard(db, WEEK);
    assert.equal(live.length, 1);
    assert.equal(live[0]?.id, "lst_live");
    assert.equal(live[0]?.brand, "This Week");
    assert.ok(!live.some((row) => row.brand === "Last Week"));
    assert.equal(listLiveBoard(db, "2026-W35").length, 0);

    const stored = db.prepare("SELECT COUNT(*) AS n FROM listings").get() as {
      n: number;
    };
    assert.equal(stored.n, 2);
  } finally {
    db.close();
  }
});
