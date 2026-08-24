#!/usr/bin/env bash
# Offline gate for main. Must exit 0 on a clean clone with no secrets.
# When application code lands, add unit/contract tests here. Do not delete the
# contract checks. Do not require live Polar or other third-party networks.
# Operator live smoke is scripts/live-smoke.sh and is never invoked from here.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "== contract files =="
for f in README.md SPEC.md BUILD.md CONTRIBUTING.md scripts/test.sh; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done

echo "== contributing rules are documented =="
grep -q 'main must always be buildable' CONTRIBUTING.md \
  || grep -q 'main` must always be buildable' CONTRIBUTING.md \
  || fail "CONTRIBUTING.md does not state the main-branch rule"

echo "== SPEC mentions git collaboration =="
grep -q 'Git collaboration' SPEC.md || fail "SPEC.md missing Git collaboration section"

echo "== BUILD is a PR DAG through live-smoke =="
grep -E -q '^### PR [0-9]+:' BUILD.md || fail "BUILD.md missing ### PR N: headings"
grep -q 'live-smoke' BUILD.md || fail "BUILD.md missing live-smoke"

echo "== CI job ci exists =="
[[ -f .github/workflows/ci.yml ]] || fail "missing .github/workflows/ci.yml"
grep -qE '^[[:space:]]+ci:[[:space:]]*$' .github/workflows/ci.yml \
  || fail "ci.yml missing job id ci"
grep -q 'scripts/test.sh' .github/workflows/ci.yml \
  || fail "ci.yml does not run scripts/test.sh"

echo "== product contract keywords =="
grep -qi 'Polar' SPEC.md || fail "SPEC.md must name Polar"
grep -q '\$5' SPEC.md || fail "SPEC.md must document min \$5"
grep -qi 'weekly' SPEC.md || fail "SPEC.md must document weekly reset"
grep -qi 'follower' SPEC.md || fail "SPEC.md must forbid fake follower counts"

echo "== no committed secrets =="
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git ls-files | grep -E '(^|/)\.env$|(^|/)id_rsa$|\.pem$|credentials\.json$' >/dev/null; then
    fail "secret-like path is tracked"
  fi
fi

echo "== markdown is UTF-8 text =="
file -b --mime-encoding README.md SPEC.md CONTRIBUTING.md BUILD.md | grep -qiE 'utf-8|us-ascii' \
  || fail "docs are not UTF-8/ASCII"

echo "== live-smoke stays operator-only =="
[[ -f scripts/live-smoke.sh ]] || fail "missing scripts/live-smoke.sh"
[[ -x scripts/live-smoke.sh ]] || fail "scripts/live-smoke.sh must be executable"
[[ -f docs/live-smoke.md ]] || fail "missing docs/live-smoke.md"
[[ -s docs/live-smoke.md ]] || fail "empty docs/live-smoke.md"
if grep -Eq '^\s*(bash )?(\./)?scripts/live-smoke\.sh' scripts/test.sh; then
  fail "test.sh must not invoke live-smoke.sh"
fi
if grep -E '^[[:space:]]*(export[[:space:]]+)?POLAR_LIVE=1' scripts/test.sh >/dev/null; then
  fail "test.sh must not set POLAR_LIVE=1"
fi
if [[ -f .github/workflows/ci.yml ]]; then
  if grep -nE 'live-smoke|POLAR_LIVE=1' .github/workflows/ci.yml >/dev/null; then
    fail "CI must not run live-smoke or set POLAR_LIVE=1"
  fi
fi
grep -q 'BLOCKED-SECRET: POLAR_ACCESS_TOKEN' scripts/live-smoke.sh \
  || fail "live-smoke.sh must name BLOCKED-SECRET: POLAR_ACCESS_TOKEN"
grep -q 'POLAR_LIVE' scripts/live-smoke.sh \
  || fail "live-smoke.sh must gate live Polar on POLAR_LIVE"
grep -q 'sandbox.polar.sh' scripts/live-smoke.sh \
  || fail "live-smoke.sh must require a Polar sandbox Checkout URL"
grep -q 'POLAR_API_BASE' scripts/live-smoke.sh \
  || fail "live-smoke.sh must pass POLAR_API_BASE to the live process"
grep -q 'live-smoke refuses CI=true' scripts/live-smoke.sh \
  || fail "live-smoke.sh must refuse CI=true"
grep -q 'live-smoke must not run in GitHub Actions' scripts/live-smoke.sh \
  || fail "live-smoke.sh must refuse GITHUB_ACTIONS=true"
grep -q 'PASS-ERROR' docs/live-smoke.md || fail "docs/live-smoke.md missing PASS-ERROR"
grep -q 'BLOCKED-SECRET' docs/live-smoke.md || fail "docs/live-smoke.md missing BLOCKED-SECRET"
for flow in Health 'Empty board' 'About / rules' 'Place $5' Outbid Raise Tie Click Reject Reset Secret; do
  grep -q "${flow}" docs/live-smoke.md \
    || fail "docs/live-smoke.md missing SPEC §11 flow: ${flow}"
done

