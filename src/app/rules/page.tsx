import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getDb } from "../../lib/db";
import { listLiveBoard, nowUtc } from "../../lib/week";
import { RulesCopy } from "../../lib/rules-copy";

export const metadata: Metadata = {
  title: "Rules · Creator Brief Wall",
  description:
    "Min $5. Rank is the bid. Older wins ties. Raise pays the difference. Rolling last 7 days. No chat or NSFW.",
  alternates: { canonical: "/rules" },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function RulesPage() {
  noStore();
  await connection();
  await headers();
  const occupied = listLiveBoard(getDb(), nowUtc()).length > 0;
  return <RulesCopy occupied={occupied} />;
}
