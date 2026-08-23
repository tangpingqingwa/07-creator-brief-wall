"use client";

import React, { useState } from "react";
import { MAX_BID_USD, MIN_BID_USD } from "../lib/rank";

function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return MIN_BID_USD;
  return Math.max(MIN_BID_USD, Math.min(MAX_BID_USD, Math.trunc(value)));
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
      className="paste-rail"
      id="claim"
      data-claim-amount={floor}
      data-top-bid={topBidUsd ?? ""}
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
      <p className="claim-note">
        {occupied
          ? takesLead
            ? `Need $${floor} to take #1. Pay $${amount} and this flyer is first.`
            : `Need $${floor} to take #1. $${amount} still lists, below the top. New spots start at $${MIN_BID_USD}.`
          : `Blank plaster. $${MIN_BID_USD} pastes the first flyer at #1.`}
      </p>
      <form
        id="brief-form"
        className="outbid-form"
        method="post"
        action="/checkout"
      >
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
        <button className="outbid" type="submit">
          Outbid
        </button>
      </form>
    </aside>
  );
}