if [[ -f package.json ]]; then
  echo "== install =="
  if [[ ! -d node_modules ]]; then
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  fi

  unset POLAR_LIVE
  unset POLAR_ACCESS_TOKEN
  unset POLAR_WEBHOOK_SECRET
  unset POLAR_SUCCESS_URL
  unset POLAR_PRODUCT_ID
  unset POLAR_API_BASE
  unset POLAR_FIXTURE_ONLY
  export POLAR_FIXTURE_ONLY=1

  if [[ -f tsconfig.json ]]; then
    echo "== tsc --noEmit =="
    npx tsc --noEmit
  fi

  echo "== unit tests =="
  shopt -s nullglob
  test_files=(tests/*.test.ts)
  shopt -u nullglob
  [[ ${#test_files[@]} -gt 0 ]] || fail "no tests/*.test.ts files"
  test_log="$(mktemp "${TMPDIR:-/tmp}/cbw-unit.XXXXXX")"
  set +e
  test_status=0
  for test_file in "${test_files[@]}"; do
    echo "-- ${test_file} --"
    file_ok=0
    attempt=1
    while [[ "${attempt}" -le 8 ]]; do
      file_log="$(mktemp "${TMPDIR:-/tmp}/cbw-unit-file.XXXXXX")"
      npx tsx --test --test-force-exit --test-reporter spec "${test_file}" \
        >"${file_log}" 2>&1
      file_status=$?
      cat "${file_log}" | tee -a "${test_log}"
      if [[ ${file_status} -eq 0 ]]; then
        file_ok=1
        rm -f "${file_log}"
        break
      fi
      # Node 24 + better-sqlite3 can abort in Database/Statement dtors during GC.
      # The file's assertions already passed; retry the process.
      if grep -q 'RemoveEnvironmentCleanupHook' "${file_log}" \
        && grep -qE 'Database::~Database|Statement::~Statement' "${file_log}"
      then
        echo "retry ${attempt}/8 ${test_file} after better-sqlite3 GC abort" >&2
        rm -f "${file_log}"
        attempt=$((attempt + 1))
        continue
      fi
      rm -f "${file_log}"
      break
    done
    if [[ "${file_ok}" -ne 1 ]]; then
      test_status=1
    fi
  done
  set -e
  [[ ${test_status} -eq 0 ]] || fail "unit tests failed"
  grep -Eq 'tests[[:space:]]+[1-9][0-9]*' "${test_log}" \
    || fail "test runner reported 0 tests"
  rm -f "${test_log}"

  echo "== skeleton files =="
  for f in \
    src/db/schema.sql \
    src/lib/db.ts \
    src/app/healthz/route.ts \
    src/app/page.tsx
  do
    [[ -f "$f" ]] || fail "missing $f"
  done
  grep -q 'CREATE TABLE IF NOT EXISTS listings' src/db/schema.sql \
    || fail "schema.sql missing listings"
  grep -q 'CREATE TABLE IF NOT EXISTS payments' src/db/schema.sql \
    || fail "schema.sql missing payments"
  if grep -qiE 'follower|subscriber|engagement rate|estimated reach' src/db/schema.sql; then
    fail "schema.sql must not store invented audience metrics"
  fi
  [[ "${POLAR_LIVE:-}" != "1" ]] || fail "POLAR_LIVE must stay unset in test.sh"

  echo "== board UI + ranking =="
  for f in \
    src/lib/rank.ts \
    src/lib/board-markup.tsx \
    src/app/board.css \
    src/app/board.tsx \
    src/app/outbid-form.tsx \
    tests/rank.test.ts \
    tests/board.test.ts
  do
    [[ -f "$f" ]] || fail "missing $f"
  done
  grep -q 'bidUsd' src/lib/rank.ts || fail "rank.ts missing bidUsd sort"
  grep -q 'createdAt' src/lib/rank.ts || fail "rank.ts missing createdAt older-wins-ties"
  grep -q 'Outbid' src/app/board.tsx src/app/outbid-form.tsx \
    || fail "board missing Outbid button"
  grep -q 'name="brand"' src/app/outbid-form.tsx || fail "form missing brand"
  grep -q 'name="terms"' src/app/outbid-form.tsx || fail "form missing terms"
  grep -q 'name="briefUrl"' src/app/outbid-form.tsx || fail "form missing brief URL"
  grep -q 'name="bidUsd"' src/app/outbid-form.tsx || fail "form missing amount"
  grep -q 'clicks' src/lib/board-markup.tsx || fail "cards missing clicks"
  grep -q 'className="plaster"' src/lib/board-markup.tsx \
    || fail "BoardCards empty helper must still be blank plaster"
  grep -q 'export function OccupiedFlyers' src/lib/board-markup.tsx \
    || fail "occupied week must compose OccupiedFlyers"
  grep -q 'plaster is blank' src/app/outbid-form.tsx \
    || fail "empty week must say the plaster is blank on Claim #1"
  grep -q 'data-empty-week="true"' src/app/outbid-form.tsx \
    || fail "empty Claim #1 paper must carry the honest empty-week stamp"
  grep -q 'className="card' src/lib/board-markup.tsx || fail "a brief must be a flyer card"
  grep -q 'Claim #1 for' src/app/outbid-form.tsx || fail "form missing Claim #1"
  grep -q 'amount-stepper' src/app/outbid-form.tsx || fail "form missing ± amount stepper"
  grep -q 'amount-field' src/app/board.css || fail "CSS missing dashed amount field"
  grep -q 'export function claimNumberOneUsd' src/lib/rank.ts \
    || fail "rank.ts must export claimNumberOneUsd"
  grep -q 'claimNumberOneUsd' src/app/board.tsx \
    || fail "board must seed the claim amount from this week’s top bid"
  grep -q '<OccupiedFlyers listings={listings} />' src/app/board.tsx \
    || fail "occupied week must render OccupiedFlyers"
  if grep -q '<EmptyPlaster' src/app/board.tsx; then
    fail "empty week must not render a second EmptyPlaster column beside Claim #1"
  fi
  if grep -q '<BoardCards' src/app/board.tsx; then
    fail "empty and occupied walls must compose separately, not share BoardCards"
  fi
  grep -q 'data-claim-amount' src/app/outbid-form.tsx \
    || fail "claim strip must expose this week’s #1 price"
  grep -q 'Need \$' src/app/outbid-form.tsx \
    || fail "occupied claim must say what it costs to take #1"
  grep -q 'Blank plaster' src/app/outbid-form.tsx \
    || fail "empty claim must say blank plaster is #1 for the minimum"
  grep -q 'data-empty-claim-first' src/app/outbid-form.tsx \
    || fail "empty claim must stamp Claim #1 first"
  grep -q 'empty-claim-first' src/app/outbid-form.tsx \
    || fail "empty claim must use the empty-claim-first class"
  grep -q 'empty plaster still leads with Claim #1' tests/board.test.ts \
    || fail "board tests must cover empty plaster leading with Claim #1"
  grep -q 'empty plaster stays Claim #1 with no Terms / Open leak' tests/board.test.ts \
    || fail "board tests must cover empty plaster with no Terms / Open leak"
  grep -q 'empty plaster stays Claim #1 with no later-open / cards-later leak' tests/board.test.ts \
    || fail "board tests must cover empty plaster with no later-open leak"
  grep -q 'empty plaster Claim #1 is the first click — brief URL is a later write' tests/board.test.ts \
    || fail "board tests must cover empty plaster Claim #1 then later brief URL"
  grep -q 'claim strip defaults to this week' tests/board.test.ts \
    || fail "board tests must cover the live #1 claim amount"
  grep -q 'occupied wall puts flyers' tests/board.test.ts \
    || fail "board tests must cover flyer-first occupied reading order"
  grep -q 'one flyer has a single labeled Open brief hop' tests/board.test.ts \
    || fail "board tests must cover the labeled Open brief hop"
  grep -q 'one flyer names Terms as the prize before $bid' tests/board.test.ts \
    || fail "board tests must cover labeled Terms before \$bid"
  grep -q 'occupied #1 Terms reads first and larger than $bid and clicks' tests/board.test.ts \
    || fail "board tests must cover #1 Terms larger than \$bid"
  grep -q 'occupied #1 $bid stays a later fact and does not shout beside Terms' tests/board.test.ts \
    || fail "board tests must cover #1 \$bid staying a later fact"
  grep -q 'occupied later-rank Open stays quieter so #1 Open is the first click' tests/board.test.ts \
    || fail "board tests must cover quieter later-rank Open brief"
  grep -q 'occupied later flyers stay quieter than #1 Terms — prize stays first' tests/board.test.ts \
    || fail "board tests must cover quieter later flyers than #1 Terms"
  grep -q 'occupied Terms stay the prize and later Open stays after #1 Open' tests/board.test.ts \
    || fail "board tests must cover later Open after #1 Open"
  grep -q 'one flyer opens the brief after Terms, not next to $bid' tests/board.test.ts \
    || fail "board tests must cover Open brief after Terms"
  grep -q 'GET confirm sheet puts terms and the brief URL before the leave hop' tests/board.test.ts \
    || fail "board tests must cover the confirm sheet"
  grep -q 'GET confirm-before-leave does not increment clicks' tests/board.test.ts \
    || fail "board tests must cover GET confirm-before-leave"
  grep -q 'occupied wall names one Post a brief hop' tests/board.test.ts \
    || fail "board tests must cover the occupied Post a brief hop"
  grep -q 'occupied wall posts a brief after Open brief' tests/board.test.ts \
    || fail "board tests must cover Post a brief after Open brief"
  grep -q 'occupied wall lets Open brief win the first click after Post follows Open' tests/board.test.ts \
    || fail "board tests must cover Open brief winning the first click"
  grep -q 'occupied wall concentrates Post a brief after Open wins the first click' tests/board.test.ts \
    || fail "board tests must cover concentrated Post a brief after Open first click"
  grep -q 'occupied wall concentrates Open brief after Post is concentrated' tests/board.test.ts \
    || fail "board tests must cover concentrated Open brief after Post first write"
  grep -q 'occupied wall concentrates Post a brief after Open is re-concentrated' tests/board.test.ts \
    || fail "board tests must cover concentrated Post a brief after Open first read"
  grep -q 'occupied wall concentrates Open brief after Post is re-concentrated' tests/board.test.ts \
    || fail "board tests must cover concentrated Open brief after Post first write is re-concentrated"
  grep -q 'occupied wall concentrates Post a brief after Open is re-concentrated again' tests/board.test.ts \
    || fail "board tests must cover concentrated Post a brief after Open first read is re-concentrated again"
  grep -q 'occupied wall concentrates Open brief after Post is re-concentrated again' tests/board.test.ts \
    || fail "board tests must cover concentrated Open brief after Post first write is re-concentrated again"
  grep -q 'occupied wall concentrates Post a brief after Open is re-concentrated again under louder Open' tests/board.test.ts \
    || fail "board tests must cover concentrated Post a brief after Open first read is re-concentrated again under louder Open"
  grep -q 'occupied wall concentrates Open brief after Post is re-concentrated again under louder Post' tests/board.test.ts \
    || fail "board tests must cover concentrated Open brief after Post first write is re-concentrated again under louder Post"
  grep -q 'occupied wall concentrates Post a brief after Open is re-concentrated again under louder Open brief' tests/board.test.ts \
    || fail "board tests must cover concentrated Post a brief after Open first read is re-concentrated again under louder Open brief"
  grep -q 'occupied wall concentrates Open brief after Post is re-concentrated again under louder Post a brief' tests/board.test.ts \
    || fail "board tests must cover concentrated Open brief after Post first write is re-concentrated again under louder Post a brief"
  grep -q 'occupied wall concentrates Post a brief after Open is re-concentrated again under louder Open brief hop' tests/board.test.ts \
    || fail "board tests must cover concentrated Post a brief after Open first read is re-concentrated again under louder Open brief hop"
  grep -q 'data-first-click' src/lib/board-markup.tsx \
    || fail "occupied #1 Open brief must mark the first click"
  grep -q 'data-open-after-post-first' src/lib/board-markup.tsx \
    || fail "Open brief must concentrate after Post is the first write"
  grep -q 'data-first-read="open"' src/lib/board-markup.tsx \
    || fail "Open brief must stamp the first read after Post"
  grep -q 'data-open-after-post-two-stamp' src/lib/board-markup.tsx \
    || fail "Open brief must concentrate after Post is re-concentrated"
  grep -q 'data-open-after-post-three-stamp' src/lib/board-markup.tsx \
    || fail "Open brief must concentrate after Post is re-concentrated again"
  grep -q 'data-open-after-post-four-stamp' src/lib/board-markup.tsx \
    || fail "Open brief must concentrate after Post is re-concentrated again under louder Post"
  grep -q 'data-open-after-post-five-stamp' src/lib/board-markup.tsx \
    || fail "Open brief must concentrate after Post is re-concentrated again under louder Post a brief"
  grep -q 'data-first-click="open"' src/app/board.css \
    || fail "CSS must make Open brief win the first click"
  grep -q 'open-after-post-first' src/app/board.css \
    || fail "CSS must concentrate Open brief after Post first write"
  grep -q 'open-after-post-two' src/app/board.css \
    || fail "CSS must concentrate Open brief after Post is re-concentrated"
  grep -q 'open-after-post-three' src/app/board.css \
    || fail "CSS must concentrate Open brief after Post is re-concentrated again"
  grep -q 'open-after-post-four' src/app/board.css \
    || fail "CSS must concentrate Open brief after Post is re-concentrated again under louder Post"
  grep -q 'open-after-post-five' src/app/board.css \
    || fail "CSS must concentrate Open brief after Post is re-concentrated again under louder Post a brief"
  grep -q 'data-post-brief' src/lib/board-markup.tsx \
    || fail "occupied wall must mark Post a brief"
  grep -q 'data-post-after-open' src/lib/board-markup.tsx \
    || fail "Post a brief must mark the hop after Open brief"
  grep -q 'data-post-after-open-first' src/lib/board-markup.tsx \
    || fail "Post a brief must concentrate after Open wins the first click"
  grep -q 'data-first-write="post"' src/lib/board-markup.tsx \
    || fail "Post a brief must stamp the first write after Open"
  grep -q 'data-post-after-open-two' src/lib/board-markup.tsx \
    || fail "Post a brief must concentrate after Open is re-concentrated"
  grep -q 'data-post-after-open-three' src/lib/board-markup.tsx \
    || fail "Post a brief must concentrate after Open is re-concentrated again"
  grep -q 'data-post-after-open-four' src/lib/board-markup.tsx \
    || fail "Post a brief must concentrate after Open is re-concentrated again under louder Open"
  grep -q 'data-post-after-open-five' src/lib/board-markup.tsx \
    || fail "Post a brief must concentrate after Open is re-concentrated again under louder Open brief"
  grep -q 'data-post-after-open-six' src/lib/board-markup.tsx \
    || fail "Post a brief must concentrate after Open is re-concentrated again under louder Open brief hop"
  grep -q 'after Open brief' src/lib/board-markup.tsx \
    || fail "Post a brief must say after Open brief"
  grep -q 'post-after-open' src/lib/board-markup.tsx \
    || fail "Post a brief after Open brief must stay the buyer hop"
  grep -q 'post-after-note' src/app/board.css \
    || fail "CSS must style the after-Open-brief hop note"
  grep -q 'className="post-brief post-after-open post-after-open-first post-after-open-two post-after-open-three post-after-open-four post-after-open-five post-after-open-six"' src/lib/board-markup.tsx \
    || fail "Post a brief must stay the buyer hop"
  grep -q 'href="#claim"' src/lib/board-markup.tsx \
    || fail "Post a brief must hop to the claim strip"
  grep -q 'Post a brief' src/lib/board-markup.tsx \
    || fail "occupied wall must say Post a brief"
  grep -q 'post-label' src/lib/board-markup.tsx \
    || fail "Post a brief must be the labeled hop"
  grep -q 'Claim #1' src/lib/board-markup.tsx \
    || fail "Post a brief must land on Claim #1"
  grep -q 'Post a brief this week' src/app/outbid-form.tsx \
    || fail "occupied claim must say Post a brief this week"
  grep -q 'post-brief' src/app/board.css \
    || fail "CSS must style the Post a brief hop"
  grep -q 'post-after-open-first' src/app/board.css \
    || fail "CSS must concentrate Post a brief after Open first click"
  grep -q 'post-after-open-two' src/app/board.css \
    || fail "CSS must concentrate Post a brief after Open is re-concentrated"
  grep -q 'post-after-open-three' src/app/board.css \
    || fail "CSS must concentrate Post a brief after Open is re-concentrated again"
  grep -q 'post-after-open-four' src/app/board.css \
    || fail "CSS must concentrate Post a brief after Open is re-concentrated again under louder Open"
  grep -q 'post-after-open-five' src/app/board.css \
    || fail "CSS must concentrate Post a brief after Open is re-concentrated again under louder Open brief"
  grep -q 'post-after-open-six' src/app/board.css \
    || fail "CSS must concentrate Post a brief after Open is re-concentrated again under louder Open brief hop"
  grep -q 'open-label' src/lib/board-markup.tsx \
    || fail "Open brief must be the labeled hop on a flyer"
  grep -q 'data-open-brief' src/lib/board-markup.tsx \
    || fail "Open brief hop must be marked data-open-brief"
  grep -q 'data-open-after-terms' src/lib/board-markup.tsx \
    || fail "Open brief must mark the hop after Terms"
  grep -q 'after Terms' src/lib/board-markup.tsx \
    || fail "Open brief must say after Terms"
  grep -q 'open-after-terms' src/lib/board-markup.tsx \
    || fail "Open brief after Terms must stay the flyer hop"
  grep -q 'open-after-note' src/app/board.css \
    || fail "CSS must style the after-Terms hop note"
  grep -q 'brief-url open-after-terms' src/lib/board-markup.tsx \
    || fail "Open brief must stay the flyer hop"
  grep -q 'brief-url open-after-terms open-after-post-first' src/lib/board-markup.tsx \
    || fail "occupied #1 Open brief must concentrate after Post"
  grep -q 'brief-url open-after-terms open-after-post-first open-after-post-two' src/lib/board-markup.tsx \
    || fail "occupied #1 Open brief must concentrate after Post is re-concentrated"
  grep -q 'brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three' src/lib/board-markup.tsx \
    || fail "occupied #1 Open brief must concentrate after Post is re-concentrated again"
  grep -q 'brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three open-after-post-four' src/lib/board-markup.tsx \
    || fail "occupied #1 Open brief must concentrate after Post is re-concentrated again under louder Post"
  grep -q 'brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three open-after-post-four open-after-post-five' src/lib/board-markup.tsx \
    || fail "occupied #1 Open brief must concentrate after Post is re-concentrated again under louder Post a brief"
  grep -q 'data-terms' src/lib/board-markup.tsx \
    || fail "flyer must mark the Terms prize"
  grep -q 'terms-label' src/lib/board-markup.tsx \
    || fail "flyer must label Terms"
  grep -q 'terms-copy' src/lib/board-markup.tsx \
    || fail "flyer must show the terms copy as the prize"
  grep -q 'terms-label' src/app/board.css \
    || fail "CSS must style the Terms label"
  grep -q 'data-prize' src/lib/board-markup.tsx \
    || fail "occupied #1 flyer must mark Terms as the prize"
  grep -q 'data-prize-before-price' src/lib/board-markup.tsx \
    || fail "occupied #1 flyer must stamp prize before price"
  grep -q 'prize-before-price' src/lib/board-markup.tsx \
    || fail "occupied #1 Terms must use the prize-before-price class"
  grep -q 'prize-before-price' src/app/board.css \
    || fail "CSS must enlarge #1 Terms over \$bid"
  grep -q 'card-lead .terms.prize-before-price .terms-copy' src/app/board.css \
    || fail "CSS must enlarge only the #1 Terms copy"
  grep -q 'wall-occupied .card-lead .bid' src/app/board.css \
    || fail "CSS must keep #1 \$bid quieter than Terms"
  grep -q 'data-later-fact' src/lib/board-markup.tsx \
    || fail "occupied #1 flyer must stamp \$bid as a later fact"
  grep -q 'later-fact' src/lib/board-markup.tsx \
    || fail "occupied #1 \$bid must use the later-fact class"
  grep -q 'later-fact' src/app/board.css \
    || fail "CSS must keep #1 \$bid a later fact beside Terms"
  grep -qF 'wall-occupied .card-lead .bid.later-fact[data-later-fact]' src/app/board.css \
    || fail "CSS must mute #1 \$bid so it cannot shout beside Terms"
  grep -q 'function OpenBriefHop' src/lib/board-markup.tsx \
    || fail "occupied Open must compose OpenBriefHop, not stamp a mute class"
  grep -q '{lead ? hop : null}' src/lib/board-markup.tsx \
    || fail "occupied #1 Open must sit after Terms, before \$bid"
  grep -q '{lead ? null : hop}' src/lib/board-markup.tsx \
    || fail "later Open must recede after \$bid, not sit in the Terms prize slot"
  grep -q 'cards-lead' src/lib/board-markup.tsx \
    || fail "occupied #1 flyer must sit in the lead cards list"
  grep -q 'cards-later' src/lib/board-markup.tsx \
    || fail "later-rank flyers must sit in a later cards list"
  grep -q 'data-later-open' src/lib/board-markup.tsx \
    || fail "later-rank Open brief must mark data-later-open"
  grep -q 'brief-url later-open' src/lib/board-markup.tsx \
    || fail "later-rank Open brief must use the later-open hop"
  grep -qF '.wall-occupied .cards-later .card' src/app/board.css \
    || fail "later flyers must recede as later cards after #1"
  grep -qF '.wall-occupied .cards-later .brief-url.later-open[data-later-open]' src/app/board.css \
    || fail "CSS must keep later-rank Open quieter than #1 Open on occupied plaster"
  if grep -qF '.wall-occupied .cards-later .wall-occupied .card' src/app/board.css
  then
    fail "later-card recede CSS must match later flyers, not a dead nested selector"
  fi
  grep -qF '.wall-stage.wall-empty[data-occupied="false"] [data-later-open]' src/app/board.css \
    || fail "CSS must keep later-rank Open off empty plaster"
  grep -qF '.wall-stage.wall-empty[data-occupied="false"] .cards-later' src/app/board.css \
    || fail "CSS must keep later-rank flyers off empty plaster"
  grep -qF '.wall-stage.wall-empty[data-occupied="false"] .later-open' src/app/board.css \
    || fail "CSS must keep later-open hop off empty plaster"
  grep -qF '.wall-occupied .cards-later' src/app/board.css \
    || fail "later-rank CSS must stay on occupied plaster"
  if grep -nE 'open-later-rank|data-later-rank[^-]' src/lib/board-markup.tsx src/app/board.css >/dev/null
  then
    fail "do not stamp open-later-rank; compose later-rank Open as a quieter hop"
  fi
  grep -q 'wall-occupied .card-lead .clicks' src/app/board.css \
    || fail "CSS must keep #1 clicks quieter than Terms"
  python3 - src/app/board.css <<'PY' || fail "#1 Terms copy must be larger than \$bid and clicks"
import re
import sys
css = open(sys.argv[1], encoding="utf-8").read()

def size(pattern):
    match = re.search(pattern, css, re.S)
    if not match:
        raise SystemExit(1)
    return float(match.group(1))

prize = size(r"\.wall-occupied \.card-lead \.terms\.prize-before-price \.terms-copy\s*\{[^}]*font-size:\s*([\d.]+)rem")
bid = size(r"\.wall-occupied \.card-lead \.bid\s*\{[^}]*font-size:\s*([\d.]+)rem")
clicks = size(r"\.wall-occupied \.card-lead \.clicks\s*\{[^}]*font-size:\s*([\d.]+)rem")
if not (prize > bid and prize > clicks):
    raise SystemExit(1)
if "color: var(--muted)" not in re.search(
    r"\.wall-occupied \.card-lead \.bid\.later-fact\[data-later-fact\]\s*\{[^}]*\}", css, re.S
).group(0):
    raise SystemExit(1)
if "color: var(--bid)" in re.search(
    r"\.wall-occupied \.card-lead \.bid\.later-fact\[data-later-fact\]\s*\{[^}]*\}", css, re.S
).group(0):
    raise SystemExit(1)
later_open = size(r"\.wall-occupied \.cards-later \.brief-url\.later-open\[data-later-open\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
base_open = size(r"\.wall-occupied \.card \.brief-url \{\n[^}]*font-size:\s*([\d.]+)rem")
lead_open = size(r"\.wall-occupied \.card \.brief-url\.open-after-post-five\s*\{[^}]*font-size:\s*([\d.]+)rem")
if not (later_open < base_open and later_open < lead_open):
    raise SystemExit(1)
later_block = re.search(
    r"\.wall-occupied \.cards-later \.brief-url\.later-open\[data-later-open\]\s*\{[^}]*\}", css, re.S
)
if later_block is None:
    raise SystemExit(1)
if "color: var(--muted)" not in later_block.group(0):
    raise SystemExit(1)
if "color: var(--ink)" in later_block.group(0):
    raise SystemExit(1)
if "border: 0" not in later_block.group(0):
    raise SystemExit(1)
if "background: transparent" not in later_block.group(0):
    raise SystemExit(1)
if re.search(r"(?m)^(?:a\.post-brief|\.cards-later |\.card \.brief-url)", css):
    raise SystemExit(1)
lead_areas = re.search(
    r"\.wall-occupied \.card \{\n[^}]*grid-template-areas:\s*([^;]+);", css, re.S
)
later_areas = re.search(
    r"\.wall-occupied \.cards-later \.card \{\n[^}]*grid-template-areas:\s*([^;]+);", css, re.S
)
if lead_areas is None or later_areas is None:
    raise SystemExit(1)
if lead_areas.group(1).find('"url url url"') >= lead_areas.group(1).find('"bid bid clicks"'):
    raise SystemExit(1)
if later_areas.group(1).find('"bid bid clicks"') >= later_areas.group(1).find('"url url url"'):
    raise SystemExit(1)
if ".wall-occupied .cards-later .wall-occupied .card" in css:
    raise SystemExit(1)
PY
  grep -q '"rank brand brand"' src/app/board.css \
    || fail "flyer CSS must not put \$bid on the first row"
  if grep -nE 'href=\{listing\.briefUrl\}|href=\{`\$\{listing\.briefUrl' src/lib/board-markup.tsx >/dev/null
  then
    fail "flyer must not hop the raw brief URL"
  fi
  grep -q 'wall-occupied' src/app/board.css \
    || fail "occupied wall CSS must put flyers in the first reading slot"
  grep -q 'data-occupied' src/lib/board-markup.tsx \
    || fail "wall stage must mark occupied vs empty plaster"
  grep -q 'empty-claim-first' src/app/board.css \
    || fail "CSS must keep empty plaster leading with Claim #1"
  grep -q 'wall-empty' src/app/board.css \
    || fail "CSS must isolate blank plaster from occupied chrome"
  grep -qF '.wall-stage.wall-empty[data-occupied="false"] [data-terms]' src/app/board.css \
    || fail "CSS must keep Terms off empty plaster"
  grep -qF '.wall-stage.wall-empty[data-occupied="false"] [data-open-brief]' src/app/board.css \
    || fail "CSS must keep Open brief off empty plaster"
  grep -qF '.wall-stage.wall-empty[data-occupied="false"] [data-later-fact]' src/app/board.css \
    || fail "CSS must keep later-fact \$bid off empty plaster"
  grep -qF '.wall-stage.wall-empty[data-occupied="false"] .flyers' src/app/board.css \
    || fail "CSS must keep occupied flyers off empty plaster"
  grep -qF '.wall-stage.wall-empty[data-occupied="false"] .plaster' src/app/board.css \
    || fail "CSS must keep a flyer-shaped plaster hole off empty Claim #1"
  grep -qF 'grid-template-columns: minmax(16rem, 32rem)' src/app/board.css \
    || fail "empty plaster CSS must collapse to Claim #1 paper"
  grep -q 'data-occupied="false"' src/app/board.css \
    || fail "CSS must keep occupied chrome off empty plaster"
  if grep -nE 'empty-claim-plaster|data-empty-claim-plaster' src/lib/board-markup.tsx src/app/board.css src/app/board.tsx >/dev/null
  then
    fail "do not stamp empty-claim-plaster; compose empty vs occupied walls"
  fi
  grep -q 'confirm-before-leave' src/app/board.css \
    || fail "CSS must mark confirm-before-leave on GET /r/:id"
  grep -q 'data-confirm-uncounted' src/app/board.css \
    || fail "CSS must style the uncounted GET preview"
  grep -qF '.confirm-sheet.confirm-before-leave[data-confirm-before-leave]' src/app/board.css \
    || fail "CSS must concentrate leave on the confirm-before-leave sheet"
  if grep -nE 'data-post-after-open-seven|data-open-after-post-six-stamp' \
    src/lib/board-markup.tsx src/app/outbid-form.tsx src/app/board.css src/lib/confirm-brief.ts >/dev/null
  then
    fail "do not stamp *-after-*-N on empty plaster or confirm-before-leave"
  fi
  echo "== UX: empty plaster Claim #1 is the first click — brief URL is a later write =="
  grep -q 'empty-claim-first' src/app/outbid-form.tsx \
    || fail "empty Claim #1 must use the empty-claim-first class"
  grep -q 'data-empty-claim-first' src/app/outbid-form.tsx \
    || fail "empty Claim #1 must stamp data-empty-claim-first"
  grep -q 'data-first-click="claim"' src/app/outbid-form.tsx \
    || fail "empty Claim #1 Outbid must win the first click"
  grep -q 'data-later-write' src/app/outbid-form.tsx \
    || fail "empty plaster must stamp the brief URL as a later write"
  grep -q 'data-brief-identity' src/app/outbid-form.tsx \
    || fail "empty plaster must wrap brand / terms / brief URL as listing identity"
  grep -q 'Then the brief URL' src/app/outbid-form.tsx \
    || fail "empty plaster must name the brief URL as a later write"
  grep -q 'EmptyClaimFirstWrite' src/app/outbid-form.tsx \
    || fail "empty plaster must compose Claim #1 before the brief URL"
  grep -q 'OccupiedBriefWrite' src/app/outbid-form.tsx \
    || fail "occupied claim must keep brief fields on the rail with Outbid"
  grep -q 'Empty plaster: Brief URL is a later write after Claim #1 / Outbid' src/app/board.css \
    || fail "empty CSS must name the brief URL as a later write after Claim #1"
  grep -Fq '.wall-stage.wall-empty[data-occupied="false"] .paste-rail.empty-claim-first[data-empty-claim-first] .brief-identity[data-later-write]' src/app/board.css \
    || fail "empty CSS must compose later-write identity off the claim rail"
  grep -Fq '.wall-stage.wall-empty[data-occupied="false"] .paste-rail.empty-claim-first[data-empty-claim-first] .later-write-label' src/app/board.css \
    || fail "empty CSS must label the later brief URL write"
  grep -Fq '.wall-stage.wall-empty[data-occupied="false"] .paste-rail.empty-claim-first[data-empty-claim-first] .outbid[data-first-click="claim"]' src/app/board.css \
    || fail "empty CSS must make Claim #1 Outbid the first click"
  grep -Fq '.wall-occupied .paste-rail .brief-identity[data-later-write]' src/app/board.css \
    || fail "occupied week must hide empty later-write identity"
  grep -Fq '.wall-occupied .paste-rail [data-first-click="claim"]' src/app/board.css \
    || fail "occupied week must hide empty Claim #1 first-click"
  grep -q 'Then the brief URL' tests/board.test.ts \
    || fail "board tests must name the later brief URL write"
  grep -q 'data-first-click="claim"' tests/board.test.ts \
    || fail "board tests must stamp empty Claim #1 as the first click"
  grep -q 'Claim #1' src/app/outbid-form.tsx \
    || fail "empty later-write cut must keep Claim #1"
  grep -q 'plaster is blank' src/app/outbid-form.tsx \
    || fail "empty later-write cut must keep blank plaster"
  grep -q 'Open brief' src/lib/board-markup.tsx \
    || fail "empty later-write cut must keep occupied Open brief"
  grep -q 'Post a brief' src/lib/board-markup.tsx \
    || fail "empty later-write cut must keep occupied Post a brief"
  grep -q 'data-first-click="open"' src/lib/board-markup.tsx \
    || fail "empty later-write cut must keep occupied Open brief the first click"
  grep -q 'data-prize=' src/lib/board-markup.tsx \
    || fail "empty later-write cut must keep occupied Terms as the prize"
  grep -q 'amount-field' src/app/outbid-form.tsx \
    || fail "empty later-write cut must keep the dashed amount"
  grep -q 'className="step"' src/app/outbid-form.tsx \
    || fail "empty later-write cut must keep ± steppers"
  grep -q 'Outbid' src/app/outbid-form.tsx \
    || fail "empty later-write cut must keep Outbid"
  grep -q 'name="brand"' src/app/outbid-form.tsx \
    || fail "empty later-write cut must keep Brand"
  grep -q 'name="terms"' src/app/outbid-form.tsx \
    || fail "empty later-write cut must keep Terms"
  grep -q 'name="briefUrl"' src/app/outbid-form.tsx \
    || fail "empty later-write cut must keep Brief URL"
  grep -q 'className="plaster"' src/lib/board-markup.tsx \
    || fail "empty later-write cut must not rebuild the plaster wall"
  if grep -qE 'data-post-after-open-seven|data-open-after-post-six-stamp' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx src/lib/board-markup.tsx; then
    fail "empty later-write must not add another numbered hop stamp"
  fi
  if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx; then
    fail "empty later-write must not rebuild the plaster wall into a long form"
  fi
  if awk '/function OccupiedBriefWrite/,/function EmptyClaimFirstWrite/' src/app/outbid-form.tsx | grep -q 'data-first-click="claim"'; then
    fail "occupied claim must not stamp empty Claim #1 as the first click"
  fi
  if awk '/function OccupiedBriefWrite/,/function EmptyClaimFirstWrite/' src/app/outbid-form.tsx | grep -q 'Then the brief URL'; then
    fail "occupied claim must not name a later brief URL write"
  fi
  if awk '/function OccupiedBriefWrite/,/function EmptyClaimFirstWrite/' src/app/outbid-form.tsx | grep -q 'data-later-write'; then
    fail "occupied brief fields must stay on the claim rail with Outbid"
  fi
  if ! awk '
    /function EmptyClaimFirstWrite/ { empty=NR }
    empty && /data-first-click="claim"/ { click=NR }
    empty && /Then the brief URL/ { label=NR }
    empty && /BriefIdentityFields/ { ident=NR }
    END { exit !(empty && click && label && ident && empty < click && click < label && label < ident) }
  ' src/app/outbid-form.tsx; then
    fail "empty Claim #1 / Outbid must precede the later brief URL write"
  fi
  if ! awk '
    /function OccupiedBriefWrite/ { occ=NR }
    occ && /BriefIdentityFields/ && !fields { fields=NR }
    occ && /Outbid/ && !row { row=NR }
    /function EmptyClaimFirstWrite/ { empty=NR }
    END { exit !(occ && fields && row && empty && occ < fields && fields < row && row < empty) }
  ' src/app/outbid-form.tsx; then
    fail "occupied claim must keep brief fields before Outbid"
  fi
  python3 - src/app/board.css src/app/outbid-form.tsx <<'PY' || fail "empty later-write must recede after Claim #1 / Outbid without recolor or a new hop"
import re
import sys
css = open(sys.argv[1], encoding="utf-8").read()
form = open(sys.argv[2], encoding="utf-8").read()
marker = "Empty plaster: Brief URL is a later write after Claim #1 / Outbid"
if marker not in css:
    raise SystemExit(1)
later = css.split(marker, 1)[1].split("End empty-plaster later-write", 1)[0]
if ".brief-identity[data-later-write]" not in later:
    raise SystemExit(1)
if "border-top: 1px dashed var(--line)" not in later:
    raise SystemExit(1)
if "background:" in later or "var(--bid-ink)" in later:
    raise SystemExit(1)
if "data-post-after-open-seven" in later or "data-open-after-post-six-stamp" in later:
    raise SystemExit(1)
click = re.search(
    r"\.wall-stage\.wall-empty\[data-occupied=\"false\"\] \.paste-rail\.empty-claim-first\[data-empty-claim-first\] \.outbid\[data-first-click=\"claim\"\]\s*\{[^}]*\}",
    css,
    re.S,
)
if not click or "min-height: 2.75rem" not in click.group(0):
    raise SystemExit(1)
if "background:" in click.group(0):
    raise SystemExit(1)
empty = form.split("function EmptyClaimFirstWrite", 1)[-1].split("export function OutbidForm", 1)[0]
occupied = form.split("function OccupiedBriefWrite", 1)[-1].split("function EmptyClaimFirstWrite", 1)[0]
if empty.find("Outbid") < 0 or empty.find("data-later-write") < empty.find("Outbid"):
    raise SystemExit(1)
if empty.find("BriefIdentityFields") < empty.find("Then the brief URL"):
    raise SystemExit(1)
if occupied.find("BriefIdentityFields") < 0 or occupied.find("Outbid") < occupied.find("BriefIdentityFields"):
    raise SystemExit(1)
if 'data-first-click="claim"' in occupied or "Then the brief URL" in occupied:
    raise SystemExit(1)
PY
  if ! awk '
    /wall-occupied \.card-lead \.terms\.prize-before-price \.terms-copy/ { prize=NR }
    /wall-occupied \.card \.brief-url\[data-first-click="open"\]/ { open=NR }
    /wall-occupied \.cards-later \.brief-url\.later-open\[data-later-open\]/ { later_open=NR }
    /Empty plaster: Brief URL is a later write after Claim #1 \/ Outbid/ { later=NR }
    END { exit !(prize && open && later_open && later && prize < open && open < later_open && later_open < later) }
  ' src/app/board.css; then
    fail "empty later-write CSS must sit after occupied prize / Open / later Open"
  fi
  echo "== UX: occupied later flyers stay quieter than #1 Terms — prize stays first =="
  grep -q 'function OccupiedLaterFlyer' src/lib/board-markup.tsx \
    || fail "later ranks must use OccupiedLaterFlyer, not the #1 prize flyer"
  grep -q 'function OccupiedLeadFlyer' src/lib/board-markup.tsx \
    || fail "occupied #1 must keep OccupiedLeadFlyer"
  grep -q 'className="card later-flyer"' src/lib/board-markup.tsx \
    || fail "later ranks must use later-flyer anatomy"
  grep -q 'data-later-flyer' src/lib/board-markup.tsx \
    || fail "later ranks must stamp data-later-flyer"
  grep -q 'data-later-pack' src/lib/board-markup.tsx \
    || fail "later ranks must group in a later pack"
  grep -q 'These flyers are not this week’s #1 prize' src/lib/board-markup.tsx \
    || fail "later pack must say later flyers are not the #1 prize"
  grep -q 'later-terms-kicker' src/lib/board-markup.tsx \
    || fail "later ranks must keep Terms without #1 prize chrome"
  grep -q 'later-terms-copy' src/lib/board-markup.tsx \
    || fail "later ranks must keep quieter terms copy"
  grep -q '{lead ? hop : null}' src/lib/board-markup.tsx \
    || fail "later-rank cut must keep #1 Open after Terms"
  grep -q '{lead ? null : hop}' src/lib/board-markup.tsx \
    || fail "later Open must stay after \$bid in cards-later"
  grep -q 'data-prize=""' src/lib/board-markup.tsx \
    || fail "later-rank cut must keep occupied Terms as the prize"
  grep -q 'data-first-click="open"' src/lib/board-markup.tsx \
    || fail "later-rank cut must keep #1 Open the first occupied click"
  grep -q 'Claim #1' src/app/outbid-form.tsx \
    || fail "later-rank cut must keep Claim #1"
  grep -q 'plaster is blank' src/app/outbid-form.tsx \
    || fail "later-rank cut must keep blank plaster"
  grep -q 'Open brief' src/lib/board-markup.tsx \
    || fail "later-rank cut must keep Open brief"
  grep -q 'Post a brief' src/lib/board-markup.tsx \
    || fail "later-rank cut must keep Post a brief"
  grep -q 'amount-field' src/app/outbid-form.tsx \
    || fail "later-rank cut must keep the dashed amount"
  grep -q 'className="step"' src/app/outbid-form.tsx \
    || fail "later-rank cut must keep ± steppers"
  grep -q 'Outbid' src/app/outbid-form.tsx \
    || fail "later-rank cut must keep Outbid"
  grep -q 'className="plaster"' src/lib/board-markup.tsx \
    || fail "later-rank cut must not rebuild the plaster wall"
  grep -qF '.wall-occupied .later-pack[data-later-pack]' src/app/board.css \
    || fail "CSS must group later ranks in a pack after #1"
  grep -qF '.wall-occupied .cards-lead[data-rolling-week]' src/app/board.css \
    || fail "CSS must compose occupied rolling last-7-days on the lead flyers"
  grep -qF '.wall-occupied .cards-later .card.later-flyer[data-later-flyer]' src/app/board.css \
    || fail "CSS must compose later ranks as hopper slips"
  grep -qF '.wall-occupied .cards-later .card.later-flyer[data-later-flyer] .later-terms-copy' src/app/board.css \
    || fail "CSS must keep later terms quieter than #1 Terms"
  grep -qF '.wall-occupied .cards-later .brief-url.later-open[data-later-open]' src/app/board.css \
    || fail "CSS must keep later Open after \$bid in cards-later"
  grep -qF '.wall-stage.wall-empty[data-occupied="false"] .later-pack' src/app/board.css \
    || fail "empty plaster CSS must keep later-pack off Claim #1"
  grep -qF '.wall-stage.wall-empty[data-occupied="false"] .later-flyer' src/app/board.css \
    || fail "empty plaster CSS must keep later-flyer off Claim #1"
  grep -qF '.wall-stage.wall-empty[data-occupied="false"] [data-later-flyer]' src/app/board.css \
    || fail "empty plaster CSS must keep later-flyer stamps off Claim #1"
  grep -qF '.wall-stage.wall-empty[data-occupied="false"] [data-rolling-week]' src/app/board.css \
    || fail "empty plaster CSS must keep rolling-week stamps off Claim #1"
  if grep -qE 'data-post-after-open-seven|data-open-after-post-six-stamp' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx src/lib/board-markup.tsx; then
    fail "later-rank quiet must not add another numbered hop stamp"
  fi
  if grep -qE 'data-later-quiet|data-later-rank-quiet|open-later-rank' src/lib/board-markup.tsx src/app/board.css src/app/outbid-form.tsx; then
    fail "do not stamp-only mute later flyers"
  fi
  grep -q 'data-rolling-week=""' src/lib/board-markup.tsx \
    || fail "occupied flyers must stamp the rolling last-7-days window"
  grep -q 'Rolling last 7 days. Not Monday 00:00 UTC.' src/lib/board-markup.tsx \
    || fail "occupied flyers must name the rolling last-7-days window"
  if awk '/function EmptyClaimFirstWrite/,/export function OutbidForm/' src/app/outbid-form.tsx | grep -q 'data-rolling-week'; then
    fail "empty plaster must not stamp the rolling week window"
  fi
  if grep -Eqi '24h lock|lock on #1' src/lib/board-markup.tsx src/app/outbid-form.tsx src/app/board.css; then
    fail "rolling week is not a 24h lock on #1"
  fi
  if grep -nE 'open-later-rank|data-later-rank[^-]' src/lib/board-markup.tsx src/app/board.css >/dev/null
  then
    fail "do not stamp open-later-rank; compose later-rank Open as a quieter hop"
  fi
  if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx; then
    fail "later-rank quiet must not rebuild the plaster wall into a long form"
  fi
  if awk '/function OccupiedLaterFlyer/,/export function OccupiedFlyers/' src/lib/board-markup.tsx | grep -q 'data-prize'; then
    fail "later ranks must not wear the #1 prize stamp"
  fi
  if awk '/function OccupiedLaterFlyer/,/export function OccupiedFlyers/' src/lib/board-markup.tsx | grep -q 'terms-label'; then
    fail "later ranks must not reuse #1 Terms prize chrome"
  fi
  if awk '/function OccupiedLaterFlyer/,/export function OccupiedFlyers/' src/lib/board-markup.tsx | grep -q 'card-lead'; then
    fail "later ranks must not reuse #1 lead flyer chrome"
  fi
  if awk '/function OccupiedLaterFlyer/,/export function OccupiedFlyers/' src/lib/board-markup.tsx | grep -q 'data-first-click="open"'; then
    fail "later ranks must not steal the first occupied click"
  fi
  python3 - src/app/board.css src/lib/board-markup.tsx <<'PY' || fail "later flyers must stay quieter than #1 Terms without recolor or a new hop"
import re
import sys
css = open(sys.argv[1], encoding="utf-8").read()
markup = open(sys.argv[2], encoding="utf-8").read()

def size(pattern):
    match = re.search(pattern, css, re.S)
    if not match:
        raise SystemExit(1)
    return float(match.group(1))

prize = size(r"\.wall-occupied \.card-lead \.terms\.prize-before-price \.terms-copy\s*\{[^}]*font-size:\s*([\d.]+)rem")
later_terms = size(r"\.wall-occupied \.cards-later \.card\.later-flyer\[data-later-flyer\] \.later-terms-copy\s*\{[^}]*font-size:\s*([\d.]+)rem")
later_brand = size(r"\.wall-occupied \.cards-later \.card\.later-flyer\[data-later-flyer\] \.later-brand\s*\{[^}]*font-size:\s*([\d.]+)rem")
later_open = size(r"\.wall-occupied \.cards-later \.brief-url\.later-open\[data-later-open\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
lead_open = size(r"\.wall-occupied \.card \.brief-url\.open-after-post-five\s*\{[^}]*font-size:\s*([\d.]+)rem")
if not (prize > later_terms and prize > later_brand and lead_open > later_open):
    raise SystemExit(1)
pack = re.search(r"\.wall-occupied \.later-pack\[data-later-pack\]\s*\{[^}]*\}", css, re.S)
slip = re.search(r"\.wall-occupied \.cards-later \.card\.later-flyer\[data-later-flyer\]\s*\{[^}]*\}", css, re.S)
if not pack or "border-top: 1px dashed var(--line)" not in pack.group(0):
    raise SystemExit(1)
if not slip or "box-shadow: none" not in slip.group(0) or "border: 1px dashed var(--line)" not in slip.group(0):
    raise SystemExit(1)
if "var(--bid-ink)" in slip.group(0) or "background:" in pack.group(0):
    raise SystemExit(1)
later_fn = markup.split("function OccupiedLaterFlyer", 1)[-1].split("export function OccupiedFlyers", 1)[0]
if "data-prize" in later_fn or "terms-label" in later_fn or "card-lead" in later_fn:
    raise SystemExit(1)
if 'data-first-click="open"' in later_fn or "prize-before-price" in later_fn:
    raise SystemExit(1)
if "data-post-after-open-seven" in markup or "data-open-after-post-six-stamp" in markup:
    raise SystemExit(1)
if "data-later-quiet" in markup or "data-later-rank-quiet" in markup:
    raise SystemExit(1)
PY
  if ! awk '
    /wall-occupied \.card-lead \.terms\.prize-before-price \.terms-copy/ { prize=NR }
    /wall-occupied \.card \.brief-url\[data-first-click="open"\]/ { open=NR }
    /wall-occupied \.later-pack\[data-later-pack\] \{/ { pack=NR }
    /cards-later \.card\.later-flyer\[data-later-flyer\] \{/ { later=NR }
    /wall-occupied \.cards-lead\[data-rolling-week\]/ { rolling=NR }
    /Empty plaster: Brief URL is a later write after Claim #1 \/ Outbid/ { empty=NR }
    END { exit !(prize && open && pack && later && rolling && empty && prize < open && open < pack && pack < later && later < rolling && rolling < empty) }
  ' src/app/board.css; then
    fail "later-rank CSS must sit after occupied prize / Open and before empty later-write"
  fi
  grep -q 'occupied later flyers stay quieter than #1 Terms' tests/board.test.ts \
    || fail "board tests must cover quieter later flyers than #1 Terms"
  grep -q 'occupied week window is rolling last-7-days' tests/board.test.ts \
    || fail "board tests must cover occupied rolling last-7-days window"
  grep -q 'These flyers are not this week’s #1 prize' tests/board.test.ts \
    || fail "board tests must name later flyers as not the #1 prize"
  grep -q 'data-later-flyer' tests/board.test.ts \
    || fail "board tests must stamp later flyers"
  grep -q 'older' tests/rank.test.ts || fail "rank tests missing older-wins-ties"
  if grep -qiE '[0-9][0-9,]*[[:space:]]*(followers|subscribers)|avg views|estimated reach|\bcpm\b' \
    src/lib/board-markup.tsx src/app/outbid-form.tsx src/lib/rank.ts src/app/board.css \
    src/lib/confirm-brief.ts
  then
    fail "board UI must not render follower or reach fields"
  fi

  echo "== Polar checkout + fixture =="
  for f in \
    src/lib/polar.ts \
    src/app/api/checkout/route.ts \
    src/app/api/webhooks/polar/route.ts \
    src/app/checkout/return/page.tsx \
    tests/checkout.test.ts \
    .env.example
  do
    [[ -f "$f" ]] || fail "missing $f"
  done
  grep -q 'export class FakePolarPort' src/lib/polar.ts \
    || fail "polar.ts must export FakePolarPort"
  grep -q 'export class LivePolarPort' src/lib/polar.ts \
    || fail "polar.ts must export LivePolarPort"
  grep -q 'export function polarApiBase' src/lib/polar.ts \
    || fail "polar.ts must export polarApiBase"
  grep -q 'POLAR_API_BASE' src/lib/polar.ts \
    || fail "polar.ts must honor POLAR_API_BASE"
  grep -q 'https://api.polar.sh' src/lib/polar.ts \
    || fail "polar.ts must default Polar API to production"
  grep -q 'POLAR_API_BASE' .env.example \
    || fail ".env.example missing POLAR_API_BASE"
  grep -q 'POLAR_ACCESS_TOKEN' .env.example \
    || fail ".env.example missing POLAR_ACCESS_TOKEN"
  grep -q 'POLAR_WEBHOOK_SECRET' .env.example \
    || fail ".env.example missing POLAR_WEBHOOK_SECRET"
  grep -q 'POLAR_SUCCESS_URL' .env.example \
    || fail ".env.example missing POLAR_SUCCESS_URL"
  grep -q 'POLAR_PRODUCT_ID' .env.example \
    || fail ".env.example missing POLAR_PRODUCT_ID"
  grep -q 'You' src/app/checkout/return/page.tsx \
    || fail "return page must show paid copy"
  grep -q 'No rank change' src/app/checkout/return/page.tsx \
    || fail "return page must show canceled copy"
  grep -q 'unpaid' tests/checkout.test.ts \
    || fail "checkout tests must cover unpaid sessions"
  grep -q 'FakePolarPort' tests/checkout.test.ts \
    || fail "checkout tests must use FakePolarPort"
  if grep -nE 'fetch\(|polar\.sh|api\.polar' src/app/api/checkout/route.ts \
    src/app/api/webhooks/polar/route.ts >/dev/null
  then
    fail "checkout/webhook routes must not call Polar over the network"
  fi
  [[ -z "${POLAR_LIVE:-}" ]] || fail "POLAR_LIVE must stay unset in test.sh"
  [[ -z "${POLAR_ACCESS_TOKEN:-}" ]] || fail "POLAR_ACCESS_TOKEN must stay unset"
  [[ -z "${POLAR_WEBHOOK_SECRET:-}" ]] || fail "POLAR_WEBHOOK_SECRET must stay unset"

  echo "== raise-bid + difference =="
  grep -q 'export function raise' src/lib/rank.ts \
    || fail "rank.ts missing raise"
  grep -q 'export function quoteCheckout' src/lib/rank.ts \
    || fail "rank.ts missing quoteCheckout"
  grep -q 'chargeUsd' src/lib/rank.ts \
    || fail "rank.ts must charge new − current on raise"
  grep -q 'planCheckout' src/lib/polar.ts src/app/api/checkout/route.ts \
    || fail "checkout raise path missing planCheckout"
  grep -q 'kind === "raise"' src/lib/polar.ts \
    || fail "checkout must apply a raise after payment"
  grep -q 'raise pays difference' tests/rank.test.ts \
    || fail "rank tests must cover raise pays difference"
  grep -q 'cannot steal #1' tests/rank.test.ts \
    || fail "rank tests must cover steal-by-difference"
  grep -q 'same brief URL raise' tests/checkout.test.ts \
    || fail "checkout tests must cover same-URL raise"
  grep -q 'raise_too_small' tests/checkout.test.ts \
    || fail "checkout tests must reject a same-or-lower raise"
  if grep -nE 'fetch\(|polar\.sh|api\.polar' src/app/api/checkout/route.ts \
    src/app/api/webhooks/polar/route.ts >/dev/null
  then
    fail "raise checkout must stay offline in routes"
  fi
  [[ -z "${POLAR_LIVE:-}" ]] || fail "POLAR_LIVE must stay unset in test.sh"

  echo "== about, rules, URL hygiene =="
  for f in \
    src/app/about/page.tsx \
    src/app/rules/page.tsx \
    src/lib/urls.ts \
    tests/urls.test.ts
  do
    [[ -f "$f" ]] || fail "missing $f"
  done
  grep -q 'export function canonicalizeBriefUrl' src/lib/urls.ts \
    || fail "urls.ts must export canonicalizeBriefUrl"
  grep -q 'utm_' src/lib/urls.ts || fail "urls.ts must strip utm_*"
  grep -q 'fbclid' src/lib/urls.ts || fail "urls.ts must strip fbclid"
  grep -q 'https' src/lib/urls.ts || fail "urls.ts must require https"
  grep -q 'bit.ly' src/lib/urls.ts || fail "urls.ts must reject bit.ly"
  grep -q 'canonicalizeBriefUrl' src/lib/polar.ts \
    || fail "checkout must apply URL hygiene before persist"
  grep -q 'no ads' src/app/about/page.tsx || fail "about must state no ads"
  grep -q 'no API keys' src/app/about/page.tsx || fail "about must state no API keys"
  grep -q 'no revenue share' src/app/about/page.tsx \
    || fail "about must state no revenue share"
  grep -q 'Rank is the bid' src/app/about/page.tsx \
    || fail "about must state rank is the bid"
  grep -q 'not affiliated' src/app/about/page.tsx \
    || fail "about must state independence from platforms"
  grep -q 'creator-brief-wall' src/app/about/page.tsx \
    || fail "about must name the creator-brief-wall vertical"
  grep -q '\$5' src/app/rules/page.tsx || fail "rules must state min \$5"
  grep -q 'Rank is the bid' src/app/rules/page.tsx \
    || fail "rules must state rank is the bid"
  grep -q 'Older wins ties' src/app/rules/page.tsx \
    || fail "rules must state older wins ties"
  grep -q 'Raise pays difference' src/app/rules/page.tsx \
    || fail "rules must state raise pays difference"
  grep -q 'Monday 00:00' src/app/rules/page.tsx \
    || fail "rules must state weekly UTC reset"
  grep -q 'Rolling last 7 days. Not Monday 00:00 UTC.' src/app/rules/page.tsx \
    || fail "rules must name the rolling last-7-days window"
  grep -q 'NSFW' src/app/rules/page.tsx || fail "rules must document NSFW rejects"
  grep -q 'Telegram' src/app/rules/page.tsx \
    || fail "rules must document chat-link rejects"
  grep -q 'utm_' tests/urls.test.ts || fail "url tests must strip tracking query"
  grep -q 't.me' tests/urls.test.ts || fail "url tests must reject Telegram"
  grep -q 'onlyfans' tests/urls.test.ts || fail "url tests must reject NSFW"
  grep -q 'bit.ly' tests/urls.test.ts || fail "url tests must reject shorteners"
  if grep -nE '[^a-zA-Z_]fetch\(' src/lib/urls.ts >/dev/null; then
    fail "urls.ts must not call global fetch (tests stay offline)"
  fi

  echo "== weekly reset + public brief-URL clicks =="
  for f in \
    src/lib/week.ts \
    src/lib/clicks.ts \
    src/lib/confirm-brief.ts \
    src/app/r/\[id\]/route.ts \
    tests/week.test.ts \
    tests/board.test.ts
  do
    [[ -f "$f" ]] || fail "missing $f"
  done
  grep -q 'export function utcWeekId' src/lib/week.ts \
    || fail "week.ts must export utcWeekId"
  grep -q 'Monday 00:00' src/lib/week.ts \
    || fail "week.ts must document Monday 00:00 UTC reset"
  grep -q 'ROLLING_WEEK_MS' src/lib/week.ts \
    || fail "week.ts must export the rolling last-7-days window"
  grep -q 'export function bidInRollingWeek' src/lib/week.ts \
    || fail "week.ts must export bidInRollingWeek"
  grep -q 'export function rollingWeekStart' src/lib/week.ts \
    || fail "week.ts must export rollingWeekStart"
  grep -q 'created_at >=' src/lib/week.ts \
    || fail "live board must filter by rolling created_at, not week_id delete"
  grep -q 'WEEK_NOW' src/lib/week.ts \
    || fail "week.ts must honor WEEK_NOW as the operator/test clock"
  grep -q 'currentWeekUtc' src/app/page.tsx \
    || fail "page.tsx must use currentWeekUtc"
  grep -q 'listLiveBoard' src/app/page.tsx \
    || fail "page.tsx must load the current week only"
  grep -q 'findLiveListingByBrief' src/lib/polar.ts \
    || fail "checkout raise must use the rolling live listing"
  grep -q 'export function incrementPublicClick' src/lib/clicks.ts \
    || fail "clicks.ts must export incrementPublicClick"
  grep -q 'export function getPublicListing' src/lib/clicks.ts \
    || fail "clicks.ts must export getPublicListing"
  grep -q 'outboundBriefUrl' src/lib/clicks.ts \
    || fail "clicks must redirect to the canonical brief URL"
  grep -qE 'export (async )?function GET' src/app/r/\[id\]/route.ts \
    || fail "/r/:id must handle GET"
  grep -qE 'export (async )?function POST' src/app/r/\[id\]/route.ts \
    || fail "/r/:id must handle POST"
  grep -q '302' src/app/r/\[id\]/route.ts \
    || fail "/r/:id must 302"
  grep -q 'confirmBriefHtml' src/app/r/\[id\]/route.ts \
    || fail "GET /r/:id must render the confirm sheet"
  grep -q 'incrementPublicClick' src/app/r/\[id\]/route.ts \
    || fail "POST /r/:id must increment on the confirmed leave"
  grep -q 'data-confirm-brief' src/lib/confirm-brief.ts \
    || fail "confirm sheet must mark data-confirm-brief"
  grep -q 'data-confirm-before-leave' src/lib/confirm-brief.ts \
    || fail "confirm sheet must stamp confirm-before-leave"
  grep -q 'data-confirm-uncounted' src/lib/confirm-brief.ts \
    || fail "confirm sheet must mark the uncounted GET preview"
  grep -q 'Opening this flyer has not counted a hop' src/lib/confirm-brief.ts \
    || fail "confirm sheet must say opening has not counted a hop"
  grep -q 'Leave to the brief' src/lib/confirm-brief.ts \
    || fail "confirm sheet must say Leave to the brief"
  grep -q 'method="post"' src/lib/confirm-brief.ts \
    || fail "confirm leave must POST /r/:id"
  grep -q 'public hops — not reach' src/lib/confirm-brief.ts \
    || fail "confirm sheet must not dress clicks as reach"
  grep -q 'getPublicListing' src/app/r/\[id\]/route.ts \
    || fail "GET /r/:id must load via getPublicListing"
  awk '/export async function GET/,/export async function POST/' src/app/r/\[id\]/route.ts \
    | grep -q 'incrementPublicClick' \
    && fail "GET /r/:id must not call incrementPublicClick"
  awk '/export async function POST/,0' src/app/r/\[id\]/route.ts \
    | grep -q 'incrementPublicClick' \
    || fail "POST /r/:id must call incrementPublicClick"
  grep -q 'href={`/r/${listing.id}`}' src/lib/board-markup.tsx \
    || fail "Open brief must go through /r/:id"
  if grep -nE '[^a-zA-Z_]fetch\(' src/lib/confirm-brief.ts >/dev/null; then
    fail "confirm sheet must stay offline (no fetch)"
  fi
  grep -q 'Monday 00:00 UTC rolls weekId' tests/week.test.ts \
    || fail "week tests must cover Monday 00:00 UTC roll"
  grep -q 'previous week rows are absent from the live board' tests/week.test.ts \
    || fail "week tests must hide previous week rows"
  grep -Fq 'rolling last-7-days window is 7 * 24h' tests/week.test.ts \
    || fail "week tests must cover rolling last-7-days length"
  grep -q 'Monday 00:00 UTC does not drop a bid still inside the rolling week' tests/week.test.ts \
    || fail "week tests must keep a Sunday pay across Monday midnight"
  grep -q 'live board keeps a Sunday pay across Monday 00:00 UTC' tests/week.test.ts \
    || fail "week tests must keep Sunday pay on the live board across Monday"
  grep -q 'incrementPublicClick' tests/board.test.ts \
    || fail "board tests must cover public clicks"
  grep -q 'GET confirm sheet puts terms and the brief URL before the leave hop' tests/board.test.ts \
    || fail "board tests must cover the GET confirm sheet"
  grep -q 'GET confirm-before-leave does not increment clicks' tests/board.test.ts \
    || fail "board tests must cover GET confirm-before-leave"
  if grep -nE '[^a-zA-Z_]fetch\(' src/lib/week.ts src/lib/clicks.ts \
    src/lib/confirm-brief.ts src/app/r/\[id\]/route.ts >/dev/null
  then
    fail "week/clicks must stay offline (no fetch)"
  fi
  [[ -z "${POLAR_LIVE:-}" ]] || fail "POLAR_LIVE must stay unset in test.sh"

  echo "== GET /healthz and empty board =="
  port="${TEST_PORT:-34567}"
  log_file="$(mktemp "${TMPDIR:-/tmp}/cbw-next.XXXXXX.log")"
  db_file="$(mktemp "${TMPDIR:-/tmp}/cbw.XXXXXX.sqlite")"
  server_pid=""
  kill_tree() {
    local pid="${1:-}"
    local child
    [[ -n "${pid}" ]] || return 0
    for child in $(pgrep -P "${pid}" 2>/dev/null || true); do
      kill_tree "${child}"
    done
    kill "${pid}" 2>/dev/null || true
  }

  listeners_on_port() {
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null \
      || fuser "${port}/tcp" 2>/dev/null \
      || true
  }

  stop_http() {
    local pid="${1:-}"
    # `npx next start` is a parent; the listener is often a grandchild.
    # Killing only the parent leaves last week's board still bound to the port.
    if [[ -n "${pid}" ]]; then
      kill_tree "${pid}"
      wait "${pid}" 2>/dev/null || true
      kill_tree "${pid}"
      kill -9 "${pid}" 2>/dev/null || true
    fi
    local leftover
    leftover="$(listeners_on_port)"
    if [[ -n "${leftover}" ]]; then
      kill -9 ${leftover} 2>/dev/null || true
    fi
    if command -v fuser >/dev/null 2>&1; then
      fuser -k "${port}/tcp" >/dev/null 2>&1 || true
    fi
    local _
    for _ in $(seq 1 50); do
      if ! curl -sf --max-time 1 "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then
        leftover="$(listeners_on_port)"
        [[ -z "${leftover}" ]] && return 0
      fi
      leftover="$(listeners_on_port)"
      if [[ -n "${leftover}" ]]; then
        kill -9 ${leftover} 2>/dev/null || true
      fi
      sleep 0.1
    done
  }
  cleanup_http() {
    stop_http "${server_pid}"
    server_pid=""
    rm -f "${log_file}" "${db_file}" "${db_file}-wal" "${db_file}-shm"
  }
  trap cleanup_http EXIT

  export DATABASE_PATH="${db_file}"
  export NEXT_TELEMETRY_DISABLED=1
  npx next build
  PORT="${port}" node ./node_modules/next/dist/bin/next start --port "${port}" --hostname 127.0.0.1 \
    >"${log_file}" 2>&1 &
  server_pid=$!

  ready=0
  for _ in $(seq 1 60); do
    if ! kill -0 "${server_pid}" 2>/dev/null; then
      fail "next start exited early: $(cat "${log_file}")"
    fi
    if curl -sf "http://127.0.0.1:${port}/healthz" >/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  [[ "${ready}" -eq 1 ]] || fail "GET /healthz did not become ready: $(cat "${log_file}")"

  health_body="$(mktemp)"
  health_code="$(curl -sS -o "${health_body}" -w '%{http_code}' "http://127.0.0.1:${port}/healthz")"
  [[ "${health_code}" == "200" ]] || fail "GET /healthz expected 200 got ${health_code}"
  grep -q '"ok":true' "${health_body}" || fail "GET /healthz body must be {\"ok\":true}"

  home_body="$(mktemp)"
  home_code="$(curl -sS -o "${home_body}" -w '%{http_code}' "http://127.0.0.1:${port}/")"
  [[ "${home_code}" == "200" ]] || fail "GET / expected 200 got ${home_code}"
  grep -q 'data-empty-week="true"' "${home_body}" \
    || fail "GET / must render the honest empty-week state"
  grep -qi 'board is empty' "${home_body}" \
    || fail "GET / must say this week’s board is empty"
  grep -qi 'plaster is blank' "${home_body}" \
    || fail "GET / empty week must read as blank plaster"
  grep -q 'data-claim-amount="5"' "${home_body}" \
    || fail "empty week claim must default to \$5 for #1"
  grep -qi 'blank plaster' "${home_body}" \
    || fail "empty week claim must say blank plaster is the first flyer"
  grep -q 'data-occupied="false"' "${home_body}" \
    || fail "empty week must mark the wall unoccupied"
  grep -q 'data-empty-claim-first=""' "${home_body}" \
    || fail "empty week must stamp Claim #1 first"
  grep -q 'class="paste-rail empty-claim-first"' "${home_body}" \
    || fail "empty week claim must use the empty-claim-first class"
  grep -q 'class="wall-stage wall-empty"' "${home_body}" \
    || fail "empty week must compose the empty wall stage"
  if grep -q 'wall-occupied' "${home_body}"; then
    fail "empty week must not use flyer-first occupied layout"
  fi
  if grep -q 'class="flyers"' "${home_body}"; then
    fail "empty plaster has no flyer list"
  fi
  if grep -qE 'empty-claim-plaster|data-empty-claim-plaster' "${home_body}"; then
    fail "empty plaster must stay Claim #1 by composition, not an extra stamp"
  fi
  if grep -q 'data-post-brief' "${home_body}"; then
    fail "empty week must not show a Post a brief hop"
  fi
  if grep -q 'data-post-after-open' "${home_body}"; then
    fail "empty plaster has no flyer; do not show Post a brief after Open brief"
  fi
  if grep -q 'data-post-after-open-first' "${home_body}"; then
    fail "empty plaster has no flyer; do not concentrate Post a brief after Open"
  fi
  if grep -q 'data-first-write="post"' "${home_body}"; then
    fail "empty plaster has no flyer; do not stamp first-write Post a brief"
  fi
  if grep -q 'data-post-after-open-two' "${home_body}"; then
    fail "empty plaster has no flyer; do not concentrate Post a brief after Open is re-concentrated"
  fi
  if grep -q 'data-post-after-open-three' "${home_body}"; then
    fail "empty plaster has no flyer; do not concentrate Post a brief after Open is re-concentrated again"
  fi
  if grep -q 'data-post-after-open-four' "${home_body}"; then
    fail "empty plaster has no flyer; do not concentrate Post a brief after Open is re-concentrated again under louder Open"
  fi
  if grep -q 'data-post-after-open-five' "${home_body}"; then
    fail "empty plaster has no flyer; do not concentrate Post a brief after Open is re-concentrated again under louder Open brief"
  fi
  if grep -q 'data-post-after-open-six' "${home_body}"; then
    fail "empty plaster has no flyer; do not concentrate Post a brief after Open is re-concentrated again under louder Open brief hop"
  fi
  if grep -qi 'after Open brief' "${home_body}"; then
    fail "empty plaster must not say after Open brief"
  fi
  if grep -q 'data-first-click="open"' "${home_body}"; then
    fail "empty plaster has no flyer; do not mark a first-click Open brief"
  fi
  grep -q 'data-first-click="claim"' "${home_body}" \
    || fail "empty plaster must mark Claim #1 / Outbid as the first click"
  grep -q 'data-later-write=""' "${home_body}" \
    || fail "empty plaster must stamp the brief URL as a later write"
  grep -q 'Then the brief URL' "${home_body}" \
    || fail "empty plaster must name the later brief URL write"
  grep -q 'data-brief-identity=""' "${home_body}" \
    || fail "empty plaster must wrap brand / terms / brief URL as later-write identity"
  if grep -q 'data-open-after-post-first' "${home_body}"; then
    fail "empty plaster has no flyer; do not concentrate Open brief after Post"
  fi
  if grep -q 'data-first-read="open"' "${home_body}"; then
    fail "empty plaster has no flyer; do not stamp first-read Open brief"
  fi
  if grep -q 'data-open-after-post-two-stamp' "${home_body}"; then
    fail "empty plaster has no flyer; do not concentrate Open brief after Post is re-concentrated"
  fi
  if grep -q 'data-open-after-post-three-stamp' "${home_body}"; then
    fail "empty plaster has no flyer; do not concentrate Open brief after Post is re-concentrated again"
  fi
  if grep -q 'data-open-after-post-four-stamp' "${home_body}"; then
    fail "empty plaster has no flyer; do not concentrate Open brief after Post is re-concentrated again under louder Post"
  fi
  if grep -q 'data-open-after-post-five-stamp' "${home_body}"; then
    fail "empty plaster has no flyer; do not concentrate Open brief after Post is re-concentrated again under louder Post a brief"
  fi
  if grep -q 'data-terms=""' "${home_body}"; then
    fail "empty plaster has no flyer; do not show Terms"
  fi
  if grep -q 'class="terms-label"' "${home_body}"; then
    fail "empty plaster must not label Terms on a flyer"
  fi
  if grep -q 'data-prize' "${home_body}"; then
    fail "empty plaster has no flyer; do not mark a Terms prize"
  fi
  if grep -q 'prize-before-price' "${home_body}"; then
    fail "empty plaster has no flyer; do not stamp prize before price"
  fi
  if grep -q 'data-later-fact' "${home_body}"; then
    fail "empty plaster has no flyer; do not stamp \$bid as a later fact"
  fi
  if grep -q 'later-fact' "${home_body}"; then
    fail "empty plaster has no flyer; do not mute a later-fact \$bid"
  fi
  if grep -q 'data-rolling-week' "${home_body}"; then
    fail "empty plaster has no flyer; do not stamp the rolling week window"
  fi
  if grep -qi 'Rolling last 7 days' "${home_body}"; then
    fail "empty plaster must not name the occupied rolling week window"
  fi
  if grep -q 'data-later-open=""' "${home_body}"; then
    fail "empty plaster has no flyer; do not stamp later-rank Open"
  fi
  if grep -q 'class="brief-url later-open"' "${home_body}"; then
    fail "empty plaster has no flyer; do not mute a later-rank Open"
  fi
  if grep -q 'cards-later' "${home_body}"; then
    fail "empty plaster has no later-rank flyer list"
  fi
  if grep -q 'cards-lead' "${home_body}"; then
    fail "empty plaster has no lead flyer list"
  fi
  if grep -q 'class="brief-url later-open"' "${home_body}"; then
    fail "empty plaster has no flyer; do not recede a later-rank Open"
  fi
  if grep -q 'data-open-after-terms' "${home_body}"; then
    fail "empty plaster has no flyer; do not show Open brief after Terms"
  fi
  if grep -qi 'after Terms' "${home_body}"; then
    fail "empty plaster must not say after Terms"
  fi
  if grep -qi 'Post a brief' "${home_body}"; then
    fail "empty week Claim #1 is already first; do not add Post a brief"
  fi
  python3 - "${home_body}" <<'PY' || fail "empty week must keep Claim #1 before blank plaster, then later-write brief URL"
import sys
html = open(sys.argv[1], encoding="utf-8").read()
claim = html.find('id="claim"')
stamp = html.find('data-empty-claim-first=""')
plaster = html.find('data-empty-week="true"')
first = html.find('data-first-click="claim"')
outbid = html.find(">Outbid<")
later = html.find('data-later-write=""')
label = html.find("Then the brief URL")
identity = html.find('data-brief-identity=""')
brand = html.find('name="brand"')
terms = html.find('name="terms"')
url = html.find('name="briefUrl"')
if claim < 0 or stamp < 0 or plaster < 0 or not (claim <= stamp < plaster):
    raise SystemExit(1)
if first < 0 or outbid < 0 or later < 0 or label < 0 or identity < 0:
    raise SystemExit(1)
if not (claim <= stamp < plaster < first < outbid < identity <= later < label < brand < terms < url):
    raise SystemExit(1)
if html.count('data-empty-claim-first=""') != 1:
    raise SystemExit(1)
if html.count('data-empty-week="true"') != 1:
    raise SystemExit(1)
if html.count('data-first-click="claim"') != 1:
    raise SystemExit(1)
if html.count('data-later-write=""') != 1:
    raise SystemExit(1)
if html.count('data-brief-identity=""') != 1:
    raise SystemExit(1)
if 'class="wall-stage wall-empty"' not in html:
    raise SystemExit(1)
if 'class="plaster"' in html or 'class="flyers"' in html:
    raise SystemExit(1)
if "data-post-brief" in html or "data-open-brief" in html or "data-prize" in html:
    raise SystemExit(1)
if "prize-before-price" in html or "data-later-fact" in html or "later-fact" in html:
    raise SystemExit(1)
if "data-rolling-week" in html or "Rolling last 7 days" in html:
    raise SystemExit(1)
if 'data-later-open=""' in html or 'class="brief-url later-open"' in html or "cards-later" in html:
    raise SystemExit(1)
if "cards-lead" in html:
    raise SystemExit(1)
if 'data-terms=""' in html or "terms-label" in html or "data-open-after-terms" in html:
    raise SystemExit(1)
if "Post a brief" in html or "Open brief" in html:
    raise SystemExit(1)
if "empty-claim-plaster" in html or 'class="flyers"' in html:
    raise SystemExit(1)
if 'data-first-click="open"' in html:
    raise SystemExit(1)
PY
  grep -q 'Outbid' src/app/outbid-form.tsx || fail "form missing Outbid"
  if grep -qiE '[0-9][0-9,]*[[:space:]]*(followers|subscribers)|avg views|estimated reach' "${home_body}"; then
    fail "GET / must not invent follower or reach numbers"
  fi

  echo "== GET /about and /rules =="
  about_body="$(mktemp)"
  about_code="$(curl -sS -o "${about_body}" -w '%{http_code}' "http://127.0.0.1:${port}/about")"
  [[ "${about_code}" == "200" ]] || fail "GET /about expected 200 got ${about_code}"
  grep -q 'data-page="about"' "${about_body}" || fail "GET /about missing about page"
  grep -qi 'rank is the bid' "${about_body}" || fail "GET /about must say rank is the bid"
  grep -qi 'no ads' "${about_body}" || fail "GET /about must say no ads"
  grep -qi 'not affiliated' "${about_body}" || fail "GET /about must state independence"
  grep -q 'creator-brief-wall' "${about_body}" \
    || fail "GET /about must name the creator-brief-wall vertical"

  rules_body="$(mktemp)"
  rules_code="$(curl -sS -o "${rules_body}" -w '%{http_code}' "http://127.0.0.1:${port}/rules")"
  [[ "${rules_code}" == "200" ]] || fail "GET /rules expected 200 got ${rules_code}"
  grep -q 'data-page="rules"' "${rules_body}" || fail "GET /rules missing rules page"
  grep -q '\$5' "${rules_body}" || fail "GET /rules must state min \$5"
  grep -qi 'rank is the bid' "${rules_body}" || fail "GET /rules must say rank is the bid"
  grep -qi 'older wins' "${rules_body}" || fail "GET /rules must say older wins ties"
  grep -qi 'difference' "${rules_body}" || fail "GET /rules must say raise pays difference"
  grep -q 'Rolling last 7 days. Not Monday 00:00 UTC.' "${rules_body}" \
    || fail "GET /rules must name the rolling last-7-days window"

  echo "== fixture \$5 appears on the board after completion =="
  unpaid_body="$(mktemp)"
  unpaid_code="$(curl -sS -o "${unpaid_body}" -w '%{http_code}' \
    -X POST "http://127.0.0.1:${port}/checkout" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode 'brand=Ghost' \
    --data-urlencode 'terms=unpaid session' \
    --data-urlencode 'briefUrl=https://example.com/unpaid' \
    --data-urlencode 'bidUsd=5')"
  [[ "${unpaid_code}" == "303" ]] || fail "unpaid POST /checkout expected 303 got ${unpaid_code}"
  unpaid_home="$(mktemp)"
  curl -sS -o "${unpaid_home}" "http://127.0.0.1:${port}/"
  grep -q 'data-empty-week="true"' "${unpaid_home}" \
    || fail "unpaid checkout must not list"
  if grep -q 'Ghost' "${unpaid_home}"; then
    fail "unpaid checkout leaked Ghost onto the board"
  fi

  paid_headers="$(mktemp)"
  paid_code="$(curl -sS -D "${paid_headers}" -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${port}/checkout" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode 'brand=Acme' \
    --data-urlencode 'terms=$800 flat, 1 TikTok' \
    --data-urlencode 'briefUrl=https://example.com/acme' \
    --data-urlencode 'bidUsd=5')"
  [[ "${paid_code}" == "303" ]] || fail "POST /checkout expected 303 got ${paid_code}"
  paid_location="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub("\r",""); print $2}' "${paid_headers}")"
  [[ -n "${paid_location}" ]] || fail "POST /checkout missing Location"
  if [[ "${paid_location}" != http* ]]; then
    paid_location="http://127.0.0.1:${port}${paid_location}"
  fi
  return_body="$(mktemp)"
  return_code="$(curl -sS -o "${return_body}" -w '%{http_code}' "${paid_location}")"
  [[ "${return_code}" == "200" ]] || fail "GET /checkout/return expected 200 got ${return_code}"
  grep -q 'data-return="success"' "${return_body}" \
    || fail "fixture return must be paid success"
  grep -qi 'on the board' "${return_body}" \
    || fail "fixture return must say you're on the board"

  listed_body="$(mktemp)"
  listed_code="$(curl -sS -o "${listed_body}" -w '%{http_code}' "http://127.0.0.1:${port}/")"
  [[ "${listed_code}" == "200" ]] || fail "GET / after pay expected 200 got ${listed_code}"
  grep -q 'Acme' "${listed_body}" || fail "fixture \$5 must appear on the board"
  grep -q '\$5' "${listed_body}" || fail "board must show \$5 after fixture pay"
  grep -q 'data-bid="5"' "${listed_body}" || fail "board card missing data-bid=5"
  grep -q 'data-claim-amount="6"' "${listed_body}" \
    || fail "after a \$5 flyer, claim #1 must default to \$6"
  grep -q 'data-top-bid="5"' "${listed_body}" \
    || fail "occupied claim must show the current top bid"
  grep -q 'Need \$6 to take #1' "${listed_body}" \
    || fail "occupied claim must say \$6 takes #1"
  grep -q 'data-occupied="true"' "${listed_body}" \
    || fail "paid board must mark the wall occupied"
  grep -q 'wall-occupied' "${listed_body}" \
    || fail "paid board must use flyer-first occupied layout"
  if grep -q 'data-empty-claim-first' "${listed_body}"; then
    fail "occupied week must not stamp empty Claim #1 first"
  fi
  if grep -q 'empty-claim-first' "${listed_body}"; then
    fail "occupied week must not use the empty-claim-first class"
  fi
  if grep -q 'data-first-click="claim"' "${listed_body}"; then
    fail "occupied week must not stamp empty Claim #1 as the first click"
  fi
  if grep -q 'data-later-write' "${listed_body}"; then
    fail "occupied week must not leak empty later-write identity"
  fi
  if grep -q 'Then the brief URL' "${listed_body}"; then
    fail "occupied week must not name a later brief URL write"
  fi
  if grep -q 'data-brief-identity' "${listed_body}"; then
    fail "occupied week must keep brand / terms / brief URL on the claim rail"
  fi
  if grep -q 'wall-empty' "${listed_body}"; then
    fail "occupied week must not use the empty wall stage"
  fi
  grep -q 'data-open-brief=""' "${listed_body}" \
    || fail "paid flyer must expose a labeled Open brief hop"
  grep -q 'data-first-click="open"' "${listed_body}" \
    || fail "paid #1 flyer must mark Open brief as the first click"
  grep -q 'data-open-after-post-first=""' "${listed_body}" \
    || fail "paid #1 flyer must concentrate Open brief after Post first write"
  grep -q 'data-first-read="open"' "${listed_body}" \
    || fail "paid #1 flyer must stamp Open brief as the first read"
  grep -q 'data-open-after-post-two-stamp=""' "${listed_body}" \
    || fail "paid #1 flyer must concentrate Open brief after Post is re-concentrated"
  grep -q 'data-open-after-post-three-stamp=""' "${listed_body}" \
    || fail "paid #1 flyer must concentrate Open brief after Post is re-concentrated again"
  grep -q 'data-open-after-post-four-stamp=""' "${listed_body}" \
    || fail "paid #1 flyer must concentrate Open brief after Post is re-concentrated again under louder Post"
  grep -q 'data-open-after-post-five-stamp=""' "${listed_body}" \
    || fail "paid #1 flyer must concentrate Open brief after Post is re-concentrated again under louder Post a brief"
  grep -q 'class="brief-url open-after-terms open-after-post-first open-after-post-two open-after-post-three open-after-post-four open-after-post-five"' "${listed_body}" \
    || fail "paid #1 Open brief hop must stay the re-concentrated flyer hop"
  grep -q 'data-open-after-terms=""' "${listed_body}" \
    || fail "paid flyer must mark Open brief after Terms"
  grep -q 'class="open-label">Open brief' "${listed_body}" \
    || fail "paid flyer must say Open brief on the hop"
  grep -q 'class="open-after-note">after Terms' "${listed_body}" \
    || fail "paid flyer must say Open brief is after Terms"
  grep -q 'data-terms=""' "${listed_body}" \
    || fail "paid flyer must mark Terms as the prize"
  grep -q 'class="terms-label">Terms' "${listed_body}" \
    || fail "paid flyer must say Terms on the prize"
  grep -q 'class="terms-copy">\$800 flat, 1 TikTok' "${listed_body}" \
    || fail "paid flyer must show the terms copy as the prize"
  grep -q 'class="terms prize-before-price"' "${listed_body}" \
    || fail "paid #1 flyer must enlarge Terms before \$bid"
  grep -q 'data-prize=""' "${listed_body}" \
    || fail "paid #1 flyer must mark Terms as the prize"
  grep -q 'data-prize-before-price=""' "${listed_body}" \
    || fail "paid #1 flyer must stamp prize before price"
  grep -q 'class="bid later-fact"' "${listed_body}" \
    || fail "paid #1 flyer must keep \$bid a later fact"
  grep -q 'data-later-fact=""' "${listed_body}" \
    || fail "paid #1 flyer must stamp \$bid as a later fact"
  if grep -q 'data-later-open=""' "${listed_body}"; then
    fail "paid #1-only board must not stamp later-rank Open"
  fi
  if grep -q 'class="brief-url later-open"' "${listed_body}"; then
    fail "paid #1-only board must not mute a later-rank Open"
  fi
  if grep -q 'cards-later' "${listed_body}"; then
    fail "paid #1-only board must not render a later-rank flyer list"
  fi
  python3 - "${listed_body}" <<'PY' || fail "paid flyer must put labeled Terms before Open brief and \$bid"
import re
import sys
html = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r'<li[^>]*class="card[^"]*"[^>]*data-brand="Acme"[^>]*>.*?</li>', html, re.S)
if not match:
    raise SystemExit(1)
card = match.group(0)
terms = card.find('data-terms=""')
prize = card.find('data-prize=""')
prize_stamp = card.find('data-prize-before-price=""')
prize_class = card.find('class="terms prize-before-price"')
label = card.find('class="terms-label">Terms')
copy = card.find('class="terms-copy">$800 flat, 1 TikTok')
hop = card.find('data-open-brief=""')
after = card.find('data-open-after-terms=""')
note = card.find('class="open-after-note">after Terms')
first = card.find('data-first-click="open"')
open_stamp = card.find('data-open-after-post-first=""')
first_read = card.find('data-first-read="open"')
open_two = card.find('data-open-after-post-two-stamp=""')
open_three = card.find('data-open-after-post-three-stamp=""')
open_four = card.find('data-open-after-post-four-stamp=""')
open_five = card.find('data-open-after-post-five-stamp=""')
later = card.find('data-later-fact=""')
bid_class = card.find('class="bid later-fact"')
bid = card.find('class="bid later-fact"')
if terms < 0 or prize < 0 or prize_stamp < 0 or prize_class < 0 or label < 0 or copy < 0 or hop < 0 or after < 0 or note < 0 or first < 0 or open_stamp < 0 or first_read < 0 or open_two < 0 or open_three < 0 or open_four < 0 or open_five < 0 or later < 0 or bid_class < 0 or bid < 0:
    raise SystemExit(1)
open_label = card.find('class="open-label">Open brief')
if not (prize_class <= terms <= prize <= prize_stamp < label < copy < hop <= after < note < open_label < bid_class <= later):
    raise SystemExit(1)
if not (hop <= first <= open_stamp < first_read <= open_two < open_three < open_four < open_five < open_label):
    raise SystemExit(1)
if open_stamp - first > 80:
    raise SystemExit(1)
if open_two - first_read > 80:
    raise SystemExit(1)
if open_three - open_two > 80:
    raise SystemExit(1)
if open_four - open_three > 80:
    raise SystemExit(1)
if open_five - open_four > 80:
    raise SystemExit(1)
if not re.search(r'class="bid later-fact"[^>]*>\$(?:<!-- -->)?5', card):
    raise SystemExit(1)
if html.count('data-open-after-post-first=""') != 1:
    raise SystemExit(1)
if html.count('data-first-read="open"') != 1:
    raise SystemExit(1)
if html.count('data-open-after-post-two-stamp=""') != 1:
    raise SystemExit(1)
if html.count('data-open-after-post-three-stamp=""') != 1:
    raise SystemExit(1)
if html.count('data-open-after-post-four-stamp=""') != 1:
    raise SystemExit(1)
if html.count('data-open-after-post-five-stamp=""') != 1:
    raise SystemExit(1)
if html.count('data-prize=""') != 1:
    raise SystemExit(1)
if html.count('data-prize-before-price=""') != 1:
    raise SystemExit(1)
if html.count('class="terms prize-before-price"') != 1:
    raise SystemExit(1)
if html.count('data-later-fact=""') != 1:
    raise SystemExit(1)
if html.count('class="bid later-fact"') != 1:
    raise SystemExit(1)
if 'data-later-open=""' in card or 'class="brief-url later-open"' in card:
    raise SystemExit(1)
if html.count('data-later-open=""') != 0:
    raise SystemExit(1)
if 'class="brief-url later-open"' in html or "cards-later" in html:
    raise SystemExit(1)
PY
  grep -q 'data-post-brief=""' "${listed_body}" \
    || fail "paid board must expose one Post a brief hop"
  grep -q 'data-post-after-open=""' "${listed_body}" \
    || fail "paid board must mark Post a brief after Open brief"
  grep -q 'data-post-after-open-first=""' "${listed_body}" \
    || fail "paid board must concentrate Post a brief after Open first click"
  grep -q 'data-first-write="post"' "${listed_body}" \
    || fail "paid board must stamp Post a brief as the first write"
  grep -q 'data-post-after-open-two=""' "${listed_body}" \
    || fail "paid board must concentrate Post a brief after Open is re-concentrated"
  grep -q 'data-post-after-open-three=""' "${listed_body}" \
    || fail "paid board must concentrate Post a brief after Open is re-concentrated again"
  grep -q 'data-post-after-open-four=""' "${listed_body}" \
    || fail "paid board must concentrate Post a brief after Open is re-concentrated again under louder Open"
  grep -q 'data-post-after-open-five=""' "${listed_body}" \
    || fail "paid board must concentrate Post a brief after Open is re-concentrated again under louder Open brief"
  grep -q 'data-post-after-open-six=""' "${listed_body}" \
    || fail "paid board must concentrate Post a brief after Open is re-concentrated again under louder Open brief hop"
  grep -q 'href="#claim"' "${listed_body}" \
    || fail "Post a brief must hop to #claim"
  grep -q 'class="post-brief post-after-open post-after-open-first post-after-open-two post-after-open-three post-after-open-four post-after-open-five post-after-open-six"' "${listed_body}" \
    || fail "Post a brief hop must be labeled after Open brief"
  grep -q 'class="post-after-note">after Open brief' "${listed_body}" \
    || fail "paid board must say Post a brief is after Open brief"
  grep -q 'class="post-label">Post a brief' "${listed_body}" \
    || fail "paid board must say Post a brief"
  grep -q 'class="post-dest">Claim #1' "${listed_body}" \
    || fail "Post a brief must name Claim #1 as the landing"
  grep -q 'Post a brief this week' "${listed_body}" \
    || fail "occupied claim must say Post a brief this week"
  grep -q 'data-rolling-week=""' "${listed_body}" \
    || fail "occupied wall must stamp the rolling last-7-days window"
  grep -q 'Rolling last 7 days. Not Monday 00:00 UTC.' "${listed_body}" \
    || fail "occupied wall must name the rolling last-7-days window"
  python3 - "${listed_body}" <<'PY' || fail "Open brief must win the first click; Post a brief follows after the flyers"
import sys
html = open(sys.argv[1], encoding="utf-8").read()
nav = html.find('aria-label="Site"')
nav_end = html.find("</nav>", nav)
hop = html.find('data-post-after-open=""')
stamp = html.find('data-post-after-open-first=""')
write = html.find('data-first-write="post"')
two = html.find('data-post-after-open-two=""')
three = html.find('data-post-after-open-three=""')
four = html.find('data-post-after-open-four=""')
five = html.find('data-post-after-open-five=""')
six = html.find('data-post-after-open-six=""')
note = html.find('class="post-after-note">after Open brief')
label = html.find('class="post-label">Post a brief')
dest = html.find('class="post-dest">Claim #1')
flyers = html.find('aria-label="Paid briefs this week"')
first = html.find('data-first-click="open"')
open_stamp = html.find('data-open-after-post-first=""')
first_read = html.find('data-first-read="open"')
open_two = html.find('data-open-after-post-two-stamp=""')
open_three = html.find('data-open-after-post-three-stamp=""')
open_four = html.find('data-open-after-post-four-stamp=""')
open_five = html.find('data-open-after-post-five-stamp=""')
open_hop = html.find('class="open-label">Open brief')
claim = html.find('id="claim"')
rolling = html.find('data-rolling-week=""')
if nav < 0 or nav_end < 0 or hop < 0 or stamp < 0 or write < 0 or two < 0 or three < 0 or four < 0 or five < 0 or six < 0 or flyers < 0 or first < 0 or open_stamp < 0 or first_read < 0 or open_two < 0 or open_three < 0 or open_four < 0 or open_five < 0 or claim < 0 or rolling < 0:
    raise SystemExit(1)
if not (nav < nav_end < flyers <= rolling < first <= open_stamp < first_read <= open_two < open_three < open_four < open_five < open_hop < hop <= stamp < write < two < three < four < five < six < note < label < dest < claim):
    raise SystemExit(1)
if stamp - hop > 80:
    raise SystemExit(1)
if two - write > 80:
    raise SystemExit(1)
if three - two > 80:
    raise SystemExit(1)
if four - three > 80:
    raise SystemExit(1)
if five - four > 80:
    raise SystemExit(1)
if six - five > 80:
    raise SystemExit(1)
if open_stamp - first > 80:
    raise SystemExit(1)
if open_two - first_read > 80:
    raise SystemExit(1)
if open_three - open_two > 80:
    raise SystemExit(1)
if open_four - open_three > 80:
    raise SystemExit(1)
if open_five - open_four > 80:
    raise SystemExit(1)
if html.count('data-post-brief=""') != 1 or html.count('href="#claim"') != 1:
    raise SystemExit(1)
if html.count('data-post-after-open=""') != 1:
    raise SystemExit(1)
if html.count('data-post-after-open-first=""') != 1:
    raise SystemExit(1)
if html.count('data-first-write="post"') != 1:
    raise SystemExit(1)
if html.count('data-post-after-open-two=""') != 1:
    raise SystemExit(1)
if html.count('data-post-after-open-three=""') != 1:
    raise SystemExit(1)
if html.count('data-post-after-open-four=""') != 1:
    raise SystemExit(1)
if html.count('data-post-after-open-five=""') != 1:
    raise SystemExit(1)
if html.count('data-post-after-open-six=""') != 1:
    raise SystemExit(1)
if html.count('data-first-click="open"') != 1:
    raise SystemExit(1)
if html.count('data-open-after-post-first=""') != 1:
    raise SystemExit(1)
if html.count('data-first-read="open"') != 1:
    raise SystemExit(1)
if html.count('data-open-after-post-two-stamp=""') != 1:
    raise SystemExit(1)
if html.count('data-open-after-post-three-stamp=""') != 1:
    raise SystemExit(1)
if html.count('data-open-after-post-four-stamp=""') != 1:
    raise SystemExit(1)
if html.count('data-open-after-post-five-stamp=""') != 1:
    raise SystemExit(1)
PY
  python3 - "${listed_body}" <<'PY' || fail "paid board must put flyers before the claim strip"
import sys
html = open(sys.argv[1], encoding="utf-8").read()
flyers = html.find('aria-label="Paid briefs this week"')
claim = html.find('id="claim"')
if flyers < 0 or claim < 0 or flyers >= claim:
    raise SystemExit(1)
PY
  if grep -q 'data-empty-week="true"' "${listed_body}"; then
    fail "board must leave empty-week after a paid fixture"
  fi
  if grep -qiE '[0-9][0-9,]*[[:space:]]*(followers|subscribers)|avg views|estimated reach' "${listed_body}"; then
    fail "paid board must not invent follower or reach numbers"
  fi

  echo "== same brief URL raise pays the difference only =="
  same_bid_body="$(mktemp)"
  same_bid_code="$(curl -sS -o "${same_bid_body}" -w '%{http_code}' \
    -X POST "http://127.0.0.1:${port}/checkout" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode 'brand=Acme' \
    --data-urlencode 'terms=$800 flat, 1 TikTok' \
    --data-urlencode 'briefUrl=https://example.com/acme' \
    --data-urlencode 'bidUsd=5')"
  [[ "${same_bid_code}" == "400" ]] || fail "same-or-lower raise expected 400 got ${same_bid_code}"
  grep -q 'raise_too_small' "${same_bid_body}" \
    || fail "same-or-lower raise must report raise_too_small"

  raise_headers="$(mktemp)"
  raise_code="$(curl -sS -D "${raise_headers}" -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${port}/checkout" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode 'brand=Acme' \
    --data-urlencode 'terms=$800 flat, 1 TikTok' \
    --data-urlencode 'briefUrl=https://example.com/acme' \
    --data-urlencode 'bidUsd=7')"
  [[ "${raise_code}" == "303" ]] || fail "raise POST /checkout expected 303 got ${raise_code}"
  raise_location="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub("\r",""); print $2}' "${raise_headers}")"
  [[ -n "${raise_location}" ]] || fail "raise POST /checkout missing Location"
  if [[ "${raise_location}" != http* ]]; then
    raise_location="http://127.0.0.1:${port}${raise_location}"
  fi
  raise_return="$(mktemp)"
  raise_return_code="$(curl -sS -o "${raise_return}" -w '%{http_code}' "${raise_location}")"
  [[ "${raise_return_code}" == "200" ]] || fail "raise return expected 200 got ${raise_return_code}"
  grep -q 'data-return="success"' "${raise_return}" \
    || fail "raise return must be paid success"

  raised_body="$(mktemp)"
  raised_code="$(curl -sS -o "${raised_body}" -w '%{http_code}' "http://127.0.0.1:${port}/")"
  [[ "${raised_code}" == "200" ]] || fail "GET / after raise expected 200 got ${raised_code}"
  grep -q 'data-bid="7"' "${raised_body}" || fail "board must show raised \$7"
  if grep -q 'data-bid="5"' "${raised_body}"; then
    fail "raised listing must leave the old \$5 bid"
  fi
  grep -q 'Acme' "${raised_body}" || fail "raised listing must stay on the board"

  echo "== rival paying only the difference cannot steal #1 =="
  steal_headers="$(mktemp)"
  steal_code="$(curl -sS -D "${steal_headers}" -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${port}/checkout" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode 'brand=Rival' \
    --data-urlencode 'terms=tries to pay only the difference' \
    --data-urlencode 'briefUrl=https://example.com/rival' \
    --data-urlencode 'bidUsd=5')"
  [[ "${steal_code}" == "303" ]] || fail "rival POST /checkout expected 303 got ${steal_code}"
  steal_location="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub("\r",""); print $2}' "${steal_headers}")"
  [[ -n "${steal_location}" ]] || fail "rival POST /checkout missing Location"
  if [[ "${steal_location}" != http* ]]; then
    steal_location="http://127.0.0.1:${port}${steal_location}"
  fi
  curl -sS -o /dev/null "${steal_location}"
  steal_home="$(mktemp)"
  curl -sS -o "${steal_home}" "http://127.0.0.1:${port}/"
  grep -q 'Rival' "${steal_home}" || fail "rival \$5 must still list at its own rank"
  grep -q 'data-bid="7"' "${steal_home}" || fail "incumbent must stay at \$7 after rival \$5"
  grep -q 'data-bid="5"' "${steal_home}" || fail "rival \$5 must list at its own full bid"
  grep -E -q 'data-rank="1"[^>]*data-brand="Acme"|data-brand="Acme"[^>]*data-rank="1"' \
    "${steal_home}" || fail "\$7 incumbent must stay #1 after a rival \$5 full bid"
  if grep -E -q 'data-rank="1"[^>]*data-brand="Rival"|data-brand="Rival"[^>]*data-rank="1"' \
    "${steal_home}"
  then
    fail "rival paying \$5 must not steal #1"
  fi

  echo "== raise to top + \$1 becomes #1 =="
  take_headers="$(mktemp)"
  take_code="$(curl -sS -D "${take_headers}" -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${port}/checkout" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode 'brand=Rival' \
    --data-urlencode 'terms=full bid above the top' \
    --data-urlencode 'briefUrl=https://example.com/rival' \
    --data-urlencode 'bidUsd=8')"
  [[ "${take_code}" == "303" ]] || fail "rival raise expected 303 got ${take_code}"
  take_location="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub("\r",""); print $2}' "${take_headers}")"
  [[ -n "${take_location}" ]] || fail "rival raise missing Location"
  if [[ "${take_location}" != http* ]]; then
    take_location="http://127.0.0.1:${port}${take_location}"
  fi
  curl -sS -o /dev/null "${take_location}"
  take_home="$(mktemp)"
  curl -sS -o "${take_home}" "http://127.0.0.1:${port}/"
  grep -q 'data-bid="8"' "${take_home}" || fail "board must show rival at \$8"
  grep -E -q 'data-rank="1"[^>]*data-brand="Rival"|data-brand="Rival"[^>]*data-rank="1"' \
    "${take_home}" || fail "\$8 must become #1 over the \$7 incumbent"
  grep -E -q 'data-rank="2"[^>]*data-brand="Acme"|data-brand="Acme"[^>]*data-rank="2"' \
    "${take_home}" || fail "\$7 incumbent must drop to #2 after a \$8 full bid"
  python3 - "${take_home}" <<'PY' || fail "only the live #1 flyer may enlarge Terms before \$bid"
import re
import sys
html = open(sys.argv[1], encoding="utf-8").read()
rival = re.search(r'<li[^>]*data-brand="Rival"[^>]*>.*?</li>', html, re.S)
acme = re.search(r'<li[^>]*data-brand="Acme"[^>]*>.*?</li>', html, re.S)
if not rival or not acme:
    raise SystemExit(1)
if 'data-prize=""' not in rival.group(0) or 'prize-before-price' not in rival.group(0):
    raise SystemExit(1)
if 'data-later-fact=""' not in rival.group(0) or 'class="bid later-fact"' not in rival.group(0):
    raise SystemExit(1)
if 'data-prize' in acme.group(0) or 'prize-before-price' in acme.group(0):
    raise SystemExit(1)
if 'data-later-fact' in acme.group(0) or 'later-fact' in acme.group(0):
    raise SystemExit(1)
if html.count('data-prize=""') != 1 or html.count('data-prize-before-price=""') != 1:
    raise SystemExit(1)
if html.count('data-later-fact=""') != 1 or html.count('class="bid later-fact"') != 1:
    raise SystemExit(1)
if 'data-later-open=""' not in acme.group(0) or 'class="brief-url later-open"' not in acme.group(0):
    raise SystemExit(1)
if 'data-later-open=""' in rival.group(0) or 'class="brief-url later-open"' in rival.group(0):
    raise SystemExit(1)
if html.count('data-later-open=""') != 1:
    raise SystemExit(1)
if html.count('class="brief-url later-open"') != 1:
    raise SystemExit(1)
if 'class="card later-flyer"' not in acme.group(0) or 'data-later-flyer=""' not in acme.group(0):
    raise SystemExit(1)
if 'class="card later-flyer"' in rival.group(0) or 'data-later-flyer=""' in rival.group(0):
    raise SystemExit(1)
if 'class="later-terms-kicker">Terms' not in acme.group(0):
    raise SystemExit(1)
if 'class="terms-label">Terms' in acme.group(0) or 'class="terms-copy"' in acme.group(0):
    raise SystemExit(1)
if html.count('data-later-flyer=""') != 1:
    raise SystemExit(1)
if html.count('data-later-pack=""') != 1:
    raise SystemExit(1)
if "These flyers are not this week’s #1 prize" not in html:
    raise SystemExit(1)
if 'data-first-click="open"' not in rival.group(0):
    raise SystemExit(1)
if 'data-first-click="open"' in acme.group(0):
    raise SystemExit(1)
if 'aria-label="Paid briefs this week"' not in html or 'aria-label="Later briefs this week"' not in html:
    raise SystemExit(1)
if html.find('aria-label="Paid briefs this week"') >= html.find('aria-label="Later briefs this week"'):
    raise SystemExit(1)
if html.find('data-later-pack=""') >= html.find('aria-label="Later briefs this week"'):
    raise SystemExit(1)
rival_terms = rival.group(0).find('data-terms=""')
rival_open = rival.group(0).find('class="open-label">Open brief')
rival_bid = rival.group(0).find('class="bid later-fact"')
acme_terms = acme.group(0).find('data-terms=""')
acme_bid = acme.group(0).find('class="bid">')
acme_open = acme.group(0).find('data-later-open=""')
if rival_terms < 0 or rival_open < 0 or rival_bid < 0 or acme_terms < 0 or acme_bid < 0 or acme_open < 0:
    raise SystemExit(1)
if not (rival_terms < rival_open < rival_bid):
    raise SystemExit(1)
if not (acme_terms < acme_bid < acme_open):
    raise SystemExit(1)
PY

  echo "== reject chat / NSFW / shortener / http brief URLs =="
  for bad in \
    'https://t.me/acmebriefs|chat_link_forbidden' \
    'https://onlyfans.com/creator|nsfw_forbidden' \
    'https://bit.ly/acme-brief|shortener_forbidden' \
    'http://example.com/insecure|invalid_url'
  do
    bad_url="${bad%%|*}"
    bad_code_name="${bad##*|}"
    bad_body="$(mktemp)"
    bad_http="$(curl -sS -o "${bad_body}" -w '%{http_code}' \
      -X POST "http://127.0.0.1:${port}/checkout" \
      -H 'content-type: application/x-www-form-urlencoded' \
      --data-urlencode 'brand=Rejected' \
      --data-urlencode 'terms=must not list' \
      --data-urlencode "briefUrl=${bad_url}" \
      --data-urlencode 'bidUsd=5')"
    [[ "${bad_http}" == "400" ]] \
      || fail "POST ${bad_url} expected 400 got ${bad_http}"
    grep -q "${bad_code_name}" "${bad_body}" \
      || fail "POST ${bad_url} must report ${bad_code_name}"
    rm -f "${bad_body}"
  done
  reject_home="$(mktemp)"
  curl -sS -o "${reject_home}" "http://127.0.0.1:${port}/"
  if grep -q 'Rejected' "${reject_home}"; then
    fail "rejected chat/NSFW/shortener/http URLs must not list"
  fi

  echo "== tracking query is stripped before persist =="
  track_headers="$(mktemp)"
  track_code="$(curl -sS -D "${track_headers}" -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${port}/checkout" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode 'brand=CleanUrl' \
    --data-urlencode 'terms=stripped tracking' \
    --data-urlencode 'briefUrl=https://example.com/clean?utm_source=x&fbclid=abc' \
    --data-urlencode 'bidUsd=5')"
  [[ "${track_code}" == "303" ]] || fail "tracking POST /checkout expected 303 got ${track_code}"
  track_location="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub("\r",""); print $2}' "${track_headers}")"
  [[ -n "${track_location}" ]] || fail "tracking POST /checkout missing Location"
  if [[ "${track_location}" != http* ]]; then
    track_location="http://127.0.0.1:${port}${track_location}"
  fi
  curl -sS -o /dev/null "${track_location}"
  track_home="$(mktemp)"
  curl -sS -o "${track_home}" "http://127.0.0.1:${port}/"
  grep -q 'CleanUrl' "${track_home}" || fail "stripped tracking URL must still list"
  grep -q 'https://example.com/clean' "${track_home}" \
    || fail "stored brief URL must keep origin + path after strip"
  if grep -qE 'utm_|fbclid' "${track_home}"; then
    fail "stored brief URL must not keep tracking query"
  fi

  echo "== GET /r/:id confirms terms; POST increments and 302s without trackers =="
  listing_id="$(
    grep -oE 'data-brand="CleanUrl"[^>]*data-id="[^"]+"|data-id="[^"]+"[^>]*data-brand="CleanUrl"' \
      "${track_home}" \
      | grep -oE 'data-id="[^"]+"' \
      | head -n 1 \
      | sed -E 's/data-id="([^"]+)"/\1/'
  )"
  if [[ -z "${listing_id}" ]]; then
    listing_id="$(
      grep -oE 'data-id="[^"]+"' "${track_home}" | tail -n 1 | sed -E 's/data-id="([^"]+)"/\1/'
    )"
  fi
  [[ -n "${listing_id}" ]] || fail "paid board missing data-id for click hop"
  grep -q "href=\"/r/${listing_id}\"" "${track_home}" \
    || fail "Open brief must point at /r/:id"
  grep -q 'data-open-brief=""' "${track_home}" \
    || fail "paid flyer must mark the Open brief hop"
  grep -q 'class="open-label">Open brief' "${track_home}" \
    || fail "paid flyer must label the hop Open brief"
  grep -q 'data-clicks="0"' "${track_home}" || fail "new listing clicks must start at 0"

  confirm_body="$(mktemp)"
  confirm_headers="$(mktemp)"
  confirm_code="$(curl -sS -D "${confirm_headers}" -o "${confirm_body}" -w '%{http_code}' \
    --max-redirs 0 \
    "http://127.0.0.1:${port}/r/${listing_id}")"
  [[ "${confirm_code}" == "200" ]] || fail "GET /r/:id expected 200 confirm got ${confirm_code}"
  confirm_location="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub("\r",""); print $2}' "${confirm_headers}")"
  [[ -z "${confirm_location}" ]] || fail "GET /r/:id must not redirect, got ${confirm_location}"
  grep -q 'data-confirm-brief=""' "${confirm_body}" \
    || fail "GET /r/:id must render the confirm sheet"
  grep -q 'data-confirm-before-leave=""' "${confirm_body}" \
    || fail "GET /r/:id must stamp confirm-before-leave"
  grep -q 'class="confirm-sheet confirm-before-leave"' "${confirm_body}" \
    || fail "GET /r/:id must use the confirm-before-leave sheet"
  grep -q 'data-confirm-uncounted=""' "${confirm_body}" \
    || fail "GET /r/:id must mark the uncounted preview"
  grep -q 'Opening this flyer has not counted a hop' "${confirm_body}" \
    || fail "GET /r/:id must say opening has not counted a hop"
  grep -q 'Confirm this brief' "${confirm_body}" \
    || fail "GET /r/:id must say Confirm this brief"
  grep -q 'stripped tracking' "${confirm_body}" \
    || fail "GET /r/:id must show the brand terms first"
  grep -q 'https://example.com/clean' "${confirm_body}" \
    || fail "GET /r/:id must show the canonical brief URL"
  grep -q 'Leave to the brief' "${confirm_body}" \
    || fail "GET /r/:id must offer Leave to the brief"
  grep -q "action=\"/r/${listing_id}\"" "${confirm_body}" \
    || fail "confirm leave must POST back to /r/:id"
  grep -q 'data-leave-brief=""' "${confirm_body}" \
    || fail "confirm leave hop must be marked"
  grep -q 'public hops — not reach' "${confirm_body}" \
    || fail "confirm sheet must not dress clicks as reach"
  grep -q 'data-clicks="0"' "${confirm_body}" \
    || fail "GET /r/:id must show the uncounted click total"
  if grep -qE 'utm_|fbclid' "${confirm_body}"; then
    fail "GET /r/:id must not show tracking query"
  fi
  if grep -qE 'data-post-after-open-seven|data-open-after-post-six' "${confirm_body}"; then
    fail "GET /r/:id must not stamp *-after-*-N"
  fi
  python3 - "${confirm_body}" <<'PY' || fail "confirm sheet must put uncounted preview, terms, and URL before the leave hop"
import sys
html = open(sys.argv[1], encoding="utf-8").read()
stamp = html.find('data-confirm-before-leave=""')
uncounted = html.find('data-confirm-uncounted=""')
copy = html.find("Opening this flyer has not counted a hop")
terms = html.find("stripped tracking")
url = html.find("https://example.com/clean")
leave = html.find('data-leave-brief=""')
bid = html.find('class="confirm-bid">$5')
if stamp < 0 or uncounted < 0 or copy < 0 or terms < 0 or url < 0 or leave < 0 or bid < 0:
    raise SystemExit(1)
if not (stamp < uncounted <= copy < terms < url < leave < bid):
    raise SystemExit(1)
if html.count('data-confirm-before-leave=""') != 1:
    raise SystemExit(1)
if html.count('data-leave-brief=""') != 1:
    raise SystemExit(1)
PY

  after_get="$(mktemp)"
  curl -sS -o "${after_get}" "http://127.0.0.1:${port}/"
  grep -q 'data-clicks="0"' "${after_get}" \
    || fail "GET /r/:id must not increment public clicks"
  if grep -q 'data-clicks="1"' "${after_get}"; then
    fail "GET confirm must not count as a hop"
  fi

  post_headers="$(mktemp)"
  post_code="$(curl -sS -D "${post_headers}" -o /dev/null -w '%{http_code}' \
    --max-redirs 0 \
    -X POST "http://127.0.0.1:${port}/r/${listing_id}")"
  [[ "${post_code}" == "302" ]] || fail "POST /r/:id expected 302 got ${post_code}"
  post_location="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub("\r",""); print $2}' "${post_headers}")"
  [[ "${post_location}" == "https://example.com/clean" ]] \
    || fail "POST /r/:id must 302 to canonical brief URL, got ${post_location}"
  if echo "${post_location}" | grep -qE 'utm_|fbclid|gclid'; then
    fail "POST /r/:id must not add tracking query"
  fi

  after_post="$(mktemp)"
  curl -sS -o "${after_post}" "http://127.0.0.1:${port}/"
  grep -q 'data-clicks="1"' "${after_post}" || fail "POST /r/:id must increment public clicks"
  grep -q 'CleanUrl' "${after_post}" || fail "clicked listing must stay on the live board"

  missing_code="$(curl -sS -o /dev/null -w '%{http_code}' \
    --max-redirs 0 \
    "http://127.0.0.1:${port}/r/does-not-exist")"
  [[ "${missing_code}" == "404" ]] || fail "unknown /r/:id expected 404 got ${missing_code}"

  echo "== WEEK_NOW roll hides previous week from the live board =="
  stop_http "${server_pid}"
  server_pid=""
  # New listener on a fresh port so a leftover next-server cannot serve last week.
  port=$((port + 1))
  export WEEK_NOW="2099-01-05T00:00:00.000Z"
  PORT="${port}" node ./node_modules/next/dist/bin/next start --port "${port}" --hostname 127.0.0.1 \
    >"${log_file}" 2>&1 &
  server_pid=$!
  ready=0
  for _ in $(seq 1 60); do
    if ! kill -0 "${server_pid}" 2>/dev/null; then
      fail "next start after WEEK_NOW exited early: $(cat "${log_file}")"
    fi
    if curl -sf "http://127.0.0.1:${port}/healthz" >/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  [[ "${ready}" -eq 1 ]] || fail "GET /healthz after WEEK_NOW did not become ready: $(cat "${log_file}")"
  rolled_body="$(mktemp)"
  rolled_code="$(curl -sS -o "${rolled_body}" -w '%{http_code}' "http://127.0.0.1:${port}/")"
  [[ "${rolled_code}" == "200" ]] || fail "GET / after week roll expected 200 got ${rolled_code}"
  grep -q 'data-empty-week="true"' "${rolled_body}" \
    || fail "week roll must hide previous week from the live board"
  grep -q 'data-empty-claim-first=""' "${rolled_body}" \
    || fail "rolled empty week must still lead with Claim #1"
  grep -q 'class="paste-rail empty-claim-first"' "${rolled_body}" \
    || fail "rolled empty week must stamp the empty Claim #1 class"
  if grep -qE 'Acme|Rival|CleanUrl|data-post-brief|data-open-brief|data-prize|prize-before-price|data-later-fact|later-fact|data-later-open=""|class="brief-url later-open"|cards-later' "${rolled_body}"; then
    fail "previous week listings must be absent from the live board"
  fi
  unset WEEK_NOW

  rm -f "${health_body}" "${home_body}" "${about_body}" "${rules_body}" \
    "${unpaid_body}" "${unpaid_home}" \
    "${paid_headers}" "${return_body}" "${listed_body}" \
    "${same_bid_body}" "${raise_headers}" "${raise_return}" "${raised_body}" \
    "${steal_headers}" "${steal_home}" "${take_headers}" "${take_home}" \
    "${reject_home}" "${track_headers}" "${track_home}" \
    "${confirm_body}" "${confirm_headers}" "${after_get}" \
    "${post_headers}" "${after_post}" \
    "${rolled_body}"
fi

echo "OK: buildable and testable"
