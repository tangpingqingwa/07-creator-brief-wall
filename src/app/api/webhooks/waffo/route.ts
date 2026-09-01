import { getDb } from "../../../../lib/db";
import {
  applyVerifiedPaidEvent,
  CheckoutError,
  getPaymentPort,
  waffoWebhookErrorStatus,
} from "../../../../lib/polar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only settlement boundary. The body is read once and passed unchanged to
 * the Waffo SDK so its RSA signature covers exactly what the provider sent.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  try {
    const db = getDb();
    const port = getPaymentPort(db);
    const result = await port.parseWebhook(rawBody, headers);
    if ("ignored" in result) {
      return Response.json({ received: true, applied: false });
    }
    const applied = applyVerifiedPaidEvent(db, result);
    return Response.json({
      received: true,
      applied: applied.applied !== false,
      ...(applied.replayed ? { replayed: true } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Waffo webhook failed";
    const status = error instanceof CheckoutError
      ? waffoWebhookErrorStatus(error)
      : 503;
    return Response.json({ error: message }, { status });
  }
}
