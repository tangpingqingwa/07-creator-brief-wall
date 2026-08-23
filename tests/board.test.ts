import assert from "node:assert/strict";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ClickError, getPublicListing, incrementPublicClick } from "../src/lib/clicks";
import { Board } from "../src/app/board";
import { BoardCards, BoardChrome } from "../src/lib/board-markup";
import { confirmBriefHtml } from "../src/lib/confirm-brief";
import { openDatabase } from "../src/lib/db";
import { claimNumberOneUsd, rankListings, type Listing } from "../src/lib/rank";
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
  assert.match(html, /plaster is blank/i);
  assert.match(html, /Outbid/);
  assert.match(formSource, /Claim #1 for/);
  assert.match(formSource, /name="brand"/);
  assert.match(formSource, /name="terms"/);
  assert.match(formSource, /name="briefUrl"/);
  assert.match(formSource, /name="bidUsd"/);
  assert.match(formSource, /Outbid/);
  assert.match(formSource, /className="amount-stepper"/);
  assert.match(formSource, /data-claim-amount/);
  assert.match(formSource, /Blank plaster/);
  assert.doesNotMatch(html, FORBIDDEN);
  assert.doesNotMatch(formSource, FORBIDDEN);
});

test("claim strip defaults to this week’s real #1 price", () => {
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

test("occupied wall names one Post a brief hop to the claim strip", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /This week’s wall/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /Post a brief/);
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
      ]),
    }),
  );
  const hop = occupied.indexOf('data-post-brief=""');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(hop >= 0 && flyers >= 0 && claim >= 0);
  assert.ok(flyers < hop && hop < claim);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.match(occupied, /class="post-brief post-after-open post-after-open-first post-after-open-two"[^>]*href="#claim"/);
  assert.match(occupied, /data-post-after-open=""/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /class="post-after-note">after Open brief/);
  assert.match(occupied, /class="post-label">Post a brief/);
  assert.match(occupied, /class="post-dest">Claim #1/);
  assert.match(occupied, /Post a brief this week/);
  assert.match(occupied, /Need \$8 to take #1/);
  assert.match(occupied, /Open brief/);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /This week’s wall/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall posts a brief after Open brief", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-post-after-open/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /after Open brief/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /Post a brief/);
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
      ]),
    }),
  );
  const hop = occupied.indexOf('data-post-after-open=""');
  const stamp = occupied.indexOf('data-post-after-open-first=""');
  const write = occupied.indexOf('data-first-write="post"');
  const two = occupied.indexOf('data-post-after-open-two=""');
  const note = occupied.indexOf('class="post-after-note">after Open brief');
  const label = occupied.indexOf('class="post-label">Post a brief');
  const dest = occupied.indexOf('class="post-dest">Claim #1');
  const nav = occupied.indexOf('aria-label="Site"');
  const navEnd = occupied.indexOf("</nav>", nav);
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const open = occupied.indexOf('class="open-label">Open brief');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(nav >= 0 && navEnd > nav && flyers > navEnd);
  assert.ok(open > flyers && hop > open);
  assert.ok(stamp >= hop && write > stamp && Math.abs(stamp - hop) < 80);
  assert.ok(two > write && Math.abs(two - write) < 80);
  assert.ok(note > hop && label > note && dest > label && claim > dest);
  assert.equal((occupied.match(/data-post-after-open=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-write="post"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.match(occupied, /aria-label="Post a brief after Open brief"/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall lets Open brief win the first click after Post follows Open", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /Post a brief/);
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
  const firstClick = occupied.indexOf('data-first-click="open"');
  const post = occupied.indexOf('data-post-after-open=""');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstClick > flyers);
  assert.ok(post > firstClick && claim > post);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /data-open-brief=""/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /data-open-after-post-first/);
  assert.doesNotMatch(two, /data-first-read="open"/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-write="post"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.doesNotMatch(empty, FORBIDDEN);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall concentrates Post a brief after Open wins the first click", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
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
  const firstClick = occupied.indexOf('data-first-click="open"');
  const post = occupied.indexOf('data-post-after-open=""');
  const stamp = occupied.indexOf('data-post-after-open-first=""');
  const write = occupied.indexOf('data-first-write="post"');
  const twoStamp = occupied.indexOf('data-post-after-open-two=""');
  const label = occupied.indexOf('class="post-label">Post a brief');
  const dest = occupied.indexOf('class="post-dest">Claim #1');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstClick > flyers);
  assert.ok(post > firstClick && stamp >= post && write > stamp && Math.abs(stamp - post) < 80);
  assert.ok(twoStamp > write && Math.abs(twoStamp - write) < 80);
  assert.ok(label > write && dest > label && claim > dest);
  assert.match(occupied, /class="post-brief post-after-open post-after-open-first post-after-open-two"[^>]*href="#claim"/);
  assert.match(occupied, /data-post-brief=""/);
  assert.match(occupied, /data-post-after-open=""/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /class="post-label">Post a brief/);
  assert.match(occupied, /class="post-dest">Claim #1/);
  assert.match(occupied, /href="#claim"/);
  assert.equal((occupied.match(/data-post-after-open-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-write="post"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /Post a brief this week[\s\S]*Post a brief this week/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall concentrates Open brief after Post is concentrated", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /Post a brief/);
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
  const firstClick = occupied.indexOf('data-first-click="open"');
  const openStamp = occupied.indexOf('data-open-after-post-first=""');
  const firstRead = occupied.indexOf('data-first-read="open"');
  const open = occupied.indexOf('class="open-label">Open brief');
  const post = occupied.indexOf('data-post-after-open=""');
  const write = occupied.indexOf('data-first-write="post"');
  const postTwo = occupied.indexOf('data-post-after-open-two=""');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstClick > flyers);
  assert.ok(openStamp >= firstClick && firstRead > openStamp);
  assert.ok(Math.abs(openStamp - firstClick) < 80);
  assert.ok(open > firstRead && post > open && write > post && postTwo > write && claim > postTwo);
  assert.match(lead, /class="brief-url open-after-terms open-after-post-first"/);
  assert.match(lead, /data-open-brief=""/);
  assert.match(lead, /data-open-after-terms=""/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(lead, /class="open-label">Open brief/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(two, /data-open-brief=""/);
  assert.match(two, /Open brief/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /data-open-after-post-first/);
  assert.doesNotMatch(two, /data-first-read="open"/);
  assert.doesNotMatch(two, /open-after-post-first/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.equal((occupied.match(/data-open-after-post-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-brief=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/href="\/r\/lst_lead"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall concentrates Post a brief after Open is re-concentrated", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
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
  const firstRead = occupied.indexOf('data-first-read="open"');
  const open = occupied.indexOf('class="open-label">Open brief');
  const post = occupied.indexOf('data-post-after-open=""');
  const stamp = occupied.indexOf('data-post-after-open-first=""');
  const write = occupied.indexOf('data-first-write="post"');
  const twoStamp = occupied.indexOf('data-post-after-open-two=""');
  const label = occupied.indexOf('class="post-label">Post a brief');
  const dest = occupied.indexOf('class="post-dest">Claim #1');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstRead > flyers);
  assert.ok(open > firstRead && post > open);
  assert.ok(stamp >= post && write > stamp && twoStamp > write);
  assert.ok(Math.abs(stamp - post) < 80);
  assert.ok(Math.abs(twoStamp - write) < 80);
  assert.ok(label > twoStamp && dest > label && claim > dest);
  assert.match(occupied, /class="post-brief post-after-open post-after-open-first post-after-open-two"[^>]*href="#claim"/);
  assert.match(occupied, /data-post-brief=""/);
  assert.match(occupied, /data-post-after-open=""/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /class="post-label">Post a brief/);
  assert.match(occupied, /class="post-dest">Claim #1/);
  assert.match(occupied, /href="#claim"/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(two, /data-open-brief=""/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.doesNotMatch(two, /data-first-write="post"/);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-write="post"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /Post a brief this week[\s\S]*Post a brief this week/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall puts flyers ahead of the claim strip", () => {
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
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && claim >= 0);
  assert.ok(flyers < claim);
  assert.match(occupied, /data-occupied="true"/);
  assert.match(occupied, /wall-occupied/);
  assert.match(occupied, /Lead Co/);
  assert.match(occupied, /Open brief/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, /Outbid/);
  assert.match(occupied, /Need \$8 to take #1/);
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
  const after = card.indexOf('class="open-after-note">after Terms');
  const open = card.indexOf('class="open-label">Open brief');
  const bid = card.indexOf('class="bid">$5');
  const clicks = card.indexOf("3 clicks");
  assert.ok(brand >= 0 && termsMark > brand);
  assert.ok(termsLabel > termsMark && termsCopy > termsLabel);
  assert.ok(hop > termsCopy && after > hop && open > after && bid > open && clicks > bid);
  assert.match(card, /data-terms=""/);
  assert.match(card, /class="terms-label">Terms/);
  assert.match(card, /\$800 flat, 1 TikTok/);
  assert.match(card, /Open brief/);
  assert.match(card, /after Terms/);
  assert.match(card, /data-open-after-terms=""/);
  assert.match(card, /\$5/);
  assert.doesNotMatch(html, FORBIDDEN);
});

test("one flyer opens the brief after Terms, not next to $bid", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-open-after-terms/);
  assert.doesNotMatch(empty, /after Terms/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);

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
        listing({
          id: "lst_two",
          brand: "Two Co",
          terms: "later rank",
          briefUrl: "https://briefs.example.com/two",
          bidUsd: 5,
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const cardStart = html.indexOf('data-id="lst_acme"');
  const card = html.slice(cardStart, html.indexOf("</li>", cardStart));
  const terms = card.indexOf('data-terms=""');
  const hop = card.indexOf('data-open-after-terms=""');
  const after = card.indexOf('class="open-after-note">after Terms');
  const open = card.indexOf('class="open-label">Open brief');
  const bid = card.indexOf('class="bid">$5');
  const clicks = card.indexOf("3 clicks");
  assert.ok(terms >= 0 && hop > terms && after > hop);
  assert.ok(open > after && bid > open && clicks > bid);
  assert.match(card, /class="brief-url open-after-terms open-after-post-first"/);
  assert.match(card, /data-open-brief=""/);
  assert.match(card, /data-first-click="open"/);
  assert.match(card, /data-open-after-post-first=""/);
  assert.match(card, /data-first-read="open"/);
  assert.match(card, /href="\/r\/lst_acme"/);
  assert.equal((html.match(/data-open-after-terms=""/g) ?? []).length, 2);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-post-first=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  const laterStart = html.indexOf('data-id="lst_two"');
  const later = html.slice(laterStart, html.indexOf("</li>", laterStart));
  assert.doesNotMatch(later, /data-first-click="open"/);
  assert.doesNotMatch(later, /data-open-after-post-first/);
  assert.doesNotMatch(later, /data-first-read="open"/);
  assert.doesNotMatch(html, FORBIDDEN);
});

test("one flyer has a single labeled Open brief hop", () => {
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
  const terms = card.indexOf("$800 flat, 1 TikTok");
  const hop = card.indexOf('data-open-brief=""');
  const open = card.indexOf('class="open-label">Open brief');
  const host = card.indexOf('class="host">briefs.example.com');
  const hops = card.match(/href="\/r\/lst_acme"/g) ?? [];
  assert.ok(brand >= 0 && terms > brand && hop > terms);
  assert.match(card, /class="terms-label">Terms/);
  assert.ok(open > hop && host > open);
  assert.equal(hops.length, 1);
  assert.equal((card.match(/class="host"/g) ?? []).length, 1);
  assert.match(card, /data-open-brief=""/);
  assert.match(card, /data-open-after-terms=""/);
  assert.match(card, /data-first-click="open"/);
  assert.match(card, /data-open-after-post-first=""/);
  assert.match(card, /data-first-read="open"/);
  assert.match(card, /after Terms/);
  assert.match(card, /aria-label="Open brief at briefs.example.com"/);
  assert.doesNotMatch(card, /href="https:\/\/briefs\.example\.com/);
  assert.doesNotMatch(html, FORBIDDEN);
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
  const terms = html.indexOf("$800 flat, 1 TikTok");
  const url = html.indexOf("https://briefs.example.com/acme?id=9");
  const leave = html.indexOf('data-leave-brief=""');
  const bid = html.indexOf('class="confirm-bid">$5');
  const hops = html.indexOf("3 public hops — not reach");
  assert.ok(terms >= 0 && url > terms && leave > url);
  assert.ok(bid > leave && hops > bid);
  assert.match(html, /data-confirm-brief=""/);
  assert.match(html, /data-page="confirm-brief"/);
  assert.match(html, /Confirm this brief/);
  assert.match(html, /Leave to the brief/);
  assert.match(html, /method="post"/);
  assert.match(html, /action="\/r\/lst_acme"/);
  assert.doesNotMatch(html, /href="https:\/\/briefs\.example\.com/);
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

    const preview = getPublicListing(db, "lst_click");
    assert.equal(preview.clicks, 0);
    assert.equal(preview.briefUrl, "https://example.com/brief?id=99");

    const stillZero = listLiveBoard(db, WEEK);
    assert.equal(stillZero[0]?.clicks, 0);

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
    assert.throws(
      () => getPublicListing(db, "missing"),
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
