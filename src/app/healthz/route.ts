import { assertRuntimeReady } from "../../lib/polar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type HealthzOk = { ok: true };

export async function GET(): Promise<Response> {
  try {
    assertRuntimeReady();
    const body: HealthzOk = { ok: true };
    return Response.json(body, { status: 200 });
  } catch {
    return Response.json({ ok: false, ready: false }, { status: 503 });
  }
}
