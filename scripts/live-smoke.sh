#!/usr/bin/env bash
# Operator smoke against a local process. Not called from scripts/test.sh or CI.
# Walks SPEC §11: health, empty board, about/rules, fixture place/outbid/raise/tie,
# click hop, chat/NSFW reject, WEEK_NOW reset, and fail-closed Waffo config.
# The smoke process always starts with explicit WAFFO_MODE=fixture and never
# calls a provider. A separate waffo-prod probe verifies missing configuration
# is rejected by the framework as a non-secret 5xx before provider I/O.
# Serves the real Next.js process (`next start`) after `next build`.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  fail "live-smoke must not run in GitHub Actions"
fi
if [[ "${CI:-}" == "true" ]]; then
  fail "live-smoke refuses CI=true"
fi

command -v curl >/dev/null || fail "curl is required"
command -v node >/dev/null || fail "node is required"

if [[ ! -d node_modules ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
fi

PASS=0
PASS_ERROR=0
BLOCKED=0
FAIL=0
STARTED_PID=""
RESET_PID=""
LIVE_PID=""
WORKDIR=""
RESULT_LOG=""
BASE="${LIVE_SMOKE_BASE:-}"
OWNED_PROCESS=0

# Capture only non-secret operator context before the fixture process unsets it.
OP_WAFFO_MODE="${WAFFO_MODE:-}"

kill_tree() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

listeners_on_port() {
  local port="$1"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null \
    || fuser "${port}/tcp" 2>/dev/null \
    || true
}

stop_http() {
  local pid="${1:-}"
  local port="${2:-}"
  if [[ -n "${pid}" ]]; then
    kill_tree "${pid}"
    wait "${pid}" 2>/dev/null || true
    kill_tree "${pid}"
    kill -9 "${pid}" 2>/dev/null || true
  fi
  if [[ -n "${port}" ]]; then
    local leftover
    leftover="$(listeners_on_port "${port}")"
    if [[ -n "${leftover}" ]]; then
      kill -9 ${leftover} 2>/dev/null || true
    fi
    if command -v fuser >/dev/null 2>&1; then
      fuser -k "${port}/tcp" >/dev/null 2>&1 || true
    fi
  fi
}

cleanup() {
  stop_http "${LIVE_PID}" "${LIVE_PORT:-}"
  LIVE_PID=""
  stop_http "${RESET_PID}" "${RESET_PORT:-}"
  RESET_PID=""
  stop_http "${STARTED_PID}" "${PORT:-}"
  STARTED_PID=""
  if [[ -n "${WORKDIR}" && -d "${WORKDIR}" ]]; then
    rm -rf "${WORKDIR}"
  fi
}
trap cleanup EXIT

record() {
  local flow="$1"
  local status="$2"
  local note="${3:-}"
  printf 'RESULT\t%s\t%s\t%s\n' "$flow" "$status" "$note"
  if [[ -n "${RESULT_LOG}" ]]; then
    printf '%s\t%s\t%s\n' "$flow" "$status" "$note" >>"${RESULT_LOG}"
  fi
  case "$status" in
    PASS) PASS=$((PASS + 1)) ;;
    PASS-ERROR) PASS_ERROR=$((PASS_ERROR + 1)) ;;
    BLOCKED-SECRET) BLOCKED=$((BLOCKED + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    *) fail "unknown smoke status ${status}" ;;
  esac
}

is_non_secret_5xx() {
  local code="$1"
  [[ "$code" =~ ^5[0-9][0-9]$ ]]
}

non_secret_body() {
  local body="$1"
  [[ -s "$body" ]] || return 1
  ! grep -Eiq -- 'BEGIN (RSA |EC |OPENSSH )?(PRIVATE|PUBLIC) KEY|WAFFO_PRIVATE_KEY=|access[_ -]?token=' "$body"
}

pick_port() {
  node --input-type=module -e '
    import net from "node:net";
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") process.exit(1);
      process.stdout.write(String(addr.port));
      server.close();
    });
  '
}

