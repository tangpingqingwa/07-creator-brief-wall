import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { AboutCopy } from "../src/lib/about-copy";
import { RaiseTooSmallCopy } from "../src/lib/raise-too-small-copy";
import { RulesCopy } from "../src/lib/rules-copy";
import { CheckoutError, parseCheckoutInput } from "../src/lib/polar";
import {
  briefUrlKey,
  canonicalizeBriefUrl,
  outboundBriefUrl,
  UrlError,
} from "../src/lib/urls";

function assertUrlError(raw: string, code: UrlError["code"]) {
  assert.throws(() => canonicalizeBriefUrl(raw), (error: unknown) => {
    assert.ok(error instanceof UrlError);
    assert.equal(error.code, code);
    assert.equal(error.httpStatus, 400);
    return true;
  });
}

test("strips utm_* / fbclid and a tracker-only query; keeps a brief id", () => {
  assert.equal(
    canonicalizeBriefUrl(
      "https://Brand.Example.com:443/brief/acme/?utm_source=x&utm_campaign=ad&fbclid=1&gclid=2&gbraid=3&wbraid=4&mc_eid=5&ref=tw&ref_src=x&affiliate=1&aff=2&irclickid=9#frag",
    ),
    "https://brand.example.com/brief/acme",
  );
  assert.equal(
    canonicalizeBriefUrl("https://example.com/brief?utm_source=x&id=99"),
    "https://example.com/brief?id=99",
  );
  assert.equal(
    canonicalizeBriefUrl("https://example.com/brief?utm_source=x&fbclid=abc"),
    "https://example.com/brief",
  );
  assert.doesNotMatch(
    canonicalizeBriefUrl("https://example.com/brief?utm_source=x"),
    /utm_|fbclid|\?$/,
  );
});

test("https only; http, javascript, and data schemes are invalid_url", () => {
  for (const raw of [
    "http://example.com/brief",
    "javascript:alert(1)",
    "data:text/html,hi",
    "ftp://example.com/brief",
    "not a url",
    "",
    "https://user:pass@example.com/brief",
  ]) {
    assertUrlError(raw, "invalid_url");
  }
});

test("rejects telegram / discord / whatsapp / messenger / signal / slack invite", () => {
  for (const raw of [
    "https://t.me/acmebriefs",
    "https://telegram.me/joinchat/abc",
    "https://wa.me/15551234567",
    "https://chat.whatsapp.com/invite",
    "https://discord.gg/acme",
    "https://discord.com/invite/acme",
    "https://m.me/acme",
    "https://signal.me/#p/+15551234567",
    "https://join.slack.com/t/acme/shared_invite/zt-1",
    "https://acme.slack.com/join/shared_invite/zt-1",
  ]) {
    assertUrlError(raw, "chat_link_forbidden");
  }
});

test("rejects NSFW hosts and path keywords", () => {
  for (const raw of [
    "https://onlyfans.com/creator",
    "https://www.pornhub.com/view_video.php?viewkey=1",
    "https://fansly.com/profile",
    "https://example.com/porn/brief",
    "https://brand.example.com/onlyfans",
  ]) {
    assertUrlError(raw, "nsfw_forbidden");
  }
});

test("rejects known shorteners instead of replacing them", () => {
  for (const raw of [
    "https://bit.ly/acme-brief",
    "https://t.co/abc",
    "https://tinyurl.com/abc",
    "https://lnkd.in/abc",
  ]) {
    assertUrlError(raw, "shortener_forbidden");
  }
});

test("two briefs on the same host stay distinct by origin + path", () => {
  const first = canonicalizeBriefUrl(
    "https://briefs.example.com/a?utm_source=x",
  );
  const second = canonicalizeBriefUrl(
    "https://briefs.example.com/b?utm_source=x",
  );
  assert.equal(first, "https://briefs.example.com/a");
  assert.equal(second, "https://briefs.example.com/b");
  assert.notEqual(briefUrlKey(first), briefUrlKey(second));
});

test("outbound brief URL never adds tracking", () => {
  const stored = canonicalizeBriefUrl(
    "https://example.com/brief?utm_source=x&id=99#frag",
  );
  const outbound = outboundBriefUrl(stored);
  assert.equal(outbound, "https://example.com/brief?id=99");
  assert.doesNotMatch(outbound, /utm_|fbclid/);
});

