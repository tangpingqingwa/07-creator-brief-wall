import { getDb } from "../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type HealthzOk = { ok: true };

export async function GET(): Promise<Response> {
  getDb().prepare("SELECT 1 AS ok").get();
  const body: HealthzOk = { ok: true };
  return Response.json(body, { status: 200 });
}
