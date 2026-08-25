import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getDb } from "../../lib/db";
import { listLiveBoard, nowUtc } from "../../lib/week";
import { AboutCopy } from "../../lib/about-copy";

export const metadata: Metadata = {
  title: "About · Creator Brief Wall",
  description:
    "No ads, no API keys, no revenue share. Brands pay to be seen by creators. Rank is the bid.",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function AboutPage() {
  noStore();
  await connection();
  await headers();
  const occupied = listLiveBoard(getDb(), nowUtc()).length > 0;
  return <AboutCopy occupied={occupied} />;
}
