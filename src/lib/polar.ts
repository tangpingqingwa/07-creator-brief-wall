import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import {
  WaffoPancake,
  WaffoPancakeError,
  TaxCategory,
  type WebhookEvent,
  type WebhookEventData,
  type WebhookPublicKeys,
} from "@waffo/pancake-ts";
import type { AppDb, ListingRow } from "./db";
import { getDb, isMemoryDatabasePath } from "./db";
import {
  listingFromRow,
  MAX_BID_USD,
  MIN_BID_USD,
  place,
  quoteCheckout,
  raise,
  type CheckoutQuote,
  type Listing,
} from "./rank";
import { canonicalizeBriefUrl, UrlError } from "./urls";
import { findLiveListingByBrief, nowUtc, utcWeekId } from "./week";

export { utcWeekId } from "./week";

export type PaymentEnv = Record<string, string | undefined>;

/** The only Waffo API origin accepted by the production adapter. */
export const WAFFO_API_BASE = "https://api.waffo.ai";

export function waffoApiBase(env: PaymentEnv = process.env): string {
  const configured = env.WAFFO_API_BASE?.trim();
  return configured ? configured.replace(/\/$/, "") : WAFFO_API_BASE;
}

export type ListingDraft = {
  weekId: string;
  brand: string;
  terms: string;
  briefUrl: string;
  bidUsd: number;
};

export type CheckoutStart = {
  checkoutId: string;
  url: string;
};

export type CheckoutStatus = "open" | "paid" | "canceled";

export type CheckoutRecord = {
  checkoutId: string;
  amountUsd: number;
  kind: "place" | "raise";
  listingDraft: ListingDraft;
  successUrl: string;
  status: CheckoutStatus;
  listingId?: string;
};

export type CheckoutReturnPayment = {
  kind: "place" | "raise";
  chargeUsd: number;
};

export type CheckoutReturnResult = {
  status:
    | "success"
    | "pending"
    | "unknown"
    | "reconciliation"
    | "rejected"
    | "cancel";
  listing: Listing | null;
  payment: CheckoutReturnPayment | null;
};

export type CreateCheckoutInput = {
  amountUsd: number;
  listingDraft: ListingDraft;
  successUrl: string;
};

export type PaidEvent = {
  eventId: string;
  orderId: string;
  eventType: "order.paid" | "order.completed";
  checkoutId: string;
  draft: ListingDraft;
  amountUsd: number;
  amountCents: number;
  currency: string;
  productId: string;
  paidAt: string;
  payloadHash: string;
  metadataChargeCents?: number;
  /** Fixture events are local; signed settlement events are explicitly Waffo. */
  provider?: "fixture" | "waffo";
  /** Waffo's immutable local correlation key. */
  intentId?: string;
  /** Waffo delivery/business identifiers and facts. */
  deliveryId?: string;
  paymentId?: string;
  businessEventId?: string;
  metadataIntentId?: string;
  intentFingerprint?: string;
  targetBidCents?: number;
  quoteBaseBidCents?: number;
  mode?: "test" | "prod";
  storeId?: string;
  metadataFingerprint?: string;
  /** Waffo's verified body fingerprint with delivery id excluded. */
  providerPayloadFingerprint?: string;
  validationError?: { code: string; httpStatus: number; message: string };
  subtotalCents?: number;
  taxCents?: number;
};

export type WebhookResult = PaidEvent | { ignored: true };

export type PaidEventApplyResult = {
  listing: Listing | null;
  replayed: boolean;
  /** False means a durable rejected/reconciliation replay was acknowledged. */
  applied?: boolean;
};

export type PaymentPort = {
  readonly kind: "fixture" | "live";
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart>;
  completeCheckout(checkoutId: string): Promise<Listing | null>;
  abandonCheckout(checkoutId: string): Promise<void>;
  getCheckout(checkoutId: string): CheckoutRecord | undefined;
  parseWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<WebhookResult>;
};

export class CheckoutError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CheckoutError";
  }
}

export type WaffoProviderMode = "fixture" | "waffo-test" | "waffo-prod";

function canonicalWaffoMode(value: unknown): WaffoProviderMode | undefined {
  if (value === "fixture" || value === "waffo-test" || value === "waffo-prod") {
    return value;
  }
  return undefined;
}

export function isWaffoLive(env: PaymentEnv = process.env): boolean {
  const mode = canonicalWaffoMode(env.WAFFO_MODE);
  return mode === "waffo-test" || mode === "waffo-prod";
}

export function checkoutProvider(
  env: PaymentEnv = process.env,
): WaffoProviderMode {
  const mode = canonicalWaffoMode(env.WAFFO_MODE);
  if (mode === "fixture") {
    if (env.NODE_ENV === "production" || env.WAFFO_LIVE === "1") {
      throw new Error("BLOCKED-CONFIG: WAFFO_MODE");
    }
    return "fixture";
  }
  if (mode === "waffo-test") {
    if (env.NODE_ENV === "production" || env.WAFFO_LIVE === "1") {
      throw new Error("BLOCKED-CONFIG: WAFFO_MODE");
    }
    return mode;
  }
  if (mode === "waffo-prod") {
    if (env.WAFFO_LIVE === "1") {
      throw new Error("BLOCKED-CONFIG: WAFFO_MODE");
    }
    return mode;
  }
  throw new Error("BLOCKED-CONFIG: WAFFO_MODE");
}

function productionDatabaseConfigured(
  env: PaymentEnv,
  mode?: "waffo-test" | "waffo-prod",
): boolean {
  const path = env.DATABASE_PATH?.trim();
  return (
    env.NODE_ENV !== "production" && mode !== "waffo-prod"
  ) || (!!path && !isMemoryDatabasePath(path));
}

function publicBaseUrl(env: PaymentEnv, mode: WaffoProviderMode): string {
  const value = env.PUBLIC_BASE_URL?.trim();
  if (!value) throw new Error("BLOCKED-CONFIG: PUBLIC_BASE_URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BLOCKED-CONFIG: PUBLIC_BASE_URL");
  }
  const productionLike = env.NODE_ENV === "production" || mode === "waffo-prod";
  if (productionLike && !isPublicHttpsUrl(url)) {
    throw new Error("BLOCKED-CONFIG: PUBLIC_BASE_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BLOCKED-CONFIG: PUBLIC_BASE_URL");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("BLOCKED-CONFIG: PUBLIC_BASE_URL");
  }
  return url.origin;
}

function isPublicHttpsUrl(url: URL): boolean {
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port
  ) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host.endsWith(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    host.endsWith(".example")
  ) {
    return false;
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const ip = host.split(".").map(Number);
    if (
      ip[0] === 0 ||
      ip[0] === 10 ||
      ip[0] === 127 ||
      (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) ||
      (ip[0] === 192 && ip[1] === 168) ||
      (ip[0] === 169 && ip[1] === 254) ||
      (ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127) ||
      (ip[0] === 192 && ip[1] === 0 && ip[2] === 0) ||
      (ip[0] === 192 && ip[1] === 0 && ip[2] === 2) ||
      (ip[0] === 192 && ip[1] === 88 && ip[2] === 99) ||
      (ip[0] === 198 && ip[1] >= 18 && ip[1] <= 19) ||
      (ip[0] === 198 && ip[1] === 51 && ip[2] === 100) ||
      (ip[0] === 203 && ip[1] === 0 && ip[2] === 113) ||
      ip[0] >= 224
    ) {
      return false;
    }
    return true;
  }
  if (ipVersion === 6) {
    const normalized = host.toLowerCase();
    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:192.168.")
    ) {
      return false;
    }
    return true;
  }
  // A production callback must be an actual DNS name, not a bare host or an
  // IPv6 literal. DNS resolution is intentionally not performed here.
  return host.includes(".") && !host.includes(":");
}

function waffoWebhookPublicKey(
  env: PaymentEnv,
  mode: "test" | "prod",
): string | undefined {
  return env[`WAFFO_WEBHOOK_${mode.toUpperCase()}_PUBLIC_KEY`]?.trim();
}

function waffoPrivateKeyFromEnv(env: PaymentEnv): string {
  const inline = env.WAFFO_PRIVATE_KEY?.trim();
  if (inline) return inline.replace(/\\n/g, "\n");
  const file = env.WAFFO_PRIVATE_KEY_FILE?.trim();
  if (file) {
    try {
      const key = readFileSync(file, "utf8").trim().replace(/\\n/g, "\n");
      if (key) return key;
    } catch {
      // Treat an unreadable configured key exactly like an absent key.
    }
  }
  throw new Error("BLOCKED-SECRET: WAFFO_PRIVATE_KEY");
}

function normalizePrivateKeyForValidation(raw: string): string {
  const normalized = raw.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
  if (normalized.includes("-----BEGIN")) return normalized;
  const base64 = normalized.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) {
    throw new Error("invalid-base64");
  }
  const wrapped = base64.match(/.{1,64}/g)?.join("\n");
  if (!wrapped) throw new Error("empty-key");
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
}

function validatePrivateKeyMaterial(raw: string): void {
  try {
    const key = createPrivateKey(normalizePrivateKeyForValidation(raw));
    if (key.asymmetricKeyType !== "rsa") throw new Error("not-rsa");
  } catch {
    throw new Error("BLOCKED-CONFIG: WAFFO_PRIVATE_KEY must be a valid RSA private key");
  }
}

