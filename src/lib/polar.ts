import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import type { AppDb, ListingRow } from "./db";
import { getDb } from "./db";
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
import { utcWeekId } from "./week";

export { utcWeekId } from "./week";

export type PolarEnv = Record<string, string | undefined>;

/** Production Polar API. Override with `POLAR_API_BASE` for sandbox smoke. */
export const POLAR_API_BASE = "https://api.polar.sh";

/** Live client host. Default stays production; sandbox is env-only. */
export function polarApiBase(env: PolarEnv = process.env): string {
  const fromEnv = env.POLAR_API_BASE?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  return POLAR_API_BASE;
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
  listingDraft: ListingDraft;
  successUrl: string;
  status: CheckoutStatus;
  listingId?: string;
};

export type CreateCheckoutInput = {
  amountUsd: number;
  listingDraft: ListingDraft;
  successUrl: string;
};

export type PaidEvent = {
  checkoutId: string;
  draft: ListingDraft;
  amountUsd: number;
  paidAt: string;
};

export type WebhookResult = PaidEvent | { ignored: true };

export type PolarPort = {
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

/** Live Polar only when POLAR_LIVE=1. Fixture override always wins. */
export function isPolarLive(env: PolarEnv = process.env): boolean {
  if (env.POLAR_FIXTURE_ONLY === "1") {
    return false;
  }
  return env.POLAR_LIVE === "1";
}

export function requirePolarSecret(
  name:
    | "POLAR_ACCESS_TOKEN"
    | "POLAR_WEBHOOK_SECRET"
    | "POLAR_SUCCESS_URL"
    | "POLAR_PRODUCT_ID",
  env: PolarEnv = process.env,
): string {
  const value = env[name];
  if (!value) {
    throw new Error(`BLOCKED-SECRET: ${name}`);
  }
  return value;
}

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

/** Same canonical brief URL this week is a raise; a new URL pays a full bid. */
export function planCheckout(
  db: AppDb,
  draft: ListingDraft,
): Extract<CheckoutQuote, { ok: true }> {
  const existing = findListingByBrief(db, draft.weekId, draft.briefUrl);
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

export function applyPaidListing(
  db: AppDb,
  draft: ListingDraft,
  checkoutId: string,
  paidAt: string,
): Listing {
  const replayed = loadListingForCompletedCheckout(db, checkoutId);
  if (replayed) {
    return replayed;
  }

  const quote = planCheckout(db, draft);
  if (quote.kind === "raise") {
    return applyPaidRaise(db, draft, quote, checkoutId, paidAt);
  }
  return applyPaidPlace(db, draft, quote, checkoutId, paidAt);
}

function applyPaidPlace(
  db: AppDb,
  draft: ListingDraft,
  quote: Extract<CheckoutQuote, { ok: true; kind: "place" }>,
  checkoutId: string,
  paidAt: string,
): Listing {
  const listingId = newId("lst");
  const apply = db.transaction(() => {
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
  });
  apply();

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
  const existing = findListingByBrief(db, draft.weekId, draft.briefUrl);
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

  const apply = db.transaction(() => {
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
  });
  apply();

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
  if (pending) {
    if (
      pending.status === "pending" &&
      pending.amount_usd !== input.amountUsd
    ) {
      throw new CheckoutError(
        "raise_charge_mismatch",
        400,
        "Raise without paying the difference",
      );
    }
    db.prepare(
      `UPDATE payments
       SET listing_id = ?, status = 'completed', completed_at = ?, kind = ?, amount_usd = ?
       WHERE polar_checkout_id = ?`,
    ).run(
      input.listingId,
      input.paidAt,
      input.kind,
      input.amountUsd,
      input.checkoutId,
    );
  } else {
    db.prepare(
      `INSERT INTO payments (
        id, listing_id, week_id, brief_url, amount_usd, kind, status, polar_checkout_id, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId("pay"),
      input.listingId,
      input.draft.weekId,
      input.draft.briefUrl,
      input.amountUsd,
      input.kind,
      "completed",
      input.checkoutId,
      input.paidAt,
      input.paidAt,
    );
  }

  db.prepare(
    `UPDATE checkout_drafts
     SET status = 'paid', listing_id = ?, completed_at = ?
     WHERE checkout_id = ?`,
  ).run(input.listingId, input.paidAt, input.checkoutId);
}

export function recordOpenCheckout(
  db: AppDb,
  checkoutId: string,
  draft: ListingDraft,
  createdAt: string = new Date().toISOString(),
): void {
  if (loadDraft(db, checkoutId)) {
    return;
  }
  insertOpenDraft(db, checkoutId, draft, createdAt, planCheckout(db, draft));
}

function insertOpenDraft(
  db: AppDb,
  checkoutId: string,
  draft: ListingDraft,
  createdAt: string,
  quote?: Extract<CheckoutQuote, { ok: true }>,
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

/** In-process Polar. Completing a checkout writes the listing; unpaid does not. */
export class FakePolarPort implements PolarPort {
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
    insertOpenDraft(this.db, checkoutId, draft, new Date().toISOString(), quote);
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
    const paidAt = new Date().toISOString();
    return applyPaidListing(this.db, draftFromRow(row), checkoutId, paidAt);
  }

  async abandonCheckout(checkoutId: string): Promise<void> {
    const row = loadDraft(this.db, checkoutId);
    if (!row || row.status !== "open") {
      return;
    }
    const now = new Date().toISOString();
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
    const row = loadDraft(this.db, checkoutId);
    if (!row) {
      return undefined;
    }
    const payment = this.db
      .prepare(
        `SELECT amount_usd FROM payments WHERE polar_checkout_id = ?`,
      )
      .get(checkoutId) as { amount_usd: number } | undefined;
    return {
      checkoutId: row.checkout_id,
      amountUsd: payment?.amount_usd ?? row.bid_usd,
      listingDraft: draftFromRow(row),
      successUrl: "",
      status: row.status,
      listingId: row.listing_id ?? undefined,
    };
  }

  async parseWebhook(
    rawBody: string,
    _headers: Record<string, string>,
  ): Promise<WebhookResult> {
    return parseCheckoutWebhook(rawBody, (checkoutId, draft) =>
      this.ensureDraft(checkoutId, draft),
    );
  }

  private ensureDraft(checkoutId: string, draft: ListingDraft): void {
    if (loadDraft(this.db, checkoutId)) {
      return;
    }
    insertOpenDraft(this.db, checkoutId, draft, new Date().toISOString());
  }
}

export type LivePolarOptions = {
  env?: PolarEnv;
  fetch?: typeof fetch;
};

/**
 * Live Polar Checkout. Selected only when POLAR_LIVE=1.
 * Tests and CI must never construct this without injected fetch.
 */
export class LivePolarPort implements PolarPort {
  readonly kind = "live" as const;
  private readonly env: PolarEnv;
  private readonly fetchFn: typeof fetch;

  constructor(options: LivePolarOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchFn = options.fetch ?? fetch;
    if (!isPolarLive(this.env)) {
      throw new Error("Live Polar is env-gated; use FakePolarPort");
    }
    requirePolarSecret("POLAR_ACCESS_TOKEN", this.env);
    requirePolarSecret("POLAR_PRODUCT_ID", this.env);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart> {
    const token = requirePolarSecret("POLAR_ACCESS_TOKEN", this.env);
    const productId = requirePolarSecret("POLAR_PRODUCT_ID", this.env);
    const successUrl =
      this.env.POLAR_SUCCESS_URL?.trim() || input.successUrl;
    const response = await this.fetchFn(`${polarApiBase(this.env)}/v1/checkouts/`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        product_id: productId,
        amount: input.amountUsd * 100,
        currency: "usd",
        success_url: successUrl,
        metadata: {
          brand: input.listingDraft.brand,
          terms: input.listingDraft.terms,
          briefUrl: input.listingDraft.briefUrl,
          bidUsd: String(input.listingDraft.bidUsd),
          weekId: input.listingDraft.weekId,
          chargeUsd: String(input.amountUsd),
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`polar checkout failed: ${response.status}`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const id = readString(payload.id);
    const url = readString(payload.url);
    if (!id || !url) {
      throw new Error("polar checkout response missing id/url");
    }
    return { checkoutId: id, url };
  }

  async completeCheckout(_checkoutId: string): Promise<Listing | null> {
    throw new Error("live Polar session completes via webhook only");
  }

  async abandonCheckout(_checkoutId: string): Promise<void> {
    return;
  }

  getCheckout(_checkoutId: string): CheckoutRecord | undefined {
    return undefined;
  }

  async parseWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<WebhookResult> {
    const secret = requirePolarSecret("POLAR_WEBHOOK_SECRET", this.env);
    if (!verifyPolarSignature(rawBody, headers, secret)) {
      throw new Error("invalid Polar webhook signature");
    }
    return parseCheckoutWebhook(rawBody, () => undefined);
  }
}

export function getPolarPort(db: AppDb = getDb()): PolarPort {
  if (isPolarLive()) {
    return new LivePolarPort();
  }
  return new FakePolarPort(db);
}

export async function handleCheckoutReturn(
  params: {
    checkoutId?: string | string[];
    status?: string | string[];
  },
  port?: PolarPort,
): Promise<{ status: "success" | "cancel"; listing: Listing | null }> {
  const checkoutId = firstQuery(params.checkoutId);
  const rawStatus = firstQuery(params.status);
  const canceled = rawStatus === "cancel" || rawStatus === "canceled";

  if (!checkoutId) {
    return { status: canceled ? "cancel" : "success", listing: null };
  }

  const polar = port ?? getPolarPort();
  if (canceled) {
    await polar.abandonCheckout(checkoutId);
    return { status: "cancel", listing: null };
  }

  if (polar.kind === "live") {
    return { status: "success", listing: null };
  }

  const listing = await polar.completeCheckout(checkoutId);
  return { status: "success", listing };
}

export function firstQuery(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function verifyPolarSignature(
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
): boolean {
  const id = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signature = header(headers, "webhook-signature");
  if (!id || !timestamp || !signature) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  for (const part of signature.split(" ")) {
    const value = part.startsWith("v1,") ? part.slice(3) : part;
    if (safeEqual(value, expected)) {
      return true;
    }
  }
  return false;
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

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function parseCheckoutWebhook(
  rawBody: string,
  ensureDraft: (checkoutId: string, draft: ListingDraft) => void,
): Promise<WebhookResult> {
  const event = parseJson(rawBody);
  if (!isRecord(event)) {
    return { ignored: true };
  }
  const data = isRecord(event.data) ? event.data : event;
  const status = readString(data.status) ?? "";
  const checkoutId = readString(data.id);
  if (!checkoutId) {
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
  if (!isPaidStatus(status) && event.type !== "order.paid") {
    return { ignored: true };
  }
  const draft = draftFromMetadata(data);
  if (draft) {
    ensureDraft(checkoutId, draft);
  }
  const resolved = draft ?? undefined;
  if (!resolved) {
    return { ignored: true };
  }
  return {
    checkoutId,
    draft: resolved,
    amountUsd: resolved.bidUsd,
    paidAt: new Date().toISOString(),
  };
}

function isPaidStatus(status: string): boolean {
  return (
    status === "succeeded" ||
    status === "paid" ||
    status === "confirmed" ||
    status === "complete"
  );
}

function draftFromMetadata(data: Record<string, unknown>): ListingDraft | undefined {
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const brand = readString(metadata.brand);
  const terms = readString(metadata.terms);
  const briefUrl = readString(metadata.briefUrl);
  const bidUsd = readInt(metadata.bidUsd);
  const weekId = readString(metadata.weekId) ?? utcWeekId();
  if (!brand || !terms || !briefUrl || bidUsd === undefined) {
    return undefined;
  }
  try {
    return parseCheckoutInput({ brand, terms, briefUrl, bidUsd, weekId });
  } catch {
    return undefined;
  }
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
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}
