# Live smoke — Creator Brief Wall

Operator-only. `bash scripts/live-smoke.sh` is **not** called from `scripts/test.sh` or GitHub Actions. CI and `scripts/test.sh` stay offline and must not set `POLAR_LIVE`.

`100%` for this unit means a **local process** walked every SPEC §11 flow. Fixture checkout is allowed for place / outbid / raise / tie / click / reject / reset. Live Polar runs only when `POLAR_LIVE=1` and secrets exist. Missing Polar secret is `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` (or the frozen name) — that is not a fixture success and not a paid rank. A live Polar checkout must be a real `sandbox.polar.sh` Checkout URL, not a fixture listing. Do not invent follower counts. An empty week is valid.

## How to run

```bash
bash scripts/live-smoke.sh
```

The script:

1. Refuses `CI=true` and `GITHUB_ACTIONS=true`.
2. Builds Next.js if needed, then starts `next start` on a free loopback port with a temp `DATABASE_PATH`, Polar env unset, and `POLAR_FIXTURE_ONLY=1`.
3. Or attaches to `LIVE_SMOKE_BASE` if that server already answers `GET /healthz`.
4. Walks SPEC §11: Health, Empty board, About / rules, Place $5, Outbid, Raise, Tie, Click, Reject, Reset, Secret.
5. Live Polar missing token: starts a dedicated process with `POLAR_LIVE=1` and Polar secrets unset. Missing token prints `BLOCKED-SECRET: POLAR_ACCESS_TOKEN`. Never invents a live paid row.
6. Live Polar sandbox checkout (operator `POLAR_LIVE=1` + secrets): starts a live-flagged process with `POLAR_API_BASE=https://sandbox-api.polar.sh`. `POST /checkout` must 303 to a real `https://sandbox.polar.sh/…` Checkout URL. Unpaid session stays off the board.
7. Week roll uses the documented `WEEK_NOW` operator clock and a fresh listener so last week’s cards cannot leak onto `/`.
8. Kills the process it started and deletes the temp workdir.

Overrides: `LIVE_SMOKE_BASE`, `LIVE_SMOKE_PORT`, `LIVE_SMOKE_REBUILD=1`.

Live Polar (operator machine with a real token):

```bash
set -a
. /Users/yann/.polar/sandbox.env
set +a
POLAR_LIVE=1
unset POLAR_FIXTURE_ONLY
POLAR_API_BASE=https://sandbox-api.polar.sh
bash scripts/live-smoke.sh
```

Sandbox tokens 401 against `https://api.polar.sh`. The live client honors `POLAR_API_BASE`; default remains production. Never set `POLAR_LIVE` in `scripts/test.sh` or Actions.

## Verdicts

| Label | Meaning |
|---|---|
| `PASS` | Flow completed as SPEC requires. |
| `PASS-ERROR` | Documented product error; nothing invented. |
| `BLOCKED-SECRET` | Live Polar secret missing. Exact env var named. |
| `FAIL` | Broken product, wrong rank, invented followers, or a live charge in CI. |

## This session

Ran `bash scripts/test.sh` then `bash scripts/live-smoke.sh` on **2026-08-23** from `feat/live-polar-sandbox-smoke` (parent `d061e89` on `origin/main`). Offline `scripts/test.sh` exited 0 (`OK: buildable and testable`). Operator Polar sandbox env sourced from `/Users/yann/.polar/sandbox.env` (mode 600). `POLAR_LIVE=1`. `POLAR_FIXTURE_ONLY` unset. `POLAR_API_BASE=https://sandbox-api.polar.sh`. Token / webhook / product present by length only. Local fixture process started by the script on `http://127.0.0.1:57639` via `next start` after `next build`. Temp SQLite. Week `2026-W34` UTC. Fixture path (`POLAR_FIXTURE_ONLY=1`) for place / outbid / raise / tie / click / reject / reset. Unique `*.example` brief URLs for this run. No invented follower counts. No unpaid listing treated as paid.

Live Polar missing token was walked on a dedicated loopback process (`POLAR_LIVE=1`, token unset) and printed `BLOCKED-SECRET: POLAR_ACCESS_TOKEN`. Live Polar sandbox checkout was walked on a second live-flagged process with operator secrets and `POLAR_API_BASE=https://sandbox-api.polar.sh`. `POST /checkout` 303’d to a real `https://sandbox.polar.sh/…` Checkout URL. That unpaid session did not appear on the board. Production `https://api.polar.sh` is unused for this smoke (sandbox token is 401 there).

| Flow | Result | Note |
|---|---|---|
| Health | **PASS** | `GET /healthz` 200 `{ ok: true }` |
| Empty board | **PASS** | `GET /` 200 week `2026-W34` empty + bid form. No seeded briefs. No invented follower counts. |
| About / rules | **PASS** | `GET /about` and `GET /rules` 200. Rank is the bid. Weekly reset (rolling last 7 days, not Monday 00:00 UTC). |
| Place $5 | **PASS** | Fixture pay $5 → #1 `SmokeFive 20260823081900`. Brand + terms + $5. Tracking stripped. |
| Outbid | **PASS** | Second brief at $6 is #1. First $5 stays on the board at #2. |
| Raise | **PASS** | First listing $5→$7 (pays difference) and becomes #1. $6 stays. |
| Tie | **PASS** | Both $8. Older `SmokeEightA 20260823081900` stays #1. |
| Click | **PASS** | `GET /r/lst_7f6ceb9479de0418` 302 → `https://five.example/smoke-20260823081900`. Clicks `0→1`. No tracking junk added. |
| Reject | **PASS-ERROR** | Chat `t.me` + NSFW `onlyfans` → 400. Neither lists. |
| Reset | **PASS** | `WEEK_NOW=2099-01-05T00:00:00.000Z` → rolling window empty. Previous rows hidden. |
| Secret | **BLOCKED-SECRET** | `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` |
| Live Polar checkout | **PASS** | Real Polar sandbox Checkout URL (`sandbox.polar.sh`). Unpaid session not listed. Not a fixture listing. |

Process exit 0 (`PASS=10` `PASS-ERROR=1` `BLOCKED-SECRET=1` `FAIL=0`). Missing token must stay `BLOCKED-SECRET`. Do not invent a paid row.

## What this does not do

- Does not call `scripts/live-smoke.sh` from `scripts/test.sh` or Actions.
- Does not set `POLAR_LIVE=1` in CI.
- Does not seed fake briefs or follower counts.
- Does not treat a missing Polar secret as a paid listing.
- Does not treat a fixture return URL as a live Polar checkout.
