import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/lib/db";
import { insertFixtureListing } from "../src/lib/test-listings";
import {
  ROLLING_WEEK_MS,
  bidInRollingWeek,
  currentWeekUtc,
  isLiveWeekId,
  isoWeekMondayUtc,
  listLiveBoard,
  nextResetUtc,
  nowUtc,
  previousWeekId,
  rollingWeekStart,
  utcWeekId,
  weekStartUtc,
} from "../src/lib/week";

test("Monday 00:00 UTC rolls weekId", () => {
  const justBefore = new Date("2026-08-16T23:59:59.999Z");
  const monday = new Date("2026-08-17T00:00:00.000Z");
  assert.equal(utcWeekId(justBefore), "2026-W33");
  assert.equal(utcWeekId(monday), "2026-W34");
  assert.equal(weekStartUtc(monday).toISOString(), "2026-08-17T00:00:00.000Z");
  assert.equal(nextResetUtc(monday).toISOString(), "2026-08-24T00:00:00.000Z");
  assert.equal(currentWeekUtc(monday).weekId, "2026-W34");
  assert.equal(
    currentWeekUtc(monday).startsAt,
    rollingWeekStart(monday).toISOString(),
  );
  assert.notEqual(utcWeekId(justBefore), utcWeekId(monday));
});

test("Sunday still belongs to the previous ISO week", () => {
  const sunday = new Date("2026-08-16T23:59:59.999Z");
  assert.equal(utcWeekId(sunday), "2026-W33");
  assert.equal(weekStartUtc(sunday).toISOString(), "2026-08-10T00:00:00.000Z");
  assert.equal(nextResetUtc(sunday).toISOString(), "2026-08-17T00:00:00.000Z");
});

test("ISO year can differ from the calendar year near 1 January", () => {
  assert.equal(utcWeekId(new Date("2026-12-31T12:00:00.000Z")), "2026-W53");
  assert.equal(utcWeekId(new Date("2027-01-01T00:00:00.000Z")), "2026-W53");
  assert.equal(utcWeekId(new Date("2027-01-04T00:00:00.000Z")), "2027-W01");
  assert.equal(
    isoWeekMondayUtc("2027-W01").toISOString(),
    "2027-01-04T00:00:00.000Z",
  );
  assert.equal(previousWeekId("2026-W34"), "2026-W33");
});

test("WEEK_NOW is the documented operator / test clock", () => {
  const previous = process.env.WEEK_NOW;
  process.env.WEEK_NOW = "2026-08-16T23:59:59.999Z";
  try {
    assert.equal(nowUtc().toISOString(), "2026-08-16T23:59:59.999Z");
    assert.equal(utcWeekId(), "2026-W33");
    process.env.WEEK_NOW = "2026-08-17T00:00:00.000Z";
    assert.equal(utcWeekId(), "2026-W34");
  } finally {
    if (previous === undefined) {
      delete process.env.WEEK_NOW;
    } else {
      process.env.WEEK_NOW = previous;
    }
  }
});

test("previous week rows are absent from the live board", () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const rows = [
    { id: "lst_old", weekId: "2026-W33", brand: "Last Week", clicks: 9 },
    { id: "lst_live", weekId: "2026-W34", brand: "This Week", clicks: 1 },
  ];
  const live = rows.filter((row) => isLiveWeekId(row.weekId, monday));
  assert.equal(utcWeekId(monday), "2026-W34");
  assert.equal(live.length, 1);
  assert.equal(live[0]?.id, "lst_live");
  assert.ok(!live.some((row) => row.brand === "Last Week"));
  assert.equal(isLiveWeekId("2026-W33", monday), false);
  assert.equal(
    isLiveWeekId("2026-W34", new Date("2026-08-24T00:00:00.000Z")),
    false,
  );
});

test("clicks and bids do not carry over to the next weekId", () => {
  const thisWeek = new Date("2026-08-17T00:00:00.000Z");
  const nextMonday = new Date("2026-08-24T00:00:00.000Z");
  const prior = { weekId: "2026-W34", bidUsd: 12, clicks: 5 };
  assert.equal(isLiveWeekId(prior.weekId, thisWeek), true);
  assert.equal(isLiveWeekId(prior.weekId, nextMonday), false);
  assert.equal(utcWeekId(nextMonday), "2026-W35");
  assert.equal(prior.bidUsd, 12);
  assert.equal(prior.clicks, 5);
});

test("rolling last-7-days window is 7 * 24h with an expired exact boundary", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");
  assert.equal(ROLLING_WEEK_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(
    rollingWeekStart(now).toISOString(),
    "2026-08-17T00:00:00.000Z",
  );
  assert.equal(bidInRollingWeek("2026-08-17T00:00:00.000Z", now), false);
  assert.equal(bidInRollingWeek("2026-08-17T00:00:00.001Z", now), true);
  assert.equal(bidInRollingWeek("2026-08-16T23:59:59.000Z", now), false);
  assert.equal(bidInRollingWeek("2026-08-23T23:59:59.000Z", now), true);
  assert.equal(bidInRollingWeek("2026-08-24T00:00:01.000Z", now), false);
});

test("Monday 00:00 UTC does not drop a bid still inside the rolling week", () => {
  const sundayPay = "2026-08-16T12:00:00.000Z";
  const mondayMidnight = new Date("2026-08-17T00:00:00.000Z");
  assert.equal(bidInRollingWeek(sundayPay, mondayMidnight), true);
  assert.equal(
    bidInRollingWeek(sundayPay, new Date("2026-08-23T12:00:00.000Z")),
    false,
  );
  assert.equal(
    bidInRollingWeek(sundayPay, new Date("2026-08-23T12:00:01.000Z")),
    false,
  );
});

test("live board keeps a Sunday pay across Monday 00:00 UTC and drops it after 7 days", () => {
  const db = openDatabase(":memory:");
  try {
    insertFixtureListing(db, {
      id: "lst_sunday",
      weekId: "2026-W33",
      brand: "Sunday Co",
      terms: "paid Sunday",
      briefUrl: "https://example.com/sunday",
      bidUsd: 20,
      createdAt: "2026-08-16T12:00:00.000Z",
    });
    insertFixtureListing(db, {
      id: "lst_stale",
      weekId: "2026-W33",
      brand: "Stale Co",
      terms: "aged out",
      briefUrl: "https://example.com/stale",
      bidUsd: 50,
      createdAt: "2026-08-09T12:00:00.000Z",
    });

    const monday = listLiveBoard(db, new Date("2026-08-17T00:00:00.000Z"));
    assert.equal(monday.length, 1);
    assert.equal(monday[0]?.id, "lst_sunday");
    assert.equal(monday[0]?.bidUsd, 20);

  const stillLive = listLiveBoard(
    db,
    new Date("2026-08-23T11:59:59.999Z"),
  );
  assert.equal(stillLive.length, 1);
  assert.equal(stillLive[0]?.id, "lst_sunday");

  const aged = listLiveBoard(db, new Date("2026-08-23T12:00:00.000Z"));
    assert.equal(aged.length, 0);

    const stored = db.prepare("SELECT COUNT(*) AS n FROM listings").get() as {
      n: number;
    };
    assert.equal(stored.n, 2);
  } finally {
    db.close();
  }
});