function normalizePublicKeyForValidation(raw: string): string {
  const normalized = raw.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
  if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(normalized)) {
    throw new Error("private-key");
  }
  if (normalized.includes("-----BEGIN")) return normalized;
  const base64 = normalized.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) {
    throw new Error("invalid-base64");
  }
  const wrapped = base64.match(/.{1,64}/g)?.join("\n");
  if (!wrapped) throw new Error("empty-key");
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`;
}

function validatePublicKeyMaterial(raw: string): string {
  try {
    const normalized = normalizePublicKeyForValidation(raw);
    const key = createPublicKey(normalized);
    if (key.asymmetricKeyType !== "rsa") throw new Error("not-rsa");
    return normalized;
  } catch {
    throw new Error("BLOCKED-CONFIG: Waffo webhook key must be a valid RSA public key");
  }
}

function requireWaffoRuntime(
  env: PaymentEnv,
  mode: "waffo-test" | "waffo-prod",
  db?: AppDb,
  publicKeyOverride?: WebhookPublicKeys,
): { environment: "test" | "prod"; publicKey?: string } {
  const environment = mode === "waffo-test" ? "test" : "prod";
  requireWaffoValue(env, "WAFFO_MERCHANT_ID");
  requireWaffoValue(env, "WAFFO_PRODUCT_ID");
  requireWaffoValue(env, "WAFFO_STORE_ID");
  validatePrivateKeyMaterial(waffoPrivateKeyFromEnv(env));
  const configuredPublicKey = waffoWebhookPublicKey(env, environment);
  const overridePublicKey =
    typeof publicKeyOverride === "string"
      ? publicKeyOverride.trim()
      : publicKeyOverride?.[environment]?.trim();
  const publicKey = mode === "waffo-prod"
    ? configuredPublicKey
    : overridePublicKey ?? configuredPublicKey;
  if (!publicKey) {
    throw new Error(`BLOCKED-SECRET: WAFFO_WEBHOOK_${environment.toUpperCase()}_PUBLIC_KEY`);
  }
  const normalizedPublicKey = validatePublicKeyMaterial(publicKey);
  publicBaseUrl(env, mode);
  let apiUrl: URL;
  try {
    apiUrl = new URL(waffoApiBase(env));
  } catch {
    throw new Error("BLOCKED-CONFIG: WAFFO_API_BASE");
  }
  if (
    apiUrl.origin !== WAFFO_API_BASE ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.pathname !== "/" ||
    apiUrl.search ||
    apiUrl.hash
  ) {
    throw new Error("BLOCKED-CONFIG: WAFFO_API_BASE");
  }
  if (!productionDatabaseConfigured(env, mode)) {
    throw new Error("BLOCKED-CONFIG: DATABASE_PATH");
  }
  if (!db || (mode === "waffo-prod" && db.memory)) {
    throw new Error("BLOCKED-CONFIG: durable database");
  }
  return { environment, publicKey: normalizedPublicKey };
}

function requireWaffoValue(
  env: PaymentEnv,
  name: "WAFFO_MERCHANT_ID" | "WAFFO_PRODUCT_ID" | "WAFFO_STORE_ID",
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`BLOCKED-SECRET: ${name}`);
  const prefix = name === "WAFFO_MERCHANT_ID"
    ? "MER"
    : name === "WAFFO_STORE_ID"
      ? "STO"
      : "PROD";
  if (!new RegExp(`^${prefix}_[0-9A-Za-z]{22}$`).test(value)) {
    throw new Error(`BLOCKED-CONFIG: ${name} must be a valid Waffo Short ID`);
  }
  return value;
}

export type CheckoutProvider = WaffoProviderMode;

export function parseBidUsd(raw: unknown): number {
  if (typeof raw === "boolean") {
    throw new CheckoutError("invalid_bid", 400, "Bid must be a whole US dollar amount");
  }
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) {
      throw new CheckoutError("invalid_bid", 400, "Bid must be a whole US dollar amount");
    }
    return assertBidRange(raw);
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new CheckoutError("invalid_bid", 400, "Bid must be a whole US dollar amount");
  }
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new CheckoutError("invalid_bid", 400, "Bid must be a whole US dollar amount");
  }
  return assertBidRange(Number(trimmed));
}

function assertBidRange(value: number): number {
  const check = place(value);
  if (!check.ok) {
    const code =
      value < MIN_BID_USD
        ? "bid_below_min"
        : value > MAX_BID_USD
          ? "bid_above_max"
          : "invalid_bid";
    throw new CheckoutError(code, 400, check.error);
  }
  return check.bidUsd;
}

export function parseCheckoutInput(input: {
  brand?: unknown;
  terms?: unknown;
  briefUrl?: unknown;
  bidUsd?: unknown;
  weekId?: string;
}): ListingDraft {
  const brand = readRequiredText(input.brand, "brand", 80);
  const terms = readRequiredText(input.terms, "terms", 280);
  const briefUrl = readBriefUrl(input.briefUrl);
  const bidUsd = parseBidUsd(input.bidUsd);
  return {
    weekId: input.weekId ?? utcWeekId(),
    brand,
    terms,
    briefUrl,
    bidUsd,
  };
}

function readRequiredText(
  value: unknown,
  field: "brand" | "terms" | "briefUrl",
  max: number,
): string {
  if (typeof value !== "string") {
    throw new CheckoutError("missing_field", 400, `Missing ${field}`);
  }
  const text = value.trim();
  if (text.length < 1 || text.length > max) {
    throw new CheckoutError("missing_field", 400, `Missing ${field}`);
  }
  return text;
}

function readBriefUrl(value: unknown): string {
  const raw = readRequiredText(value, "briefUrl", 2048);
  try {
    return canonicalizeBriefUrl(raw);
  } catch (error) {
    if (error instanceof UrlError) {
      throw new CheckoutError(error.code, error.httpStatus, error.message);
    }
    throw error;
  }
}

type DraftRow = {
  checkout_id: string;
  week_id: string;
  brand: string;
  terms: string;
  brief_url: string;
  bid_usd: number;
  status: CheckoutStatus;
  listing_id: string | null;
  created_at: string;
  completed_at: string | null;
};

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function draftFromRow(row: DraftRow): ListingDraft {
  return {
    weekId: row.week_id,
    brand: row.brand,
    terms: row.terms,
    briefUrl: row.brief_url,
    bidUsd: row.bid_usd,
  };
}

const LISTING_SELECT = `SELECT id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
         FROM listings`;

/**
 * Audit lookup by Waffo `weekId` label.
 * Raise identity is `findLiveListingByBrief` (last 7 days), not this weekId.
 */
export function findListingByBrief(
  db: AppDb,
  weekId: string,
  briefUrl: string,
): Listing | undefined {
  const row = db
    .prepare(`${LISTING_SELECT} WHERE week_id = ? AND brief_url = ?`)
    .get(weekId, briefUrl) as ListingRow | undefined;
  return row ? listingFromRow(row) : undefined;
}

export function getListingById(
  db: AppDb,
  listingId: string,
): Listing | undefined {
  const row = db
    .prepare(`${LISTING_SELECT} WHERE id = ?`)
    .get(listingId) as ListingRow | undefined;
  return row ? listingFromRow(row) : undefined;
}

/** Same canonical brief URL still inside last 7 days is a raise. weekId is not the raise key. */
export function planCheckout(
  db: AppDb,
  draft: ListingDraft,
): Extract<CheckoutQuote, { ok: true }> {
  const existing = findLiveListingByBrief(db, draft.briefUrl);
  const quote = quoteCheckout(existing, draft.bidUsd);
  if (!quote.ok) {
    throw new CheckoutError(checkoutErrorCode(draft.bidUsd, existing), 400, quote.error);
  }
  return quote;
}

function checkoutErrorCode(
  bidUsd: number,
  existing: Listing | undefined,
): string {
  if (!Number.isInteger(bidUsd)) {
    return "invalid_bid";
  }
  if (bidUsd > MAX_BID_USD) {
    return "bid_above_max";
  }
  if (existing) {
    return "raise_too_small";
  }
  if (bidUsd < MIN_BID_USD) {
    return "bid_below_min";
  }
  return "invalid_bid";
}

function loadListingForCompletedCheckout(
  db: AppDb,
  checkoutId: string,
): Listing | undefined {
  const existingPayment = db
    .prepare(
      `SELECT listing_id FROM payments
       WHERE polar_checkout_id = ? AND status = 'completed'`,
    )
    .get(checkoutId) as { listing_id: string | null } | undefined;
  if (!existingPayment?.listing_id) {
    return undefined;
  }
  return getListingById(db, existingPayment.listing_id);
}

type CheckoutSessionRow = DraftRow & {
  payment_id: string;
  payment_amount_usd: number;
  payment_kind: "place" | "raise";
  payment_status: "pending" | "completed" | "canceled";
  provider_product_id: string | null;
};

function loadCheckoutSession(
  db: AppDb,
  checkoutId: string,
): CheckoutSessionRow | undefined {
  return db
    .prepare(
      `SELECT d.checkout_id, d.week_id, d.brand, d.terms, d.brief_url,
              d.bid_usd, d.status, d.listing_id, d.created_at, d.completed_at,
              p.id AS payment_id, p.amount_usd AS payment_amount_usd,
              p.kind AS payment_kind, p.status AS payment_status,
              s.provider_product_id
       FROM checkout_drafts AS d
       JOIN payments AS p ON p.polar_checkout_id = d.checkout_id
       LEFT JOIN checkout_provider_sessions AS s ON s.checkout_id = d.checkout_id
       WHERE d.checkout_id = ?`,
    )
    .get(checkoutId) as CheckoutSessionRow | undefined;
}

function requirePendingCheckout(
  db: AppDb,
  checkoutId: string,
): CheckoutSessionRow {
  const session = loadCheckoutSession(db, checkoutId);
  if (!session) {
    throw new CheckoutError(
      "unknown_checkout",
      400,
      "Paid webhook references an unknown checkout",
    );
  }
  if (session.status !== "open" || session.payment_status !== "pending") {
    throw new CheckoutError(
      "checkout_not_pending",
      409,
      "Checkout has already been settled or canceled",
    );
  }
  return session;
}

function draftsEqual(left: ListingDraft, right: ListingDraft): boolean {
  return (
    left.weekId === right.weekId &&
    left.brand === right.brand &&
    left.terms === right.terms &&
    left.briefUrl === right.briefUrl &&
    left.bidUsd === right.bidUsd
  );
}

export function applyPaidListing(
  db: AppDb,
  draft: ListingDraft,
  checkoutId: string,
  paidAt: string,
): Listing {
  return db
    .transaction(() => settlePendingListing(db, draft, checkoutId, paidAt))
    .immediate();
}

function settlePendingListing(
  db: AppDb,
  draft: ListingDraft,
  checkoutId: string,
  paidAt: string,
  expectedAmountUsd?: number,
): Listing {
  const replayed = loadListingForCompletedCheckout(db, checkoutId);
  if (replayed) {
    return replayed;
  }

  const session = requirePendingCheckout(db, checkoutId);
  const localDraft = draftFromRow(session);
  if (!draftsEqual(localDraft, draft)) {
    throw new CheckoutError(
      "metadata_mismatch",
      400,
      "Paid checkout metadata does not match the local checkout",
    );
  }
  const quote = planCheckout(db, localDraft);
  if (
    quote.kind !== session.payment_kind ||
    quote.chargeUsd !== session.payment_amount_usd
  ) {
    throw new CheckoutError(
      "checkout_state_mismatch",
      409,
      "Checkout amount or rank changed before payment was confirmed",
    );
  }
  if (
    expectedAmountUsd !== undefined &&
    expectedAmountUsd !== session.payment_amount_usd
  ) {
    throw new CheckoutError(
      "amount_mismatch",
      400,
      "Paid amount does not match the local checkout",
    );
  }

  if (quote.kind === "raise") {
    return applyPaidRaise(db, localDraft, quote, checkoutId, paidAt);
  }
  return applyPaidPlace(db, localDraft, quote, checkoutId, paidAt);
}

function applyPaidPlace(
  db: AppDb,
  draft: ListingDraft,
  quote: Extract<CheckoutQuote, { ok: true; kind: "place" }>,
  checkoutId: string,
  paidAt: string,
): Listing {
  const listingId = newId("lst");
  db.prepare(
    `INSERT INTO listings (
      id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    listingId,
    draft.weekId,
    draft.brand,
    draft.terms,
    draft.briefUrl,
    null,
    quote.bidUsd,
    0,
    paidAt,
    paidAt,
  );
  completePayment(db, {
    checkoutId,
    listingId,
    draft,
    amountUsd: quote.chargeUsd,
    kind: "place",
    paidAt,
  });

  return {
    id: listingId,
    weekId: draft.weekId,
    brand: draft.brand,
    terms: draft.terms,
    briefUrl: draft.briefUrl,
    bidUsd: quote.bidUsd,
    clicks: 0,
    createdAt: paidAt,
    updatedAt: paidAt,
  };
}

function applyPaidRaise(
  db: AppDb,
  draft: ListingDraft,
  quote: Extract<CheckoutQuote, { ok: true; kind: "raise" }>,
  checkoutId: string,
  paidAt: string,
): Listing {
  const existing = findLiveListingByBrief(db, draft.briefUrl);
  if (!existing) {
    throw new CheckoutError(
      "raise_too_small",
      400,
      "Raise without paying the difference",
    );
  }
  const check = raise(existing, draft.bidUsd);
  if (!check.ok || check.chargeUsd !== quote.chargeUsd) {
    throw new CheckoutError(
      "raise_too_small",
      400,
      check.ok ? "Raise without paying the difference" : check.error,
    );
  }

  db.prepare(
    `UPDATE listings
     SET brand = ?, terms = ?, bid_usd = ?, updated_at = ?
     WHERE id = ?`,
  ).run(draft.brand, draft.terms, check.newBidUsd, paidAt, existing.id);
  completePayment(db, {
    checkoutId,
    listingId: existing.id,
    draft,
    amountUsd: check.chargeUsd,
    kind: "raise",
    paidAt,
  });

  return {
    ...existing,
    brand: draft.brand,
    terms: draft.terms,
    bidUsd: check.newBidUsd,
    updatedAt: paidAt,
  };
}

function completePayment(
  db: AppDb,
  input: {
    checkoutId: string;
    listingId: string;
    draft: ListingDraft;
    amountUsd: number;
    kind: "place" | "raise";
    paidAt: string;
  },
): void {
  const pending = db
    .prepare(
      `SELECT id, amount_usd, kind, status FROM payments WHERE polar_checkout_id = ?`,
    )
    .get(input.checkoutId) as
    | { id: string; amount_usd: number; kind: string; status: string }
    | undefined;
  if (!pending) {
    throw new CheckoutError(
      "unknown_checkout",
      400,
      "Paid checkout has no local pending payment",
    );
  }
  if (pending.status !== "pending") {
    throw new CheckoutError(
      "checkout_not_pending",
      409,
      "Checkout has already been settled or canceled",
    );
  }
  if (pending.kind !== input.kind) {
    throw new CheckoutError(
      "checkout_state_mismatch",
      409,
      "Checkout kind does not match the local quote",
    );
  }
  if (pending.amount_usd !== input.amountUsd) {
    throw new CheckoutError(
      "raise_charge_mismatch",
      400,
      "Raise without paying the difference",
    );
  }

  db.prepare(
    `UPDATE payments
     SET listing_id = ?, status = 'completed', completed_at = ?, kind = ?, amount_usd = ?
     WHERE polar_checkout_id = ? AND status = 'pending'`,
  ).run(
    input.listingId,
    input.paidAt,
    input.kind,
    input.amountUsd,
    input.checkoutId,
  );

  db.prepare(
    `UPDATE checkout_drafts
     SET status = 'paid', listing_id = ?, completed_at = ?
     WHERE checkout_id = ?`,
  ).run(input.listingId, input.paidAt, input.checkoutId);
}

