import { connection } from "next/server";
import { getDb } from "../lib/db";
import { currentWeekUtc, listLiveBoard, nowUtc } from "../lib/week";
import { Board } from "./board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  await connection();
  const week = currentWeekUtc(nowUtc());
  return (
    <Board listings={listLiveBoard(getDb(), week.weekId)} weekId={week.weekId} />
  );
}
