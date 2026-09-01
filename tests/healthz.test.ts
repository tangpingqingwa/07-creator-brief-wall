import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resetDbCache } from "../src/lib/db";

test("GET /healthz returns 200 { ok: true }", async () => {
  const previousPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = ":memory:";
  resetDbCache();
  const { GET } = await import("../src/app/healthz/route");
  try {
    const response = await GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    resetDbCache();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
  }
});

test("GET /healthz fails closed before production Waffo traffic when config is absent", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    WAFFO_MODE: process.env.WAFFO_MODE,
    DATABASE_PATH: process.env.DATABASE_PATH,
  };
  env.NODE_ENV = "production";
  env.WAFFO_MODE = "waffo-prod";
  env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "cbw-healthz-")), "app.sqlite");
  resetDbCache();
  const { GET } = await import("../src/app/healthz/route");
  try {
    const response = await GET();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, ready: false });
  } finally {
    resetDbCache();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
});

test("instrumentation register keeps an explicit fixture process usable", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    WAFFO_MODE: process.env.WAFFO_MODE,
    DATABASE_PATH: process.env.DATABASE_PATH,
    NEXT_RUNTIME: process.env.NEXT_RUNTIME,
    NEXT_PHASE: process.env.NEXT_PHASE,
  };
  env.NODE_ENV = "development";
  env.WAFFO_MODE = "fixture";
  env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "cbw-ready-fixture-")), "app.sqlite");
  env.NEXT_RUNTIME = "nodejs";
  delete env.NEXT_PHASE;
  resetDbCache();
  const { register } = await import("../src/instrumentation");
  try {
    await register();
  } finally {
    resetDbCache();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
});

test("instrumentation register rejects production-like traffic before routes", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    WAFFO_MODE: process.env.WAFFO_MODE,
    DATABASE_PATH: process.env.DATABASE_PATH,
    NEXT_RUNTIME: process.env.NEXT_RUNTIME,
    NEXT_PHASE: process.env.NEXT_PHASE,
    WAFFO_MERCHANT_ID: process.env.WAFFO_MERCHANT_ID,
    WAFFO_PRIVATE_KEY: process.env.WAFFO_PRIVATE_KEY,
    WAFFO_PRIVATE_KEY_FILE: process.env.WAFFO_PRIVATE_KEY_FILE,
    WAFFO_STORE_ID: process.env.WAFFO_STORE_ID,
    WAFFO_PRODUCT_ID: process.env.WAFFO_PRODUCT_ID,
    WAFFO_WEBHOOK_PROD_PUBLIC_KEY: process.env.WAFFO_WEBHOOK_PROD_PUBLIC_KEY,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
  };
  env.NODE_ENV = "production";
  env.WAFFO_MODE = "waffo-prod";
  env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "cbw-ready-prod-")), "app.sqlite");
  env.NEXT_RUNTIME = "nodejs";
  delete env.NEXT_PHASE;
  for (const key of [
    "WAFFO_MERCHANT_ID",
    "WAFFO_PRIVATE_KEY",
    "WAFFO_PRIVATE_KEY_FILE",
    "WAFFO_STORE_ID",
    "WAFFO_PRODUCT_ID",
    "WAFFO_WEBHOOK_PROD_PUBLIC_KEY",
    "PUBLIC_BASE_URL",
  ]) delete env[key];
  resetDbCache();
  const { register } = await import("../src/instrumentation");
  try {
    await assert.rejects(
      () => register(),
      /BLOCKED-(SECRET|CONFIG)/,
    );
  } finally {
    resetDbCache();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
});