type WebhookEventRow = {
  event_id: string;
  order_id: string | null;
  checkout_id: string | null;
  intent_id: string | null;
  event_type: string;
  payload_hash: string;
  product_id: string | null;
  currency: string | null;
  amount_cents: number | null;
  metadata_hash: string | null;
  status: "applied" | "rejected" | "reconciliation_required";
  outcome_code: string;
  outcome_message: string;
};

function loadWebhookEvent(
  db: AppDb,
  eventId: string,
): WebhookEventRow | undefined {
  return db
    .prepare(
      `SELECT event_id, order_id, checkout_id, event_type, payload_hash, status,
              intent_id, product_id, currency, amount_cents, metadata_hash,
              outcome_code, outcome_message
       FROM polar_webhook_events WHERE event_id = ?`,
    )
    .get(eventId) as WebhookEventRow | undefined;
}

function insertWebhookEvent(
  db: AppDb,
  event: PaidEvent,
  processedAt: string,
): void {
  db.prepare(
    `INSERT INTO polar_webhook_events (
      event_id, order_id, checkout_id, intent_id, event_type, payload_hash,
      product_id, currency, amount_cents, metadata_hash, status,
      outcome_code, outcome_message, received_at, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', 'applied',
              'applied Waffo compatibility event', ?, ?)`,
  ).run(
    event.eventId,
    event.orderId,
    event.checkoutId,
    event.intentId ?? null,
    event.eventType,
    event.payloadHash,
    event.productId,
    event.currency,
    event.amountCents,
    event.metadataFingerprint ?? null,
    processedAt,
    processedAt,
  );
}

/** Apply one verified Waffo order.paid event atomically and idempotently. */
export function applyVerifiedPaidEvent(
  db: AppDb,
  event: PaidEvent,
): PaidEventApplyResult {
  if (event.provider === "waffo") {
    return applyWaffoPaidEvent(db, event);
  }
  return db.transaction(() => {
    const existingEvent = loadWebhookEvent(db, event.eventId);
    if (existingEvent) {
      if (
        existingEvent.order_id !== event.orderId ||
        existingEvent.checkout_id !== event.checkoutId ||
        existingEvent.payload_hash !== event.payloadHash
      ) {
        throw new CheckoutError(
          "webhook_replay_mismatch",
          409,
          "Webhook ID was previously used for a different payload",
        );
      }
      const replayed = loadListingForCompletedCheckout(db, event.checkoutId);
      if (!replayed) {
        throw new CheckoutError(
          "webhook_replay_missing",
          500,
          "Applied webhook ledger entry has no listing",
        );
      }
      return { listing: replayed, replayed: true };
    }

    const sameOrder = db
      .prepare(
        `SELECT event_id FROM polar_webhook_events WHERE order_id = ?`,
      )
      .get(event.orderId) as { event_id: string } | undefined;
    if (sameOrder) {
      throw new CheckoutError(
        "webhook_order_replay",
        409,
        "Waffo order was already settled under another webhook ID",
      );
    }

    if (event.eventType !== "order.paid") {
      throw new CheckoutError(
        "invalid_webhook",
        400,
        "Only Waffo order.paid events can settle a checkout",
      );
    }
    if (event.currency.toLowerCase() !== "usd") {
      throw new CheckoutError(
        "currency_mismatch",
        400,
        "Waffo order currency does not match USD checkout",
      );
    }
    if (
      !Number.isInteger(event.amountCents) ||
      event.amountCents < 100 ||
      event.amountCents % 100 !== 0 ||
      event.amountUsd !== event.amountCents / 100
    ) {
      throw new CheckoutError(
        "amount_mismatch",
        400,
        "Waffo order amount is not a whole-dollar checkout amount",
      );
    }
    if (
      event.metadataChargeCents !== undefined &&
      event.metadataChargeCents !== event.amountCents
    ) {
      throw new CheckoutError(
        "metadata_mismatch",
        400,
        "Waffo order charge metadata does not match total_amount",
      );
    }

    const session = loadCheckoutSession(db, event.checkoutId);
    if (!session) {
      throw new CheckoutError(
        "unknown_checkout",
        400,
        "Paid webhook references an unknown checkout",
      );
    }
    const localDraft = draftFromRow(session);
    if (!draftsEqual(localDraft, event.draft)) {
      throw new CheckoutError(
        "metadata_mismatch",
        400,
        "Waffo order metadata does not match the local checkout",
      );
    }
    if (
      !session.provider_product_id ||
      session.provider_product_id !== event.productId
    ) {
      throw new CheckoutError(
        "product_mismatch",
        400,
        "Waffo order product does not match the local checkout",
      );
    }

    if (session.status !== "open" || session.payment_status !== "pending") {
      const replayed = loadListingForCompletedCheckout(db, event.checkoutId);
      if (replayed) {
        insertWebhookEvent(db, event, nowUtc().toISOString());
        return { listing: replayed, replayed: true };
      }
      throw new CheckoutError(
        "checkout_not_pending",
        409,
        "Checkout has already been settled or canceled",
      );
    }

    const listing = settlePendingListing(
      db,
      localDraft,
      event.checkoutId,
      event.paidAt,
      event.amountUsd,
    );
    insertWebhookEvent(db, event, nowUtc().toISOString());
    return { listing, replayed: false };
  }).immediate();
}

export function recordOpenCheckout(
  db: AppDb,
  checkoutId: string,
  draft: ListingDraft,
  createdAt: string = nowUtc().toISOString(),
  providerProductId = "fixture",
): void {
  if (loadDraft(db, checkoutId)) {
    return;
  }
  insertOpenDraft(
    db,
    checkoutId,
    draft,
    createdAt,
    planCheckout(db, draft),
    providerProductId,
  );
}

function insertOpenDraft(
  db: AppDb,
  checkoutId: string,
  draft: ListingDraft,
  createdAt: string,
  quote?: Extract<CheckoutQuote, { ok: true }>,
  providerProductId = "fixture",
): void {
  const planned = quote ?? planCheckout(db, draft);
  db.prepare(
    `INSERT INTO checkout_drafts (
      checkout_id, week_id, brand, terms, brief_url, bid_usd, status, listing_id, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?, NULL)`,
  ).run(
    checkoutId,
    draft.weekId,
    draft.brand,
    draft.terms,
    draft.briefUrl,
    draft.bidUsd,
    createdAt,
  );
  db.prepare(
    `INSERT INTO payments (
      id, listing_id, week_id, brief_url, amount_usd, kind, status, polar_checkout_id, created_at, completed_at
    ) VALUES (?, NULL, ?, ?, ?, ?, 'pending', ?, ?, NULL)`,
  ).run(
    newId("pay"),
    draft.weekId,
    draft.briefUrl,
    planned.chargeUsd,
    planned.kind,
    checkoutId,
    createdAt,
  );
  db.prepare(
    `INSERT INTO checkout_provider_sessions (checkout_id, provider_product_id)
     VALUES (?, ?)`,
  ).run(checkoutId, providerProductId);
}

function loadDraft(db: AppDb, checkoutId: string): DraftRow | undefined {
  return db
    .prepare(
      `SELECT checkout_id, week_id, brand, terms, brief_url, bid_usd, status, listing_id, created_at, completed_at
       FROM checkout_drafts WHERE checkout_id = ?`,
    )
    .get(checkoutId) as DraftRow | undefined;
}

function checkoutUrl(successUrl: string, checkoutId: string): string {
  const sep = successUrl.includes("?") ? "&" : "?";
  return `${successUrl}${sep}checkoutId=${encodeURIComponent(checkoutId)}`;
}

function checkoutRecordFromDb(
  db: AppDb,
  checkoutId: string,
): CheckoutRecord | undefined {
  const row = loadDraft(db, checkoutId);
  if (!row) {
    return undefined;
  }
  const payment = db
    .prepare(
      `SELECT amount_usd, kind FROM payments WHERE polar_checkout_id = ?`,
    )
    .get(checkoutId) as
    | { amount_usd: number; kind: "place" | "raise" }
    | undefined;
  return {
    checkoutId: row.checkout_id,
    amountUsd: payment?.amount_usd ?? row.bid_usd,
    kind: payment?.kind ?? "place",
    listingDraft: draftFromRow(row),
    successUrl: "",
    status: row.status,
    listingId: row.listing_id ?? undefined,
  };
}

/** In-process Waffo. Completing a checkout writes the listing; unpaid does not. */
export class FixturePaymentPort implements PaymentPort {
  readonly kind = "fixture" as const;

  constructor(private readonly db: AppDb = getDb()) {}

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart> {
    const draft = input.listingDraft;
    parseCheckoutInput(draft);
    const quote = planCheckout(this.db, draft);
    if (input.amountUsd !== quote.chargeUsd) {
      throw new CheckoutError(
        "raise_charge_mismatch",
        400,
        "Raise without paying the difference",
      );
    }
    const checkoutId = newId("chk");
    insertOpenDraft(this.db, checkoutId, draft, nowUtc().toISOString(), quote);
    return { checkoutId, url: checkoutUrl(input.successUrl, checkoutId) };
  }

  async completeCheckout(checkoutId: string): Promise<Listing | null> {
    const row = loadDraft(this.db, checkoutId);
    if (!row || row.status === "canceled") {
      return null;
    }
    if (row.status === "paid" && row.listing_id) {
      const listing = this.db
        .prepare(
          `SELECT id, week_id, brand, terms, brief_url, platforms, bid_usd, clicks, created_at, updated_at
           FROM listings WHERE id = ?`,
        )
        .get(row.listing_id) as ListingRow | undefined;
      return listing ? listingFromRow(listing) : null;
    }
    const paidAt = nowUtc().toISOString();
    return applyPaidListing(this.db, draftFromRow(row), checkoutId, paidAt);
  }

  async abandonCheckout(checkoutId: string): Promise<void> {
    const row = loadDraft(this.db, checkoutId);
    if (!row || row.status !== "open") {
      return;
    }
    const now = nowUtc().toISOString();
    this.db
      .prepare(
        `UPDATE checkout_drafts SET status = 'canceled', completed_at = ? WHERE checkout_id = ?`,
      )
      .run(now, checkoutId);
    this.db
      .prepare(
        `UPDATE payments SET status = 'canceled', completed_at = ? WHERE polar_checkout_id = ? AND status = 'pending'`,
      )
      .run(now, checkoutId);
  }

  getCheckout(checkoutId: string): CheckoutRecord | undefined {
    return checkoutRecordFromDb(this.db, checkoutId);
  }

  async parseWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<WebhookResult> {
    return parseFixtureWebhook(rawBody, headers);
  }
}

type WaffoIntentRow = {
  intent_id: string;
  intent_fingerprint: string | null;
  metadata_fingerprint: string | null;
  week_id: string;
  window_key: string | null;
  brand: string;
  terms: string;
  brief_url: string;
  canonical_url: string | null;
  bid_usd: number;
  target_bid_cents: number | null;
  quote_base_bid_cents: number | null;
  charge_cents: number | null;
  kind: "place" | "raise";
  expected_amount_usd: number;
  currency: string;
  mode: "test" | "prod" | null;
  store_id: string | null;
  product_id: string | null;
  tax_category: string | null;
  provider_product_id: string;
  provider_checkout_id: string | null;
  provider_checkout_url: string | null;
  session_id: string | null;
  checkout_url: string | null;
  expires_at: string | null;
  status: string;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
};

