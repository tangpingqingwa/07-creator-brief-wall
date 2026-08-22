import assert from "node:assert/strict";
import { test } from "node:test";
import {
  currentWeekUtc,
  isLiveWeekId,
  isoWeekMondayUtc,
  nextResetUtc,
  nowUtc,
  previousWeekId,
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
  assert.deepEqual(currentWeekUtc(monday), {
    weekId: "2026-W34",
    startsAt: "2026-08-17T00:00:00.000Z",
    endsAt: "2026-08-24T00:00:00.000Z",
  });
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
