"use client";

import React, { useRef, useState } from "react";
import { MAX_BID_USD, MIN_BID_USD } from "../lib/rank";
import { canonicalizeBriefUrl, normalizeBriefUrlInput } from "../lib/urls";

function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return MIN_BID_USD;
  return Math.max(MIN_BID_USD, Math.min(MAX_BID_USD, Math.trunc(value)));
}

type BriefFieldName = "brand" | "terms" | "briefUrl";
type BriefFieldChange = (field: BriefFieldName, value: string) => void;
type BriefFieldInvalid = () => void;

function BriefUrlField({
  onFieldChange,
}: {
  onFieldChange: BriefFieldChange;
}) {
  return (
    <label className="url primary-url" data-slot="url-input">
      Brief URL
      <input
        name="briefUrl"
        type="text"
        inputMode="url"
        required
        placeholder="example.com/brief"
        autoComplete="url"
        spellCheck={false}
        onChange={(event) => onFieldChange("briefUrl", event.target.value)}
      />
    </label>
  );
}

function BriefIdentityFields({
  onFieldChange,
  onInvalid,
  includeUrl = true,
}: {
  onFieldChange: BriefFieldChange;
  onInvalid?: BriefFieldInvalid;
  includeUrl?: boolean;
}) {
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
          placeholder="Your brand"
          onChange={(event) => onFieldChange("brand", event.target.value)}
          onInvalid={() => onInvalid?.()}
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
          onChange={(event) => onFieldChange("terms", event.target.value)}
          onInvalid={() => onInvalid?.()}
        />
      </label>
      {includeUrl ? <BriefUrlField onFieldChange={onFieldChange} /> : null}
    </>
  );
}

function BriefDetails({
  children,
  identityMarker = false,
}: {
  children: (onInvalid: BriefFieldInvalid) => React.ReactNode;
  identityMarker?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const reveal = () => {
    if (detailsRef.current) {
      detailsRef.current.open = true;
    }
  };
  return (
    <details
      className="brief-details"
      data-slot="category-control"
      ref={detailsRef}
    >
      <summary>
        <span>Brief details</span>
        <span className="brief-details-separator" aria-hidden="true">
          ·
        </span>
        <span className="brief-details-meta">Brand + Terms</span>
      </summary>
      <div
        className="brief-details-content"
        data-brief-identity={identityMarker ? "" : undefined}
      >
        {children(reveal)}
      </div>
    </details>
  );
}

function OccupiedBriefWrite({
  onFieldChange,
  ready,
}: {
  onFieldChange: BriefFieldChange;
  ready: boolean;
}) {
  return (
    <>
      <BriefUrlField onFieldChange={onFieldChange} />
      <BriefDetails>
        {(onInvalid) => (
          <BriefIdentityFields
            onFieldChange={onFieldChange}
            onInvalid={onInvalid}
            includeUrl={false}
          />
        )}
      </BriefDetails>
      <button
        className="outbid"
        data-slot="claim-button"
        data-auction-action="Outbid"
        type="submit"
        disabled={!ready}
        aria-disabled={!ready}
        aria-label="Claim rank"
      >
        <span className="outbid-label">Claim rank</span>
      </button>
    </>
  );
}

function EmptyClaimFirstWrite({
  onFieldChange,
  ready,
}: {
  onFieldChange: BriefFieldChange;
  ready: boolean;
}) {
  return (
    <>
      <BriefUrlField onFieldChange={onFieldChange} />
      <BriefDetails identityMarker>
        {(onInvalid) => (
          <BriefIdentityFields
            onFieldChange={onFieldChange}
            onInvalid={onInvalid}
            includeUrl={false}
          />
        )}
      </BriefDetails>
      <button
        className="outbid"
        data-slot="claim-button"
        data-auction-action="Outbid"
        type="submit"
        data-first-click="claim"
        disabled={!ready}
        aria-disabled={!ready}
        aria-label="Claim rank"
      >
        <span className="outbid-label">Claim rank</span>
      </button>
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
          Raise charge: $<span data-raise-charge-usd="">{raiseChargeUsd}</span>{" "}
          — only the difference, not a new full bid.{" "}
        </span>
      ) : (
        <span className="raise-charge" data-raise-charge="">
          A raise charges only the difference — not a new full bid.{" "}
        </span>
      )}
      A new brief pays the full amount. The same brief link already on the wall
      pays only the difference. Only a confirmed checkout changes the ranking.
    </p>
  );
}

/** Keep the disabled state in lockstep with the server's URL hygiene rules. */
export function isBriefUrlReady(raw: string): boolean {
  try {
    const normalized = normalizeBriefUrlInput(raw);
    if (!normalized) return false;
    canonicalizeBriefUrl(normalized);
    return true;
  } catch {
    return false;
  }
}

export function OutbidForm({
  defaultAmount = MIN_BID_USD,
  topBidUsd,
}: {
  defaultAmount?: number;
  topBidUsd?: number;
}) {
  const [amount, setAmount] = useState(() => clampAmount(defaultAmount));
  const [brand, setBrand] = useState("");
  const [terms, setTerms] = useState("");
  const [briefUrl, setBriefUrl] = useState("");
  const floor = clampAmount(defaultAmount);
  const occupied = topBidUsd !== undefined;
  const takesLead = amount > (topBidUsd ?? floor - 1);
  const formReady =
    brand.trim().length > 0 &&
    terms.trim().length > 0 &&
    isBriefUrlReady(briefUrl);
  const onFieldChange: BriefFieldChange = (field, value) => {
    if (field === "brand") setBrand(value);
    if (field === "terms") setTerms(value);
    if (field === "briefUrl") setBriefUrl(value);
  };

  return (
    <aside
      className={occupied ? "paste-rail" : "paste-rail empty-claim-first"}
      data-slot="claim-hero"
      id="claim"
      data-claim-amount={floor}
      data-top-bid={topBidUsd ?? ""}
      data-empty-claim-first={occupied ? undefined : ""}
      aria-label={occupied ? "Post a brief" : "Claim #1"}
    >
      <p className="paste-kicker">
        {occupied ? "Post a brief in the rolling last 7 days" : "Rolling last 7 days wall"}
      </p>
      <h2 data-slot="claim-heading">
        <span>Claim #1 for</span>
        <span className="amount-stepper" data-slot="amount-stepper">
          <button
            type="button"
            className="step"
            aria-label="Decrease bid by one dollar"
            onClick={() => setAmount((current) => clampAmount(current - 1))}
          >
            −
          </button>
          <label className="amount-field" htmlFor="bid-usd">
            $
            <input
              id="bid-usd"
              name="bidUsd"
              form="brief-form"
              aria-label="Bid amount in whole US dollars"
              inputMode="numeric"
              pattern="[0-9]*"
              required
              min={MIN_BID_USD}
              max={MAX_BID_USD}
              step={1}
              value={amount}
              style={{ width: `${Math.max(2, String(amount).length)}ch` }}
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
          Blank plaster. ${MIN_BID_USD} pastes the first flyer at #1.
        </p>
      )}
      <form
        id="brief-form"
        className="outbid-form"
        data-slot="claim-form"
        method="post"
        action="/checkout"
        data-form-ready={formReady ? "true" : "false"}
      >
        {occupied ? (
          <OccupiedBriefWrite onFieldChange={onFieldChange} ready={formReady} />
        ) : (
          <EmptyClaimFirstWrite onFieldChange={onFieldChange} ready={formReady} />
        )}
      </form>
    </aside>
  );
}