function loadWaffoIntent(
  db: AppDb,
  intentId: string,
): WaffoIntentRow | undefined {
  return db
    .prepare(
      `SELECT intent_id, intent_fingerprint, metadata_fingerprint, week_id,
              window_key, brand, terms, brief_url, canonical_url, bid_usd,
              target_bid_cents, quote_base_bid_cents, charge_cents, kind,
              expected_amount_usd, currency, mode, store_id, product_id,
              tax_category, provider_product_id, provider_checkout_id,
              provider_checkout_url, session_id, checkout_url, expires_at,
              status, failure_code, failure_message, created_at, updated_at
       FROM checkout_intents WHERE intent_id = ?`,
    )
    .get(intentId) as WaffoIntentRow | undefined;
}

function draftFromIntent(intent: WaffoIntentRow): ListingDraft {
  return {
    weekId: intent.week_id,
    brand: intent.brand,
    terms: intent.terms,
    briefUrl: intent.canonical_url || intent.brief_url,
    bidUsd: intent.bid_usd,
  };
}

function plannedQuoteFromIntent(
  intent: WaffoIntentRow,
): Extract<CheckoutQuote, { ok: true }> {
  const targetBidCents = intent.target_bid_cents ?? intent.bid_usd * 100;
  const chargeCents = intent.charge_cents ?? intent.expected_amount_usd * 100;
  if (intent.kind === "raise") {
    return {
      ok: true,
      kind: "raise",
      bidUsd: targetBidCents / 100,
      chargeUsd: chargeCents / 100,
      currentBidUsd: (intent.quote_base_bid_cents ?? 0) / 100,
    };
  }
  return {
    ok: true,
    kind: "place",
    bidUsd: targetBidCents / 100,
    chargeUsd: chargeCents / 100,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function waffoIntentFingerprint(
  draft: ListingDraft,
  quote: Extract<CheckoutQuote, { ok: true }>,
): string {
  return sha256(
    stableJson({
      weekId: draft.weekId,
      windowKey: draft.weekId,
      brand: draft.brand,
      terms: draft.terms,
      canonicalUrl: draft.briefUrl,
      targetBidCents: draft.bidUsd * 100,
      quoteBaseBidCents:
        quote.kind === "raise" ? quote.currentBidUsd * 100 : 0,
      chargeCents: quote.chargeUsd * 100,
      kind: quote.kind,
      currency: "USD",
      taxCategory: "digital_goods",
    }),
  );
}

function waffoMetadata(
  intentId: string,
  intentFingerprint: string,
  draft: ListingDraft,
  quote: Extract<CheckoutQuote, { ok: true }>,
  productId: string,
): Record<string, string> {
  return {
    intentId,
    intentFingerprint,
    productId,
    currency: "USD",
    taxCategory: "digital_goods",
    targetBidCents: String(draft.bidUsd * 100),
    quoteBaseBidCents: String(
      quote.kind === "raise" ? quote.currentBidUsd * 100 : 0,
    ),
    chargeCents: String(quote.chargeUsd * 100),
    canonicalUrl: draft.briefUrl,
    weekId: draft.weekId,
    brand: draft.brand,
    terms: draft.terms,
    briefUrl: draft.briefUrl,
    bidUsd: String(draft.bidUsd),
    kind: quote.kind,
  };
}

function createWaffoIntent(
  db: AppDb,
  draft: ListingDraft,
  quote: Extract<CheckoutQuote, { ok: true }>,
  env: PaymentEnv,
  mode: "waffo-test" | "waffo-prod",
): { row: WaffoIntentRow; metadata: Record<string, string> } {
  const intentId = randomUUID();
  const intentFingerprint = waffoIntentFingerprint(draft, quote);
  const productId = requireWaffoValue(env, "WAFFO_PRODUCT_ID");
  const metadata = waffoMetadata(
    intentId,
    intentFingerprint,
    draft,
    quote,
    productId,
  );
  const metadataFingerprint = sha256(stableJson(metadata));
  const now = nowUtc().toISOString();
  const storeId = requireWaffoValue(env, "WAFFO_STORE_ID");
  const modeValue = mode === "waffo-test" ? "test" : "prod";
  db.transaction(() => {
    db.prepare(
      `INSERT INTO checkout_intents (
        intent_id, intent_fingerprint, metadata_fingerprint, week_id, window_key,
        brand, terms, brief_url, canonical_url, bid_usd, target_bid_cents,
        quote_base_bid_cents, charge_cents, kind, expected_amount_usd, currency,
        mode, store_id, product_id, tax_category, provider_product_id,
        provider_checkout_id, provider_checkout_url, session_id, checkout_url,
        expires_at, status, failure_code, failure_message, created_at, updated_at
      ) VALUES (
        @intentId, @intentFingerprint, @metadataFingerprint, @weekId, @windowKey,
        @brand, @terms, @briefUrl, @canonicalUrl, @bidUsd, @targetBidCents,
        @quoteBaseBidCents, @chargeCents, @kind, @expectedAmountUsd, 'usd',
        @mode, @storeId, @productId, 'digital_goods', @providerProductId,
        NULL, NULL, NULL, NULL, NULL, 'creating', NULL, NULL, @createdAt, @updatedAt
      )`,
    ).run({
      intentId,
      intentFingerprint,
      metadataFingerprint,
      weekId: draft.weekId,
      windowKey: draft.weekId,
      brand: draft.brand,
      terms: draft.terms,
      briefUrl: draft.briefUrl,
      canonicalUrl: draft.briefUrl,
      bidUsd: draft.bidUsd,
      targetBidCents: draft.bidUsd * 100,
      quoteBaseBidCents:
        quote.kind === "raise" ? quote.currentBidUsd * 100 : 0,
      chargeCents: quote.chargeUsd * 100,
      kind: quote.kind,
      expectedAmountUsd: quote.chargeUsd,
      mode: modeValue,
      storeId,
      productId,
      providerProductId: productId,
      createdAt: now,
      updatedAt: now,
    });
  }).immediate();
  const row = loadWaffoIntent(db, intentId);
  if (!row) throw new Error("failed to persist Waffo checkout intent");
  return { row, metadata };
}

function markWaffoIntent(
  db: AppDb,
  intentId: string,
  status: "unknown" | "rejected" | "needs_reconciliation" | "canceled" | "paid",
  code: string,
  message: string,
): void {
  db.prepare(
    `UPDATE checkout_intents
     SET status = ?, failure_code = ?, failure_message = ?, updated_at = ?
     WHERE intent_id = ?`,
  ).run(status, code, message, nowUtc().toISOString(), intentId);
}

function attachWaffoIntentWithin(
  db: AppDb,
  intentId: string,
  sessionId: string,
  checkoutUrlValue: string | undefined,
  expiresAt: string | undefined,
): WaffoIntentRow {
  const intent = loadWaffoIntent(db, intentId);
  if (!intent) {
    throw new CheckoutError("unknown_intent", 400, "Unknown local payment intent");
  }
  const existingSession = intent.session_id || intent.provider_checkout_id;
  if (existingSession && existingSession !== sessionId) {
    throw new CheckoutError(
      "provider_attach_ambiguity",
      409,
      "A local intent is already attached to another Waffo session",
    );
  }
  if (["rejected", "canceled", "paid"].includes(intent.status)) {
    if (intent.status === "paid" && existingSession === sessionId) return intent;
    throw new CheckoutError(
      "intent_not_open",
      409,
      "Waffo intent is no longer open for attachment",
    );
  }
  const attachedAt = nowUtc().toISOString();
  db.prepare(
    `UPDATE checkout_intents
     SET provider_checkout_id = COALESCE(provider_checkout_id, ?),
         provider_checkout_url = COALESCE(provider_checkout_url, ?),
         session_id = COALESCE(session_id, ?),
         checkout_url = COALESCE(checkout_url, ?),
         expires_at = COALESCE(expires_at, ?),
         status = 'attached', failure_code = NULL, failure_message = NULL,
         updated_at = ?
     WHERE intent_id = ?`,
  ).run(
    sessionId,
    checkoutUrlValue ?? null,
    sessionId,
    checkoutUrlValue ?? null,
    expiresAt ?? null,
    attachedAt,
    intentId,
  );
  const updated = loadWaffoIntent(db, intentId);
  if (!updated) throw new Error("Waffo intent disappeared after attachment");
  const checkoutId = updated.session_id || sessionId;
  const existingDraft = loadDraft(db, checkoutId);
  if (!existingDraft) {
    insertOpenDraft(
      db,
      checkoutId,
      draftFromIntent(updated),
      updated.created_at,
      plannedQuoteFromIntent(updated),
      updated.product_id || updated.provider_product_id,
    );
  } else if (!draftsEqual(draftFromRow(existingDraft), draftFromIntent(updated))) {
    throw new CheckoutError(
      "metadata_mismatch",
      400,
      "Attached Waffo session does not match the immutable intent",
    );
  }
  return updated;
}

function attachWaffoIntent(
  db: AppDb,
  intentId: string,
  sessionId: string,
  checkoutUrlValue: string,
  expiresAt: string,
): WaffoIntentRow {
  return db
    .transaction(() =>
      attachWaffoIntentWithin(
        db,
        intentId,
        sessionId,
        checkoutUrlValue,
        expiresAt,
      ),
    )
    .immediate();
}

function waffoCheckoutError(error: unknown): CheckoutError {
  if (error instanceof CheckoutError) return error;
  if (error instanceof WaffoPancakeError) {
    const message = error.errors[0]?.message || error.message;
    // The SDK uses the `sdk` layer for non-JSON/shape failures. A transport
    // or malformed response is ambiguous even when the HTTP status happens
    // to be 4xx; only an explicit provider-layer rejection is definitive.
    if (
      error.status >= 400 &&
      error.status < 500 &&
      ![408, 409, 425, 429].includes(error.status) &&
      !error.errors.some((entry) => entry?.layer === "sdk")
    ) {
      return new CheckoutError("provider_rejected", 502, message);
    }
    return new CheckoutError("provider_ambiguous", 503, message);
  }
  return new CheckoutError(
    "provider_ambiguous",
    503,
    error instanceof Error ? error.message : "Waffo checkout response was ambiguous",
  );
}

const DEFAULT_WAFFO_CHECKOUT_TIMEOUT_MS = 15_000;
const MAX_WAFFO_CHECKOUT_TIMEOUT_MS = 60_000;
const MAX_WAFFO_CHECKOUT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

function checkoutTimeoutMs(env: PaymentEnv): number {
  const configured = env.WAFFO_REQUEST_TIMEOUT_MS?.trim();
  if (!configured) return DEFAULT_WAFFO_CHECKOUT_TIMEOUT_MS;
  const value = Number(configured);
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_WAFFO_CHECKOUT_TIMEOUT_MS
    ? value
    : DEFAULT_WAFFO_CHECKOUT_TIMEOUT_MS;
}

/**
 * Keep one deadline alive across both SDK fetch headers and its response.json
 * body read. The SDK accepts a fetch seam but does not expose a request
 * timeout, so this wrapper is the transport boundary for the whole operation.
 */
function withCheckoutDeadline(
  transport: typeof fetch,
  timeoutMs: number,
): typeof fetch {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const parentSignal = init.signal ?? undefined;
    let rejectDeadline: (error: Error) => void = () => undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    void deadline.catch(() => undefined);
    const timer = setTimeout(() => {
      controller.abort(new Error("Waffo checkout request deadline exceeded"));
      rejectDeadline(new Error("Waffo checkout request deadline exceeded"));
    }, timeoutMs);
    const onParentAbort = () => {
      controller.abort(parentSignal?.reason);
      rejectDeadline(new Error("Waffo checkout request was aborted"));
    };
    if (parentSignal) {
      if (parentSignal.aborted) onParentAbort();
      else parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    };
    try {
      const response = await Promise.race([
        transport(input, { ...init, signal: controller.signal }),
        deadline,
      ]);
      const bodyMethods = new Set(["arrayBuffer", "blob", "bytes", "formData", "json", "text"]);
      return new Proxy(response, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (
            typeof property !== "string" ||
            !bodyMethods.has(property) ||
            typeof value !== "function"
          ) {
            return value;
          }
          return (...args: unknown[]) => {
            let bodyRead: Promise<unknown>;
            try {
              bodyRead = Promise.resolve(Reflect.apply(value, target, args));
            } catch (error) {
              cleanup();
              return Promise.reject(error);
            }
            return Promise.race([bodyRead, deadline]).finally(cleanup);
          };
        },
      });
    } catch (error) {
      cleanup();
      throw error;
    }
  };
}

