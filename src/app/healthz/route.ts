import { getDb } from "../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  getDb().prepare("SELECT 1 AS ok").get();
  return Response.json({ ok: true }, { status: 200 });
}
