"use client";

import React, { useState } from "react";
import { MAX_BID_USD, MIN_BID_USD } from "../lib/rank";

function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return MIN_BID_USD;
  return Math.max(MIN_BID_USD, Math.min(MAX_BID_USD, Math.trunc(value)));
}

function BriefIdentityFields() {
  return (
    <>
      <label className="brand">
        Brand
        <input
          name="brand"
          type="text"
          required
          maxLength={80}
          autoComplete="organization"
        />
      </label>
      <label className="terms">
        Terms
        <input
          name="terms"
          type="text"
          required
          maxLength={280}
          placeholder="$800 flat, 1 TikTok"
        />
      </label>
      <label className="url">
        Brief URL
        <input
          name="briefUrl"
          type="url"
          required
          placeholder="https://"
          autoComplete="url"
        />
      </label>
    </>
  );
}

function OccupiedBriefWrite() {
  return (
    <>
      <BriefIdentityFields />
      <button className="outbid" type="submit">
        Outbid
      </button>
    </>
  );
}

function EmptyClaimFirstWrite() {
  return (
    <>
      <button className="outbid" type="submit" data-first-click="claim">
        Outbid
      </button>
      <div
        className="brief-identity"
        data-brief-identity=""
        data-later-write=""
      >
        <p className="later-write-label">Then the brief URL</p>
        <BriefIdentityFields />
      </div>
    </>
  );
}

function OccupiedCheckoutCopy({
  floor,
  amount,
  topBidUsd,
  takesLead,
}: {
  floor: number;
  amount: number;
  topBidUsd: number;
  takesLead: boolean;
}) {
  const raiseChargeUsd = takesLead ? amount - topBidUsd : 0;
  return (
    <p className="claim-note" data-raise-difference="">
      {takesLead
        ? `Need $${floor} to take #1. $${amount} is the public bid — this flyer is first. `
        : `Need $${floor} to take #1. $${amount} still lists, below the top. New spots start at $${MIN_BID_USD}. `}
      {takesLead ? (
        <span
          className="raise-charge"
          data-raise-charge=""
          data-current-usd={topBidUsd}
        >
          Polar charges $<span data-raise-charge-usd="">{raiseChargeUsd}</span>{" "}
          to raise — only the difference, not a new bid.{" "}
        </span>
      ) : (
        <span className="raise-charge" data-raise-charge="">
          Polar charges the difference on a raise — not a new full bid.{" "}
        </span>
      )}
      New brief: Polar charges that full amount. Same brief URL already on the wall: Polar charges only the difference. Unpaid checkout stays off the board until Polar reports paid. An abandoned brief is not Terms as #1.
    </p>
  );
}

export function OutbidForm({
  defaultAmount = MIN_BID_USD,
  topBidUsd,
}: {
  defaultAmount?: number;
  topBidUsd?: number;
}) {
  const [amount, setAmount] = useState(() => clampAmount(defaultAmount));
  const floor = clampAmount(defaultAmount);
  const occupied = topBidUsd !== undefined;
  const takesLead = amount > (topBidUsd ?? floor - 1);

  return (
    <aside
      className={occupied ? "paste-rail" : "paste-rail empty-claim-first"}
      id="claim"
      data-claim-amount={floor}
      data-top-bid={topBidUsd ?? ""}
      data-empty-claim-first={occupied ? undefined : ""}
      aria-label={occupied ? "Post a brief" : "Claim #1"}
    >
      <p className="paste-kicker">
        {occupied ? "Post a brief this week" : "This week’s wall"}
      </p>
      <h2>
        <span>Claim #1 for</span>
        <span className="amount-stepper">
          <button
            type="button"
            className="step"
            aria-label="Decrease bid by one dollar"
            onClick={() => setAmount((current) => clampAmount(current - 1))}
          >
            −
          </button>
          <label className="amount-field">
            $
            <input
              name="bidUsd"
              form="brief-form"
              inputMode="numeric"
              pattern="[0-9]*"
              required
              min={MIN_BID_USD}
              max={MAX_BID_USD}
              step={1}
              value={amount}
              onChange={(event) => {
                const next = Number(event.target.value.replace(/[^\d]/g, ""));
                setAmount(clampAmount(next || MIN_BID_USD));
              }}
            />
          </label>
          <button
            type="button"
            className="step"
            aria-label="Increase bid by one dollar"
            onClick={() => setAmount((current) => clampAmount(current + 1))}
          >
            +
          </button>
        </span>
      </h2>
      {occupied && topBidUsd !== undefined ? (
        <OccupiedCheckoutCopy
          floor={floor}
          amount={amount}
          topBidUsd={topBidUsd}
          takesLead={takesLead}
        />
      ) : (
        <p className="claim-note">
          Blank plaster. ${MIN_BID_USD} pastes the first flyer at #1. Unpaid checkout stays off the board until Polar reports paid. An abandoned brief is not Terms as #1.
        </p>
      )}
      {occupied ? null : (
        <>
          <p className="empty" data-empty-week="true">
            This week’s board is empty. The plaster is blank.
          </p>
          <p className="empty-hint" data-empty-window="">
            No seeded briefs. Rank is the bid. Live window is rolling last 7 days from paid placement. Not Monday 00:00 UTC. Unpaid checkout stays off the board until Polar reports paid. An abandoned brief is not Terms as #1.
          </p>
        </>
      )}
      <form
        id="brief-form"
        className="outbid-form"
        method="post"
        action="/checkout"
      >
        {occupied ? <OccupiedBriefWrite /> : <EmptyClaimFirstWrite />}
      </form>
    </aside>
  );
}