test("about states independence and no ads / API keys / revenue share", () => {
  const html = renderToStaticMarkup(
    createElement(AboutCopy, { occupied: false }),
  );
  assert.match(html, /data-page="about"/);
  assert.match(html, /data-occupied="false"/);
  assert.match(html, /no ads/i);
  assert.match(html, /no API keys/i);
  assert.match(html, /no revenue share/i);
  assert.match(html, /Rank is the bid/);
  assert.match(html, /seen by creators/);
  assert.match(html, /not affiliated/i);
  assert.match(html, /TikTok/);
  assert.match(html, /YouTube/);
  assert.match(html, /Instagram/);
  assert.match(html, /Twitch/);
  assert.match(html, /Meta/);
  assert.match(html, /creator-brief-wall/);
  assert.match(html, /outbid\.lol/);
  assert.doesNotMatch(html, /data-about-raise/);
  assert.doesNotMatch(html, /Polar charges the difference on a raise/);
  assert.doesNotMatch(html, /[0-9][0-9,]*\s*(followers|subscribers)/i);
});

test("occupied /about names Polar raise-pays-difference — unpaid Polar checkout stays off", () => {
  const empty = renderToStaticMarkup(
    createElement(AboutCopy, { occupied: false }),
  );
  assert.match(empty, /data-page="about"/);
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /Abandoned checkout does not invent a brief/);
  assert.doesNotMatch(empty, /data-about-raise/);
  assert.doesNotMatch(empty, /Polar charges the difference on a raise/);
  assert.doesNotMatch(empty, /not a new full bid/);
  assert.doesNotMatch(empty, /data-raise-difference/);
  assert.doesNotMatch(empty, /data-raise-charged/);

  const occupied = renderToStaticMarkup(
    createElement(AboutCopy, { occupied: true }),
  );
  assert.match(occupied, /data-page="about"/);
  assert.match(occupied, /data-occupied="true"/);
  assert.match(occupied, /data-about-raise=""/);
  assert.match(
    occupied,
    /Polar charges the difference on a raise — not a new full bid/,
  );
  assert.match(
    occupied,
    /Unpaid Polar checkout stays off the wall until Polar reports paid/,
  );
  assert.match(occupied, /Rank is the bid/);
  assert.match(occupied, /no ads/i);
  assert.doesNotMatch(occupied, /data-raise-difference/);
  assert.doesNotMatch(occupied, /data-raise-charged/);
  assert.doesNotMatch(occupied, /data-raise-charge=/);
  assert.doesNotMatch(occupied, /[0-9][0-9,]*\s*(followers|subscribers)/i);
});

test("checkout stores the stripped URL and rejects chat / NSFW / shortener / http", () => {
  const draft = parseCheckoutInput({
    brand: "Acme",
    terms: "$800 flat, 1 TikTok",
    briefUrl: "https://example.com/brief?utm_source=x&fbclid=1&id=99",
    bidUsd: 5,
    weekId: "2026-W34",
  });
  assert.equal(draft.briefUrl, "https://example.com/brief?id=99");
  assert.doesNotMatch(draft.briefUrl, /utm_|fbclid/);

  for (const [raw, code] of [
    ["https://t.me/acmebriefs", "chat_link_forbidden"],
    ["https://onlyfans.com/creator", "nsfw_forbidden"],
    ["https://bit.ly/acme-brief", "shortener_forbidden"],
    ["http://example.com/brief", "invalid_url"],
  ] as const) {
    assert.throws(
      () =>
        parseCheckoutInput({
          brand: "Rejected",
          terms: "must not list",
          briefUrl: raw,
          bidUsd: 5,
          weekId: "2026-W34",
        }),
      (error: unknown) => {
        assert.ok(error instanceof CheckoutError);
        assert.equal(error.code, code);
        assert.equal(error.httpStatus, 400);
        return true;
      },
    );
  }
});

test("rules state min $5, rank=bid, older wins, raise pays difference", () => {
  const html = renderToStaticMarkup(
    createElement(RulesCopy, { occupied: false }),
  );
  assert.match(html, /data-page="rules"/);
  assert.match(html, /data-occupied="false"/);
  assert.match(html, /Rank is the bid/);
  assert.match(html, /\$5/);
  assert.match(html, /Older wins ties/);
  assert.match(html, /Raise pays difference/);
  assert.match(html, /Rolling last 7 days\. Not Monday 00:00 UTC/);
  assert.match(html, /Monday 00:00:00\.000 UTC/);
  assert.match(html, /fake followers/i);
  assert.match(html, /NSFW/);
  assert.match(html, /Telegram/);
  assert.match(html, /https:/);
  assert.match(html, /utm_\*/);
  assert.match(html, /bit\.ly/);
  assert.doesNotMatch(html, /data-rules-raise/);
  assert.doesNotMatch(html, /Polar charges the difference on a raise/);
});

