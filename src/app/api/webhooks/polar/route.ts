export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Polar is retired; legacy traffic must never reach settlement. */
export async function POST(_request: Request): Promise<Response> {
  return Response.json(
    { error: "Polar webhook retired; use /webhooks/waffo" },
    { status: 410 },
  );
}

export async function GET(_request: Request): Promise<Response> {
  return POST(_request);
}
