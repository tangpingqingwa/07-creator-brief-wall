import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getDb } from "../lib/db";
import { currentWeekUtc, listLiveBoard, nowUtc } from "../lib/week";
import { Board } from "./board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function HomePage() {
  noStore();
  await connection();
  await headers();
  const week = currentWeekUtc(nowUtc());
  return (
    <Board listings={listLiveBoard(getDb(), week.weekId)} weekId={week.weekId} />
  );
}
