import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { openDatabase } from "../src/lib/db";
import {
  FixturePaymentPort,
  WaffoPort,
  checkoutProvider,
  getPaymentPort,
} from "../src/lib/polar";

const IDS = {
  merchant: "MER_2D5F8G3H1K4M6N9P0Q7R8S",
  store: "STO_2aUyqjCzEIiEcYMKj7TZtw",
  product: "PROD_2aUyqjCzEIiEcYMKj7TZtw",
};

function keys(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function baseEnv(mode: "waffo-test" | "waffo-prod" = "waffo-test") {
  const pair = keys();
  return {
    WAFFO_MODE: mode,
    WAFFO_MERCHANT_ID: IDS.merchant,
    WAFFO_PRIVATE_KEY: pair.privateKey,
    WAFFO_STORE_ID: IDS.store,
    WAFFO_PRODUCT_ID: IDS.product,
    WAFFO_WEBHOOK_TEST_PUBLIC_KEY: mode === "waffo-test" ? pair.publicKey : undefined,
    WAFFO_WEBHOOK_PROD_PUBLIC_KEY: mode === "waffo-prod" ? pair.publicKey : undefined,
    PUBLIC_BASE_URL: mode === "waffo-prod"
      ? "https://briefs.example.com"
      : "http://127.0.0.1:3000",
    DATABASE_PATH: "/private/tmp/creator-brief-wall-provider.sqlite",
  };
}

test("provider mode is explicit and legacy flags cannot select a provider", () => {
  assert.equal(checkoutProvider({ WAFFO_MODE: "fixture" }), "fixture");
  assert.equal(checkoutProvider({ WAFFO_MODE: "waffo-test" }), "waffo-test");
  assert.throws(
    () => checkoutProvider({ NODE_ENV: "production", WAFFO_MODE: "waffo-test" }),
    /BLOCKED-CONFIG: WAFFO_MODE/,
  );
  assert.equal(checkoutProvider({ WAFFO_MODE: "waffo-prod" }), "waffo-prod");
  assert.throws(
    () => checkoutProvider({ WAFFO_MODE: "waffo-prod " }),
    /BLOCKED-CONFIG: WAFFO_MODE/,
    "non-canonical whitespace must not select a live provider",
  );
  assert.throws(
    () => checkoutProvider({ WAFFO_FIXTURE_ONLY: "1" }),
    /BLOCKED-CONFIG: WAFFO_MODE/,
    "legacy provider flags cannot select the Waffo fixture",
  );
  assert.throws(() => checkoutProvider({}), /BLOCKED-CONFIG: WAFFO_MODE/);
  assert.throws(() => checkoutProvider({ WAFFO_LIVE: "1" }), /BLOCKED-CONFIG: WAFFO_MODE/);
  assert.throws(() => checkoutProvider({ WAFFO_LIVE: "1" }), /BLOCKED-CONFIG: WAFFO_MODE/);
  assert.throws(
    () => checkoutProvider({ WAFFO_MODE: "waffo-prod", WAFFO_LIVE: "1" }),
    /BLOCKED-CONFIG: WAFFO_MODE/,
  );
});

test("fixture selection is explicit; missing production mode never constructs FixturePaymentPort", () => {
  const db = openDatabase(":memory:");
  const previousMode = process.env.WAFFO_MODE;
  const previousWaffoFixture = process.env.WAFFO_FIXTURE_ONLY;
  delete process.env.WAFFO_MODE;
  delete process.env.WAFFO_FIXTURE_ONLY;
  try {
    assert.throws(
      () => getPaymentPort(db),
      /BLOCKED-CONFIG: WAFFO_MODE/,
    );
  } finally {
    if (previousMode === undefined) delete process.env.WAFFO_MODE;
    else process.env.WAFFO_MODE = previousMode;
    if (previousWaffoFixture === undefined) delete process.env.WAFFO_FIXTURE_ONLY;
    else process.env.WAFFO_FIXTURE_ONLY = previousWaffoFixture;
  }
  assert.throws(
    () => checkoutProvider({ NODE_ENV: "production", WAFFO_MODE: "fixture" }),
    /BLOCKED-CONFIG: WAFFO_MODE/,
  );
  assert.ok(new FixturePaymentPort(db));
  db.close();
});

test("explicit Waffo test mode uses the official anonymous checkout shape", async () => {
  const env = baseEnv();
  const db = openDatabase(":memory:");
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const port = new WaffoPort({
    env,
    db,
    fetch: async (input, init) => {
      requests.push({ url: String(input), init: init as RequestInit });
      return new Response(
        JSON.stringify({
          data: {
            sessionId: "SES_2aUyqjCzEIiEcYMKj7TZtw",
            checkoutUrl: "https://pancake.waffo.ai/store/test-store/checkout/SES_2aUyqjCzEIiEcYMKj7TZtw",
            expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
  });
  const started = await port.createCheckout({
    amountUsd: 5,
    listingDraft: {
      weekId: "2026-W34",
      brand: "Acme",
      terms: "$800 flat, 1 TikTok",
      briefUrl: "https://example.com/acme",
      bidUsd: 5,
    },
    successUrl: "http://ignored.example/return",
  });
  assert.equal(started.checkoutId, "SES_2aUyqjCzEIiEcYMKj7TZtw");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://api.waffo.ai/v1/actions/checkout/create-session");
  const body = JSON.parse(String(requests[0]?.init.body)) as Record<string, unknown>;
  assert.deepEqual(body.productId, IDS.product);
  assert.equal(body.currency, "USD");
  assert.deepEqual(body.priceSnapshot, {
    amount: "5.00",
    taxCategory: "digital_goods",
  });
  assert.match(
    String(body.successUrl),
    /^http:\/\/127\.0\.0\.1:3000\/checkout\/complete\?intent=[^&]+$/,
  );
  assert.equal(typeof body.orderMerchantExternalId, "string");
  assert.equal(typeof (body.metadata as Record<string, unknown>).intentFingerprint, "string");
  assert.equal(Object.values(body.metadata as Record<string, unknown>).every((value) => typeof value === "string"), true);
  const intent = db.prepare("SELECT status, charge_cents, session_id FROM checkout_intents").get() as {
    status: string;
    charge_cents: number;
    session_id: string;
  };
  assert.deepEqual(intent, {
    status: "attached",
    charge_cents: 500,
    session_id: started.checkoutId,
  });
  db.close();
});

test("Waffo production mode fails closed for every required boundary value", () => {
  const complete = baseEnv("waffo-prod");
  const required = [
    "WAFFO_MERCHANT_ID",
    "WAFFO_PRIVATE_KEY",
    "WAFFO_STORE_ID",
    "WAFFO_PRODUCT_ID",
    "WAFFO_WEBHOOK_PROD_PUBLIC_KEY",
    "PUBLIC_BASE_URL",
    "DATABASE_PATH",
  ] as const;
  for (const name of required) {
    const env = { ...complete } as Record<string, string | undefined>;
    delete env[name];

    assert.throws(
      () => new WaffoPort({ env, db: openDatabase(":memory:") }),
      /BLOCKED-(SECRET|CONFIG):/,
      `missing ${name} must fail closed`,
    );
  }
  assert.throws(
    () => new WaffoPort({ env: { ...complete, DATABASE_PATH: ":memory:" }, db: openDatabase(":memory:") }),
    /BLOCKED-CONFIG: DATABASE_PATH/,
  );
  assert.throws(
    () => new WaffoPort({
      env: { ...complete, PUBLIC_BASE_URL: "https://127.0.0.1:3000" },
      db: openDatabase(":memory:"),
    }),
    /BLOCKED-CONFIG: PUBLIC_BASE_URL/,
  );
  assert.throws(
    () => new WaffoPort({
      env: { ...complete, PUBLIC_BASE_URL: "https://briefs.example.com", WAFFO_API_BASE: "https://evil.example" },
      db: openDatabase(":memory:"),
    }),
    /BLOCKED-CONFIG: WAFFO_API_BASE/,
  );
});

test("Waffo webhook keys are mode-scoped and provider checkout URLs stay public HTTPS", async () => {
  const complete = baseEnv("waffo-test");
  const withoutScopedKey = { ...complete } as Record<string, string | undefined>;
  delete withoutScopedKey.WAFFO_WEBHOOK_TEST_PUBLIC_KEY;
  assert.throws(
    () => new WaffoPort({ env: withoutScopedKey, db: openDatabase(":memory:") }),
    /BLOCKED-SECRET: WAFFO_WEBHOOK_TEST_PUBLIC_KEY/,
  );

  const db = openDatabase(":memory:");
  const port = new WaffoPort({
    env: complete,
    db,
    fetch: async () =>
      new Response(
        JSON.stringify({
          data: {
            sessionId: "SES_private_url",
            checkoutUrl: "https://127.0.0.1/checkout/SES_private_url",
            expiresAt: "2026-09-01T00:00:00.000Z",
          },
        }),
        { status: 201 },
      ),
  });
  await assert.rejects(
    port.createCheckout({
      amountUsd: 5,
      listingDraft: {
        weekId: "2026-W34",
        brand: "Private URL",
        terms: "one vertical video",
        briefUrl: "https://example.com/private-url",
        bidUsd: 5,
      },
      successUrl: "http://ignored.example/return",
    }),
    /Waffo checkout response missing session identity\/url\/expiry/,
  );
  db.close();
});

test("Waffo checkout responses require the documented hosted session and usable expiry", async () => {
  const cases = [
    {
      name: "wrong path",
      checkoutUrl: "https://pancake.waffo.ai/checkout/SES_contract_url",
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    },
    {
      name: "session mismatch",
      checkoutUrl: "https://pancake.waffo.ai/store/test-store/checkout/SES_other_url",
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    },
    {
      name: "expired",
      checkoutUrl: "https://pancake.waffo.ai/store/test-store/checkout/SES_contract_url",
      expiresAt: "1970-01-01T00:00:00.000Z",
    },
  ];
  for (const item of cases) {
    const db = openDatabase(":memory:");
    const port = new WaffoPort({
      env: baseEnv(),
      db,
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: {
              sessionId: "SES_contract_url",
              checkoutUrl: item.checkoutUrl,
              expiresAt: item.expiresAt,
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    });
    await assert.rejects(
      port.createCheckout({
        amountUsd: 5,
        listingDraft: {
          weekId: "2026-W34",
          brand: `Invalid ${item.name}`,
          terms: "one vertical video",
          briefUrl: `https://example.com/invalid-${item.name.replace(/ /g, "-")}`,
          bidUsd: 5,
        },
        successUrl: "http://ignored.example/return",
      }),
      /Waffo checkout response missing session identity\/url\/expiry/,
      item.name,
    );
    assert.equal(
      (db.prepare("SELECT status FROM checkout_intents").get() as { status: string }).status,
      "unknown",
      `${item.name} must remain recoverable rather than attach an unsafe session`,
    );
    db.close();
  }
});

test("live Waffo adapter requires a durable injected database", () => {
  const env = baseEnv();
  assert.throws(
    () => new WaffoPort({ env }),
    /BLOCKED-CONFIG: durable database/,
  );
});
