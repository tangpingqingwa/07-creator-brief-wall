import React from "react";
import { claimNumberOneUsd, type RankedListing } from "../lib/rank";
import { BoardCards, BoardChrome } from "../lib/board-markup";
import { OutbidForm } from "./outbid-form";

export function Board({
  listings,
  weekId,
}: {
  listings: RankedListing[];
  weekId?: string;
}) {
  const topBidUsd = listings[0]?.bidUsd;
  const occupied = listings.length > 0;
  const claim = (
    <OutbidForm
      defaultAmount={claimNumberOneUsd(topBidUsd)}
      topBidUsd={topBidUsd}
    />
  );
  const flyers = <BoardCards listings={listings} />;
  return (
    <BoardChrome weekId={weekId} occupied={occupied}>
      {occupied ? (
        <>
          {flyers}
          {claim}
        </>
      ) : (
        <>
          {claim}
          {flyers}
        </>
      )}
    </BoardChrome>
  );
}
