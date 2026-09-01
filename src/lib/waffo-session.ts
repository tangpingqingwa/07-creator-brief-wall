import { createHash, createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export type WaffoEnv = Record<string, string | undefined>;

export const DEFAULT_WAFFO_API_BASE = "https://api.waffo.ai";

export function polarFixtureOnly(env: WaffoEnv = process.env): boolean {
  return env.POLAR_FIXTURE_ONLY === "1";
}

export function isWaffoLive(env: WaffoEnv = process.env): boolean {
  if (polarFixtureOnly(env)) return false;
  return env.WAFFO_LIVE === "1";
}

export function waffoApiBase(env: WaffoEnv = process.env): string {
  const fromEnv = env.WAFFO_API_BASE?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return DEFAULT_WAFFO_API_BASE;
}

export function requireWaffoSecret(
  name: "WAFFO_MERCHANT_ID" | "WAFFO_PRODUCT_ID" | "WAFFO_STORE_ID",
  env: WaffoEnv = process.env,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`BLOCKED-SECRET: ${name}`);
  }
  return value;
}

export function waffoPrivateKey(env: WaffoEnv = process.env): string {
  const inline = env.WAFFO_PRIVATE_KEY?.trim();
  if (inline) return inline.replace(/\\n/g, "\n");
  const file = env.WAFFO_PRIVATE_KEY_FILE?.trim();
  if (file) {
    const value = readFileSync(file, "utf8").trim();
    if (value) return value;
  }
  throw new Error("BLOCKED-SECRET: WAFFO_PRIVATE_KEY");
}

export function requireWaffoLiveSecrets(env: WaffoEnv = process.env): void {
  requireWaffoSecret("WAFFO_MERCHANT_ID", env);
  requireWaffoSecret("WAFFO_PRODUCT_ID", env);
  waffoPrivateKey(env);
}

export async function createWaffoCheckoutSession(input: {
  env?: WaffoEnv;
  fetch?: typeof fetch;
  amountUsd: number;
  successUrl: string;
  metadata?: Record<string, string>;
}): Promise<{ checkoutId: string; url: string }> {
  const env = input.env ?? process.env;
  const fetchFn = input.fetch ?? fetch;
  const productId = requireWaffoSecret("WAFFO_PRODUCT_ID", env);
  const payload = {
    productId,
    currency: "USD",
    successUrl: input.successUrl,
    metadata: input.metadata ?? {},
    priceSnapshot: {
      USD: {
        amount: input.amountUsd.toFixed(2),
        taxIncluded: false,
        taxCategory: "saas",
      },
    },
  };
  const response = await signedWaffoFetch(
    env,
    fetchFn,
    "POST",
    "/v1/actions/checkout/create-session",
    payload,
  );
  if (!response.ok) {
    throw new Error(`waffo checkout failed: ${response.status}`);
  }
  const body = (await response.json()) as { data?: Record<string, unknown> };
  const data = isRecord(body.data) ? body.data : {};
  const checkoutId = readString(data.sessionId);
  const url = readString(data.checkoutUrl);
  if (!checkoutId || !url) {
    throw new Error("waffo checkout response missing sessionId/checkoutUrl");
  }
  return { checkoutId, url };
}

export async function signedWaffoFetch(
  env: WaffoEnv,
  fetchFn: typeof fetch,
  method: string,
  path: string,
  payload: unknown,
): Promise<Response> {
  const merchantId = requireWaffoSecret("WAFFO_MERCHANT_ID", env);
  const privateKey = waffoPrivateKey(env);
  const bodyStr = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = createHash("sha256").update(bodyStr).digest("base64");
  const canonical = `${method}\n${path}\n${timestamp}\n${bodyHash}`;
  const signature = createSign("sha256")
    .update(canonical)
    .end()
    .sign(privateKey, "base64");
  return fetchFn(`${waffoApiBase(env)}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-merchant-id": merchantId,
      "x-timestamp": timestamp,
      "x-signature": signature,
    },
    body: bodyStr,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}
