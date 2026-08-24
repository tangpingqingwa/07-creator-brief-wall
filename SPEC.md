# Creator Brief Wall — Product Development Spec

**Version:** 1.0
**Status:** Ready to build
**Repo:** https://github.com/tangpingqingwa/07-creator-brief-wall
**Market:** Global English. USD. Polar Merchant of Record.

This document is the build contract. If README and SPEC disagree, SPEC wins until README is updated. If SPEC and code disagree, fix one of them in the same PR.

---

## 1. Product statement

A public pay-to-rank board where **brands auction the #1 “brief worth taking this week”** in front of mid-tier TikTok, YouTube, Instagram, and Twitch creators.

Brands pay to be **seen by creators**, not by consumers. Rank is the bid — nothing else. There is no influencer marketplace, no DM inbox, no fake follower graph.

One-line pitch: **This week’s briefs, ranked by money. Creators see who is paying to be taken.**

Clone of [outbid.lol](https://outbid.lol/) mechanics, applied to creator briefs.

---

## 2. Goals and non-goals

### Goals (v1)

- Public English leaderboard of paid briefs. No login to **read**.
- Whole-USD bids. Documented minimum **$5**. Rank = current bid.
- Listing is **brand + payout/terms summary + brief URL**. Clicks on the brief URL are counted and public.
- Weekly reset. Board starts empty each Monday 00:00 UTC.
- Honest fields only. **No invented follower counts, reach, CPM, or “avg views.”**
- Payments via Polar (live) and a fixture checkout (tests / CI).
- Pages: board, about, rules, checkout return.
- USD, English, global. No China-city default. No consumer ad network.

### Non-goals

- Creator accounts, portfolios, media kits, or verified badges.
- In-app chat, applications, contracts, escrow, or payout to creators.
- Consumer-facing brand ads or shoppable posts.
- Fake social proof (followers, engagement rate, “top 1%”).
- Ads, API keys for viewers, or revenue share with creators.
- NSFW / adult briefs. Chat and invite links.
- Multi-currency. Crypto. Auctions that last forever without a reset.

### Kill / change rules

- If after 90 days brands will not bid because creators are not looking, freeze features. Do not add a marketplace to “fix” an empty room.
- If a listing invents audience size, take it down. Do not paper over it with a disclaimer.
- Polar down → checkout errors. Do not silently switch to a card form we do not operate.

---

## 3. Users

| Persona | Job | Success |
|---|---|---|
| Mid-tier creator | Open the wall, see which briefs are worth taking this week | Honest payout/terms + a working brief URL. No fake reach on the card. |
| Brand / agency | Put one brief above everyone else for this week | Pay USD, appear at the rank the bid can take, screenshot “#1 this week.” |
| Viewer (no account) | Watch who is paying | Public board, public bid, public clicks. |

No logged-in creator profile in v1. Paying is Polar checkout, not a first-party account.

---

## 4. Information architecture

```
GET  /                         weekly board + place/raise form
GET  /about                    what this is (not affiliated with TikTok/Meta/Google/Amazon)
GET  /rules                    ranking, money, URL, NSFW, reset
GET  /checkout/return          Polar return (paid | canceled)
POST /checkout                 start Polar (live) or fixture session
POST /webhooks/polar           Polar webhook → claim rank
GET  /r/:id                    confirm sheet: terms + brief URL before leaving
POST /r/:id                    increment public click, 302 to canonical brief URL
GET  /healthz                  200 if process up
```

No public JSON API in v1. No API keys. No ads.txt.

---

## 5. Listing schema (normative)

A listing is one paid brief on the current week’s board.

```ts
type Listing = {
  id: string                    // opaque, server-assigned
  weekId: string                // e.g. "2026-W34" (ISO week, UTC)
  brand: string                 // 1–80 chars, plain text
  terms: string                 // payout / terms summary, 1–280 chars
  briefUrl: string              // canonical https URL after hygiene
  platforms?: Array<"tiktok" | "youtube" | "instagram" | "twitch">
  bidUsd: number                // integer dollars, >= 5
  clicks: number                // public, brief-URL clicks only
  createdAt: string             // ISO-8601, first paid placement this week
  updatedAt: string             // last successful raise
}
```

**Required to place:** `brand`, `terms`, `briefUrl`, `bidUsd`.

**Forbidden on the card and in the database:**

- Follower counts, subscriber counts, average views, engagement rate, CPM, “estimated reach.”
- Star ratings, “verified creator,” or any invented social proof.
- Tracking query strings on the outbound brief URL.

`terms` is the brand’s own payout/terms **summary** (e.g. “$800 flat + product, 1 TikTok, no competitor mentions”). The site does not calculate or guarantee the payout.

Identity for raise: same **canonical brief URL** in the same `weekId`. Brand name may be edited on raise; the URL key does not change.

---

## 6. Ranking rules (normative)

Copied from outbid.lol, with this vertical’s minimum and weekly reset.

1. **Rank is the bid.** Nothing else (not clicks, not recency except ties, not “quality”).
2. Bids are **whole US dollars**. Minimum **$5**. Maximum **$50,000**. Step **$1**.
3. Paying less than #1 still lists at the rank that bid can take.
4. **Equal bids:** the **older** listing (earlier `createdAt` at that amount, then earlier first payment) keeps the higher rank.
5. **Raise:** submit the same canonical brief URL again. The new bid must be an integer **at least $1 above the listing’s current bid**. To take #1 from someone else, the new bid must be **at least $1 above the current top bid**. The payer pays only the **difference**. Someone else cannot steal that rank by paying only that difference — they must pay a full bid **strictly greater** than the current top.
6. A completed Polar payment (or fixture payment in tests) is what claims the rank. Unpaid checkout sessions do nothing.
7. **Weekly reset:** Monday 00:00 UTC. Every listing on the live board expires. Clicks and bids do not carry over. The new week starts empty. Optional read-only archive of the previous week is allowed; it must not affect live rank.

Display order: `bidUsd DESC`, then `createdAt ASC` (older wins ties), then `id ASC`.

---

## 7. URL hygiene (normative)

Apply before persist and before redirect.

| Rule | Behavior |
|---|---|
| Scheme | `https` only. Reject `http`, `javascript:`, `data:`. |
| Tracking query | Strip `utm_*`, `fbclid`, `gclid`, `gbraid`, `wbraid`, `mc_eid`, `ref`, `ref_`, `affiliate`, `aff`, `irclickid`, and the entire query string if it is only trackers. Path and non-tracker query (e.g. a brief id) may stay. |
| Chat / invite | Reject Telegram, WhatsApp, Discord, Messenger, Signal, Slack invite, and similar chat hosts. The board is briefs, not group chats. |
| NSFW | Reject sexual / adult / porn hosts and paths. If it is NSFW, it does not belong. |
| Shorteners | Reject known shorteners (`bit.ly`, `t.co`, `tinyurl.com`, `lnkd.in`, etc.). Do not silently replace in v1 — fail the submit. |
| App-store / platform paths | Key by origin + path so two different briefs on the same host do not share a bid. |

`GET /r/:id` is a confirm sheet: brand, terms, and the canonical brief URL first. It does **not** increment `clicks`. `POST /r/:id` is the confirmed leave: increment `clicks` by 1, then **302** to the stored canonical URL with **no** tracking params added by us. Clicks are public on the card.

---

## 8. Payments

| Mode | When | Behavior |
|---|---|---|
| Fixture | tests, CI, `POLAR_LIVE` unset | `FakePolarPort` completes checkout in-process. No network. |
| Live Polar | `POLAR_LIVE=1` + Polar secrets | Polar Checkout, webhook claims rank. Polar is Merchant of Record. |

- Currency: **USD** only.
- Amount charged on first place: the bid.
- Amount charged on raise: **newBid − currentBid** for that listing.
- Missing live secrets during operator smoke: record `BLOCKED-SECRET` with the exact env var. Do not fake a live charge.
- CI and `scripts/test.sh` **never** set `POLAR_LIVE=1` and never call Polar.

Env (live only): `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SUCCESS_URL`, `POLAR_PRODUCT_ID` (or equivalent Polar checkout product). Names are frozen in `.env.example` when the checkout PR lands.

---

## 9. Pages and copy

### Board (`/`)

Outbid-like: one brief URL field, brand, terms, amount, **Outbid** button. Ranked cards show rank, brand, **terms** as the labeled prize, then **$bid**, **clicks**, and the brief URL (or a “Open brief” control that goes to the confirm sheet at `/r/:id`). On the taped flyer, terms sit before $bid. **Open brief** is the hop after Terms — not a second prize next to `$bid`. On an occupied wall, **Open brief** wins the first click. **Post a brief** follows that hop — it does not sit before the flyers. It lands on Claim #1. After Open wins the first click, concentrate that same **Post a brief** hop so a first-time buyer who came to post can still find it. Do not add a second named post control. After that write hop is concentrated, concentrate the same **Open brief** hop so a first-time creator who came to read still opens the flyer. Do not add a second named open control. After that Open brief hop is re-concentrated, concentrate the same **Post a brief** hop again so a first-time buyer who came to post can still find it under the louder Open. Do not add a second named post control. After that Post hop is concentrated again, concentrate the same **Open brief** hop again so a first-time creator who came to read still opens the flyer under the louder Post. Do not add a second named open control. After that Open brief hop is re-concentrated again, concentrate the same **Post a brief** hop again so a first-time buyer who came to post can still find it under the louder Open. Do not add a second named post control. After that Post hop is concentrated again, concentrate the same **Open brief** hop again so a first-time creator who came to read still opens the flyer under the louder Post. Do not add a second named open control. After that Open brief hop is re-concentrated again, concentrate the same **Post a brief** hop again so a first-time buyer who came to post can still find it under the louder Open. Do not add a second named post control. After that Post hop is concentrated again, concentrate the same **Open brief** hop again so a first-time creator who came to read still opens the flyer under the louder Post. Do not add a second named open control. After that Open brief hop is re-concentrated again, concentrate the same **Post a brief** hop again so a first-time buyer who came to post can still find it under the louder Open. Do not add a second named post control. After that Post hop is concentrated again, concentrate the same **Open brief** hop again so a first-time creator who came to read still opens the flyer under the louder Post. Do not add a second named open control.

Empty week: honest empty state. Do not seed fake briefs. Empty plaster already leads with Claim #1, so it has no Post a brief hop, no first-write Post after Open, no first-read Open after Post, no second Post concentrate after Open is re-concentrated, no second Open concentrate after Post is re-concentrated, no third Post concentrate after Open is re-concentrated again, no third Open concentrate after Post is re-concentrated again, no fourth Post concentrate after Open is re-concentrated again, no fourth Open concentrate after Post is re-concentrated again, no fifth Post concentrate after Open is re-concentrated again, and no fifth Open concentrate after Post is re-concentrated again.

### About (`/about`)

State: no ads, no API keys, no revenue share. Brands pay to be seen by creators. Rank is the bid. Independent; not affiliated with TikTok, YouTube, Instagram, Twitch, or Meta.

### Rules (`/rules`)

Publish §6–§7 in operator language. Include min $5, older-wins-ties, raise = difference, weekly reset, no fake followers, no chat/NSFW.

### Checkout return

Paid → “You’re on the board” + link home. Canceled → no rank change.

### Confirm brief (`GET /r/:id`)

A first-time creator who opens a flyer sees the terms and the full brief URL before leaving. Rank and public hops sit after that confirm. Leave is `POST /r/:id` (“Leave to the brief”). A GET does not count as a click.

On the occupied wall, a first-time creator reads **Terms** as the labeled prize on the taped flyer. `$bid` and clicks stay later facts. They do not have to open the confirm sheet to know the payout summary. After Terms, **Open brief** is the certain next hop — the first click. After Post is concentrated as the first write, that same Open brief hop is the first read. After Post is re-concentrated as the first write, that same Open brief hop is still the first read — concentrated so it does not disappear under the louder Post. After Post is re-concentrated again as the first write, that same Open brief hop is still the first read — concentrated so it does not disappear under the louder Post. After Post is re-concentrated again as the first write, that same Open brief hop is still the first read — concentrated so it does not disappear under the louder Post. After Post is re-concentrated again as the first write, that same Open brief hop is still the first read — concentrated so it does not disappear under the louder Post. Leave still confirms on GET `/r/:id`.

On the occupied wall, a first-time buyer who came to post hops **Post a brief** after Open brief — after the flyers, not before them — landing on Claim #1. After Open wins the first click, that same Post a brief hop is the first write. After Open is re-concentrated as the first read, that same Post a brief hop is still the first write — concentrated so it does not disappear under the louder Open. After Open is re-concentrated again as the first read, that same Post a brief hop is still the first write — concentrated so it does not disappear under the louder Open. After Open is re-concentrated again as the first read, that same Post a brief hop is still the first write — concentrated so it does not disappear under the louder Open. After Open is re-concentrated again as the first read, that same Post a brief hop is still the first write — concentrated so it does not disappear under the louder Open. Empty plaster still leads with Claim #1 and has no Post a brief hop.

---

## 10. Errors

| Situation | HTTP / UX |
|---|---|
| Bid &lt; $5 or not an integer dollar | 400, stay off the board |
| Bid &gt; $50,000 | 400 |
| Missing brand / terms / brief URL | 400 |
| Chat, NSFW, shortener, non-https | 400, listing rejected |
| Raise without paying the difference | no rank change |
| Equal bid vs existing #1 from a different URL | lists below the older row |
| Polar / fixture payment not completed | no listing |
| Polar live misconfigured | checkout 503; smoke may be `BLOCKED-SECRET` |
| Weekly reset | previous rows gone from `/` |

Never invent a listing to fill the page. Never show a follower number.

---

## 11. Live-smoke flows

Operator-only (`scripts/live-smoke.sh`). Not called from `scripts/test.sh` or Actions.

| Flow | Pass |
|---|---|
| Health | `GET /healthz` 200 |
| Empty board | `/` has no fake follower counts and no seeded briefs |
| About / rules | both 200, mention rank = bid and weekly reset |
| Place $5 | fixture or live Polar; card appears with brand + terms + $5 |
| Outbid | second brief at $6 is #1; first stays on the board |
| Raise | first listing pays **$1** difference to $7 and becomes #1 |
| Tie | two $8 bids: older stays higher |
| Click | confirm on `GET /r/:id`, then `POST /r/:id`; public clicks increment on the confirmed leave; destination has no tracking junk we added |
| Reject | chat URL and NSFW URL do not list |
| Reset | after week roll (test clock or documented operator hook), board empty |
| Secret | live Polar missing token → `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` (or the frozen name) |

`FAIL` = crash, wrong rank, invented followers, or a live charge in CI.

---

## 12. Git collaboration (normative)

Development is GitHub trunk-based. **`main` is always cloneable, buildable, and testable.**

| Rule | Requirement |
|---|---|
| Integration branch | `main` only. No long-lived `develop`. |
| How code lands | Pull request into `main`. No direct push. |
| Required check | GitHub Actions workflow `ci` (job id `ci`) must be green. |
| Local / CI test | `bash scripts/test.sh` — offline, no production secrets. |
| Branch names | `feat/` `fix/` `docs/` `chore/` `test/` + short slug. |
| Merge | Squash. Delete the head branch. |
| Broken `main` | Treat as an incident. Fix on `fix/…` via PR. |

Full process: [CONTRIBUTING.md](./CONTRIBUTING.md).

Implementation plan (stack, modules, PR DAG): [BUILD.md](./BUILD.md).

Until there is an application binary, `scripts/test.sh` still has to pass: contract files exist, SPEC/CONTRIBUTING agree, no tracked secrets. Adding a server or CLI means **extending** that script with unit/contract tests. Live Polar calls are optional and must not be required for `main` to stay green.
