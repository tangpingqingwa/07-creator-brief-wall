import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";
import {
  CheckoutError,
  getPolarPort,
  isPolarLive,
  parseCheckoutInput,
  planCheckout,
  recordOpenCheckout,
  type ListingDraft,
} from "../../../lib/polar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  try {
    const draft = await readDraft(request);
    const quote = planCheckout(getDb(), draft);
    const port = getPolarPort();
    const successUrl =
      process.env.POLAR_SUCCESS_URL?.trim() || `${origin}/checkout/return`;
    const started = await port.createCheckout({
      amountUsd: quote.chargeUsd,
      listingDraft: draft,
      successUrl,
    });
    if (port.kind === "live") {
      recordOpenCheckout(getDb(), started.checkoutId, draft);
    }
    return NextResponse.redirect(started.url, 303);
  } catch (error) {
    if (error instanceof CheckoutError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus },
      );
    }
    if (error instanceof Error && error.message.startsWith("BLOCKED-SECRET")) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (isPolarLive()) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Polar checkout failed" },
        { status: 503 },
      );
    }
    throw error;
  }
}

async function readDraft(request: Request): Promise<ListingDraft> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    return parseCheckoutInput(body);
  }
  const form = await request.formData();
  return parseCheckoutInput({
    brand: form.get("brand"),
    terms: form.get("terms"),
    briefUrl: form.get("briefUrl"),
    bidUsd: form.get("bidUsd"),
  });
}
