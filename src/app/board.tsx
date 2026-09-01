import React from "react";
import {
  claimNumberOneUsd,
  rankListings,
  type RankedListing,
} from "../lib/rank";
import { BoardCards, BoardChrome, HomeRail } from "../lib/board-markup";
import { OutbidForm } from "./outbid-form";

export function Board({
  listings,
  weekId,
}: {
  listings: RankedListing[];
  weekId?: string;
}) {
  const paid = rankListings(listings);
  const topBidUsd = paid[0]?.bidUsd;
  const occupied = paid.length > 0;
  const claim = (
    <OutbidForm
      defaultAmount={claimNumberOneUsd(topBidUsd)}
      topBidUsd={topBidUsd}
    />
  );
  return (
    <BoardChrome
      weekId={weekId}
      occupied={occupied}
    >
      {claim}
      <HomeRail />
      <BoardCards listings={paid} />
    </BoardChrome>
  );
}
