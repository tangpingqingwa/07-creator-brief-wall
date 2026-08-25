import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getDb } from "../../../lib/db";
import { RaiseTooSmallCopy } from "../../../lib/raise-too-small-copy";
import { listLiveBoard, nowUtc } from "../../../lib/week";

export const metadata: Metadata = {
  title: "Raise too small · Creator Brief Wall",
  description:
    "A raise must be at least $1 above the current bid. Unpaid Polar checkout stays off the wall.",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function RaiseTooSmallPage() {
  noStore();
  await connection();
  await headers();
  const occupied = listLiveBoard(getDb(), nowUtc()).length > 0;
  return <RaiseTooSmallCopy occupied={occupied} />;
}
