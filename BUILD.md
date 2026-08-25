# Creator Brief Wall — Detailed Specification and Build Plan

**Product contract:** [SPEC.md](./SPEC.md)
**This file:** stack, modules, ranking implementation, PR sequence
**Git:** [CONTRIBUTING.md](./CONTRIBUTING.md)

Pay-to-rank clone of outbid.lol for **creator briefs**. Brands pay to be seen by mid-tier creators. Rank is the bid. No fake follower counts.

---

## 0. Outcome

Public English site: weekly board of briefs worth taking. One form (brand, terms, brief URL, amount, Outbid). Polar takes USD. Cards show **$** and **clicks**. Live rank is the rolling last 7 days from paid placement, not Monday 00:00 UTC.

---

## 1. Stack

| Layer | Choice |
|---|---|
| Runtime | Node 22 + TypeScript strict |
| App | Next.js App Router (outbid-like). Server Components for the board. One small client island for the form. |
| DB | SQLite via `better-sqlite3` in tests and default local. Same SQL must run on Postgres later if the box needs it. |
| Payments | Polar Checkout live. `FakePolarPort` in tests. Env-gated (`POLAR_LIVE=1`). |
| CSS | Minimal utility CSS or Tailwind. Visual clone: one input row, amount, Outbid button, ranked cards with $ and clicks. |
| Tests | `node:test` + fixture Polar. No live Polar in `scripts/test.sh`. |
| Host | One VPS or a single Node process. `$PORT`. |

No creator auth. No Redis in v1. No tracking pixels on outbound brief URLs.

---

## 2. Target tree

```
SPEC.md
BUILD.md
README.md
CONTRIBUTING.md
scripts/test.sh
scripts/live-smoke.sh          # PR 7; not invoked from test.sh
docs/live-smoke.md
.env.example
src/
  app/
    page.tsx                   # board
    about/page.tsx
    rules/page.tsx
    checkout/return/page.tsx
    healthz/route.ts
    api/checkout/route.ts
    api/webhooks/polar/route.ts
    r/[id]/route.ts
  lib/
    db.ts
    rank.ts
    urls.ts
    week.ts
    polar.ts                   # live + FakePolarPort
    clicks.ts
  db/schema.sql
tests/
  rank.test.ts
  urls.test.ts
  week.test.ts
  board.test.ts
  checkout.test.ts
```

This docs PR does **not** add that tree. Later PRs do.

---

## 3. Ranking module

`rank.ts` is the only place that orders the board.

```
sort: bidUsd DESC, createdAt ASC, id ASC
place(bid): reject if bid < 5 or bid > 50000 or bid !== floor(bid)
raise(listing, newBid):
  reject if newBid < listing.bidUsd + 1
  charge = newBid - listing.bidUsd
  if another listing has bid >= newBid and is older, this row still sorts below it
```

Week key: ISO week in UTC (`weekId`) is a Polar/audit label. Live rank is a rolling last-7-days filter on paid `createdAt`, not Monday 00:00 UTC. Reset is that query filter, not a delete, plus a documented operator/test clock. Raise identity is the same canonical brief URL still inside that window — not `weekId`.

---

## 4. Tests (offline)

| Test | Assert |
|---|---|
| `rank.test.ts` | $5 lists; $6 is #1; equal bids keep older higher; raise pays difference only |
| `urls.test.ts` | strips `utm_*` / `fbclid`; rejects telegram/discord; rejects NSFW; rejects `bit.ly` |
| `week.test.ts` | Monday 00:00 UTC rolls `weekId` label; live board is rolling last 7 days; aged rows absent |
| `board.test.ts` | card has brand, terms, $, clicks; HTML has **no** follower/subscriber/CPM fields |
| `checkout.test.ts` | FakePolarPort; unpaid session does not list; webhook/fixture completion lists; same brief still in last 7 days raises after `weekId` rolls |
| `scripts/test.sh` | contract files + (once app exists) `tsc` + `node:test`. Never Polar live. |

---

## 5. PR plan

Each heading below is a fleet unit. Do not start PR N+1 in the same change as PR N.

### PR 1: Skeleton + schema + healthz

