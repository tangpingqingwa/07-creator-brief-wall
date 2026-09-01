import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import {
  ClickError,
  getPublicListing,
  incrementPublicClick,
} from "../../../lib/clicks";
import { confirmBriefHtml } from "../../../lib/confirm-brief";
import { getDb } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const BOARD_CSS_PATH = join(process.cwd(), "src", "app", "board.css");

function clickErrorResponse(error: unknown): Response {
  if (error instanceof ClickError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.httpStatus },
    );
  }
  throw error;
}

function confirmDocument(body: string): string {
  const css = readFileSync(BOARD_CSS_PATH, "utf8");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Confirm this brief · Creator Brief Wall</title>
<style>${css}</style>
</head>
<body>
<div class="site-frame">${body}<footer class="maker-footer" data-maker-contact=""><p>Built by <a href="mailto:tangpingqingwa@gmail.com">tangpingqingwa@gmail.com</a></p></footer></div>
</body>
</html>
`;
}

/** Confirm-before-leave. GET is 200 and does not increment clicks. */
export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const params = await Promise.resolve(context.params);
  try {
    const listing = getPublicListing(getDb(), params.id ?? "");
    return new NextResponse(confirmDocument(confirmBriefHtml(listing)), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return clickErrorResponse(error);
  }
}

/** Confirmed leave. Increments `clicks` once, then 302s with no added trackers. */
export async function POST(
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
    return clickErrorResponse(error);
  }
}