test("occupied /rules raise identity is last-7-days, not the UTC week label", () => {
  const html = renderToStaticMarkup(
    createElement(RulesCopy, { occupied: true }),
  );
  assert.match(html, /Same canonical brief URL still inside last 7 days raises/);
  assert.match(html, /weekId<\/code> stays an audit label — not raise identity/);
  assert.doesNotMatch(html, /same UTC week raises/i);
  assert.doesNotMatch(html, /same weekId/i);
  assert.match(html, /Raise pays difference/);
  assert.match(html, /Rolling last 7 days\. Not Monday 00:00 UTC/);
});

test("occupied /rules names Polar raise-pays-difference — unpaid Polar checkout stays off", () => {
  const empty = renderToStaticMarkup(
    createElement(RulesCopy, { occupied: false }),
  );
  assert.match(empty, /data-page="rules"/);
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /Raise pays difference/);
  assert.match(empty, /Unpaid checkout stays off the board until Polar reports paid/);
  assert.doesNotMatch(empty, /data-rules-raise/);
  assert.doesNotMatch(empty, /Polar charges the difference on a raise/);
  assert.doesNotMatch(empty, /not a new full bid/);
  assert.doesNotMatch(empty, /data-raise-difference/);
  assert.doesNotMatch(empty, /data-raise-charged/);
  assert.doesNotMatch(empty, /data-about-raise/);

  const occupied = renderToStaticMarkup(
    createElement(RulesCopy, { occupied: true }),
  );
  assert.match(occupied, /data-page="rules"/);
  assert.match(occupied, /data-occupied="true"/);
  assert.match(occupied, /data-rules-raise=""/);
  assert.match(
    occupied,
    /Polar charges the difference on a raise — not a new full bid/,
  );
  assert.match(
    occupied,
    /Unpaid Polar checkout stays off the wall until Polar reports paid/,
  );
  assert.match(occupied, /Rank is the bid/);
  assert.match(occupied, /Raise pays difference/);
  assert.doesNotMatch(occupied, /data-raise-difference/);
  assert.doesNotMatch(occupied, /data-raise-charged/);
  assert.doesNotMatch(occupied, /data-raise-charge=/);
  assert.doesNotMatch(occupied, /data-about-raise/);
  assert.doesNotMatch(occupied, /[0-9][0-9,]*\s*(followers|subscribers)/i);
});

test("occupied raise-too-small names Polar still charges only the difference — unpaid Polar checkout stays off", () => {
  const empty = renderToStaticMarkup(
    createElement(RaiseTooSmallCopy, { occupied: false }),
  );
  assert.match(empty, /data-page="raise-too-small"/);
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /No rank change/);
  assert.match(
    empty,
    /Unpaid Polar checkout stays off the wall until Polar reports paid/,
  );
  assert.doesNotMatch(empty, /data-raise-too-small/);
  assert.doesNotMatch(empty, /Polar still charges only the difference/);
  assert.doesNotMatch(empty, /not a new full bid/);
  assert.doesNotMatch(empty, /data-raise-difference/);
  assert.doesNotMatch(empty, /data-raise-charged/);
  assert.doesNotMatch(empty, /data-about-raise/);
  assert.doesNotMatch(empty, /data-rules-raise/);

  const occupied = renderToStaticMarkup(
    createElement(RaiseTooSmallCopy, { occupied: true }),
  );
  assert.match(occupied, /data-page="raise-too-small"/);
  assert.match(occupied, /data-occupied="true"/);
  assert.match(occupied, /data-raise-too-small=""/);
  assert.match(occupied, /Raise is too small/);
  assert.match(occupied, /Polar still charges only the difference/);
  assert.match(occupied, /not a new full bid/);
  assert.match(
    occupied,
    /Unpaid Polar checkout stays off the wall/,
  );
  assert.match(occupied, /at least \$1 above the current bid/);
  assert.doesNotMatch(occupied, /data-raise-difference/);
  assert.doesNotMatch(occupied, /data-raise-charged/);
  assert.doesNotMatch(occupied, /data-raise-charge=/);
  assert.doesNotMatch(occupied, /data-about-raise/);
  assert.doesNotMatch(occupied, /data-rules-raise/);
  assert.doesNotMatch(occupied, /[0-9][0-9,]*\s*(followers|subscribers)/i);
});
