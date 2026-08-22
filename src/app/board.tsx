import type { RankedListing } from "../lib/rank";
import { BoardCards, BoardChrome } from "../lib/board-markup";
import { OutbidForm } from "./outbid-form";

export function Board({ listings }: { listings: RankedListing[] }) {
  return (
    <BoardChrome>
      <OutbidForm />
      <BoardCards listings={listings} />
    </BoardChrome>
  );
}
