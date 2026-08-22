import { applyPaidListing, getPolarPort } from "../../../../lib/polar";
import { getDb } from "../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  try {
    const result = await getPolarPort().parseWebhook(rawBody, headers);
    if ("ignored" in result) {
      if (result.ignored) {
        const event = safeJson(rawBody);
        const status = webhookStatus(event);
        const checkoutId = webhookId(event);
        if (
          checkoutId &&
          (status === "expired" ||
            status === "failed" ||
            status === "canceled" ||
            status === "cancelled")
        ) {
          await getPolarPort().abandonCheckout(checkoutId);
        }
      }
      return Response.json({ received: true, applied: false });
    }
    applyPaidListing(getDb(), result.draft, result.checkoutId, result.paidAt);
    return Response.json({ received: true, applied: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid webhook";
    const status =
      message.startsWith("BLOCKED-SECRET") || message.includes("signature")
        ? 400
        : 500;
    return Response.json({ error: message }, { status });
  }
}

function safeJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

function webhookStatus(event: unknown): string {
  if (!event || typeof event !== "object") {
    return "";
  }
  const record = event as Record<string, unknown>;
  const data =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : record;
  return typeof data.status === "string" ? data.status : "";
}

function webhookId(event: unknown): string | undefined {
  if (!event || typeof event !== "object") {
    return undefined;
  }
  const record = event as Record<string, unknown>;
  const data =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : record;
  return typeof data.id === "string" ? data.id : undefined;
}
