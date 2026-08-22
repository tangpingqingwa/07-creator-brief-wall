import assert from "node:assert/strict";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BoardCards, BoardChrome } from "../src/lib/board-markup";
import { rankListings, type Listing } from "../src/lib/rank";

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