- **Description:** Next.js/TS skeleton, SQLite schema (listings + payments), `GET /healthz`, extend `scripts/test.sh`. No Polar live. No board cards yet beyond an empty honest page.
- **Files:** `package.json`, `tsconfig.json`, `src/db/schema.sql`, `src/lib/db.ts`, `src/app/healthz/route.ts`, `src/app/page.tsx` (empty state), `scripts/test.sh`
- **Dependencies:** None
- **Acceptance:** `GET /healthz` 200; `GET /` 200 empty week; `bash scripts/test.sh` green offline.

### PR 2: Board UI clone

- **Description:** Outbid-like board: brand, terms, brief URL, amount, Outbid button, ranked cards with **$** and **clicks**. Still fixture-only money (in-memory or direct DB insert behind a test hook is OK if labeled test-only). No live Polar.
- **Files:** `src/app/page.tsx`, board styles, `src/lib/rank.ts`, `tests/rank.test.ts`, `tests/board.test.ts`
- **Dependencies:** PR 1
- **Acceptance:** Cards sort by bid; older wins ties; page does not render follower counts.

### PR 3: Polar checkout + fixture

- **Description:** `POST /checkout` starts Polar or `FakePolarPort`. Webhook / fixture completion writes the listing. Unpaid sessions do not list. CI stays on the fixture.
- **Files:** `src/lib/polar.ts`, `src/app/api/checkout/route.ts`, `src/app/api/webhooks/polar/route.ts`, `src/app/checkout/return/page.tsx`, `tests/checkout.test.ts`, `.env.example`
- **Dependencies:** PR 2
- **Acceptance:** Fixture $5 appears on the board after completion; live flags unset in `scripts/test.sh`.

### PR 4: Raise-bid + difference

- **Description:** Same canonical brief URL still inside last 7 days raises; `weekId` is not the raise key. Charge is **new − current**; cannot steal #1 by paying only the incumbent’s difference. New bid must be ≥ current + $1, and ≥ top + $1 to become #1.
- **Files:** `src/lib/rank.ts`, checkout raise path, `tests/rank.test.ts`
- **Dependencies:** PR 3
- **Acceptance:** SPEC §6 items 5–6.

### PR 5: About, rules, URL hygiene

- **Description:** `/about`, `/rules`, strip tracking, reject chat/NSFW/shorteners, https only. Click-through not required yet.
- **Files:** `src/app/about/page.tsx`, `src/app/rules/page.tsx`, `src/lib/urls.ts`, `tests/urls.test.ts`
- **Dependencies:** PR 2
- **Acceptance:** SPEC §7 and §9 about/rules.

### PR 6: Weekly reset + public brief-URL clicks

- **Description:** ISO week in UTC as Polar/audit label. Live board is rolling last 7 days from paid placement, not Monday 00:00 UTC. `GET /r/:id` confirms terms + URL. `POST /r/:id` increments public clicks and 302s to the canonical brief URL with no added trackers.
- **Files:** `src/lib/week.ts`, `src/lib/clicks.ts`, `src/lib/confirm-brief.ts`, `src/app/r/[id]/route.ts`, `tests/week.test.ts`, `tests/board.test.ts`
- **Dependencies:** PR 2
- **Acceptance:** SPEC §6.7 and public clicks on the brief URL.

### PR 7: Live-smoke

- **Description:** Operator `scripts/live-smoke.sh` + `docs/live-smoke.md`. Walks SPEC §11 against a local process. Polar live only if secrets exist; otherwise `BLOCKED-SECRET` with the env var name. **Not** called from `scripts/test.sh` or `.github/workflows/ci.yml`.
- **Files:** `scripts/live-smoke.sh`, `docs/live-smoke.md`, `scripts/test.sh` (assert smoke is not wired into CI)
- **Dependencies:** PR 3, PR 4, PR 5, PR 6
- **Acceptance:** Script executable. CI does not set `POLAR_LIVE=1`. Each SPEC §11 flow is PASS, PASS-ERROR, or BLOCKED-SECRET.

---

## 6. What we will not build in these PRs

- Creator login, chat, applications, or escrow.
- Follower scrapers or purchased audience numbers.
- Ads, API keys, or a public write API.
- Multi-currency or crypto.
- A scraper of TikTok / YouTube / Instagram / Twitch.

---

## 7. Done (launch path vs GA)

Launch path = PRs 1–7 on `main` and offline `scripts/test.sh` green.

GA / fleet **done** also requires an operator run of `scripts/live-smoke.sh` against a local process with live Polar **or** documented `BLOCKED-SECRET`, results in `docs/live-smoke.md`. Fixture-only CI is not done.
