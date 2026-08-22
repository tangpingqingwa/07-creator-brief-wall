import { NextResponse } from "next/server";
import { ClickError, incrementPublicClick } from "../../../lib/clicks";
import { getDb } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Public brief-URL hop. Increments `clicks` once, then 302s with no added trackers. */
async function redirectBrief(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const params = await Promise.resolve(context.params);
  try {
    const hop = incrementPublicClick(getDb(), params.id ?? "");
    const response = NextResponse.redirect(hop.url, 302);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof ClickError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus },
      );
    }
    throw error;
  }
}

export function GET(request: Request, context: RouteContext): Promise<Response> {
  return redirectBrief(request, context);
}

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return redirectBrief(request, context);
}
