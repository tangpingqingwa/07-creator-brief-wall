# Live smoke — Creator Brief Wall

Operator-only. `bash scripts/live-smoke.sh` is **not** called from
`scripts/test.sh` or GitHub Actions. The smoke process always uses the
explicit non-production `WAFFO_MODE=fixture` mode and makes zero provider
calls. It uses a temporary SQLite database and does not create a paid row
without the fixture return path.

The production provider is Waffo Pancake. Its only accepted API origin is
`https://api.waffo.ai`. `waffo-test` and `waffo-prod` are explicit, mode-scoped
operator configurations; neither is inferred from a legacy flag. Production
also requires a durable database, a public HTTPS `PUBLIC_BASE_URL`, the
mode-scoped Waffo private/public keys, and a registered canonical
`POST /webhooks/waffo` endpoint. The smoke never calls that API or registers a
webhook. Missing production configuration must fail closed before provider
I/O. Next's instrumentation hook can reject server preparation, so the local
production probe records a generic non-secret HTTP 5xx for health, the
ordinary page, and click traffic; the server log may name
`BLOCKED-SECRET: WAFFO_MERCHANT_ID`. The legacy Polar webhook path is inert and
returns 410.

## How to run

```bash
bash scripts/live-smoke.sh
```

The script:

1. Refuses `CI=true` and `GITHUB_ACTIONS=true`.
2. Builds Next.js if needed, then starts `next start` on a free loopback port
   with a temporary database and explicit `WAFFO_MODE=fixture`.
3. Or attaches to `LIVE_SMOKE_BASE` if that server already answers
   `GET /healthz` (the attached process is not reconfigured by this script).
4. Walks every SPEC §11 flow: Health, Empty board, About / rules, Place $5,
   Outbid, Raise, Tie, Click, Reject, Reset, and Secret.
5. Starts a separate `WAFFO_MODE=waffo-prod` process with required values
   intentionally absent. The framework-level readiness probe must return a
   non-secret 5xx for `/healthz`, `/`, and click traffic; 2xx, 3xx, or 4xx
   responses fail the smoke. No provider call or paid row is allowed.
6. Records the production checkout as `PASS-ERROR`: this local smoke does not
   call Waffo. A real production run needs public HTTPS, durable storage,
   webhook registration, and an operator-approved deployment.
7. Kills processes it started and deletes its temporary work directory.

Overrides: `LIVE_SMOKE_BASE`, `LIVE_SMOKE_PORT`, and
`LIVE_SMOKE_REBUILD=1`.

## Explicit provider modes

Local/offline verification:

```bash
WAFFO_MODE=fixture bash scripts/live-smoke.sh
```

The disposable fixture path is the only mode used by automated tests. A
`waffo-test` process is an explicit non-production operator configuration and
must use test identifiers and `WAFFO_WEBHOOK_TEST_PUBLIC_KEY`. A
`waffo-prod` process must use production identifiers and
`WAFFO_WEBHOOK_PROD_PUBLIC_KEY`, the pinned API origin, a durable
`DATABASE_PATH`, and a public HTTPS base. Never put provider secrets in this
document or in CI. Never use a loopback/private return URL in either
production mode.

## Verdicts

| Label | Meaning |
|---|---|
| `PASS` | Flow completed as SPEC requires. |
| `PASS-ERROR` | A documented safe refusal; no provider call or invented state occurred. |
| `BLOCKED-SECRET` | Required mode-scoped production configuration is absent; the smoke records the exact blocker without exposing secret material. |
| `FAIL` | Broken product, wrong rank, invented followers, an unexpected settlement, or a provider call in fixture smoke. |

## Expected local evidence

The fixture run should show the following properties:

| Flow | Expected result | Evidence |
|---|---|---|
| Health | **PASS** | `GET /healthz` returns 200 and `{ ok: true }`. |
| Empty board | **PASS** | No seeded briefs or invented audience metrics; bid form is present. |
| About / rules | **PASS** | Rank is the bid; rolling last-7-days language is present. |
| Place $5 | **PASS** | Fixture return creates one #1 paid listing and strips tracking parameters. |
| Outbid | **PASS** | A $6 paid listing ranks above the $5 listing. |
| Raise | **PASS** | Same canonical URL at $7 charges only the $2 difference and becomes #1. |
| Tie | **PASS** | Equal bids use older `createdAt` first. |
| Click | **PASS** | Confirmation is read-only; POST increments once and redirects to the canonical URL. |
| Reject | **PASS-ERROR** | Chat/NSFW URLs return 400 and never list. |
| Reset | **PASS** | `WEEK_NOW` rolls the visible rolling window without leaking old rows. |
| Secret | **BLOCKED-SECRET** | Production health/page/click probes return non-secret 5xx before network; the log identifies `WAFFO_MERCHANT_ID`. |
| Live Waffo checkout | **PASS-ERROR** | Deliberately not called; `provider calls=0`. |

## What this does not do

- Does not call Waffo, register a webhook, charge a card, or mutate a
  provider dashboard.
- Does not call `scripts/live-smoke.sh` from `scripts/test.sh` or Actions.
- Does not seed fake briefs, audience metrics, or paid listings.
- Does not treat a missing Waffo secret, a return URL, or a replayed webhook as
  payment.
- Does not use the retired Polar route for settlement.
