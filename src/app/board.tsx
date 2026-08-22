import type { RankedListing } from "../lib/rank";
import { BoardCards, BoardChrome } from "../lib/board-markup";
import { OutbidForm } from "./outbid-form";

export function Board({
  listings,
  weekId,
}: {
  listings: RankedListing[];
  weekId?: string;
}) {
  return (
    <BoardChrome weekId={weekId}>
      <OutbidForm />
      <BoardCards listings={listings} />
    </BoardChrome>
  );
}
