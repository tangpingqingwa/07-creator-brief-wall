import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import AboutPage from "../src/app/about/page";
import RulesPage from "../src/app/rules/page";
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
  const html = renderToStaticMarkup(createElement(AboutPage));
  assert.match(html, /data-page="about"/);
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
  assert.doesNotMatch(html, /[0-9][0-9,]*\s*(followers|subscribers)/i);
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
  const html = renderToStaticMarkup(createElement(RulesPage));
  assert.match(html, /data-page="rules"/);
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
});