export type WaffoOptions = {
  env?: PaymentEnv;
  fetch?: typeof fetch;
  db?: AppDb;
  webhookPublicKey?: WebhookPublicKeys;
};

/** Official Waffo Pancake checkout/webhook adapter selected by WAFFO_MODE. */
export class WaffoPort implements PaymentPort {
  readonly kind = "live" as const;
  readonly mode: "waffo-test" | "waffo-prod";
  private readonly env: PaymentEnv;
  private readonly db: AppDb;
  private readonly environment: "test" | "prod";
  private readonly timeoutMs: number;
  private readonly client: WaffoPancake;

  constructor(options: WaffoOptions = {}) {
    this.env = options.env ?? process.env;
    const selected = checkoutProvider(this.env);
    if (selected !== "waffo-test" && selected !== "waffo-prod") {
      throw new Error("Waffo is env-gated; use the explicit fixture port");
    }
    this.mode = selected;
    this.db = options.db as AppDb;
    const runtime = requireWaffoRuntime(
      this.env,
      selected,
      options.db,
      options.webhookPublicKey,
    );
    this.environment = runtime.environment;
    this.timeoutMs = checkoutTimeoutMs(this.env);
    const merchantId = requireWaffoValue(this.env, "WAFFO_MERCHANT_ID");
    const productId = requireWaffoValue(this.env, "WAFFO_PRODUCT_ID");
    void productId;
    this.client = new WaffoPancake({
      merchantId,
      privateKey: waffoPrivateKeyFromEnv(this.env),
      baseUrl: waffoApiBase(this.env),
      environment: runtime.environment,
      fetch: withCheckoutDeadline(
        options.fetch ?? globalThis.fetch.bind(globalThis),
        this.timeoutMs,
      ),
      // Pass the already-resolved environment-specific key as a string so
      // the SDK cannot silently fall back to the other environment key.
      webhookPublicKey: runtime.publicKey,
    });
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart> {
    const draft = parseCheckoutInput(input.listingDraft);
    const quote = planCheckout(this.db, draft);
    if (input.amountUsd !== quote.chargeUsd) {
      throw new CheckoutError(
        "raise_charge_mismatch",
        400,
        "Checkout amount does not match the immutable quote",
      );
    }
    const { row: intent, metadata } = createWaffoIntent(
      this.db,
      draft,
      quote,
      this.env,
      this.mode,
    );
    const base = publicBaseUrl(this.env, this.mode);
    const successUrl = `${base}/checkout/complete?intent=${encodeURIComponent(intent.intent_id)}`;
    const productId = requireWaffoValue(this.env, "WAFFO_PRODUCT_ID");
    try {
      const session = await this.client.checkout.anonymous.create({
        productId,
        currency: "USD",
        priceSnapshot: {
          amount: centsToDisplay(quote.chargeUsd * 100),
          taxCategory: TaxCategory.DigitalGoods,
        },
        successUrl,
        orderMerchantExternalId: intent.intent_id,
        metadata,
      });
      const sessionId = readString(session.sessionId);
      const checkoutUrlValue = readString(session.checkoutUrl);
      const expiresAt = readString(session.expiresAt);
      if (
        !sessionId ||
        !checkoutUrlValue ||
        !isPublicProviderCheckoutUrl(checkoutUrlValue, sessionId) ||
        !expiresAt ||
        !isFutureCheckoutExpiry(expiresAt)
      ) {
        throw new Error("Waffo checkout response missing session identity/url/expiry");
      }
      attachWaffoIntent(
        this.db,
        intent.intent_id,
        sessionId,
        checkoutUrlValue,
        expiresAt,
      );
      return { checkoutId: sessionId, url: checkoutUrlValue };
    } catch (error) {
      const failure = waffoCheckoutError(error);
      const status = failure.code === "provider_rejected"
        ? "rejected"
        : "unknown";
      markWaffoIntent(
        this.db,
        intent.intent_id,
        status,
        failure.code,
        failure.message,
      );
      throw failure;
    }
  }

  async completeCheckout(_checkoutId: string): Promise<Listing | null> {
    throw new Error("live Waffo sessions complete via webhook only");
  }

  async abandonCheckout(checkoutId: string): Promise<void> {
    const now = nowUtc().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE checkout_drafts SET status = 'canceled', completed_at = ?
           WHERE checkout_id = ? AND status = 'open'`,
        )
        .run(now, checkoutId);
      this.db
        .prepare(
          `UPDATE payments SET status = 'canceled', completed_at = ?
           WHERE polar_checkout_id = ? AND status = 'pending'`,
        )
        .run(now, checkoutId);
      this.db
        .prepare(
          `UPDATE checkout_intents
           SET status = 'canceled', updated_at = ?
           WHERE (session_id = ? OR provider_checkout_id = ?)
             AND status IN ('creating','open','attached','unknown','needs_reconciliation','reconciliation_required')`,
        )
        .run(now, checkoutId, checkoutId);
    }).immediate();
  }

  getCheckout(checkoutId: string): CheckoutRecord | undefined {
    return checkoutRecordFromDb(this.db, checkoutId);
  }

  async parseWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<WebhookResult> {
    const signature = header(headers, "x-waffo-signature");
    let event: WebhookEvent<WebhookEventData>;
    try {
      event = this.client.webhooks.verify<WebhookEventData>(rawBody, signature, {
        environment: this.environment,
      });
    } catch (error) {
      throw new CheckoutError(
        "invalid_signature",
        400,
        error instanceof Error ? error.message : "invalid Waffo webhook signature",
      );
    }
    if (event.eventType !== "order.completed") {
      return { ignored: true };
    }
    return parseWaffoWebhook(event, rawBody, this.environment, this.env);
  }
}

/**
 * Waffo's anonymous cashier URL is an externally hosted destination. Keep the
 * provider's documented host/path and the response session ID bound together;
 * a generic public URL is not a safe redirect target.
 */
function isPublicProviderCheckoutUrl(
  value: string,
  expectedSessionId: string,
): boolean {
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.hostname !== "pancake.waffo.ai" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    return false;
  }
  // URL parsing normalizes explicit default ports, dot segments, and encoded
  // path bytes. Inspect the wire spelling too so those forms cannot bypass the
  // documented hosted resource boundary.
  const authority = /^https:\/\/([^/?#]*)/.exec(value)?.[1];
  if (
    authority !== "pancake.waffo.ai" ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return false;
  }
  const rawPath = value.slice("https://".length + authority.length);
  if (rawPath !== parsed.pathname || parsed.pathname.includes("%")) {
    return false;
  }
  const match = /^\/store\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,62}))\/checkout\/([A-Za-z0-9_-]+)$/.exec(
    parsed.pathname,
  );
  return match !== null && match[2] === expectedSessionId;
}

function isFutureCheckoutExpiry(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  const expiresAt = parsed.getTime();
  const now = nowUtc().getTime();
  return (
    Number.isFinite(expiresAt) &&
    parsed.toISOString() === value &&
    expiresAt > now &&
    expiresAt - now <= MAX_WAFFO_CHECKOUT_TTL_MS
  );
}

/** Compatibility name for callers that previously imported the live port. */
export class LiveWaffoPort extends WaffoPort {}

export function getPaymentPort(
  db?: AppDb,
  env: PaymentEnv = process.env,
): PaymentPort {
  const selected = checkoutProvider(env);
  const localDb = db ?? getDb();
  if (selected === "fixture") return new FixturePaymentPort(localDb);
  return new WaffoPort({ db: localDb, env });
}

/**
 * Validate the complete local runtime composition before Next serves traffic.
 * This intentionally constructs the selected port but never starts checkout
 * I/O; Waffo network access only occurs from createCheckout after a request.
 */
export function assertRuntimeReady(
  env: PaymentEnv = process.env,
  db?: AppDb,
): void {
  checkoutProvider(env);
  const localDb = db ?? getDb();
  getPaymentPort(localDb, env);
  // Keep the database probe in the same gate as provider/config validation so
  // a closed or half-initialized durable store cannot report readiness.
  localDb.prepare("SELECT 1 AS ok").get();
}

const WAFFO_RETRYABLE_OUTCOMES = new Set([
  "unknown_intent",
  "unknown_checkout",
  "intent_not_open",
  "provider_attach_ambiguity",
  "checkout_state_mismatch",
  "checkout_not_pending",
  "raise_too_small",
  "provider_ambiguous",
  "event_time_out_of_bounds",
  "webhook_replay_missing",
  "webhook_not_applied",
]);

/** Map durable reconciliation/infra outcomes to a provider-retryable status. */
export function waffoWebhookErrorStatus(error: CheckoutError): number {
  if (WAFFO_RETRYABLE_OUTCOMES.has(error.code) || error.httpStatus >= 500) {
    return 503;
  }
  return error.httpStatus;
}

function centsToDisplay(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new CheckoutError("amount_mismatch", 400, "Amount is not a safe USD value");
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Exact USD display-string parsing; never use a binary floating point amount. */
export function displayToCents(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
    return undefined;
  }
  const [whole, fraction = ""] = value.split(".");
  try {
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
    return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : undefined;
  } catch {
    return undefined;
  }
}

function waffoIssue(
  code: string,
  message: string,
  httpStatus = 400,
): { code: string; httpStatus: number; message: string } {
  return { code, httpStatus, message };
}

function waffoDraftFromMetadata(
  metadata: Record<string, unknown>,
): ListingDraft | undefined {
  const briefUrl = readString(metadata.canonicalUrl ?? metadata.briefUrl);
  const draft = {
    brand: readString(metadata.brand),
    terms: readString(metadata.terms),
    briefUrl,
    bidUsd: readInt(metadata.bidUsd),
    weekId: readString(metadata.weekId),
  };
  if (
    !draft.brand ||
    !draft.terms ||
    !draft.briefUrl ||
    draft.bidUsd === undefined ||
    !draft.weekId
  ) {
    return undefined;
  }
  try {
    return parseCheckoutInput(draft);
  } catch {
    return undefined;
  }
}

function waffoMetadataStringMap(
  value: unknown,
): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== "string")) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

type WaffoAliasRead = {
  value?: string;
  invalid: boolean;
};

/**
 * Read signed aliases without collapsing malformed-present values into
 * "missing". Waffo's canonical fields are exact strings; whitespace and
 * conflicting aliases must remain visible to settlement validation.
 */
function readWaffoStringAliases(
  values: Array<[present: boolean, value: unknown]>,
): WaffoAliasRead {
  const seen: string[] = [];
  let invalid = false;
  for (const [present, value] of values) {
    if (!present) continue;
    if (
      typeof value !== "string" ||
      value === "" ||
      value.trim() !== value
    ) {
      invalid = true;
      continue;
    }
    seen.push(value);
  }
  const unique = [...new Set(seen)];
  if (unique.length > 1) invalid = true;
  return { value: unique.length === 1 ? unique[0] : undefined, invalid };
}

function waffoProductIdentity(
  eventData: Record<string, unknown>,
): WaffoAliasRead {
  const hasOwn = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(eventData, key);
  const aliases: Array<[boolean, unknown]> = [
    [hasOwn("productId"), eventData.productId],
    [hasOwn("product_id"), eventData.product_id],
  ];
  let invalid = false;
  if (hasOwn("product")) {
    const product = eventData.product;
    if (isRecord(product) && Object.prototype.hasOwnProperty.call(product, "id")) {
      aliases.push([true, product.id]);
    } else {
      invalid = true;
    }
  }

  const metadata = eventData.productMetadata;
  if (!hasOwn("productMetadata") || !isRecord(metadata)) {
    invalid = true;
  } else {
    if (Object.values(metadata).some((value) => typeof value !== "string")) {
      invalid = true;
    }
    const metadataHasProduct = Object.prototype.hasOwnProperty.call(
      metadata,
      "productId",
    );
    aliases.push([metadataHasProduct, metadata.productId]);
    if (!metadataHasProduct) invalid = true;
  }

  const read = readWaffoStringAliases(aliases);
  return { value: read.value, invalid: invalid || read.invalid };
}

function parseWaffoWebhook(
  event: WebhookEvent<WebhookEventData>,
  rawBody: string,
  environment: "test" | "prod",
  env: PaymentEnv,
): PaidEvent {
  const eventData: Record<string, unknown> = isRecord(event.data)
    ? event.data
    : {};
  const metadata = waffoMetadataStringMap(eventData.orderMetadata);
  const deliveryId = readWaffoStringAliases([[true, event.id]]).value ?? "";
  const businessEventId = readWaffoStringAliases([[true, event.eventId]]).value ?? "";
  const orderId = readWaffoStringAliases([[true, eventData.orderId]]).value ?? "";
  const paymentId = readWaffoStringAliases([[true, eventData.paymentId]]).value ?? "";
  const intentId = readWaffoStringAliases([
    [true, eventData.orderMerchantExternalId],
  ]).value ?? "";
  const metadataIntentId = metadata && readString(metadata.intentId);
  const intentFingerprint = metadata && readString(metadata.intentFingerprint);
  const sessionAliases = readWaffoStringAliases([
    [Object.prototype.hasOwnProperty.call(eventData, "checkoutSessionId"), eventData.checkoutSessionId],
    [Object.prototype.hasOwnProperty.call(eventData, "sessionId"), eventData.sessionId],
    [Object.prototype.hasOwnProperty.call(eventData, "checkoutId"), eventData.checkoutId],
    [Object.prototype.hasOwnProperty.call(eventData, "checkout_id"), eventData.checkout_id],
  ]);
  const sessionId = sessionAliases.value;
  // Waffo order.completed does not promise a checkout-session field. Keep it
  // empty so a successful response can reconcile through the durable intent
  // session, while a lost response gets a deterministic local session id.
  const checkoutId = sessionId ?? "";
  const currency = readString(eventData.currency) ?? "";
  const hasSubtotal = Object.prototype.hasOwnProperty.call(eventData, "subtotal");
  const hasTotal = Object.prototype.hasOwnProperty.call(eventData, "total");
  const subtotalRaw = readString(eventData.subtotal);
  const amountRaw = readString(eventData.amount);
  const totalRaw = readString(eventData.total);
  const taxRaw = readString(eventData.taxAmount);
  const subtotalCents = subtotalRaw === undefined ? undefined : displayToCents(subtotalRaw);
  const parsedAmountCents = amountRaw === undefined ? undefined : displayToCents(amountRaw);
  // The ranked charge is always the tax-exclusive subtotal when one is
  // supplied. `amount` may be either the subtotal or the tax-inclusive total;
  // the equation below validates which representation Waffo returned.
  const amountCents = subtotalCents ?? parsedAmountCents;
  const totalCents = totalRaw === undefined ? undefined : displayToCents(totalRaw);
  const taxCents = taxRaw === undefined ? undefined : displayToCents(taxRaw);
  const draft = metadata ? waffoDraftFromMetadata(metadata) : undefined;
  const fallbackDraft: ListingDraft = draft ?? {
    weekId: "",
    brand: "",
    terms: "",
    briefUrl: "",
    bidUsd: 0,
  };
  const targetBidCents = metadata ? readInt(metadata.targetBidCents) : undefined;
  const quoteBaseBidCents = metadata
    ? readInt(metadata.quoteBaseBidCents)
    : undefined;
  const metadataChargeCents = metadata
    ? readInt(metadata.chargeCents)
    : undefined;
  const eventTimestamp = readDate(event.timestamp);
  const expectedMode = environment;
  let validationError:
    | { code: string; httpStatus: number; message: string }
    | undefined;
  const fail = (
    code: string,
    message: string,
    httpStatus = 400,
  ): void => {
    if (!validationError) validationError = waffoIssue(code, message, httpStatus);
  };
  if (!deliveryId || !businessEventId) {
    fail("invalid_webhook", "Waffo webhook is missing delivery/business identity");
  }
  if (sessionAliases.invalid) {
    fail("invalid_webhook", "Waffo checkout session aliases are malformed or conflicting");
  }
  if (event.mode !== expectedMode) {
    fail("mode_mismatch", "Waffo webhook mode does not match this runtime");
  }
  const storeId = readWaffoStringAliases([[true, event.storeId]]).value;
  if (!storeId) {
    fail("invalid_webhook", "Waffo webhook is missing store identity");
  }
  if (!orderId || !paymentId || !intentId) {
    fail("invalid_webhook", "Waffo webhook is missing order/payment/intent identity");
  }
  if (businessEventId && paymentId && businessEventId !== paymentId) {
    fail(
      "identity_mismatch",
      "Waffo business event ID does not match the payment ID",
    );
  }
  if (eventData.orderStatus !== "completed") {
    fail("event_status_mismatch", "Waffo order is not completed");
  }
  if (eventData.paymentStatus !== "succeeded") {
    fail("payment_status_mismatch", "Waffo payment is not succeeded");
  }
  if (currency !== "USD") {
    fail("currency_mismatch", "Waffo order currency must be USD");
  }
  if (amountCents === undefined) {
    fail("amount_mismatch", "Waffo order amount is not a valid USD display amount");
  }
  if (amountRaw === undefined) {
    fail("amount_mismatch", "Waffo order amount is missing");
  }
  if (amountRaw !== undefined && parsedAmountCents === undefined) {
    fail("amount_mismatch", "Waffo order amount is not a valid USD display amount");
  }
  if (subtotalRaw !== undefined && subtotalCents === undefined) {
    fail("amount_mismatch", "Waffo subtotal is not a valid USD display amount");
  }
  if (hasSubtotal && subtotalRaw === undefined) {
    fail("amount_mismatch", "Waffo subtotal is missing or invalid");
  }
  if (taxRaw !== undefined && taxCents === undefined) {
    fail("amount_mismatch", "Waffo tax amount is not a valid USD display amount");
  }
  if (taxRaw === undefined) {
    fail("amount_mismatch", "Waffo tax amount is missing");
  }
  if (hasTotal && totalRaw === undefined) {
    fail("amount_mismatch", "Waffo total is missing or invalid");
  }
  if (subtotalCents !== undefined) {
    if (taxCents !== undefined && hasTotal && totalCents !== undefined) {
      if (!Number.isSafeInteger(subtotalCents + taxCents) || totalCents !== subtotalCents + taxCents) {
        fail("amount_mismatch", "Waffo total does not equal subtotal plus tax");
      }
      if (
        parsedAmountCents !== undefined &&
        parsedAmountCents !== subtotalCents &&
        parsedAmountCents !== totalCents
      ) {
        fail("amount_mismatch", "Waffo amount must equal subtotal or total");
      }
    } else if (
      taxCents !== undefined &&
      (parsedAmountCents !== subtotalCents &&
        (!Number.isSafeInteger(subtotalCents + taxCents) ||
          parsedAmountCents !== subtotalCents + taxCents))
    ) {
      // `total` is optional in Waffo's tax-exclusive event shape. With a
      // subtotal anchor, `amount` may be either that subtotal or the exact
      // subtotal-plus-tax total; the ranked charge remains the subtotal.
      fail("amount_mismatch", "Waffo subtotal requires a consistent amount and tax");
    }
  } else if (
    taxCents !== undefined &&
    (taxCents !== 0 ||
      parsedAmountCents === undefined ||
      (hasTotal && totalCents !== parsedAmountCents))
  ) {
    // No subtotal means the amount itself is the only safe charge anchor. It
    // must be explicitly tax-free, and a present total must agree exactly.
    fail("amount_mismatch", "Waffo amount requires explicit zero tax");
  }
  if (!metadata || !metadataIntentId || !intentFingerprint || !draft) {
    fail("metadata_mismatch", "Waffo order metadata is incomplete");
  }
  if (metadataIntentId && metadataIntentId !== intentId) {
    fail("metadata_mismatch", "Waffo metadata intent does not match order intent");
  }
  if (!eventTimestamp) {
    fail("invalid_webhook", "Waffo webhook timestamp is invalid");
  } else if (!isSensibleEventTimestamp(eventTimestamp)) {
    fail(
      "event_time_out_of_bounds",
      "Waffo webhook timestamp is outside the supported settlement window",
    );
  }
  const productIdentity = waffoProductIdentity(eventData);
  const signedProductId = productIdentity.value;
  const expectedProductId = env.WAFFO_PRODUCT_ID?.trim() ?? "";
  if (productIdentity.invalid || !signedProductId || signedProductId !== expectedProductId) {
    fail("product_mismatch", "Waffo signed product metadata is invalid");
  }
  const { id: _deliveryId, ...deliveryIndependentEvent } = event;
  const providerPayloadFingerprint = sha256(stableJson(deliveryIndependentEvent));
  return {
    eventId: deliveryId,
    deliveryId,
    businessEventId,
    paymentId,
    orderId,
    eventType: "order.completed",
    checkoutId,
    intentId,
    metadataIntentId,
    intentFingerprint,
    draft: fallbackDraft,
    amountUsd: (amountCents ?? 0) / 100,
    amountCents: amountCents ?? 0,
    currency,
    productId: signedProductId ?? "",
    paidAt: eventTimestamp ?? nowUtc().toISOString(),
    payloadHash: hashPayload(rawBody),
    providerPayloadFingerprint,
    metadataFingerprint: metadata ? sha256(stableJson(metadata)) : undefined,
    metadataChargeCents,
    targetBidCents,
    quoteBaseBidCents,
    subtotalCents,
    taxCents,
    mode: event.mode === "test" || event.mode === "prod" ? event.mode : undefined,
    storeId,
    provider: "waffo",
    validationError,
  };
}

type WaffoEventLedgerStatus =
  | "applied"
  | "rejected"
  | "reconciliation_required";

type WaffoLedgerRow = {
  event_type: string;
  event_id: string;
  payment_id: string | null;
  order_id: string | null;
  intent_id: string | null;
  delivery_id: string | null;
  mode: string | null;
  store_id: string | null;
  product_id: string | null;
  payload_hash: string;
  event_fingerprint: string;
  status: WaffoEventLedgerStatus;
  outcome_code: string;
  outcome_message: string;
};

type WaffoDeliveryRow = Omit<WaffoLedgerRow, "event_type" | "event_id"> & {
  delivery_id: string;
  event_type: string;
  event_id: string;
};

function loadWaffoDelivery(
  db: AppDb,
  deliveryId: string,
): WaffoDeliveryRow | undefined {
  return db
    .prepare(
      `SELECT delivery_id, event_type, event_id, payment_id, order_id,
              intent_id, mode, store_id, product_id, payload_hash,
              event_fingerprint, status, outcome_code, outcome_message
       FROM waffo_webhook_deliveries WHERE delivery_id = ?`,
    )
    .get(deliveryId) as WaffoDeliveryRow | undefined;
}

function loadWaffoBusinessEvent(
  db: AppDb,
  eventType: string,
  eventId: string,
): WaffoLedgerRow | undefined {
  return db
    .prepare(
      `SELECT event_type, event_id, payment_id, order_id, intent_id,
              delivery_id, mode, store_id, product_id, payload_hash,
              event_fingerprint, status, outcome_code, outcome_message
       FROM waffo_webhook_events WHERE event_type = ? AND event_id = ?`,
    )
    .get(eventType, eventId) as WaffoLedgerRow | undefined;
}

function loadWaffoIdentityConflict(
  db: AppDb,
  column: "payment_id" | "order_id" | "intent_id",
  value: string | undefined,
): WaffoLedgerRow | undefined {
  if (!value) return undefined;
  return db
    .prepare(
      `SELECT event_type, event_id, payment_id, order_id, intent_id,
              delivery_id, mode, store_id, product_id, payload_hash,
              event_fingerprint, status, outcome_code, outcome_message
       FROM waffo_webhook_events WHERE ${column} = ?`,
    )
    .get(value) as WaffoLedgerRow | undefined;
}

function waffoFactsMatch(row: WaffoLedgerRow | WaffoDeliveryRow, event: PaidEvent): boolean {
  return (
    row.payload_hash === event.payloadHash &&
    waffoBusinessFactsMatch(row, event)
  );
}

/**
 * A second Waffo delivery has a different delivery UUID in the signed body,
 * so its raw-body hash necessarily differs. Its immutable business facts must
 * still match before it can be treated as an idempotent no-op.
 */
function waffoBusinessFactsMatch(
  row: WaffoLedgerRow | WaffoDeliveryRow,
  event: PaidEvent,
): boolean {
  return (
    row.event_fingerprint === waffoEventFingerprint(event) &&
    (row.payment_id ?? null) === (event.paymentId ?? null) &&
    (row.order_id ?? null) === (event.orderId || null) &&
    (row.intent_id ?? null) === (event.intentId || null)
  );
}

function waffoEventFingerprint(event: PaidEvent): string {
  return sha256(
    stableJson({
      eventType: event.eventType,
      eventId: event.businessEventId ?? event.eventId,
      paymentId: event.paymentId,
      orderId: event.orderId,
      intentId: event.intentId,
      mode: event.mode,
      storeId: event.storeId,
      currency: event.currency,
      productId: event.productId,
      amountCents: event.amountCents,
      subtotalCents: event.subtotalCents,
      taxCents: event.taxCents,
      metadataFingerprint: event.metadataFingerprint,
      intentFingerprint: event.intentFingerprint,
      targetBidCents: event.targetBidCents,
      quoteBaseBidCents: event.quoteBaseBidCents,
      providerPayloadFingerprint: event.providerPayloadFingerprint,
    }),
  );
}

function insertWaffoBusinessEvent(
  db: AppDb,
  event: PaidEvent,
  status: WaffoEventLedgerStatus,
  code: string,
  message: string,
  processedAt: string,
): void {
  db.prepare(
    `INSERT INTO waffo_webhook_events (
      event_type, event_id, payment_id, order_id, intent_id, delivery_id,
      mode, store_id, product_id, payload_hash, event_fingerprint, status, outcome_code,
      outcome_message, received_at, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.eventType,
    event.businessEventId ?? event.eventId,
    event.paymentId ?? null,
    event.orderId || null,
    event.intentId || null,
    event.deliveryId ?? event.eventId,
    event.mode ?? null,
    event.storeId ?? null,
    event.productId || null,
    event.payloadHash,
    waffoEventFingerprint(event),
    status,
    code,
    message,
    processedAt,
    processedAt,
  );
}

function insertWaffoDelivery(
  db: AppDb,
  event: PaidEvent,
  status: WaffoEventLedgerStatus,
  code: string,
  message: string,
  processedAt: string,
): void {
  db.prepare(
    `INSERT INTO waffo_webhook_deliveries (
      delivery_id, event_type, event_id, payment_id, order_id, intent_id,
      mode, store_id, product_id, payload_hash, event_fingerprint, status,
      outcome_code, outcome_message,
      received_at, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.deliveryId ?? event.eventId,
    event.eventType,
    event.businessEventId ?? event.eventId,
    event.paymentId ?? null,
    event.orderId || null,
    event.intentId || null,
    event.mode ?? null,
    event.storeId ?? null,
    event.productId || null,
    event.payloadHash,
    waffoEventFingerprint(event),
    status,
    code,
    message,
    processedAt,
    processedAt,
  );
}

function insertWaffoAttempt(
  db: AppDb,
  event: PaidEvent,
  status: WaffoEventLedgerStatus,
  code: string,
  message: string,
  processedAt: string,
): void {
  db.prepare(
    `INSERT INTO waffo_webhook_attempts (
      attempt_id, delivery_id, event_type, event_id, payment_id, order_id,
      intent_id, mode, store_id, product_id, payload_hash, event_fingerprint,
      status, outcome_code, outcome_message, received_at, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    event.deliveryId ?? event.eventId,
    event.eventType,
    event.businessEventId ?? event.eventId,
    event.paymentId ?? null,
    event.orderId || null,
    event.intentId || null,
    event.mode ?? null,
    event.storeId ?? null,
    event.productId || null,
    event.payloadHash,
    waffoEventFingerprint(event),
    status,
    code,
    message,
    processedAt,
    processedAt,
  );
}

function loadListingForWaffoIntent(
  db: AppDb,
  intentId: string,
): Listing | undefined {
  const row = db
    .prepare(
      `SELECT p.listing_id
       FROM payments AS p
       JOIN checkout_intents AS i ON i.session_id = p.polar_checkout_id
       WHERE i.intent_id = ? AND p.status = 'completed'`,
    )
    .get(intentId) as { listing_id: string | null } | undefined;
  return row?.listing_id ? getListingById(db, row.listing_id) : undefined;
}

function waffoErrorFromLedger(row: WaffoLedgerRow | WaffoDeliveryRow): CheckoutError {
  return new CheckoutError(
    row.outcome_code,
    row.status === "reconciliation_required" ? 409 : 400,
    row.outcome_message,
  );
}

function waffoOutcomeStatus(error: CheckoutError): WaffoEventLedgerStatus {
  return [
    "unknown_intent",
    "unknown_checkout",
    "intent_not_open",
    "provider_attach_ambiguity",
    "checkout_state_mismatch",
    "checkout_not_pending",
    "raise_too_small",
    "provider_ambiguous",
    "event_time_out_of_bounds",
  ].includes(error.code)
    ? "reconciliation_required"
    : "rejected";
}

const WAFFO_KNOWN_INTENT_FACT_MISMATCHES = new Set([
  "invalid_webhook",
  "mode_mismatch",
  "provider_scope_mismatch",
  "event_status_mismatch",
  "payment_status_mismatch",
  "currency_mismatch",
  "amount_mismatch",
  "metadata_mismatch",
  "product_mismatch",
]);

/**
 * A signed completed-payment envelope can be validly authenticated while its
 * captured facts disagree with the local immutable intent. Once all identity
 * needed to locate that intent is present, keep the payment recoverable and
 * auditable instead of treating it as an ordinary rejected attempt.
 */
function isKnownWaffoIntentFactMismatch(
  db: AppDb,
  event: PaidEvent,
  error: CheckoutError,
): boolean {
  if (
    !event.intentId ||
    !event.orderId ||
    !event.paymentId ||
    !event.businessEventId ||
    !WAFFO_KNOWN_INTENT_FACT_MISMATCHES.has(error.code)
  ) {
    return false;
  }
  const intent = loadWaffoIntent(db, event.intentId);
  return intent !== undefined && intent.status !== "paid";
}

function ensureWaffoIntentForEvent(
  db: AppDb,
  event: PaidEvent,
): { intent: WaffoIntentRow; checkoutId: string; draft: ListingDraft } {
  if (event.validationError) {
    throw new CheckoutError(
      event.validationError.code,
      event.validationError.httpStatus,
      event.validationError.message,
    );
  }
  if (!event.intentId) {
    throw new CheckoutError("unknown_intent", 400, "Waffo event has no local intent");
  }
  const intent = loadWaffoIntent(db, event.intentId);
  if (!intent) {
    throw new CheckoutError("unknown_intent", 400, "Unknown local Waffo intent");
  }
  if (event.metadataIntentId !== event.intentId) {
    throw new CheckoutError(
      "metadata_mismatch",
      400,
      "Waffo metadata intent does not match the local intent",
    );
  }
  if (!intent.intent_fingerprint || event.intentFingerprint !== intent.intent_fingerprint) {
    throw new CheckoutError(
      "metadata_mismatch",
      400,
      "Waffo intent fingerprint does not match the immutable intent",
    );
  }
  if (!intent.metadata_fingerprint || event.metadataFingerprint !== intent.metadata_fingerprint) {
    throw new CheckoutError(
      "metadata_mismatch",
      400,
      "Waffo metadata fingerprint does not match the immutable intent",
    );
  }
  if (intent.mode !== event.mode || intent.store_id !== event.storeId) {
    throw new CheckoutError(
      "provider_scope_mismatch",
      400,
      "Waffo mode/store does not match the immutable intent",
    );
  }
  if (!intent.product_id || intent.product_id !== event.productId) {
    throw new CheckoutError(
      "product_mismatch",
      400,
      "Waffo product does not match the immutable intent",
    );
  }
  if (event.currency !== "USD" || intent.currency !== "usd") {
    throw new CheckoutError("currency_mismatch", 400, "Waffo currency must be USD");
  }
  const chargeCents = intent.charge_cents ?? intent.expected_amount_usd * 100;
  if (
    event.amountCents !== chargeCents ||
    event.metadataChargeCents !== undefined && event.metadataChargeCents !== chargeCents
  ) {
    throw new CheckoutError(
      "amount_mismatch",
      400,
      "Waffo amount does not match the immutable intent charge",
    );
  }
  const targetBidCents = intent.target_bid_cents ?? intent.bid_usd * 100;
  if (event.targetBidCents !== targetBidCents) {
    throw new CheckoutError(
      "metadata_mismatch",
      400,
      "Waffo target bid does not match the immutable intent",
    );
  }
  const quoteBaseBidCents = intent.quote_base_bid_cents ?? 0;
  if (event.quoteBaseBidCents !== quoteBaseBidCents) {
    throw new CheckoutError(
      "metadata_mismatch",
      400,
      "Waffo quote base does not match the immutable intent",
    );
  }
  if (!draftsEqual(event.draft, draftFromIntent(intent))) {
    throw new CheckoutError(
      "metadata_mismatch",
      400,
      "Waffo normalized brief does not match the immutable intent",
    );
  }
  if (["rejected", "canceled", "paid"].includes(intent.status)) {
    if (intent.status === "paid") {
      const listing = loadListingForWaffoIntent(db, intent.intent_id);
      if (listing) {
        throw new CheckoutError("already_applied", 409, "Waffo intent was already applied");
      }
    }
    throw new CheckoutError("intent_not_open", 409, "Waffo intent is not payable");
  }
  const checkoutId = event.checkoutId || intent.session_id || intent.provider_checkout_id || `waffo_${intent.intent_id}`;
  const attached = attachWaffoIntentWithin(
    db,
    intent.intent_id,
    checkoutId,
    intent.checkout_url || intent.provider_checkout_url || undefined,
    intent.expires_at || undefined,
  );
  return { intent: attached, checkoutId, draft: draftFromIntent(attached) };
}

function applyWaffoPaidEvent(
  db: AppDb,
  event: PaidEvent,
): PaidEventApplyResult {
  let deferredError: CheckoutError | undefined;
  let appliedResult: PaidEventApplyResult | undefined;
  const result = db
    .transaction(() => {
      const deliveryId = event.deliveryId ?? event.eventId;
      const businessEventId = event.businessEventId ?? event.eventId;
      if (!deliveryId || !businessEventId) {
        deferredError = new CheckoutError("invalid_webhook", 400, "Waffo event identity is missing");
        return undefined;
      }
      const existingDelivery = loadWaffoDelivery(db, deliveryId);
      if (existingDelivery) {
        if (!waffoFactsMatch(existingDelivery, event)) {
          insertWaffoAttempt(
            db,
            event,
            "rejected",
            "webhook_replay_mismatch",
            "Waffo delivery id was reused for a different payload",
            nowUtc().toISOString(),
          );
          deferredError = new CheckoutError(
            "webhook_replay_mismatch",
            409,
            "Waffo delivery id was reused for a different payload",
          );
          return undefined;
        }
        if (existingDelivery.status === "applied") {
          const listing = event.intentId
            ? loadListingForWaffoIntent(db, event.intentId)
            : undefined;
          if (!listing) {
            deferredError = new CheckoutError("webhook_replay_missing", 500, "Applied Waffo delivery has no listing");
            return undefined;
          }
          appliedResult = { listing, replayed: true };
          return appliedResult;
        }
        // A byte-identical retry of a rejected or reconciliation outcome is
        // already durably accounted for. Acknowledge it without reopening the
        // intent or writing rank a second time; changed payloads took the
        // append-only conflict path above.
        appliedResult = {
          listing: event.intentId
            ? loadListingForWaffoIntent(db, event.intentId) ?? null
            : null,
          replayed: true,
          applied: false,
        };
        return appliedResult;
      }

      const existingBusiness = loadWaffoBusinessEvent(
        db,
        event.eventType,
        businessEventId,
      );
      if (existingBusiness) {
        if (!waffoBusinessFactsMatch(existingBusiness, event)) {
          insertWaffoDelivery(
            db,
            event,
            "rejected",
            "webhook_replay_mismatch",
            "Waffo business event was reused for a different payload",
            nowUtc().toISOString(),
          );
          deferredError = new CheckoutError(
            "webhook_replay_mismatch",
            409,
            "Waffo business event was reused for a different payload",
          );
          return undefined;
        }
        insertWaffoDelivery(
          db,
          event,
          existingBusiness.status,
          "duplicate_delivery",
          "Exact Waffo business event was already recorded",
          nowUtc().toISOString(),
        );
        if (existingBusiness.status === "applied") {
          const listing = event.intentId
            ? loadListingForWaffoIntent(db, event.intentId)
            : undefined;
          if (listing) {
            appliedResult = { listing, replayed: true };
            return appliedResult;
          }
          deferredError = new CheckoutError("webhook_replay_missing", 500, "Applied Waffo event has no listing");
          return undefined;
        }
        appliedResult = {
          listing: event.intentId
            ? loadListingForWaffoIntent(db, event.intentId) ?? null
            : null,
          replayed: true,
          applied: false,
        };
        return appliedResult;
      }

      const conflicts = [
        loadWaffoIdentityConflict(db, "payment_id", event.paymentId),
        loadWaffoIdentityConflict(db, "order_id", event.orderId),
        loadWaffoIdentityConflict(db, "intent_id", event.intentId),
      ].filter((row): row is WaffoLedgerRow => row !== undefined);
      const identityConflict = conflicts[0];
      if (identityConflict) {
        if (!waffoBusinessFactsMatch(identityConflict, event)) {
          insertWaffoDelivery(
            db,
            event,
            "rejected",
            "identity_reuse",
            "Waffo payment/order/intent identity was reused for a different payload",
            nowUtc().toISOString(),
          );
          deferredError = new CheckoutError(
            "identity_reuse",
            409,
            "Waffo payment/order/intent identity was reused for a different payload",
          );
          return undefined;
        }
        insertWaffoDelivery(
          db,
          event,
          identityConflict.status,
          "duplicate_delivery",
          "Exact Waffo identity was already recorded",
          nowUtc().toISOString(),
        );
        if (identityConflict.status === "applied") {
          const listing = event.intentId
            ? loadListingForWaffoIntent(db, event.intentId)
            : undefined;
          if (listing) {
            appliedResult = { listing, replayed: true };
            return appliedResult;
          }
          deferredError = new CheckoutError("webhook_replay_missing", 500, "Applied Waffo identity has no listing");
          return undefined;
        }
        appliedResult = {
          listing: event.intentId
            ? loadListingForWaffoIntent(db, event.intentId) ?? null
            : null,
          replayed: true,
          applied: false,
        };
        return appliedResult;
      }

      try {
        const ensured = ensureWaffoIntentForEvent(db, event);
        const session = requirePendingCheckout(db, ensured.checkoutId);
        const listing = settlePendingListing(
          db,
          ensured.draft,
          ensured.checkoutId,
          event.paidAt,
          event.amountUsd,
        );
        db.prepare(
          `UPDATE checkout_intents
           SET status = 'paid', failure_code = NULL, failure_message = NULL,
               updated_at = ? WHERE intent_id = ?`,
        ).run(nowUtc().toISOString(), ensured.intent.intent_id);
        const processedAt = nowUtc().toISOString();
        insertWaffoBusinessEvent(
          db,
          event,
          "applied",
          "applied",
          "Waffo order.completed applied",
          processedAt,
        );
        insertWaffoDelivery(
          db,
          event,
          "applied",
          "applied",
          "Waffo order.completed applied",
          processedAt,
        );
        void session;
        appliedResult = { listing, replayed: false };
        return appliedResult;
      } catch (error) {
        if (!(error instanceof CheckoutError)) throw error;
        const status =
          isKnownWaffoIntentFactMismatch(db, event, error)
            ? "reconciliation_required"
            : waffoOutcomeStatus(error);
        if (status === "reconciliation_required" && event.intentId) {
          markWaffoIntent(
            db,
            event.intentId,
            "needs_reconciliation",
            error.code,
            error.message,
          );
        }
        const processedAt = nowUtc().toISOString();
        insertWaffoBusinessEvent(db, event, status, error.code, error.message, processedAt);
        insertWaffoDelivery(db, event, status, error.code, error.message, processedAt);
        deferredError = error;
        return undefined;
      }
    })
    .immediate();
  if (deferredError) throw deferredError;
  if (appliedResult) return appliedResult;
  if (result) return result;
  throw new CheckoutError("webhook_not_applied", 500, "Waffo webhook had no outcome");
}

function paymentFromCheckout(
  polar: PaymentPort,
  checkoutId: string,
): CheckoutReturnPayment | null {
  const checkout = polar.getCheckout(checkoutId);
  if (!checkout) {
    return null;
  }
  return { kind: checkout.kind, chargeUsd: checkout.amountUsd };
}

function checkoutReturnStatus(
  intent: WaffoIntentRow,
  listing: Listing | undefined,
): CheckoutReturnResult["status"] {
  if (listing) return "success";
  switch (intent.status) {
    case "paid":
      // A paid intent without its listing is an internal reconciliation case,
      // never a success screen that implies rank was written.
      return "reconciliation";
    case "unknown":
      return "unknown";
    case "needs_reconciliation":
    case "reconciliation_required":
      return "reconciliation";
    case "rejected":
    case "failed":
      return "rejected";
    default:
      return "pending";
  }
}

function loadWaffoIntentForCheckout(
  db: AppDb,
  checkoutId: string,
): WaffoIntentRow | undefined {
  return db
    .prepare(
      `SELECT intent_id, intent_fingerprint, metadata_fingerprint, week_id,
              window_key, brand, terms, brief_url, canonical_url, bid_usd,
              target_bid_cents, quote_base_bid_cents, charge_cents, kind,
              expected_amount_usd, currency, mode, store_id, product_id,
              tax_category, provider_product_id, provider_checkout_id,
              provider_checkout_url, session_id, checkout_url, expires_at,
              status, failure_code, failure_message, created_at, updated_at
       FROM checkout_intents
       WHERE session_id = ? OR provider_checkout_id = ?
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(checkoutId, checkoutId) as WaffoIntentRow | undefined;
}

export async function handleCheckoutReturn(
  params: {
    checkoutId?: string | string[];
    intent?: string | string[];
    status?: string | string[];
  },
  port?: PaymentPort,
): Promise<CheckoutReturnResult> {
  const checkoutId = firstQuery(params.checkoutId);
  const intentId = firstQuery(params.intent);
  const rawStatus = firstQuery(params.status);
  const canceled = rawStatus === "cancel" || rawStatus === "canceled";

  if (intentId) {
    const db = getDb();
    const intent = loadWaffoIntent(db, intentId);
    if (canceled) {
      return {
        status: "cancel",
        listing: null,
        payment: intent ? paymentFromIntent(intent) : null,
      };
    }
    if (!intent) {
      return { status: "pending", listing: null, payment: null };
    }
    const listing =
      intent.status === "paid" ? loadListingForWaffoIntent(db, intentId) : undefined;
    return {
      status: checkoutReturnStatus(intent, listing),
      listing: listing ?? null,
      payment: paymentFromIntent(intent),
    };
  }

  if (!checkoutId) {
    return {
      status: canceled ? "cancel" : "pending",
      listing: null,
      payment: null,
    };
  }

  const polar = port ?? getPaymentPort();
  if (canceled) {
    // A browser return is not a provider settlement boundary. Fixture returns
    // may mark their local draft canceled; live Waffo returns remain read-only
    // because only a verified webhook can change payment state.
    if (polar.kind !== "live") await polar.abandonCheckout(checkoutId);
    return {
      status: "cancel",
      listing: null,
      payment: paymentFromCheckout(polar, checkoutId),
    };
  }

  if (polar.kind === "live") {
    const db = getDb();
    const intent = loadWaffoIntentForCheckout(db, checkoutId);
    const checkout = polar.getCheckout(checkoutId);
    const listing =
      intent?.status === "paid"
        ? loadListingForWaffoIntent(db, intent.intent_id) ?? null
        : checkout?.status === "paid" && checkout.listingId
          ? getListingById(db, checkout.listingId) ?? null
          : null;
    return {
      status: intent
        ? checkoutReturnStatus(intent, listing ?? undefined)
        : listing
          ? "success"
          : "pending",
      listing,
      payment: paymentFromCheckout(polar, checkoutId),
    };
  }

  const listing = await polar.completeCheckout(checkoutId);
  return {
    status: "success",
    listing,
    payment: paymentFromCheckout(polar, checkoutId),
  };
}

function paymentFromIntent(intent: WaffoIntentRow): CheckoutReturnPayment {
  return {
    kind: intent.kind,
    chargeUsd: intent.charge_cents !== null
      ? intent.charge_cents / 100
      : intent.expected_amount_usd,
  };
}

export function firstQuery(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function header(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === needle && value.trim() !== "") {
      return value;
    }
  }
  return undefined;
}

async function parseFixtureWebhook(
  rawBody: string,
  headers: Record<string, string>,
): Promise<WebhookResult> {
  const event = parseJson(rawBody);
  if (!isRecord(event)) {
    throw new CheckoutError("invalid_webhook", 400, "invalid webhook payload");
  }
  const eventType = readString(event.type);
  const data = isRecord(event.data) ? event.data : event;
  const status = (readString(data.status) ?? "").toLowerCase();
  if (eventType !== "order.paid") {
    return { ignored: true };
  }
  if (
    status === "expired" ||
    status === "failed" ||
    status === "canceled" ||
    status === "cancelled"
  ) {
    return { ignored: true };
  }
  if (status !== "paid" || data.paid !== true) {
    throw new CheckoutError(
      "invalid_webhook",
      400,
      "order.paid payload is not paid",
    );
  }
  const eventId = header(headers, "webhook-id");
  const orderId = readString(data.id);
  const checkoutId = readString(data.checkout_id ?? data.checkoutId);
  const productId = readString(data.product_id ?? data.productId);
  const currency = readString(data.currency)?.toLowerCase();
  const amountCents = readInt(data.total_amount ?? data.totalAmount);
  if (!eventId || !orderId || !checkoutId || !productId || !currency) {
    throw new CheckoutError(
      "invalid_webhook",
      400,
      "order.paid payload is missing reconciliation fields",
    );
  }
  if (amountCents === undefined) {
    throw new CheckoutError(
      "invalid_webhook",
      400,
      "order.paid payload is missing total_amount",
    );
  }
  const draft = draftFromMetadata(data);
  if (!draft) {
    throw new CheckoutError(
      "invalid_webhook",
      400,
      "order.paid payload is missing checkout metadata",
    );
  }
  const metadataChargeCents = metadataChargeCentsFrom(data);
  const paidAt = readDate(
    event.timestamp ?? data.paid_at ?? data.paidAt ?? data.created_at,
  );
  if (event.timestamp !== undefined && !paidAt) {
    throw new CheckoutError(
      "invalid_webhook",
      400,
      "order.paid payload has an invalid timestamp",
    );
  }
  return {
    eventId,
    orderId,
    eventType: "order.paid",
    checkoutId,
    draft,
    amountUsd: amountCents / 100,
    amountCents,
    currency,
    productId,
    paidAt: paidAt ?? nowUtc().toISOString(),
    payloadHash: hashPayload(rawBody),
    ...(metadataChargeCents === undefined ? {} : { metadataChargeCents }),
  };
}

function draftFromMetadata(data: Record<string, unknown>): ListingDraft | undefined {
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const brand = readString(metadata.brand);
  const terms = readString(metadata.terms);
  const briefUrl = readString(metadata.briefUrl);
  const bidUsd = readInt(metadata.bidUsd);
  const weekId = readString(metadata.weekId);
  if (!brand || !terms || !briefUrl || bidUsd === undefined || !weekId) {
    return undefined;
  }
  try {
    return parseCheckoutInput({ brand, terms, briefUrl, bidUsd, weekId });
  } catch {
    return undefined;
  }
}

function metadataChargeCentsFrom(
  data: Record<string, unknown>,
): number | undefined {
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  if (!Object.prototype.hasOwnProperty.call(metadata, "chargeUsd")) {
    return undefined;
  }
  const chargeUsd = readInt(metadata.chargeUsd);
  if (chargeUsd === undefined || chargeUsd < 1) {
    throw new CheckoutError(
      "invalid_webhook",
      400,
      "Checkout charge metadata is invalid",
    );
  }
  return chargeUsd * 100;
}

function hashPayload(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function readDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
  }
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    ? value
    : undefined;
}

const MAX_WAFFO_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_WAFFO_EVENT_FUTURE_MS = 5 * 60 * 1_000;

function isSensibleEventTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const now = nowUtc().getTime();
  return (
    parsed >= now - MAX_WAFFO_EVENT_AGE_MS &&
    parsed <= now + MAX_WAFFO_EVENT_FUTURE_MS
  );
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}
