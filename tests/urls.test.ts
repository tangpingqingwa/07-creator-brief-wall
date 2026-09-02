import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { isBriefUrlReady } from "../src/app/outbid-form";
import { AboutCopy } from "../src/lib/about-copy";
import { RaiseTooSmallCopy } from "../src/lib/raise-too-small-copy";
import { RulesCopy } from "../src/lib/rules-copy";
import { CheckoutError, parseCheckoutInput } from "../src/lib/polar";
import {
  briefUrlKey,
  canonicalizeBriefUrl,
  normalizeBriefUrlInput,
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

test("bare brief domains default to HTTPS before canonicalization", () => {
  assert.equal(
    normalizeBriefUrlInput("example.com/brief"),
    "https://example.com/brief",
  );
  assert.equal(
    normalizeBriefUrlInput("example.com:8443/brief"),
    "https://example.com:8443/brief",
  );
  assert.equal(
    canonicalizeBriefUrl("Example.com/brief?utm_source=campaign"),
    "https://example.com/brief",
  );
  assert.equal(
    canonicalizeBriefUrl("//example.com/brief"),
    "https://example.com/brief",
  );
});

test("server and client reject obfuscated schemes, relative paths, and private targets", () => {
  const invalid = [
    "javascript\n://example.com/brief",
    "java\tscript:123",
    "http\r://example.com/brief",
    "java script:123",
    "java\\script:123",
    "https\\://example.com/brief",
    "https//example.com/brief",
    "http//example.com/brief",
    "data//example.com/brief",
    "/path",
    "///example.com/brief",
    "https:///example.com/brief",
    "https://example.com\\evil",
    "https://localhost/brief",
    "https://brief.localhost/brief",
    "https://brief.local/brief",
    "https://brief.test/brief",
    "https://brief.invalid/brief",
    "https://brief.example/brief",
    "https://127.0.0.1:3000/brief",
    "127.0.0.1:3000/brief",
    "https://10.0.0.1/brief",
    "https://172.16.0.1/brief",
    "https://192.168.1.1/brief",
    "https://169.254.1.1/brief",
    "https://[::1]/brief",
    "https://[fd00::1]/brief",
    "https://[fe80::1]/brief",
  ];

  for (const raw of invalid) {
    assertUrlError(raw, "invalid_url");
    assert.equal(isBriefUrlReady(raw), false, raw);
  }
});

test("safe HTTPS, protocol-relative, and plausible bare public authorities remain accepted", () => {
  for (const raw of [
    "https://example.com/brief",
    "//example.com/brief",
    "example.com/brief",
    "example.com:8443/brief",
  ]) {
    assert.equal(isBriefUrlReady(raw), true, raw);
    assert.doesNotThrow(() => canonicalizeBriefUrl(raw));
  }

  assert.equal(normalizeBriefUrlInput("/path"), "/path");
  assert.equal(normalizeBriefUrlInput("///example.com/brief"), "///example.com/brief");
  assert.equal(normalizeBriefUrlInput("https//example.com/brief"), "https//example.com/brief");
});

test("repeated trailing dots cannot bypass denied hosts or public-host checks", () => {
  for (const [raw, code] of [
    ["https://t.me../acme", "chat_link_forbidden"],
    ["https://onlyfans.com.../creator", "nsfw_forbidden"],
    ["https://bit.ly.../acme", "shortener_forbidden"],
    ["https://example.com../brief", "invalid_url"],
  ] as const) {
    assertUrlError(raw, code);
    assert.equal(isBriefUrlReady(raw), false, raw);
  }
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

test("about explains the public wall without implementation or clone copy", () => {
  const html = renderToStaticMarkup(
    createElement(AboutCopy, { occupied: false }),
  );
  assert.match(html, /data-page="about"/);
  assert.match(html, /data-occupied="false"/);
  assert.match(html, /Creator Brief Wall is a public pay-to-rank board/);
  assert.match(html, /Rank is the bid/);
  assert.match(html, /seen by creators/);
  assert.match(html, /payment is confirmed/);
  assert.match(html, /TikTok/);
  assert.match(html, /YouTube/);
  assert.match(html, /Instagram/);
  assert.match(html, /Twitch/);
  assert.match(html, /Meta/);
  assert.doesNotMatch(
    html,
    /outbid\.lol|creator-brief-wall|\bclone\b|\bv1\b|\bfixture\b|API keys?|Waffo|weekId|createdAt|paidAt/i,
  );
  assert.doesNotMatch(html, /data-about-raise/);
  assert.doesNotMatch(html, /Waffo charges the difference on a raise/);
  assert.doesNotMatch(html, /[0-9][0-9,]*\s*(followers|subscribers)/i);
});

test("occupied /about explains raise pricing without provider copy", () => {
  const empty = renderToStaticMarkup(
    createElement(AboutCopy, { occupied: false }),
  );
  assert.match(empty, /data-page="about"/);
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /canceled or abandoned checkout changes nothing/);
  assert.doesNotMatch(empty, /data-about-raise/);
  assert.doesNotMatch(empty, /Waffo charges the difference on a raise/);
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
    /A raise charges the original payer only the difference/,
  );
  assert.match(
    occupied,
    /A brief appears only after payment is confirmed/,
  );
  assert.match(occupied, /Rank is the bid/);
  assert.doesNotMatch(occupied, /Waffo|outbid\.lol|\bclone\b|\bfixture\b/i);
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

test("checkout accepts a bare brief domain and stores its HTTPS canonical", () => {
  const draft = parseCheckoutInput({
    brand: "Acme",
    terms: "$800 flat, 1 TikTok",
    briefUrl: "briefs.example.com/acme",
    bidUsd: 5,
    weekId: "2026-W34",
  });
  assert.equal(draft.briefUrl, "https://briefs.example.com/acme");
});

test("client readiness uses the same HTTPS default and rejects unsafe schemes", () => {
  assert.equal(isBriefUrlReady("briefs.example.com/acme"), true);
  assert.equal(isBriefUrlReady("https://briefs.example.com/acme"), true);
  assert.equal(isBriefUrlReady("http://briefs.example.com/acme"), false);
  assert.equal(isBriefUrlReady("javascript:alert(1)"), false);
});

test("rules state min $5, rank=bid, older wins, raise pays difference", () => {
  const html = renderToStaticMarkup(
    createElement(RulesCopy, { occupied: false }),
  );
  assert.match(html, /data-page="rules"/);
  assert.match(html, /data-occupied="false"/);
  assert.match(html, /Rank is the bid/);
  assert.match(html, /\$5/);
  assert.match(html, /brief placed first keeps the higher rank/);
  assert.match(html, /same cleaned brief link may raise/i);
  assert.match(html, /charged only the <strong>difference/);
  assert.match(html, /Rolling seven-day window/);
  assert.match(html, /does not reset for everyone at Monday midnight/);
  assert.match(html, /fake followers/i);
  assert.match(html, /NSFW/);
  assert.match(html, /Telegram/);
  assert.match(html, /secure, public brief link/);
  assert.match(html, /Tracking, referral, and affiliate parameters are removed/);
  assert.match(html, /Link shorteners/);
  assert.doesNotMatch(html, /weekId|createdAt|paidAt|Waffo|outbid\.lol|\bclone\b|\bfixture\b/i);
  assert.doesNotMatch(html, /data-rules-raise/);
  assert.doesNotMatch(html, /Waffo charges the difference on a raise/);
});

test("occupied /rules explains active-placement raises in public language", () => {
  const html = renderToStaticMarkup(
    createElement(RulesCopy, { occupied: true }),
  );
  assert.match(html, /same cleaned brief link may raise while its placement is active/i);
  assert.match(html, /A raise charges the original payer only the difference/);
  assert.match(html, /Each placement keeps its own seven-day window/);
  assert.doesNotMatch(html, /weekId|createdAt|paidAt|Waffo|outbid\.lol|\bclone\b|\bfixture\b/i);
});

test("occupied /rules keeps payment and raise copy provider-neutral", () => {
  const empty = renderToStaticMarkup(
    createElement(RulesCopy, { occupied: false }),
  );
  assert.match(empty, /data-page="rules"/);
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /same cleaned brief link may raise/i);
  assert.match(empty, /incomplete or abandoned checkout never appears on the wall/i);
  assert.doesNotMatch(empty, /data-rules-raise/);
  assert.doesNotMatch(empty, /Waffo charges the difference on a raise/);
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
    /A raise charges the original payer only the difference/,
  );
  assert.match(
    occupied,
    /incomplete or abandoned checkout never appears on the wall/i,
  );
  assert.match(occupied, /Rank is the bid/);
  assert.match(occupied, /same cleaned brief link may raise/i);
  assert.doesNotMatch(occupied, /Waffo|outbid\.lol|\bclone\b|\bfixture\b/i);
  assert.doesNotMatch(occupied, /data-raise-difference/);
  assert.doesNotMatch(occupied, /data-raise-charged/);
  assert.doesNotMatch(occupied, /data-raise-charge=/);
  assert.doesNotMatch(occupied, /data-about-raise/);
  assert.doesNotMatch(occupied, /[0-9][0-9,]*\s*(followers|subscribers)/i);
});

test("raise-too-small copy is provider-neutral in empty and occupied states", () => {
  const empty = renderToStaticMarkup(
    createElement(RaiseTooSmallCopy, { occupied: false }),
  );
  assert.match(empty, /data-page="raise-too-small"/);
  assert.match(empty, /data-occupied="false"/);
  assert.match(empty, /No rank change/);
  assert.match(
    empty,
    /incomplete or abandoned checkout stays off the wall/i,
  );
  assert.doesNotMatch(empty, /data-raise-too-small/);
  assert.doesNotMatch(empty, /Waffo still charges only the difference/);
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
  assert.match(occupied, /original payer is charged only the difference/);
  assert.match(occupied, /wall changes only after payment is confirmed/);
  assert.match(occupied, /at least \$1 above the current bid/);
  assert.doesNotMatch(occupied, /data-raise-difference/);
  assert.doesNotMatch(occupied, /data-raise-charged/);
  assert.doesNotMatch(occupied, /data-raise-charge=/);
  assert.doesNotMatch(occupied, /data-about-raise/);
  assert.doesNotMatch(occupied, /data-rules-raise/);
  assert.doesNotMatch(occupied, /Waffo|outbid\.lol|\bclone\b|\bfixture\b/i);
  assert.doesNotMatch(occupied, /[0-9][0-9,]*\s*(followers|subscribers)/i);
});
