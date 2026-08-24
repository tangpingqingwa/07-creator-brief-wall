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
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
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
  assert.match(occupied, /class="post-brief post-after-open post-after-open-first post-after-open-two post-after-open-three post-after-open-four post-after-open-five post-after-open-six"[^>]*href="#claim"/);
  assert.match(occupied, /data-post-after-open=""/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(occupied, /data-open-after-post-two-stamp=""/);
  assert.match(occupied, /data-open-after-post-three-stamp=""/);
  assert.match(occupied, /data-open-after-post-four-stamp=""/);
  assert.match(occupied, /data-open-after-post-five-stamp=""/);
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
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
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
  const three = occupied.indexOf('data-post-after-open-three=""');
  const four = occupied.indexOf('data-post-after-open-four=""');
  const five = occupied.indexOf('data-post-after-open-five=""');
  const six = occupied.indexOf('data-post-after-open-six=""');
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
  assert.ok(three > two && Math.abs(three - two) < 80);
  assert.ok(four > three && Math.abs(four - three) < 80);
  assert.ok(five > four && Math.abs(five - four) < 80);
  assert.ok(six > five && Math.abs(six - five) < 80);
  assert.ok(note > hop && label > note && dest > label && claim > dest);
  assert.equal((occupied.match(/data-post-after-open=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-write="post"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
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
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
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
  assert.match(lead, /data-open-after-post-two-stamp=""/);
  assert.match(lead, /data-open-after-post-three-stamp=""/);
  assert.match(lead, /data-open-after-post-four-stamp=""/);
  assert.match(lead, /data-open-after-post-five-stamp=""/);
  assert.match(lead, /data-open-brief=""/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /data-open-after-terms/);
  assert.doesNotMatch(two, /after Terms/);
  assert.doesNotMatch(two, /data-open-after-post-first/);
  assert.doesNotMatch(two, /data-first-read="open"/);
  assert.doesNotMatch(two, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.doesNotMatch(two, /data-post-after-open-three/);
  assert.doesNotMatch(two, /data-post-after-open-four/);
  assert.doesNotMatch(two, /data-post-after-open-five/);
  assert.doesNotMatch(two, /data-post-after-open-six/);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-two-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-three-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-four-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-five-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-write="post"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
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
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
  assert.doesNotMatch(empty, /data-post-after-open/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
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
  const threeStamp = occupied.indexOf('data-post-after-open-three=""');
  const fourStamp = occupied.indexOf('data-post-after-open-four=""');
  const fiveStamp = occupied.indexOf('data-post-after-open-five=""');
  const sixStamp = occupied.indexOf('data-post-after-open-six=""');
  const label = occupied.indexOf('class="post-label">Post a brief');
  const dest = occupied.indexOf('class="post-dest">Claim #1');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstClick > flyers);
  assert.ok(post > firstClick && stamp >= post && write > stamp && Math.abs(stamp - post) < 80);
  assert.ok(twoStamp > write && Math.abs(twoStamp - write) < 80);
  assert.ok(threeStamp > twoStamp && Math.abs(threeStamp - twoStamp) < 80);
  assert.ok(fourStamp > threeStamp && Math.abs(fourStamp - threeStamp) < 80);
  assert.ok(fiveStamp > fourStamp && Math.abs(fiveStamp - fourStamp) < 80);
  assert.ok(sixStamp > fiveStamp && Math.abs(sixStamp - fiveStamp) < 80);
  assert.ok(label > write && dest > label && claim > dest);
  assert.match(occupied, /class="post-brief post-after-open post-after-open-first post-after-open-two post-after-open-three post-after-open-four post-after-open-five post-after-open-six"[^>]*href="#claim"/);
  assert.match(occupied, /data-post-brief=""/);
  assert.match(occupied, /data-post-after-open=""/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(occupied, /class="post-label">Post a brief/);
  assert.match(occupied, /class="post-dest">Claim #1/);
  assert.match(occupied, /href="#claim"/);
  assert.equal((occupied.match(/data-post-after-open-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-write="post"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
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
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
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
  const openTwo = occupied.indexOf('data-open-after-post-two-stamp=""');
  const openThree = occupied.indexOf('data-open-after-post-three-stamp=""');
  const openFour = occupied.indexOf('data-open-after-post-four-stamp=""');
  const openFive = occupied.indexOf('data-open-after-post-five-stamp=""');
  const open = occupied.indexOf('class="open-label">Open brief');
  const post = occupied.indexOf('data-post-after-open=""');
  const write = occupied.indexOf('data-first-write="post"');
  const postTwo = occupied.indexOf('data-post-after-open-two=""');
  const postThree = occupied.indexOf('data-post-after-open-three=""');
  const postFour = occupied.indexOf('data-post-after-open-four=""');
  const postFive = occupied.indexOf('data-post-after-open-five=""');
  const postSix = occupied.indexOf('data-post-after-open-six=""');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstClick > flyers);
  assert.ok(openStamp >= firstClick && firstRead > openStamp && openTwo > firstRead && openThree > openTwo && openFour > openThree && openFive > openFour);
  assert.ok(Math.abs(openStamp - firstClick) < 80);
  assert.ok(Math.abs(openTwo - firstRead) < 80);
  assert.ok(Math.abs(openThree - openTwo) < 80);
  assert.ok(Math.abs(openFour - openThree) < 80);
  assert.ok(Math.abs(openFive - openFour) < 80);
  assert.ok(open > openFive && post > open && write > post && postTwo > write && postThree > postTwo && postFour > postThree && postFive > postFour && postSix > postFive && claim > postSix);
  assert.match(lead, /class="brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three open-after-post-four open-after-post-five"/);
  assert.match(lead, /data-open-brief=""/);
  assert.match(lead, /data-open-after-terms=""/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /data-open-after-post-two-stamp=""/);
  assert.match(lead, /data-open-after-post-three-stamp=""/);
  assert.match(lead, /data-open-after-post-four-stamp=""/);
  assert.match(lead, /data-open-after-post-five-stamp=""/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(lead, /class="open-label">Open brief/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(two, /data-open-brief=""/);
  assert.match(two, /Open brief/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /data-open-after-terms/);
  assert.doesNotMatch(two, /after Terms/);
  assert.doesNotMatch(two, /data-open-after-post-first/);
  assert.doesNotMatch(two, /data-first-read="open"/);
  assert.doesNotMatch(two, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(two, /open-after-post-first/);
  assert.doesNotMatch(two, /open-after-post-two/);
  assert.doesNotMatch(two, /open-after-post-three/);
  assert.doesNotMatch(two, /open-after-post-four/);
  assert.doesNotMatch(two, /open-after-post-five/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.doesNotMatch(two, /data-post-after-open-three/);
  assert.doesNotMatch(two, /data-post-after-open-four/);
  assert.doesNotMatch(two, /data-post-after-open-five/);
  assert.doesNotMatch(two, /data-post-after-open-six/);
  assert.equal((occupied.match(/data-open-after-post-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-two-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-three-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-four-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-five-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-brief=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/href="\/r\/lst_lead"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall concentrates Post a brief after Open is re-concentrated", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
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
  const threeStamp = occupied.indexOf('data-post-after-open-three=""');
  const fourStamp = occupied.indexOf('data-post-after-open-four=""');
  const fiveStamp = occupied.indexOf('data-post-after-open-five=""');
  const sixStamp = occupied.indexOf('data-post-after-open-six=""');
  const label = occupied.indexOf('class="post-label">Post a brief');
  const dest = occupied.indexOf('class="post-dest">Claim #1');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstRead > flyers);
  assert.ok(open > firstRead && post > open);
  assert.ok(stamp >= post && write > stamp && twoStamp > write && threeStamp > twoStamp && fourStamp > threeStamp && fiveStamp > fourStamp && sixStamp > fiveStamp);
  assert.ok(Math.abs(stamp - post) < 80);
  assert.ok(Math.abs(twoStamp - write) < 80);
  assert.ok(Math.abs(threeStamp - twoStamp) < 80);
  assert.ok(Math.abs(fourStamp - threeStamp) < 80);
  assert.ok(Math.abs(fiveStamp - fourStamp) < 80);
  assert.ok(Math.abs(sixStamp - fiveStamp) < 80);
  assert.ok(label > sixStamp && dest > label && claim > dest);
  assert.match(occupied, /class="post-brief post-after-open post-after-open-first post-after-open-two post-after-open-three post-after-open-four post-after-open-five post-after-open-six"[^>]*href="#claim"/);
  assert.match(occupied, /data-post-brief=""/);
  assert.match(occupied, /data-post-after-open=""/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(occupied, /class="post-label">Post a brief/);
  assert.match(occupied, /class="post-dest">Claim #1/);
  assert.match(occupied, /href="#claim"/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(lead, /data-open-after-post-two-stamp=""/);
  assert.match(lead, /data-open-after-post-three-stamp=""/);
  assert.match(lead, /data-open-after-post-four-stamp=""/);
  assert.match(lead, /data-open-after-post-five-stamp=""/);
  assert.match(two, /data-open-brief=""/);
  assert.doesNotMatch(two, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.doesNotMatch(two, /data-post-after-open-three/);
  assert.doesNotMatch(two, /data-post-after-open-four/);
  assert.doesNotMatch(two, /data-post-after-open-five/);
  assert.doesNotMatch(two, /data-post-after-open-six/);
  assert.doesNotMatch(two, /data-first-write="post"/);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-write="post"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-two-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-three-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-four-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-five-stamp=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /Post a brief this week[\s\S]*Post a brief this week/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall concentrates Open brief after Post is re-concentrated", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
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
  const openTwo = occupied.indexOf('data-open-after-post-two-stamp=""');
  const openThree = occupied.indexOf('data-open-after-post-three-stamp=""');
  const openFour = occupied.indexOf('data-open-after-post-four-stamp=""');
  const openFive = occupied.indexOf('data-open-after-post-five-stamp=""');
  const open = occupied.indexOf('class="open-label">Open brief');
  const post = occupied.indexOf('data-post-after-open=""');
  const write = occupied.indexOf('data-first-write="post"');
  const postTwo = occupied.indexOf('data-post-after-open-two=""');
  const postThree = occupied.indexOf('data-post-after-open-three=""');
  const postFour = occupied.indexOf('data-post-after-open-four=""');
  const postFive = occupied.indexOf('data-post-after-open-five=""');
  const postSix = occupied.indexOf('data-post-after-open-six=""');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstClick > flyers);
  assert.ok(openStamp >= firstClick && firstRead > openStamp && openTwo > firstRead && openThree > openTwo && openFour > openThree && openFive > openFour);
  assert.ok(Math.abs(openStamp - firstClick) < 80);
  assert.ok(Math.abs(openTwo - firstRead) < 80);
  assert.ok(Math.abs(openThree - openTwo) < 80);
  assert.ok(Math.abs(openFour - openThree) < 80);
  assert.ok(Math.abs(openFive - openFour) < 80);
  assert.ok(open > openFive && post > open && write > post && postTwo > write && postThree > postTwo && postFour > postThree && postFive > postFour && postSix > postFive && claim > postSix);
  assert.match(lead, /class="brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three open-after-post-four open-after-post-five"/);
  assert.match(lead, /data-open-brief=""/);
  assert.match(lead, /data-open-after-terms=""/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /data-open-after-post-two-stamp=""/);
  assert.match(lead, /data-open-after-post-three-stamp=""/);
  assert.match(lead, /data-open-after-post-four-stamp=""/);
  assert.match(lead, /data-open-after-post-five-stamp=""/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(lead, /class="open-label">Open brief/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(two, /data-open-brief=""/);
  assert.match(two, /Open brief/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /data-open-after-terms/);
  assert.doesNotMatch(two, /after Terms/);
  assert.doesNotMatch(two, /data-open-after-post-first/);
  assert.doesNotMatch(two, /data-first-read="open"/);
  assert.doesNotMatch(two, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(two, /open-after-post-two/);
  assert.doesNotMatch(two, /open-after-post-three/);
  assert.doesNotMatch(two, /open-after-post-four/);
  assert.doesNotMatch(two, /open-after-post-five/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.doesNotMatch(two, /data-post-after-open-three/);
  assert.doesNotMatch(two, /data-post-after-open-four/);
  assert.doesNotMatch(two, /data-post-after-open-five/);
  assert.doesNotMatch(two, /data-post-after-open-six/);
  assert.equal((occupied.match(/data-open-after-post-two-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-three-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-four-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-five-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-brief=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/href="\/r\/lst_lead"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall concentrates Post a brief after Open is re-concentrated again", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
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
  const openTwo = occupied.indexOf('data-open-after-post-two-stamp=""');
  const openThree = occupied.indexOf('data-open-after-post-three-stamp=""');
  const openFour = occupied.indexOf('data-open-after-post-four-stamp=""');
  const openFive = occupied.indexOf('data-open-after-post-five-stamp=""');
  const open = occupied.indexOf('class="open-label">Open brief');
  const post = occupied.indexOf('data-post-after-open=""');
  const stamp = occupied.indexOf('data-post-after-open-first=""');
  const write = occupied.indexOf('data-first-write="post"');
  const twoStamp = occupied.indexOf('data-post-after-open-two=""');
  const threeStamp = occupied.indexOf('data-post-after-open-three=""');
  const fourStamp = occupied.indexOf('data-post-after-open-four=""');
  const fiveStamp = occupied.indexOf('data-post-after-open-five=""');
  const sixStamp = occupied.indexOf('data-post-after-open-six=""');
  const label = occupied.indexOf('class="post-label">Post a brief');
  const dest = occupied.indexOf('class="post-dest">Claim #1');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstRead > flyers);
  assert.ok(openTwo > firstRead && openThree > openTwo && openFour > openThree && openFive > openFour && open > openFive && post > open);
  assert.ok(stamp >= post && write > stamp && twoStamp > write && threeStamp > twoStamp && fourStamp > threeStamp && fiveStamp > fourStamp && sixStamp > fiveStamp);
  assert.ok(Math.abs(stamp - post) < 80);
  assert.ok(Math.abs(twoStamp - write) < 80);
  assert.ok(Math.abs(threeStamp - twoStamp) < 80);
  assert.ok(Math.abs(fourStamp - threeStamp) < 80);
  assert.ok(Math.abs(fiveStamp - fourStamp) < 80);
  assert.ok(Math.abs(sixStamp - fiveStamp) < 80);
  assert.ok(Math.abs(openThree - openTwo) < 80);
  assert.ok(Math.abs(openFour - openThree) < 80);
  assert.ok(Math.abs(openFive - openFour) < 80);
  assert.ok(label > sixStamp && dest > label && claim > dest);
  assert.match(occupied, /class="post-brief post-after-open post-after-open-first post-after-open-two post-after-open-three post-after-open-four post-after-open-five post-after-open-six"[^>]*href="#claim"/);
  assert.match(occupied, /data-post-brief=""/);
  assert.match(occupied, /data-post-after-open=""/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(occupied, /class="post-label">Post a brief/);
  assert.match(occupied, /class="post-dest">Claim #1/);
  assert.match(occupied, /href="#claim"/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(lead, /data-open-after-post-two-stamp=""/);
  assert.match(lead, /data-open-after-post-three-stamp=""/);
  assert.match(lead, /data-open-after-post-four-stamp=""/);
  assert.match(lead, /data-open-after-post-five-stamp=""/);
  assert.match(two, /data-open-brief=""/);
  assert.doesNotMatch(two, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.doesNotMatch(two, /data-post-after-open-three/);
  assert.doesNotMatch(two, /data-post-after-open-four/);
  assert.doesNotMatch(two, /data-post-after-open-five/);
  assert.doesNotMatch(two, /data-post-after-open-six/);
  assert.doesNotMatch(two, /data-first-write="post"/);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-write="post"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-two-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-three-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-four-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-five-stamp=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /Post a brief this week[\s\S]*Post a brief this week/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall concentrates Open brief after Post is re-concentrated again", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
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
  const openTwo = occupied.indexOf('data-open-after-post-two-stamp=""');
  const openThree = occupied.indexOf('data-open-after-post-three-stamp=""');
  const openFour = occupied.indexOf('data-open-after-post-four-stamp=""');
  const openFive = occupied.indexOf('data-open-after-post-five-stamp=""');
  const open = occupied.indexOf('class="open-label">Open brief');
  const post = occupied.indexOf('data-post-after-open=""');
  const write = occupied.indexOf('data-first-write="post"');
  const postTwo = occupied.indexOf('data-post-after-open-two=""');
  const postThree = occupied.indexOf('data-post-after-open-three=""');
  const postFour = occupied.indexOf('data-post-after-open-four=""');
  const postFive = occupied.indexOf('data-post-after-open-five=""');
  const postSix = occupied.indexOf('data-post-after-open-six=""');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstClick > flyers);
  assert.ok(openStamp >= firstClick && firstRead > openStamp && openTwo > firstRead && openThree > openTwo && openFour > openThree && openFive > openFour);
  assert.ok(Math.abs(openStamp - firstClick) < 80);
  assert.ok(Math.abs(openTwo - firstRead) < 80);
  assert.ok(Math.abs(openThree - openTwo) < 80);
  assert.ok(Math.abs(openFour - openThree) < 80);
  assert.ok(Math.abs(openFive - openFour) < 80);
  assert.ok(open > openFive && post > open && write > post && postTwo > write && postThree > postTwo && postFour > postThree && postFive > postFour && postSix > postFive && claim > postSix);
  assert.match(lead, /class="brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three open-after-post-four open-after-post-five"/);
  assert.match(lead, /data-open-brief=""/);
  assert.match(lead, /data-open-after-terms=""/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /data-open-after-post-two-stamp=""/);
  assert.match(lead, /data-open-after-post-three-stamp=""/);
  assert.match(lead, /data-open-after-post-four-stamp=""/);
  assert.match(lead, /data-open-after-post-five-stamp=""/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(lead, /class="open-label">Open brief/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(two, /data-open-brief=""/);
  assert.match(two, /Open brief/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /data-open-after-terms/);
  assert.doesNotMatch(two, /after Terms/);
  assert.doesNotMatch(two, /data-open-after-post-first/);
  assert.doesNotMatch(two, /data-first-read="open"/);
  assert.doesNotMatch(two, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(two, /open-after-post-three/);
  assert.doesNotMatch(two, /open-after-post-four/);
  assert.doesNotMatch(two, /open-after-post-five/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.doesNotMatch(two, /data-post-after-open-three/);
  assert.doesNotMatch(two, /data-post-after-open-four/);
  assert.doesNotMatch(two, /data-post-after-open-five/);
  assert.doesNotMatch(two, /data-post-after-open-six/);
  assert.equal((occupied.match(/data-open-after-post-three-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-four-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-five-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-two-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-brief=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/href="\/r\/lst_lead"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall concentrates Post a brief after Open is re-concentrated again under louder Open", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
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
  const openTwo = occupied.indexOf('data-open-after-post-two-stamp=""');
  const openThree = occupied.indexOf('data-open-after-post-three-stamp=""');
  const openFour = occupied.indexOf('data-open-after-post-four-stamp=""');
  const openFive = occupied.indexOf('data-open-after-post-five-stamp=""');
  const open = occupied.indexOf('class="open-label">Open brief');
  const post = occupied.indexOf('data-post-after-open=""');
  const stamp = occupied.indexOf('data-post-after-open-first=""');
  const write = occupied.indexOf('data-first-write="post"');
  const twoStamp = occupied.indexOf('data-post-after-open-two=""');
  const threeStamp = occupied.indexOf('data-post-after-open-three=""');
  const fourStamp = occupied.indexOf('data-post-after-open-four=""');
  const fiveStamp = occupied.indexOf('data-post-after-open-five=""');
  const sixStamp = occupied.indexOf('data-post-after-open-six=""');
  const label = occupied.indexOf('class="post-label">Post a brief');
  const dest = occupied.indexOf('class="post-dest">Claim #1');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstRead > flyers);
  assert.ok(openTwo > firstRead && openThree > openTwo && openFour > openThree && openFive > openFour && open > openFive && post > open);
  assert.ok(
    stamp >= post &&
      write > stamp &&
      twoStamp > write &&
      threeStamp > twoStamp &&
      fourStamp > threeStamp &&
      fiveStamp > fourStamp &&
      sixStamp > fiveStamp,
  );
  assert.ok(Math.abs(stamp - post) < 80);
  assert.ok(Math.abs(twoStamp - write) < 80);
  assert.ok(Math.abs(threeStamp - twoStamp) < 80);
  assert.ok(Math.abs(fourStamp - threeStamp) < 80);
  assert.ok(Math.abs(fiveStamp - fourStamp) < 80);
  assert.ok(Math.abs(sixStamp - fiveStamp) < 80);
  assert.ok(Math.abs(openThree - openTwo) < 80);
  assert.ok(Math.abs(openFour - openThree) < 80);
  assert.ok(Math.abs(openFive - openFour) < 80);
  assert.ok(label > sixStamp && dest > label && claim > dest);
  assert.match(occupied, /class="post-brief post-after-open post-after-open-first post-after-open-two post-after-open-three post-after-open-four post-after-open-five post-after-open-six"[^>]*href="#claim"/);
  assert.match(occupied, /data-post-brief=""/);
  assert.match(occupied, /data-post-after-open=""/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(occupied, /class="post-label">Post a brief/);
  assert.match(occupied, /class="post-dest">Claim #1/);
  assert.match(occupied, /href="#claim"/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(lead, /data-open-after-post-two-stamp=""/);
  assert.match(lead, /data-open-after-post-three-stamp=""/);
  assert.match(lead, /data-open-after-post-four-stamp=""/);
  assert.match(lead, /data-open-after-post-five-stamp=""/);
  assert.match(two, /data-open-brief=""/);
  assert.doesNotMatch(two, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.doesNotMatch(two, /data-post-after-open-three/);
  assert.doesNotMatch(two, /data-post-after-open-four/);
  assert.doesNotMatch(two, /data-post-after-open-five/);
  assert.doesNotMatch(two, /data-post-after-open-six/);
  assert.doesNotMatch(two, /data-first-write="post"/);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-write="post"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-two-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-three-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-four-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-five-stamp=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /Post a brief this week[\s\S]*Post a brief this week/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall concentrates Open brief after Post is re-concentrated again under louder Post", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
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
  const openTwo = occupied.indexOf('data-open-after-post-two-stamp=""');
  const openThree = occupied.indexOf('data-open-after-post-three-stamp=""');
  const openFour = occupied.indexOf('data-open-after-post-four-stamp=""');
  const openFive = occupied.indexOf('data-open-after-post-five-stamp=""');
  const open = occupied.indexOf('class="open-label">Open brief');
  const post = occupied.indexOf('data-post-after-open=""');
  const write = occupied.indexOf('data-first-write="post"');
  const postTwo = occupied.indexOf('data-post-after-open-two=""');
  const postThree = occupied.indexOf('data-post-after-open-three=""');
  const postFour = occupied.indexOf('data-post-after-open-four=""');
  const postFive = occupied.indexOf('data-post-after-open-five=""');
  const postSix = occupied.indexOf('data-post-after-open-six=""');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstClick > flyers);
  assert.ok(
    openStamp >= firstClick &&
      firstRead > openStamp &&
      openTwo > firstRead &&
      openThree > openTwo &&
      openFour > openThree &&
      openFive > openFour,
  );
  assert.ok(Math.abs(openStamp - firstClick) < 80);
  assert.ok(Math.abs(openTwo - firstRead) < 80);
  assert.ok(Math.abs(openThree - openTwo) < 80);
  assert.ok(Math.abs(openFour - openThree) < 80);
  assert.ok(Math.abs(openFive - openFour) < 80);
  assert.ok(
    open > openFive &&
      post > open &&
      write > post &&
      postTwo > write &&
      postThree > postTwo &&
      postFour > postThree &&
      postFive > postFour &&
      postSix > postFive &&
      claim > postSix,
  );
  assert.match(lead, /class="brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three open-after-post-four open-after-post-five"/);
  assert.match(lead, /data-open-brief=""/);
  assert.match(lead, /data-open-after-terms=""/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /data-open-after-post-two-stamp=""/);
  assert.match(lead, /data-open-after-post-three-stamp=""/);
  assert.match(lead, /data-open-after-post-four-stamp=""/);
  assert.match(lead, /data-open-after-post-five-stamp=""/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(lead, /class="open-label">Open brief/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(two, /data-open-brief=""/);
  assert.match(two, /Open brief/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /data-open-after-terms/);
  assert.doesNotMatch(two, /after Terms/);
  assert.doesNotMatch(two, /data-open-after-post-first/);
  assert.doesNotMatch(two, /data-first-read="open"/);
  assert.doesNotMatch(two, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(two, /open-after-post-four/);
  assert.doesNotMatch(two, /open-after-post-five/);
  assert.doesNotMatch(two, /open-after-post-three/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.doesNotMatch(two, /data-post-after-open-three/);
  assert.doesNotMatch(two, /data-post-after-open-four/);
  assert.doesNotMatch(two, /data-post-after-open-five/);
  assert.doesNotMatch(two, /data-post-after-open-six/);
  assert.equal((occupied.match(/data-open-after-post-four-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-five-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-three-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-two-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-brief=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/href="\/r\/lst_lead"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall concentrates Post a brief after Open is re-concentrated again under louder Open brief", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
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
  const openTwo = occupied.indexOf('data-open-after-post-two-stamp=""');
  const openThree = occupied.indexOf('data-open-after-post-three-stamp=""');
  const openFour = occupied.indexOf('data-open-after-post-four-stamp=""');
  const openFive = occupied.indexOf('data-open-after-post-five-stamp=""');
  const open = occupied.indexOf('class="open-label">Open brief');
  const post = occupied.indexOf('data-post-after-open=""');
  const stamp = occupied.indexOf('data-post-after-open-first=""');
  const write = occupied.indexOf('data-first-write="post"');
  const twoStamp = occupied.indexOf('data-post-after-open-two=""');
  const threeStamp = occupied.indexOf('data-post-after-open-three=""');
  const fourStamp = occupied.indexOf('data-post-after-open-four=""');
  const fiveStamp = occupied.indexOf('data-post-after-open-five=""');
  const sixStamp = occupied.indexOf('data-post-after-open-six=""');
  const label = occupied.indexOf('class="post-label">Post a brief');
  const dest = occupied.indexOf('class="post-dest">Claim #1');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstRead > flyers);
  assert.ok(openTwo > firstRead && openThree > openTwo && openFour > openThree && openFive > openFour && open > openFive && post > open);
  assert.ok(
    stamp >= post &&
      write > stamp &&
      twoStamp > write &&
      threeStamp > twoStamp &&
      fourStamp > threeStamp &&
      fiveStamp > fourStamp &&
      sixStamp > fiveStamp,
  );
  assert.ok(Math.abs(stamp - post) < 80);
  assert.ok(Math.abs(twoStamp - write) < 80);
  assert.ok(Math.abs(threeStamp - twoStamp) < 80);
  assert.ok(Math.abs(fourStamp - threeStamp) < 80);
  assert.ok(Math.abs(fiveStamp - fourStamp) < 80);
  assert.ok(Math.abs(sixStamp - fiveStamp) < 80);
  assert.ok(Math.abs(openThree - openTwo) < 80);
  assert.ok(Math.abs(openFour - openThree) < 80);
  assert.ok(Math.abs(openFive - openFour) < 80);
  assert.ok(label > sixStamp && dest > label && claim > dest);
  assert.match(occupied, /class="post-brief post-after-open post-after-open-first post-after-open-two post-after-open-three post-after-open-four post-after-open-five post-after-open-six"[^>]*href="#claim"/);
  assert.match(occupied, /data-post-brief=""/);
  assert.match(occupied, /data-post-after-open=""/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(occupied, /class="post-label">Post a brief/);
  assert.match(occupied, /class="post-dest">Claim #1/);
  assert.match(occupied, /href="#claim"/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(lead, /data-open-after-post-two-stamp=""/);
  assert.match(lead, /data-open-after-post-three-stamp=""/);
  assert.match(lead, /data-open-after-post-four-stamp=""/);
  assert.match(lead, /data-open-after-post-five-stamp=""/);
  assert.match(two, /data-open-brief=""/);
  assert.doesNotMatch(two, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.doesNotMatch(two, /data-post-after-open-three/);
  assert.doesNotMatch(two, /data-post-after-open-four/);
  assert.doesNotMatch(two, /data-post-after-open-five/);
  assert.doesNotMatch(two, /data-post-after-open-six/);
  assert.doesNotMatch(two, /data-first-write="post"/);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-write="post"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-two-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-three-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-four-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-five-stamp=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /Post a brief this week[\s\S]*Post a brief this week/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall concentrates Post a brief after Open is re-concentrated again under louder Open brief hop", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-post-after-open-six/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
  assert.doesNotMatch(empty, /data-post-after-open/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
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
  const openTwo = occupied.indexOf('data-open-after-post-two-stamp=""');
  const openThree = occupied.indexOf('data-open-after-post-three-stamp=""');
  const openFour = occupied.indexOf('data-open-after-post-four-stamp=""');
  const openFive = occupied.indexOf('data-open-after-post-five-stamp=""');
  const open = occupied.indexOf('class="open-label">Open brief');
  const post = occupied.indexOf('data-post-after-open=""');
  const stamp = occupied.indexOf('data-post-after-open-first=""');
  const write = occupied.indexOf('data-first-write="post"');
  const twoStamp = occupied.indexOf('data-post-after-open-two=""');
  const threeStamp = occupied.indexOf('data-post-after-open-three=""');
  const fourStamp = occupied.indexOf('data-post-after-open-four=""');
  const fiveStamp = occupied.indexOf('data-post-after-open-five=""');
  const sixStamp = occupied.indexOf('data-post-after-open-six=""');
  const label = occupied.indexOf('class="post-label">Post a brief');
  const dest = occupied.indexOf('class="post-dest">Claim #1');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstRead > flyers);
  assert.ok(openTwo > firstRead && openThree > openTwo && openFour > openThree && openFive > openFour && open > openFive && post > open);
  assert.ok(
    stamp >= post &&
      write > stamp &&
      twoStamp > write &&
      threeStamp > twoStamp &&
      fourStamp > threeStamp &&
      fiveStamp > fourStamp &&
      sixStamp > fiveStamp,
  );
  assert.ok(Math.abs(stamp - post) < 80);
  assert.ok(Math.abs(twoStamp - write) < 80);
  assert.ok(Math.abs(threeStamp - twoStamp) < 80);
  assert.ok(Math.abs(fourStamp - threeStamp) < 80);
  assert.ok(Math.abs(fiveStamp - fourStamp) < 80);
  assert.ok(Math.abs(sixStamp - fiveStamp) < 80);
  assert.ok(Math.abs(openThree - openTwo) < 80);
  assert.ok(Math.abs(openFour - openThree) < 80);
  assert.ok(Math.abs(openFive - openFour) < 80);
  assert.ok(label > sixStamp && dest > label && claim > dest);
  assert.match(occupied, /class="post-brief post-after-open post-after-open-first post-after-open-two post-after-open-three post-after-open-four post-after-open-five post-after-open-six"[^>]*href="#claim"/);
  assert.match(occupied, /data-post-brief=""/);
  assert.match(occupied, /data-post-after-open=""/);
  assert.match(occupied, /data-post-after-open-first=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(occupied, /class="post-label">Post a brief/);
  assert.match(occupied, /class="post-dest">Claim #1/);
  assert.match(occupied, /href="#claim"/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(lead, /data-open-after-post-two-stamp=""/);
  assert.match(lead, /data-open-after-post-three-stamp=""/);
  assert.match(lead, /data-open-after-post-four-stamp=""/);
  assert.match(lead, /data-open-after-post-five-stamp=""/);
  assert.match(two, /data-open-brief=""/);
  assert.doesNotMatch(two, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.doesNotMatch(two, /data-post-after-open-three/);
  assert.doesNotMatch(two, /data-post-after-open-four/);
  assert.doesNotMatch(two, /data-post-after-open-five/);
  assert.doesNotMatch(two, /data-post-after-open-six/);
  assert.doesNotMatch(two, /data-first-write="post"/);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-write="post"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-two-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-three-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-four-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-five-stamp=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /Post a brief this week[\s\S]*Post a brief this week/);
  assert.doesNotMatch(occupied, FORBIDDEN);
});

test("occupied wall concentrates Open brief after Post is re-concentrated again under louder Post a brief", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-first/);
  assert.doesNotMatch(empty, /data-first-read="open"/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-post-after-open-five/);
  assert.doesNotMatch(empty, /data-post-after-open-six/);
  assert.doesNotMatch(empty, /data-post-after-open-four/);
  assert.doesNotMatch(empty, /data-post-after-open-three/);
  assert.doesNotMatch(empty, /data-post-after-open-two/);
  assert.doesNotMatch(empty, /data-post-after-open-first/);
  assert.doesNotMatch(empty, /data-first-write="post"/);
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
  const openTwo = occupied.indexOf('data-open-after-post-two-stamp=""');
  const openThree = occupied.indexOf('data-open-after-post-three-stamp=""');
  const openFour = occupied.indexOf('data-open-after-post-four-stamp=""');
  const openFive = occupied.indexOf('data-open-after-post-five-stamp=""');
  const open = occupied.indexOf('class="open-label">Open brief');
  const post = occupied.indexOf('data-post-after-open=""');
  const write = occupied.indexOf('data-first-write="post"');
  const postTwo = occupied.indexOf('data-post-after-open-two=""');
  const postThree = occupied.indexOf('data-post-after-open-three=""');
  const postFour = occupied.indexOf('data-post-after-open-four=""');
  const postFive = occupied.indexOf('data-post-after-open-five=""');
  const postSix = occupied.indexOf('data-post-after-open-six=""');
  const flyers = occupied.indexOf('aria-label="Paid briefs this week"');
  const claim = occupied.indexOf('id="claim"');
  assert.ok(flyers >= 0 && firstClick > flyers);
  assert.ok(
    openStamp >= firstClick &&
      firstRead > openStamp &&
      openTwo > firstRead &&
      openThree > openTwo &&
      openFour > openThree &&
      openFive > openFour,
  );
  assert.ok(Math.abs(openStamp - firstClick) < 80);
  assert.ok(Math.abs(openTwo - firstRead) < 80);
  assert.ok(Math.abs(openThree - openTwo) < 80);
  assert.ok(Math.abs(openFour - openThree) < 80);
  assert.ok(Math.abs(openFive - openFour) < 80);
  assert.ok(
    open > openFive &&
      post > open &&
      write > post &&
      postTwo > write &&
      postThree > postTwo &&
      postFour > postThree &&
      postFive > postFour &&
      postSix > postFive &&
      claim > postSix,
  );
  assert.match(lead, /class="brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three open-after-post-four open-after-post-five"/);
  assert.match(lead, /data-open-brief=""/);
  assert.match(lead, /data-open-after-terms=""/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /data-open-after-post-first=""/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /data-open-after-post-two-stamp=""/);
  assert.match(lead, /data-open-after-post-three-stamp=""/);
  assert.match(lead, /data-open-after-post-four-stamp=""/);
  assert.match(lead, /data-open-after-post-five-stamp=""/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(lead, /class="open-label">Open brief/);
  assert.match(occupied, /data-post-after-open-five=""/);
  assert.match(occupied, /data-post-after-open-six=""/);
  assert.match(occupied, /data-post-after-open-four=""/);
  assert.match(occupied, /data-post-after-open-three=""/);
  assert.match(occupied, /data-post-after-open-two=""/);
  assert.match(occupied, /data-first-write="post"/);
  assert.match(two, /data-open-brief=""/);
  assert.match(two, /Open brief/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /data-open-after-terms/);
  assert.doesNotMatch(two, /after Terms/);
  assert.doesNotMatch(two, /data-open-after-post-first/);
  assert.doesNotMatch(two, /data-first-read="open"/);
  assert.doesNotMatch(two, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(two, /data-open-after-post-five-stamp/);
  assert.doesNotMatch(two, /open-after-post-five/);
  assert.doesNotMatch(two, /open-after-post-four/);
  assert.doesNotMatch(two, /open-after-post-three/);
  assert.doesNotMatch(two, /data-post-after-open-two/);
  assert.doesNotMatch(two, /data-post-after-open-three/);
  assert.doesNotMatch(two, /data-post-after-open-four/);
  assert.doesNotMatch(two, /data-post-after-open-five/);
  assert.doesNotMatch(two, /data-post-after-open-six/);
  assert.equal((occupied.match(/data-open-after-post-five-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-four-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-three-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-two-stamp=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-after-post-first=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-brief=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/href="\/r\/lst_lead"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-brief=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-six=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-post-after-open-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/href="#claim"/g) ?? []).length, 1);
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
  assert.doesNotMatch(css, /data-post-after-open-seven|data-open-after-post-six/);

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
  assert.match(empty, /This week’s wall/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /\$5 pastes the first flyer at #1/);
  assert.match(empty, /data-empty-week="true"/);
  assert.doesNotMatch(empty, /class="plaster"/);
  assert.doesNotMatch(empty, /class="flyers"/);
  assert.doesNotMatch(empty, /wall-occupied/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /data-post-after-open/);
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
  assert.doesNotMatch(empty, /after Open brief/);
  assert.doesNotMatch(empty, /after Terms/);
  assert.doesNotMatch(empty, /data-post-after-open-seven/);
  assert.doesNotMatch(empty, /data-open-after-post-six/);
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
  assert.match(occupied, /Post a brief this week/);
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
  assert.match(board, /<OccupiedFlyers listings=\{listings\} \/>/);
  assert.doesNotMatch(board, /EmptyPlaster/);
  assert.doesNotMatch(board, /<BoardCards/);
  assert.match(form, /data-empty-week="true"/);
  assert.match(form, /The plaster is blank/);
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
  assert.doesNotMatch(css, /data-post-after-open-seven|data-open-after-post-six/);
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
  assert.doesNotMatch(empty, /class="plaster"/);
  assert.doesNotMatch(empty, /class="flyers"/);
  assert.doesNotMatch(empty, /class="card/);
  assert.doesNotMatch(empty, /data-terms=/);
  assert.doesNotMatch(empty, /class="terms-label"/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-open-after-terms/);
  assert.doesNotMatch(empty, /after Terms/);
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

test("empty plaster Claim #1 is the first click — brief URL is a later write", () => {
  assert.match(
    cssSource,
    /Empty plaster: Brief URL is a later write after Claim #1 \/ Outbid/,
  );
  assert.match(
    cssSource,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.paste-rail\.empty-claim-first\[data-empty-claim-first\] \.brief-identity\[data-later-write\]/,
  );
  assert.match(
    cssSource,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.paste-rail\.empty-claim-first\[data-empty-claim-first\] \.later-write-label/,
  );
  assert.match(
    cssSource,
    /\.wall-stage\.wall-empty\[data-occupied="false"\] \.paste-rail\.empty-claim-first\[data-empty-claim-first\] \.outbid\[data-first-click="claim"\]/,
  );
  const later =
    (cssSource.split(
      "Empty plaster: Brief URL is a later write after Claim #1 / Outbid",
      2,
    )[1] ?? "").split("End empty-plaster later-write")[0] ?? "";
  assert.match(later, /border-top:\s*1px dashed var\(--line\)/);
  assert.match(later, /color:\s*var\(--muted\)/);
  assert.doesNotMatch(later, /background:/);
  assert.doesNotMatch(later, /var\(--bid-ink\)/);
  assert.doesNotMatch(later, /data-post-after-open-seven|data-open-after-post-six-stamp/);
  assert.match(cssSource, /\.wall-occupied \.paste-rail \.brief-identity\[data-later-write\]/);
  assert.match(cssSource, /\.wall-occupied \.paste-rail \[data-first-click="claim"\]/);

  const emptyFn =
    formSource.split("function EmptyClaimFirstWrite")[1]?.split(
      "export function OutbidForm",
    )[0] ?? "";
  const occupiedFn =
    formSource.split("function OccupiedBriefWrite")[1]?.split(
      "function EmptyClaimFirstWrite",
    )[0] ?? "";
  const emptyOutbid = emptyFn.indexOf("Outbid");
  const emptyLater = emptyFn.indexOf("data-later-write");
  const emptyUrl = emptyFn.indexOf("BriefIdentityFields");
  const occupiedFields = occupiedFn.indexOf("BriefIdentityFields");
  const occupiedOutbid = occupiedFn.indexOf("Outbid");
  assert.ok(emptyOutbid >= 0 && emptyLater > emptyOutbid);
  assert.ok(emptyUrl > emptyLater);
  assert.ok(occupiedFields >= 0 && occupiedOutbid > occupiedFields);
  assert.match(emptyFn, /data-first-click="claim"/);
  assert.match(emptyFn, /Then the brief URL/);
  assert.doesNotMatch(occupiedFn, /data-first-click="claim"/);
  assert.doesNotMatch(occupiedFn, /Then the brief URL/);
  assert.doesNotMatch(occupiedFn, /data-later-write/);
  assert.doesNotMatch(formSource, /data-post-after-open-seven|data-open-after-post-six-stamp/);

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  const claimAt = empty.indexOf('id="claim"');
  const emptyClaimAt = empty.indexOf('data-empty-claim-first=""');
  const claimCopyAt = empty.indexOf("Claim #1 for");
  const firstClickAt = empty.indexOf('data-first-click="claim"');
  const outbidAt = empty.indexOf(">Outbid<");
  const laterWriteAt = empty.indexOf('data-later-write=""');
  const laterLabelAt = empty.indexOf("Then the brief URL");
  const identityAt = empty.indexOf('data-brief-identity=""');
  const brandAt = empty.indexOf('name="brand"');
  const termsAt = empty.indexOf('name="terms"');
  const briefAt = empty.indexOf('name="briefUrl"');
  const plasterAt = empty.indexOf('data-empty-week="true"');
  assert.ok(claimAt >= 0 && emptyClaimAt > claimAt);
  assert.ok(claimCopyAt > emptyClaimAt && firstClickAt > claimCopyAt);
  assert.ok(outbidAt > firstClickAt);
  assert.ok(laterWriteAt > outbidAt && laterLabelAt > laterWriteAt);
  assert.ok(identityAt > outbidAt && identityAt <= laterWriteAt);
  assert.ok(brandAt > laterLabelAt && termsAt > brandAt);
  assert.ok(briefAt > termsAt);
  assert.ok(plasterAt >= 0 && plasterAt < firstClickAt);
  assert.match(empty, /class="paste-rail empty-claim-first"/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(empty, /aria-label="Claim #1"/);
  assert.match(empty, /data-first-click="claim"/);
  assert.match(empty, /data-brief-identity=""/);
  assert.match(empty, /data-later-write=""/);
  assert.match(empty, /Then the brief URL/);
  assert.match(empty, /name="brand"/);
  assert.match(empty, /name="terms"/);
  assert.match(empty, /name="briefUrl"/);
  assert.match(empty, /name="bidUsd"/);
  assert.match(empty, />Outbid</);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /class="amount-field"/);
  assert.match(empty, /class="step"/);
  assert.match(empty, /class="wall-stage wall-empty"/);
  assert.match(empty, /data-occupied="false"/);
  assert.doesNotMatch(empty, /Post a brief/);
  assert.doesNotMatch(empty, /Open brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-post-brief/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /data-later-open/);
  assert.doesNotMatch(empty, /later-open/);
  assert.doesNotMatch(empty, /cards-later/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /prize-before-price/);
  assert.doesNotMatch(empty, /data-later-fact/);
  assert.doesNotMatch(empty, /data-post-after-open-seven/);
  assert.doesNotMatch(empty, /data-open-after-post-six-stamp/);
  assert.equal((empty.match(/data-first-click="claim"/g) ?? []).length, 1);
  assert.equal((empty.match(/data-later-write=""/g) ?? []).length, 1);
  assert.equal((empty.match(/data-brief-identity=""/g) ?? []).length, 1);
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
  const leadStart = occupied.indexOf('data-id="lst_lead"');
  const twoStart = occupied.indexOf('data-id="lst_two"');
  const occupiedClaim = occupied.indexOf('id="claim"');
  const occupiedBrand = occupied.indexOf('name="brand"');
  const occupiedBrief = occupied.indexOf('name="briefUrl"');
  const occupiedSubmit = occupied.indexOf(">Outbid<");
  const occupiedOpen = occupied.indexOf('class="open-label">Open brief');
  const occupiedPost = occupied.indexOf('class="post-label">Post a brief');
  const lead = occupied.slice(leadStart, twoStart);
  const two = occupied.slice(twoStart, occupied.indexOf("</li>", twoStart));
  assert.ok(leadStart >= 0 && twoStart > leadStart);
  assert.ok(occupiedOpen > leadStart && occupiedOpen < occupiedClaim);
  assert.ok(occupiedBrand > occupiedClaim && occupiedBrief > occupiedBrand);
  assert.ok(occupiedSubmit > occupiedBrief);
  assert.ok(occupiedPost > occupiedOpen && occupiedPost < occupiedClaim);
  assert.match(occupied, /class="paste-rail"/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /Open brief/);
  assert.match(occupied, /Post a brief/);
  assert.match(occupied, /data-prize=/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Outbid</);
  assert.match(occupied, /name="brand"/);
  assert.match(occupied, /name="terms"/);
  assert.match(occupied, /name="briefUrl"/);
  assert.match(lead, /Open brief/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.doesNotMatch(occupied, /empty-claim-first/);
  assert.doesNotMatch(occupied, /data-empty-claim-first/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /data-later-write=/);
  assert.doesNotMatch(occupied, /data-brief-identity=/);
  assert.doesNotMatch(occupied, /Then the brief URL/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(occupied, /data-post-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-post-six-stamp/);
  assert.doesNotMatch(occupied, FORBIDDEN);
  assert.match(formSource, /empty-claim-first/);
  assert.match(formSource, /data-empty-claim-first=\{occupied \? undefined : ""\}/);
  assert.match(formSource, /data-first-click="claim"/);
  assert.match(formSource, /Then the brief URL/);
  assert.match(formSource, /OccupiedBriefWrite/);
  assert.match(formSource, /EmptyClaimFirstWrite/);
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
  assert.match(css, /\.wall-occupied a\.post-brief\.post-after-open \{/);
  assert.doesNotMatch(css, /^a\.post-brief\.post-after-open \{/m);
  assert.doesNotMatch(css, /^[^.\n]*\.cards-later \{/m);
  assert.doesNotMatch(css, /^[^.\n]*\.brief-url\.later-open/m);
  assert.doesNotMatch(board, /OccupiedFlyers listings=\{listings\} \/>[\s\S]*listings\.length === 0/);
  assert.match(board, /occupied \? \(/);
  assert.match(markup, /className="cards cards-later"/);
  assert.doesNotMatch(markup, /empty-claim-plaster/);
  assert.doesNotMatch(css, /empty-claim-plaster/);
  assert.doesNotMatch(css, /data-post-after-open-seven|data-open-after-post-six/);

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
  const after = card.indexOf('class="open-after-note">after Terms');
  const open = card.indexOf('class="open-label">Open brief');
  const later = card.indexOf('data-later-fact=""');
  const bid = card.indexOf('class="bid later-fact"');
  const clicks = card.indexOf("3 clicks");
  assert.ok(brand >= 0 && termsMark > brand);
  assert.ok(termsLabel > termsMark && termsCopy > termsLabel);
  assert.ok(hop > termsCopy && after > hop && open > after && bid > open && later >= bid && clicks > later);
  assert.match(card, /data-terms=""/);
  assert.match(card, /class="terms-label">Terms/);
  assert.match(card, /\$800 flat, 1 TikTok/);
  assert.match(card, /Open brief/);
  assert.match(card, /after Terms/);
  assert.match(card, /data-open-after-terms=""/);
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
  assert.equal((occupied.match(/data-later-fact=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="bid later-fact"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-later-open=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /data-post-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-post-six/);
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
  assert.equal((occupied.match(/data-later-fact=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="bid later-fact"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-later-open=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /data-post-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-post-six/);
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
    /\.wall-occupied \.card \.brief-url\.open-after-post-five\s*\{[^}]*font-size:\s*([\d.]+)rem/,
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
  assert.match(markup, /function OpenBriefHop/);
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
  assert.doesNotMatch(empty, /data-open-after-terms/);
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
  const leadList = occupied.indexOf('aria-label="Paid briefs this week"');
  const laterList = occupied.indexOf('aria-label="Later briefs this week"');
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
  assert.ok(post > twoStart && claim > post);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /data-open-brief=""/);
  assert.match(lead, /data-open-after-terms=""/);
  assert.match(lead, /class="open-after-note">after Terms/);
  assert.match(lead, /class="open-label">Open brief/);
  assert.match(lead, /href="\/r\/lst_lead"/);
  assert.match(
    lead,
    /class="brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three open-after-post-four open-after-post-five"/,
  );
  assert.doesNotMatch(lead, /data-later-open/);
  assert.doesNotMatch(lead, /later-open/);
  assert.doesNotMatch(lead, /cards-later/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.match(two, /data-open-brief=""/);
  assert.match(two, /class="open-label">Open brief/);
  assert.match(two, /href="\/r\/lst_two"/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /data-open-after-terms/);
  assert.doesNotMatch(two, /after Terms/);
  assert.doesNotMatch(two, /data-open-after-post-first/);
  assert.doesNotMatch(two, /data-first-read="open"/);
  assert.doesNotMatch(two, /open-after-post-five/);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-later-open=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="brief-url later-open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-open-brief=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/class="open-label">Open brief/g) ?? []).length, 2);
  assert.equal((occupied.match(/aria-label="Paid briefs this week"/g) ?? []).length, 1);
  assert.equal((occupied.match(/aria-label="Later briefs this week"/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /open-later-rank|data-later-rank[^-]/);
  assert.doesNotMatch(occupied, /data-post-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-post-six/);
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
  assert.match(solo, /aria-label="Paid briefs this week"/);
  assert.match(solo, /data-first-click="open"/);
  assert.doesNotMatch(solo, /cards-later/);
  assert.doesNotMatch(solo, /Later briefs this week/);
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
  assert.match(
    css,
    /\.wall-occupied \.cards-later \.card\s*\{[^}]*grid-template-areas:[\s\S]*"bid bid clicks"[\s\S]*"url url url"/,
  );
  assert.match(
    css,
    /\.wall-occupied \.card \{\n[^}]*grid-template-areas:[\s\S]*"url url url"[\s\S]*"bid bid clicks"/,
  );
  assert.doesNotMatch(css, /\.wall-occupied \.cards-later \.wall-occupied \.card/);
  assert.match(markup, /\{lead \? hop : null\}/);
  assert.match(markup, /\{lead \? null : hop\}/);
  assert.match(markup, /function OpenBriefHop/);
  assert.doesNotMatch(markup, /open-later-rank|data-later-rank[^-]/);
  assert.doesNotMatch(css, /open-later-rank|data-later-rank[^-]|data-post-after-open-seven|data-open-after-post-six/);

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
  const leadList = occupied.indexOf('aria-label="Paid briefs this week"');
  const laterList = occupied.indexOf('aria-label="Later briefs this week"');
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
  assert.match(lead, /class="open-after-note">after Terms/);
  assert.doesNotMatch(lead, /data-later-open/);
  assert.match(two, /data-later-open=""/);
  assert.match(two, /class="brief-url later-open"/);
  assert.match(two, /data-open-brief=""/);
  assert.match(two, /href="\/r\/lst_two"/);
  assert.doesNotMatch(two, /data-first-click="open"/);
  assert.doesNotMatch(two, /data-open-after-terms/);
  assert.doesNotMatch(two, /after Terms/);
  assert.doesNotMatch(two, /data-prize=/);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-later-open=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /open-later-rank|data-later-rank[^-]/);
  assert.doesNotMatch(occupied, /data-post-after-open-seven|data-open-after-post-six/);
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
    /\.wall-occupied \.card \.brief-url\.open-after-post-five\s*\{[^}]*font-size:\s*([\d.]+)rem/,
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
  assert.match(laterSlip, /grid-template-columns:\s*4\.6rem minmax\(0, 1fr\)/);
  assert.match(laterSlip, /box-shadow:\s*none/);
  assert.match(laterSlip, /border:\s*1px dashed var\(--line\)/);
  assert.doesNotMatch(laterSlip, /outline:\s*2px solid var\(--bid\)/);
  assert.match(markup, /function OccupiedLaterFlyer/);
  assert.match(markup, /function OccupiedLeadFlyer/);
  assert.match(markup, /className="card later-flyer"/);
  assert.match(markup, /data-later-flyer=""/);
  assert.match(markup, /data-later-pack=""/);
  assert.match(markup, /These flyers are not this week’s #1 prize/);
  assert.match(markup, /className="later-terms-kicker"/);
  assert.match(markup, /className="later-terms-copy"/);
  assert.match(markup, /\{lead \? hop : null\}/);
  assert.match(markup, /\{lead \? null : hop\}/);
  assert.doesNotMatch(markup, /open-later-rank|data-later-rank[^-]|data-later-quiet|data-later-rank-quiet/);
  assert.doesNotMatch(css, /open-later-rank|data-later-rank[^-]|data-later-quiet|0\.78rem --muted/);
  assert.doesNotMatch(markup, /data-post-after-open-seven|data-open-after-post-six/);
  assert.doesNotMatch(css, /data-post-after-open-seven|data-open-after-post-six/);

  const empty = renderToStaticMarkup(
    createElement(Board, { listings: [], weekId: WEEK }),
  );
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /Blank plaster/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(empty, /data-first-click="claim"/);
  assert.match(empty, /Then the brief URL/);
  assert.doesNotMatch(empty, /data-later-flyer/);
  assert.doesNotMatch(empty, /later-flyer/);
  assert.doesNotMatch(empty, /data-later-pack/);
  assert.doesNotMatch(empty, /later-pack/);
  assert.doesNotMatch(empty, /These flyers are not this week’s #1 prize/);
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
  assert.match(solo, /aria-label="Paid briefs this week"/);
  assert.match(solo, /data-prize=""/);
  assert.match(solo, /data-first-click="open"/);
  assert.match(solo, /class="terms-label">Terms/);
  assert.doesNotMatch(solo, /data-later-flyer/);
  assert.doesNotMatch(solo, /later-flyer/);
  assert.doesNotMatch(solo, /data-later-pack/);
  assert.doesNotMatch(solo, /These flyers are not this week’s #1 prize/);
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
  const laterListAt = occupied.indexOf('aria-label="Later briefs this week"');
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
  assert.ok(postAt > threeStart && claimAt > postAt);
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
  assert.match(occupied, /These flyers are not this week’s #1 prize/);
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
  assert.doesNotMatch(two, /data-open-after-terms/);
  assert.doesNotMatch(two, /after Terms/);
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
  assert.doesNotMatch(occupied, /data-post-after-open-seven|data-open-after-post-six/);
  assert.doesNotMatch(occupied, /data-later-write=/);
  assert.doesNotMatch(occupied, /Then the brief URL/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Outbid</);
  assert.doesNotMatch(empty, FORBIDDEN);
  assert.doesNotMatch(occupied, FORBIDDEN);
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
  assert.doesNotMatch(empty, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(empty, /data-open-after-post-five-stamp/);

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
  const laterFact = card.indexOf('data-later-fact=""');
  const bid = card.indexOf('class="bid later-fact"');
  const clicks = card.indexOf("3 clicks");
  assert.ok(terms >= 0 && hop > terms && after > hop);
  assert.ok(open > after && bid > open && laterFact >= bid && clicks > laterFact);
  assert.match(card, /class="brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three open-after-post-four open-after-post-five"/);
  assert.match(card, /data-open-brief=""/);
  assert.match(card, /data-first-click="open"/);
  assert.match(card, /data-open-after-post-first=""/);
  assert.match(card, /data-first-read="open"/);
  assert.match(card, /data-open-after-post-two-stamp=""/);
  assert.match(card, /data-open-after-post-three-stamp=""/);
  assert.match(card, /data-open-after-post-four-stamp=""/);
  assert.match(card, /data-open-after-post-five-stamp=""/);
  assert.match(card, /href="\/r\/lst_acme"/);
  assert.equal((html.match(/data-open-after-terms=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-post-first=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-post-two-stamp=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-post-three-stamp=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-post-four-stamp=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-post-five-stamp=""/g) ?? []).length, 1);
  const laterStart = html.indexOf('data-id="lst_two"');
  const later = html.slice(laterStart, html.indexOf("</li>", laterStart));
  const laterTerms = later.indexOf('data-terms=""');
  const laterBid = later.indexOf('class="bid">$5');
  const laterOpen = later.indexOf('data-later-open=""');
  assert.ok(laterTerms >= 0 && laterBid > laterTerms && laterOpen > laterBid);
  assert.match(later, /data-later-open=""/);
  assert.match(later, /class="brief-url later-open"/);
  assert.doesNotMatch(later, /data-first-click="open"/);
  assert.doesNotMatch(later, /data-open-after-terms/);
  assert.doesNotMatch(later, /after Terms/);
  assert.doesNotMatch(later, /data-open-after-post-first/);
  assert.doesNotMatch(later, /data-first-read="open"/);
  assert.doesNotMatch(later, /data-open-after-post-two-stamp/);
  assert.doesNotMatch(later, /data-open-after-post-three-stamp/);
  assert.doesNotMatch(later, /data-open-after-post-four-stamp/);
  assert.doesNotMatch(later, /data-open-after-post-five-stamp/);
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
  assert.match(card, /data-open-after-post-two-stamp=""/);
  assert.match(card, /data-open-after-post-three-stamp=""/);
  assert.match(card, /data-open-after-post-four-stamp=""/);
  assert.match(card, /data-open-after-post-five-stamp=""/);
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
  const uncounted = html.indexOf('data-confirm-uncounted=""');
  const uncountedCopy = html.indexOf("Opening this flyer has not counted a hop.");
  const terms = html.indexOf("$800 flat, 1 TikTok");
  const url = html.indexOf("https://briefs.example.com/acme?id=9");
  const leave = html.indexOf('data-leave-brief=""');
  const bid = html.indexOf('class="confirm-bid">$5');
  const hops = html.indexOf("3 public hops — not reach");
  assert.ok(uncounted >= 0 && uncountedCopy >= 0 && uncounted <= uncountedCopy);
  assert.ok(terms > uncountedCopy && url > terms && leave > url);
  assert.ok(bid > leave && hops > bid);
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
  assert.doesNotMatch(html, /data-post-after-open-seven|data-open-after-post-six/);
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
  assert.doesNotMatch(css, /data-post-after-open-seven|data-open-after-post-six/);

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
    const stillZero = listLiveBoard(db, WEEK);
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
