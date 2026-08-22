# Live smoke — Creator Brief Wall

Operator-only. `bash scripts/live-smoke.sh` is **not** called from `scripts/test.sh` or GitHub Actions. CI and `scripts/test.sh` stay offline and must not set `POLAR_LIVE`.

`100%` for this unit means a **local process** walked every SPEC §11 flow. Fixture checkout is allowed for place / outbid / raise / tie / click / reject / reset. Live Polar runs only when `POLAR_LIVE=1` and secrets exist. Missing Polar secret is `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` (or the frozen name) — that is not a fixture success and not a paid rank. Do not invent follower counts. An empty week is valid.

## How to run

```bash
bash scripts/live-smoke.sh
```

The script:

1. Refuses `CI=true` and `GITHUB_ACTIONS=true`.
2. Builds Next.js if needed, then starts `next start` on a free loopback port with a temp `DATABASE_PATH`, Polar env unset, and `POLAR_FIXTURE_ONLY=1`.
3. Or attaches to `LIVE_SMOKE_BASE` if that server already answers `GET /healthz`.
4. Walks SPEC §11: Health, Empty board, About / rules, Place $5, Outbid, Raise, Tie, Click, Reject, Reset, Secret.
5. Live Polar: starts a second process with `POLAR_LIVE=1` and Polar secrets unset. Missing token prints `BLOCKED-SECRET: POLAR_ACCESS_TOKEN`. Never invents a live paid row.
6. Week roll uses the documented `WEEK_NOW` operator clock and a fresh listener so last week’s cards cannot leak onto `/`.
7. Kills the process it started and deletes the temp workdir.

Overrides: `LIVE_SMOKE_BASE`, `LIVE_SMOKE_PORT`, `LIVE_SMOKE_REBUILD=1`.

Live Polar (operator machine with a real token):

```bash
POLAR_LIVE=1 POLAR_ACCESS_TOKEN=… POLAR_PRODUCT_ID=… bash scripts/live-smoke.sh
```

## Verdicts

| Label | Meaning |
|---|---|
| `PASS` | Flow completed as SPEC requires. |
| `PASS-ERROR` | Documented product error; nothing invented. |
| `BLOCKED-SECRET` | Live Polar secret missing. Exact env var named. |
| `FAIL` | Broken product, wrong rank, invented followers, or a live charge in CI. |

## This session

Ran `bash scripts/live-smoke.sh` on **2026-08-22** from `feat/live-smoke` (parent `295927f`, weekly reset + `/r/:id` on `origin/main`). Local process started by the script on `http://127.0.0.1:58998` via `next start` after `next build`. Temp SQLite. Week `2026-W34` UTC. `POLAR_LIVE` unset. `POLAR_ACCESS_TOKEN` unset. Fixture path (`POLAR_FIXTURE_ONLY=1`) for place / outbid / raise / tie / click / reject / reset. Unique `*.example` brief URLs for this run. No invented follower counts. No unpaid listing. Live Polar missing token was walked on a second loopback process and printed `BLOCKED-SECRET: POLAR_ACCESS_TOKEN`.

Also refused `CI=true` (`FAIL: live-smoke refuses CI=true`) and `GITHUB_ACTIONS=true`.

| Flow | Result | Note |
|---|---|---|
| Health | **PASS** | `GET /healthz` 200 `{ ok: true }` |
| Empty board | **PASS** | `GET /` 200 week `2026-W34` empty + bid form. No seeded briefs. No invented follower counts. |
| About / rules | **PASS** | `GET /about` and `GET /rules` 200. Rank is the bid. Weekly reset (`Monday 00:00`). |
| Place $5 | **PASS** | Fixture pay $5 → #1 `SmokeFive 20260822153936`. Brand + terms + $5. Tracking stripped. |
| Outbid | **PASS** | Second brief at $6 is #1. First $5 stays on the board at #2. |
| Raise | **PASS** | First listing $5→$7 (pays $1 difference) and becomes #1. $6 stays. |
| Tie | **PASS** | Both $8. Older `SmokeEightA 20260822153936` stays #1. |
| Click | **PASS** | `GET /r/lst_d52917c9521a2a2c` 302 → `https://five.example/smoke-20260822153936`. Clicks `0→1`. No tracking junk added. |
| Reject | **PASS-ERROR** | Chat `t.me` + NSFW `onlyfans` → 400. Neither lists. |
| Reset | **PASS** | `WEEK_NOW=2099-01-05T00:00:00.000Z` → week `2099-W02` empty. Previous rows hidden. |
| Secret | **BLOCKED-SECRET** | `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` |

Process exit 0 (`PASS=9` `PASS-ERROR=1` `BLOCKED-SECRET=1` `FAIL=0`). Re-run with `POLAR_LIVE=1` and a real token to complete Polar Checkout; missing token must stay `BLOCKED-SECRET`, never a fixture listing treated as live Polar.

## What this does not do

- Does not call `scripts/live-smoke.sh` from `scripts/test.sh` or Actions.
- Does not set `POLAR_LIVE=1` in CI.
- Does not seed fake briefs or follower counts.
- Does not treat a missing Polar secret as a paid listing.
