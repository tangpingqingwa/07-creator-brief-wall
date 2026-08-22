import { getDb } from "../lib/db";
import { currentWeekUtc, listLiveBoard } from "../lib/week";
import { Board } from "./board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function HomePage() {
  const week = currentWeekUtc();
  return (
    <Board listings={listLiveBoard(getDb(), week.weekId)} weekId={week.weekId} />
  );
}
