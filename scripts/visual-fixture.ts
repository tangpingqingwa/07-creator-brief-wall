import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/lib/db";
import { insertFixtureListing } from "../src/lib/test-listings";
import { listLiveBoard } from "../src/lib/week";

export const VISUAL_FIXTURE_NOW = new Date("2026-08-29T12:00:00.000Z");
export const VISUAL_FIXTURE_WEEK = "2026-W35";

export const VISUAL_FIXTURE_ROWS = [
  {
    id: "lst_visual_one",
    brand: "Juniper House",
    terms: "Flat fee; 1 TikTok video; deliver by Sep 12",
    briefUrl: "https://example.com/creator-briefs/juniper-house-fall-drop",
    bidUsd: 17_000,
    clicks: 148,
    createdAt: "2026-08-28T10:00:00.000Z",
  },
  {
    id: "lst_visual_two",
    brand: "Good Form Skin",
    terms: "Flat fee and product; 1 Instagram Reel; publish by Sep 13",
    briefUrl: "https://example.com/creator-briefs/good-form-skin-routine",
    bidUsd: 16_000,
    clicks: 92,
    createdAt: "2026-08-27T10:00:00.000Z",
  },
  {
    id: "lst_visual_three",
    brand: "Field Note Coffee",
    terms: "Flat fee; 1 YouTube Short; deliver by Sep 15",
    briefUrl: "https://example.com/creator-briefs/field-note-coffee-morning",
    bidUsd: 14_028,
    clicks: 64,
    createdAt: "2026-08-26T10:00:00.000Z",
  },
  {
    id: "lst_visual_four",
    brand: "Arc and Alder Home",
    terms: "Flat fee; 2 TikTok videos; publish by Sep 18",
    briefUrl: "https://example.com/creator-briefs/arc-alder-studio",
    bidUsd: 13_005,
    clicks: 48,
    createdAt: "2026-08-25T10:00:00.000Z",
  },
  {
    id: "lst_visual_five",
    brand: "Rally Outdoor Co.",
    terms: "Flat fee and product; 1 Twitch segment; stream by Sep 20",
    briefUrl: "https://example.com/creator-briefs/rally-outdoor-weekend",
    bidUsd: 12_080,
    clicks: 27,
    createdAt: "2026-08-24T10:00:00.000Z",
  },
  {
    id: "lst_visual_six",
    brand: "Moss and Metric",
    terms: "Flat fee; 3 Instagram story frames; deliver by Sep 22",
    briefUrl: "https://example.com/creator-briefs/moss-metric-desk-reset",
    bidUsd: 11_004,
    clicks: 12,
    createdAt: "2026-08-23T10:00:00.000Z",
  },
] as const;

export function seedVisualFixture(databasePath: string) {
  const path = resolve(databasePath);
  if (!path.startsWith("/private/tmp/")) {
    throw new Error("visual fixture requires a disposable /private/tmp database");
  }
  if (existsSync(path)) {
    throw new Error("visual fixture refuses to overwrite an existing database");
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path);
  try {
    for (const row of VISUAL_FIXTURE_ROWS) {
      insertFixtureListing(db, {
        ...row,
        weekId: VISUAL_FIXTURE_WEEK,
      });
    }
    return listLiveBoard(db, VISUAL_FIXTURE_NOW);
  } finally {
    db.close();
  }
}

function runFromCli(): void {
  const requested = process.argv[2] ?? process.env.DATABASE_PATH;
  if (!requested || requested === ":memory:") {
    throw new Error("visual fixture requires a disposable file-backed DATABASE_PATH");
  }
  const rows = seedVisualFixture(requested);
  for (const row of rows) {
    process.stdout.write(
      `${row.id}\t${row.brand}\t${row.terms}\t${row.bidUsd}\t${row.clicks}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFromCli();
}