current_week_id() {
  node --input-type=module -e '
    const now = new Date();
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = cursor.getUTCDay() || 7;
    cursor.setUTCDate(cursor.getUTCDate() + 4 - day);
    const isoYear = cursor.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const week = Math.ceil(((cursor.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    process.stdout.write(`${isoYear}-W${String(week).padStart(2, "0")}`);
  '
}

wait_health() {
  local url="$1/healthz"
  local i
  for i in $(seq 1 80); do
    if curl -fsS --connect-timeout 2 --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

start_next() {
  local port="$1"
  local log_path="$2"
  shift 2
  (
    cd "$root"
    unset WAFFO_API_BASE WAFFO_MERCHANT_ID \
      WAFFO_PRIVATE_KEY WAFFO_PRIVATE_KEY_FILE WAFFO_STORE_ID WAFFO_PRODUCT_ID \
      WAFFO_WEBHOOK_TEST_PUBLIC_KEY WAFFO_WEBHOOK_PROD_PUBLIC_KEY WAFFO_LIVE \
      WAFFO_ENVIRONMENT WAFFO_SUCCESS_URL WAFFO_STORE_SLUG WEEK_NOW NODE_ENV || true
    export WAFFO_MODE=fixture
    # Explicitly mask any stale .env.local live switch. Fixture smoke must be
    # offline even when an operator's shell has production-era dotenv values.
    export WAFFO_LIVE=
    # `next start` defaults NODE_ENV to production; the local smoke is an
    # explicitly non-production fixture process. The production probe below
    # overrides this to production after its mode-scoped empty values.
    export NODE_ENV=development
    export PORT="${port}"
    export DATABASE_PATH="${DB_PATH}"
    export PUBLIC_BASE_URL="http://127.0.0.1:${port}"
    export NEXT_TELEMETRY_DISABLED=1
    while [[ $# -gt 0 ]]; do
      case "$1" in
        *)
          export "$1"
          ;;
      esac
      shift
    done
    exec node ./node_modules/next/dist/bin/next start --port "${port}" --hostname 127.0.0.1
  ) >"${log_path}" 2>&1 &
  echo $!
}

http_get() {
  local base="$1"
  local path="$2"
  local out="$3"
  curl -sS -o "$out" -w "%{http_code}" --connect-timeout 5 --max-time 20 \
    "${base}${path}"
}

http_get_headers() {
  local base="$1"
  local path="$2"
  local body="$3"
  local hdrs="$4"
  curl -sS -D "$hdrs" -o "$body" -w "%{http_code}" --connect-timeout 5 --max-time 20 \
    --max-redirs 0 \
    "${base}${path}"
}

http_post_json() {
  local base="$1"
  local path="$2"
  local payload="$3"
  local body="$4"
  local hdrs="$5"
  curl -sS -D "$hdrs" -o "$body" -w "%{http_code}" --connect-timeout 5 --max-time 30 \
    --max-redirs 0 \
    -X POST \
    -H "content-type: application/json" \
    -H "accept: application/json" \
    --data "$payload" \
    "${base}${path}"
}

header_value() {
  local file="$1"
  local name="$2"
  awk -v name="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" '
    BEGIN { FS = ": " }
    tolower($1) == name {
      val = $0
      sub(/^[^:]+:[ \t]*/, "", val)
      gsub(/\r/, "", val)
      print val
      exit
    }
  ' "$file"
}

json_field() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const raw = readFileSync(process.argv[1], "utf8");
    let data;
    try { data = JSON.parse(raw); } catch { process.exit(2); }
    const key = process.argv[2];
    const value = data == null ? undefined : data[key];
    if (value === undefined || value === null) process.exit(3);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      process.stdout.write(String(value));
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(value));
  ' "$1" "$2"
}

html_has() {
  local file="$1"
  local pattern="$2"
  grep -Eq "$pattern" "$file"
}

invented_followers() {
  local file="$1"
  grep -Eiq '[0-9][0-9,]*[[:space:]]*(followers|subscribers)|avg views|estimated reach|[[:space:]]cpm[[:space:]]' "$file"
}

listing_count() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    process.stdout.write(String([...html.matchAll(/data-id="/g)].length));
  ' "$1"
}

card_attr() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    const brand = process.argv[2];
    const key = process.argv[3];
    const cards = [...html.matchAll(/<li\b[^>]*class="[^"]*\bcard\b[^"]*"[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);
    for (const card of cards) {
      const brandMatch = card.match(/data-brand="([^"]*)"/);
      if (!brandMatch || brandMatch[1] !== brand) continue;
      const re = new RegExp(`data-${key}="([^"]*)"`);
      const match = card.match(re);
      if (!match) process.exit(2);
      process.stdout.write(match[1]);
      process.exit(0);
    }
    process.exit(2);
  ' "$1" "$2" "$3"
}

card_text_has() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    const brand = process.argv[2];
    const needle = process.argv[3];
    const cards = [...html.matchAll(/<li\b[^>]*class="[^"]*\bcard\b[^"]*"[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);
    for (const card of cards) {
      const brandMatch = card.match(/data-brand="([^"]*)"/);
      if (!brandMatch || brandMatch[1] !== brand) continue;
      process.stdout.write(card.includes(needle) ? "1" : "0");
      process.exit(0);
    }
    process.exit(2);
  ' "$1" "$2" "$3"
}

# Next may emit Location as http://localhost:<port>/... even when we bound 127.0.0.1.
# Follow the path on the smoke base so fixture return completes on this process.
return_path_from_location() {
  local loc="$1"
  node --input-type=module -e '
    const raw = process.argv[1] || "";
    try {
      const url = new URL(raw, "http://127.0.0.1");
      process.stdout.write(`${url.pathname}${url.search}`);
    } catch {
      process.exit(2);
    }
  ' "$loc"
}

complete_fixture_return() {
  local base="$1"
  local loc="$2"
  local return_body="$3"
  local path
  path="$(return_path_from_location "$loc" || true)"
  if [[ -z "$path" || "$path" != /checkout/complete* ]]; then
    echo "nolocation"
    return 0
  fi
  curl -sS -o "$return_body" -w "%{http_code}" --connect-timeout 5 --max-time 20 \
    "${base}${path}" || true
}

place_and_pay() {
  local base="$1"
  local brand="$2"
  local terms="$3"
  local url="$4"
  local bid="$5"
  local body="$6"
  local hdrs="$7"
  local return_body="$8"
  local code
  local loc
  local ret
  code="$(http_post_json "$base" "/checkout" \
    "{\"brand\":\"${brand}\",\"terms\":\"${terms}\",\"briefUrl\":\"${url}\",\"bidUsd\":${bid}}" \
    "$body" "$hdrs" || true)"
  if [[ "$code" != "303" ]]; then
    echo "$code"
    return 0
  fi
  loc="$(header_value "$hdrs" "location" || true)"
  ret="$(complete_fixture_return "$base" "$loc" "$return_body")"
  if [[ "$ret" != "200" ]] || ! html_has "$return_body" 'data-return="success"'; then
    echo "return-${ret}"
    return 0
  fi
  echo "ok"
}

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/cbw-live-smoke.XXXXXX")"
RESULT_LOG="${WORKDIR}/results.tsv"
: >"${RESULT_LOG}"
STAMP="$(date -u +%Y%m%d%H%M%S)"
WEEK_ID="$(current_week_id)"
DB_PATH="${WORKDIR}/board.sqlite"
FIVE_BRAND="SmokeFive ${STAMP}"
SIX_BRAND="SmokeSix ${STAMP}"
EIGHT_A_BRAND="SmokeEightA ${STAMP}"
EIGHT_B_BRAND="SmokeEightB ${STAMP}"
REJECT_BRAND="SmokeReject ${STAMP}"
FIVE_HOST="five.example/smoke-${STAMP}"
SIX_HOST="six.example/smoke-${STAMP}"
EIGHT_A_HOST="eight-a.example/smoke-${STAMP}"
EIGHT_B_HOST="eight-b.example/smoke-${STAMP}"
FIVE_URL="https://${FIVE_HOST}"
SIX_URL="https://${SIX_HOST}"
EIGHT_A_URL="https://${EIGHT_A_HOST}"
EIGHT_B_URL="https://${EIGHT_B_HOST}"
FIVE_TRACKED="${FIVE_URL}?utm_source=smoke&fbclid=abc"
FIVE_TERMS="\$800 flat, 1 TikTok fixture"
SIX_TERMS="\$6 outbid takes #1"
EIGHT_A_TERMS="older eight dollar bid"
EIGHT_B_TERMS="newer eight dollar bid"

echo "== live-smoke (operator only; not CI) =="
echo "root=${root}"
echo "weekId=${WEEK_ID}"
echo "database=${DB_PATH}"

if [[ -z "${BASE}" ]]; then
  if [[ ! -d "${root}/.next" || "${LIVE_SMOKE_REBUILD:-}" == "1" ]]; then
    echo "building Next.js production server"
    NEXT_TELEMETRY_DISABLED=1 npx next build
  else
    echo "reusing existing .next build (set LIVE_SMOKE_REBUILD=1 to rebuild)"
  fi
  PORT="${LIVE_SMOKE_PORT:-$(pick_port)}"
  BASE="http://127.0.0.1:${PORT}"
  LOG_PATH="${WORKDIR}/server.log"
  echo "starting local fixture process on ${BASE}"
  echo "WAFFO_MODE=fixture (offline fixture checkout)"
  STARTED_PID="$(start_next "$PORT" "$LOG_PATH" "WAFFO_MODE=fixture")"
  OWNED_PROCESS=1
  if ! wait_health "$BASE"; then
    echo "server log:" >&2
    cat "${LOG_PATH}" >&2 || true
    fail "local server did not become healthy at ${BASE}/healthz"
  fi
else
  BASE="${BASE%/}"
  echo "assuming existing server at ${BASE}"
  if ! wait_health "$BASE"; then
    fail "existing server at ${BASE} did not answer /healthz"
  fi
fi

echo "base=${BASE}"
echo "operator WAFFO_MODE=${OP_WAFFO_MODE:-<unset>} (ignored for fixture smoke)"
echo "provider calls=0 (fixture mode)"

# --- health ---
health_body="${WORKDIR}/healthz.json"
health_code="$(http_get "$BASE" "/healthz" "$health_body" || true)"
if [[ "$health_code" == "200" ]] && grep -q '"ok":true' "$health_body"; then
  record "health" "PASS" "GET /healthz 200 { ok: true }"
else
  record "health" "FAIL" "GET /healthz HTTP ${health_code}"
fi

# --- empty board: no fake follower counts, no seeded briefs ---
board0="${WORKDIR}/board0.html"
board0_code="$(http_get "$BASE" "/" "$board0" || true)"
board0_count="$(listing_count "$board0" || echo "?")"
if [[ "$board0_code" != "200" ]]; then
  record "empty-board" "FAIL" "GET / HTTP ${board0_code}"
elif invented_followers "$board0"; then
  record "empty-board" "FAIL" "GET / invented follower or reach numbers"
elif [[ "$OWNED_PROCESS" == "1" ]]; then
  if html_has "$board0" 'data-empty-week="true"' \
    && html_has "$board0" 'data-week-id="'"${WEEK_ID}"'"' \
    && html_has "$board0" 'name="brand"' \
    && html_has "$board0" 'name="terms"' \
    && html_has "$board0" 'name="briefUrl"' \
    && html_has "$board0" 'name="bidUsd"' \
    && html_has "$board0" 'Outbid' \
    && [[ "$board0_count" == "0" ]]; then
    record "empty-board" "PASS" "GET / 200 week ${WEEK_ID} empty + bid form; no seeded briefs"
  else
    record "empty-board" "FAIL" "GET / 200 but empty-week contract broken count=${board0_count}"
  fi
else
  if html_has "$board0" 'name="brand"' && html_has "$board0" 'Outbid' \
    && ! invented_followers "$board0"; then
    record "empty-board" "PASS" "GET / 200 attached process; ${board0_count} existing row(s); no invented followers"
  else
    record "empty-board" "FAIL" "GET / attached process missing bid form or invented followers"
  fi
fi

# --- about / rules ---
about_body="${WORKDIR}/about.html"
about_code="$(http_get "$BASE" "/about" "$about_body" || true)"
rules_body="${WORKDIR}/rules.html"
rules_code="$(http_get "$BASE" "/rules" "$rules_body" || true)"
if [[ "$about_code" == "200" && "$rules_code" == "200" ]] \
  && html_has "$about_body" 'Rank is the bid' \
  && html_has "$about_body" 'seven-day placement window' \
  && html_has "$rules_body" 'Rank is the bid' \
  && html_has "$rules_body" 'Rolling last 7 days from paid placement' \
  && html_has "$rules_body" 'does not reset for everyone at Monday midnight'; then
  record "about-rules" "PASS" "GET /about and /rules 200; rank is the bid; rolling last 7 days"
else
  record "about-rules" "FAIL" "about HTTP ${about_code} rules HTTP ${rules_code}"
fi

# --- place $5 (fixture Waffo) ---
unpaid_body="${WORKDIR}/place-unpaid.json"
unpaid_hdrs="${WORKDIR}/place-unpaid.hdrs"
unpaid_code="$(http_post_json "$BASE" "/checkout" \
  "{\"brand\":\"${FIVE_BRAND}\",\"terms\":\"${FIVE_TERMS}\",\"briefUrl\":\"${FIVE_TRACKED}\",\"bidUsd\":5}" \
  "$unpaid_body" "$unpaid_hdrs" || true)"
unpaid_loc="$(header_value "$unpaid_hdrs" "location" || true)"
board_unpaid="${WORKDIR}/board-unpaid.html"
http_get "$BASE" "/" "$board_unpaid" >/dev/null || true
if [[ "$unpaid_code" != "303" || -z "$unpaid_loc" ]]; then
  record "place-5" "FAIL" "POST /checkout \$5 HTTP ${unpaid_code}"
elif html_has "$board_unpaid" "$FIVE_BRAND"; then
  record "place-5" "FAIL" "unpaid fixture checkout appeared on the board"
else
  return5="${WORKDIR}/place-return.html"
  return5_code="$(complete_fixture_return "$BASE" "$unpaid_loc" "$return5")"
  board5="${WORKDIR}/board-place.html"
  board5_code="$(http_get "$BASE" "/" "$board5" || true)"
  five_bid="$(card_attr "$board5" "$FIVE_BRAND" "bid" || true)"
  five_rank="$(card_attr "$board5" "$FIVE_BRAND" "rank" || true)"
  five_id="$(card_attr "$board5" "$FIVE_BRAND" "id" || true)"
  five_terms_ok="$(card_text_has "$board5" "$FIVE_BRAND" "$FIVE_TERMS" || echo 0)"
  five_url_ok="$(card_text_has "$board5" "$FIVE_BRAND" "data-brief-url=\"${FIVE_URL}\"" || echo 0)"
  if [[ "$return5_code" == "200" ]] && html_has "$return5" 'data-return="success"' \
    && [[ "$board5_code" == "200" ]] \
    && [[ "$five_bid" == "5" && "$five_rank" == "1" && -n "$five_id" ]] \
    && [[ "$five_terms_ok" == "1" && "$five_url_ok" == "1" ]] \
    && html_has "$board5" '\$5' \
    && ! html_has "$board5" 'utm_source' \
    && ! html_has "$board5" 'fbclid' \
    && ! invented_followers "$board5"; then
    record "place-5" "PASS" "fixture pay \$5 → #1 ${FIVE_BRAND}; brand + terms + \$5; tracking stripped"
  else
    record "place-5" "FAIL" "return HTTP ${return5_code} bid=${five_bid} rank=${five_rank} id=${five_id}"
  fi
fi

# --- outbid: second brief at $6 is #1; first stays ---
six_pay="$(place_and_pay "$BASE" "$SIX_BRAND" "$SIX_TERMS" "$SIX_URL" 6 \
  "${WORKDIR}/six.json" "${WORKDIR}/six.hdrs" "${WORKDIR}/six-return.html")"
board6="${WORKDIR}/board-outbid.html"
http_get "$BASE" "/" "$board6" >/dev/null || true
six_rank="$(card_attr "$board6" "$SIX_BRAND" "rank" || true)"
six_bid="$(card_attr "$board6" "$SIX_BRAND" "bid" || true)"
five_rank_after="$(card_attr "$board6" "$FIVE_BRAND" "rank" || true)"
five_bid_after="$(card_attr "$board6" "$FIVE_BRAND" "bid" || true)"
if [[ "$six_pay" == "ok" ]] \
  && [[ "$six_rank" == "1" && "$six_bid" == "6" ]] \
  && [[ "$five_rank_after" == "2" && "$five_bid_after" == "5" ]]; then
  record "outbid" "PASS" "\$6 is #1; first \$5 stays on the board at #2"
else
  record "outbid" "FAIL" "pay=${six_pay} six=${six_rank}/${six_bid} five=${five_rank_after}/${five_bid_after}"
fi

# --- raise: first listing $5 → $7 (difference) and becomes #1 ---
raise_pay="$(place_and_pay "$BASE" "$FIVE_BRAND" "$FIVE_TERMS" "$FIVE_URL" 7 \
  "${WORKDIR}/raise.json" "${WORKDIR}/raise.hdrs" "${WORKDIR}/raise-return.html")"
board7="${WORKDIR}/board-raise.html"
http_get "$BASE" "/" "$board7" >/dev/null || true
five_rank_raise="$(card_attr "$board7" "$FIVE_BRAND" "rank" || true)"
five_bid_raise="$(card_attr "$board7" "$FIVE_BRAND" "bid" || true)"
six_rank_raise="$(card_attr "$board7" "$SIX_BRAND" "rank" || true)"
six_bid_raise="$(card_attr "$board7" "$SIX_BRAND" "bid" || true)"
if [[ "$raise_pay" == "ok" ]] \
  && [[ "$five_rank_raise" == "1" && "$five_bid_raise" == "7" ]] \
  && [[ "$six_rank_raise" == "2" && "$six_bid_raise" == "6" ]]; then
  record "raise" "PASS" "first listing \$5→\$7 (pays difference); becomes #1; \$6 stays"
else
  record "raise" "FAIL" "pay=${raise_pay} five=${five_rank_raise}/${five_bid_raise} six=${six_rank_raise}/${six_bid_raise}"
fi

# --- tie: two $8 bids; older stays higher ---
eight_a_pay="$(place_and_pay "$BASE" "$EIGHT_A_BRAND" "$EIGHT_A_TERMS" "$EIGHT_A_URL" 8 \
  "${WORKDIR}/eight-a.json" "${WORKDIR}/eight-a.hdrs" "${WORKDIR}/eight-a-return.html")"
sleep 1
eight_b_pay="$(place_and_pay "$BASE" "$EIGHT_B_BRAND" "$EIGHT_B_TERMS" "$EIGHT_B_URL" 8 \
  "${WORKDIR}/eight-b.json" "${WORKDIR}/eight-b.hdrs" "${WORKDIR}/eight-b-return.html")"
board8="${WORKDIR}/board-tie.html"
http_get "$BASE" "/" "$board8" >/dev/null || true
eight_a_rank="$(card_attr "$board8" "$EIGHT_A_BRAND" "rank" || true)"
eight_b_rank="$(card_attr "$board8" "$EIGHT_B_BRAND" "rank" || true)"
eight_a_bid="$(card_attr "$board8" "$EIGHT_A_BRAND" "bid" || true)"
eight_b_bid="$(card_attr "$board8" "$EIGHT_B_BRAND" "bid" || true)"
if [[ "$eight_a_pay" == "ok" && "$eight_b_pay" == "ok" ]] \
  && [[ "$eight_a_rank" == "1" && "$eight_b_rank" == "2" ]] \
  && [[ "$eight_a_bid" == "8" && "$eight_b_bid" == "8" ]]; then
  record "tie" "PASS" "both \$8; older ${EIGHT_A_BRAND} stays #1"
else
  record "tie" "FAIL" "a=${eight_a_rank}/${eight_a_bid} b=${eight_b_rank}/${eight_b_bid} pay=${eight_a_pay}/${eight_b_pay}"
fi

# --- click: GET /r/:id confirms; POST increments; 302 to canonical URL ---
five_id_click="$(card_attr "$board8" "$FIVE_BRAND" "id" || true)"
if [[ -z "$five_id_click" ]]; then
  record "click" "FAIL" "no listing id for GET /r/:id"
else
  before_clicks="$(card_attr "$board8" "$FIVE_BRAND" "clicks" || true)"
  confirm_body="${WORKDIR}/confirm.body"
  confirm_hdrs="${WORKDIR}/confirm.hdrs"
  confirm_code="$(http_get_headers "$BASE" "/r/${five_id_click}" "$confirm_body" "$confirm_hdrs" || true)"
  confirm_loc="$(header_value "$confirm_hdrs" "location" || true)"
  board_confirm="${WORKDIR}/board-confirm.html"
  http_get "$BASE" "/" "$board_confirm" >/dev/null || true
  mid_clicks="$(card_attr "$board_confirm" "$FIVE_BRAND" "clicks" || true)"
  click_body="${WORKDIR}/click.body"
  click_hdrs="${WORKDIR}/click.hdrs"
  click_code="$(
    curl -sS -D "$click_hdrs" -o "$click_body" -w "%{http_code}" \
      --connect-timeout 5 --max-time 20 --max-redirs 0 \
      -X POST "${BASE}/r/${five_id_click}" || true
  )"
  click_loc="$(header_value "$click_hdrs" "location" || true)"
  board_click="${WORKDIR}/board-click.html"
  http_get "$BASE" "/" "$board_click" >/dev/null || true
  after_clicks="$(card_attr "$board_click" "$FIVE_BRAND" "clicks" || true)"
  if [[ "$confirm_code" == "200" ]] \
    && [[ -z "$confirm_loc" ]] \
    && html_has "$confirm_body" "Confirm this brief" \
    && html_has "$confirm_body" "data-confirm-brief" \
    && html_has "$confirm_body" "data-confirm-before-leave" \
    && html_has "$confirm_body" "Opening this flyer has not counted a hop" \
    && html_has "$confirm_body" "$FIVE_URL" \
    && html_has "$confirm_body" "Leave to the brief" \
    && [[ "$mid_clicks" == "$before_clicks" ]] \
    && [[ "$click_code" == "302" ]] \
    && [[ "$click_loc" == "$FIVE_URL" ]] \
    && [[ "$click_loc" != *utm_* ]] \
    && [[ "$click_loc" != *fbclid* ]] \
    && [[ "$before_clicks" =~ ^[0-9]+$ && "$after_clicks" =~ ^[0-9]+$ ]] \
    && [[ "$after_clicks" -eq $((before_clicks + 1)) ]]; then
    record "click" "PASS" "GET /r/${five_id_click} confirms; POST 302 → ${FIVE_URL}; clicks ${before_clicks}→${after_clicks}"
  else
    record "click" "FAIL" "GET ${confirm_code} loc=${confirm_loc}; POST ${click_code} loc=${click_loc} clicks ${before_clicks}/${mid_clicks}→${after_clicks}"
  fi
fi

# --- reject: chat + NSFW do not list ---
chat_body="${WORKDIR}/chat.json"
chat_hdrs="${WORKDIR}/chat.hdrs"
chat_code="$(http_post_json "$BASE" "/checkout" \
  "{\"brand\":\"${REJECT_BRAND}\",\"terms\":\"must not list chat\",\"briefUrl\":\"https://t.me/acmebriefs\",\"bidUsd\":5}" \
  "$chat_body" "$chat_hdrs" || true)"
chat_err="$(json_field "$chat_body" "code" || json_field "$chat_body" "error" || true)"
nsfw_body="${WORKDIR}/nsfw.json"
nsfw_hdrs="${WORKDIR}/nsfw.hdrs"
nsfw_code="$(http_post_json "$BASE" "/checkout" \
  "{\"brand\":\"${REJECT_BRAND}\",\"terms\":\"must not list nsfw\",\"briefUrl\":\"https://onlyfans.com/creator\",\"bidUsd\":5}" \
  "$nsfw_body" "$nsfw_hdrs" || true)"
nsfw_err="$(json_field "$nsfw_body" "code" || json_field "$nsfw_body" "error" || true)"
board_reject="${WORKDIR}/board-reject.html"
http_get "$BASE" "/" "$board_reject" >/dev/null || true
if [[ "$chat_code" == "400" && "$nsfw_code" == "400" ]] \
  && [[ "$chat_err" == "chat_link_forbidden" && "$nsfw_err" == "nsfw_forbidden" ]] \
  && ! html_has "$board_reject" "$REJECT_BRAND"; then
  record "reject" "PASS-ERROR" "chat t.me + NSFW onlyfans → 400; neither lists"
else
  record "reject" "FAIL" "chat HTTP ${chat_code} ${chat_err}; nsfw HTTP ${nsfw_code} ${nsfw_err}"
fi

# --- reset: WEEK_NOW roll empties the live board ---
if [[ "$OWNED_PROCESS" != "1" ]]; then
  record "reset" "FAIL" "LIVE_SMOKE_BASE set; cannot apply WEEK_NOW (restart the process with WEEK_NOW)"
else
  stop_http "${STARTED_PID}" "${PORT}"
  STARTED_PID=""
  RESET_PORT="$(pick_port)"
  RESET_BASE="http://127.0.0.1:${RESET_PORT}"
  RESET_LOG="${WORKDIR}/reset.log"
  RESET_PID="$(start_next "$RESET_PORT" "$RESET_LOG" \
    "WAFFO_MODE=fixture" \
    "WEEK_NOW=2099-01-05T00:00:00.000Z")"
  if ! wait_health "$RESET_BASE"; then
    echo "reset server log:" >&2
    cat "${RESET_LOG}" >&2 || true
    record "reset" "FAIL" "WEEK_NOW process did not become healthy"
  else
    rolled="${WORKDIR}/board-reset.html"
    rolled_code="$(http_get "$RESET_BASE" "/" "$rolled" || true)"
    rolled_count="$(listing_count "$rolled" || echo "?")"
    if [[ "$rolled_code" == "200" ]] \
      && html_has "$rolled" 'data-empty-week="true"' \
      && html_has "$rolled" 'data-week-id="2099-W02"' \
      && [[ "$rolled_count" == "0" ]] \
      && ! html_has "$rolled" "$FIVE_BRAND" \
      && ! html_has "$rolled" "$SIX_BRAND" \
      && ! html_has "$rolled" "$EIGHT_A_BRAND" \
      && ! html_has "$rolled" "$EIGHT_B_BRAND"; then
      record "reset" "PASS" "WEEK_NOW=2099-01-05T00:00:00.000Z → week 2099-W02 empty; previous rows hidden"
    else
      record "reset" "FAIL" "GET / after WEEK_NOW HTTP ${rolled_code} count=${rolled_count}"
    fi
  fi
fi

# --- production configuration: fail closed before provider I/O ---
echo "== waffo production config is fail-closed =="
LIVE_PORT="$(pick_port)"
LIVE_DB="${WORKDIR}/waffo-prod.sqlite"
LIVE_LOG="${WORKDIR}/waffo-prod.log"
LIVE_BASE="http://127.0.0.1:${LIVE_PORT}"
LIVE_PID="$(
  DB_PATH="${LIVE_DB}" start_next "$LIVE_PORT" "$LIVE_LOG" \
    "WAFFO_MODE=waffo-prod" \
    "NODE_ENV=production" \
    "WAFFO_MERCHANT_ID=" \
    "WAFFO_PRIVATE_KEY=" \
    "WAFFO_PRIVATE_KEY_FILE=" \
    "WAFFO_STORE_ID=" \
    "WAFFO_PRODUCT_ID=" \
    "WAFFO_WEBHOOK_PROD_PUBLIC_KEY=" \
    "WAFFO_API_BASE=https://api.waffo.ai"
)"
live_health_body="${WORKDIR}/live-health.json"
live_page_body="${WORKDIR}/live-page.html"
live_click_body="${WORKDIR}/live-click.html"
live_health_code=""
for _ in $(seq 1 20); do
  live_health_code="$(curl -sS -o "$live_health_body" -w "%{http_code}" \
    --connect-timeout 2 --max-time 5 "${LIVE_BASE}/healthz" || true)"
  if [[ "$live_health_code" != "000" && -n "$live_health_code" ]]; then
    break
  fi
  sleep 0.25
done
live_page_code="$(http_get "$LIVE_BASE" "/" "$live_page_body" || true)"
live_click_code="$(http_get "$LIVE_BASE" "/r/does-not-exist" "$live_click_body" || true)"
if is_non_secret_5xx "$live_health_code" \
  && is_non_secret_5xx "$live_page_code" \
  && is_non_secret_5xx "$live_click_code" \
  && non_secret_body "$live_health_body" \
  && non_secret_body "$live_page_body" \
  && non_secret_body "$live_click_body" \
  && grep -qF 'BLOCKED-SECRET: WAFFO_MERCHANT_ID' "$LIVE_LOG"; then
  echo "BLOCKED-SECRET: WAFFO_MERCHANT_ID"
  record "secret" "BLOCKED-SECRET" "Next instrumentation rejected health/page/click with non-secret 5xx before provider I/O; provider calls=0"
else
  echo "waffo-prod process log:" >&2
  cat "${LIVE_LOG}" >&2 || true
  record "secret" "FAIL" "expected non-secret 5xx for health/page/click, got health=${live_health_code} page=${live_page_code} click=${live_click_code}"
fi
if [[ -n "${LIVE_PID}" ]]; then
  stop_http "${LIVE_PID}" "${LIVE_PORT}"
fi
LIVE_PID=""

# A real production checkout is deliberately outside this smoke: it requires
# stable public HTTPS, durable storage, registered `/webhooks/waffo`, and an
# operator-approved deployment. No provider call is made here.
record "live-waffo-checkout" "PASS-ERROR" "waffo-prod checkout intentionally not called; provider calls=0; requires public HTTPS + webhook registration"

echo
echo "== summary =="
echo "PASS=${PASS} PASS-ERROR=${PASS_ERROR} BLOCKED-SECRET=${BLOCKED} FAIL=${FAIL}"
echo "base=${BASE}"
echo "weekId=${WEEK_ID}"
if [[ -f "${RESULT_LOG}" ]]; then
  echo "----"
  while IFS=$'\t' read -r flow status note; do
    printf '%-14s %-16s %s\n' "$flow" "$status" "$note"
  done <"${RESULT_LOG}"
fi

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
