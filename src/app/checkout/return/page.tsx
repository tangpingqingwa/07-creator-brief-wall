import React from "react";
import {
  handleCheckoutReturn,
  type CheckoutReturnResult,
} from "../../../lib/polar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReturnPageProps = {
  searchParams?: Promise<{
    checkoutId?: string | string[];
    status?: string | string[];
  }>;
};

function raiseWasPaid(result: CheckoutReturnResult): boolean {
  return (
    result.status === "success" &&
    result.payment?.kind === "raise" &&
    result.listing != null
  );
}

export default async function CheckoutReturnPage({
  searchParams,
}: ReturnPageProps) {
  const params = (await searchParams) ?? {};
  const result = await handleCheckoutReturn(params);

  if (result.status === "cancel") {
    return (
      <main className="board" data-return="cancel">
        <h1>Checkout canceled</h1>
        <p className="unpaid-cancel">
          No rank change. A canceled or unpaid Polar return still changes no rank. An unpaid checkout does not list. Rank updates only after Polar reports paid. An abandoned brief is not Terms as #1.
        </p>
        <p>
          <a href="/">Back to the board</a>
        </p>
      </main>
    );
  }

  if (raiseWasPaid(result) && result.listing && result.payment) {
    return (
      <main className="board" data-return="success" data-raise-charged="">
        <h1>You&apos;re on the board</h1>
        <p className="raise-charged" data-raise-charged="">
          Polar charged $
          <span data-raise-charge-usd="">{result.payment.chargeUsd}</span>
          {" — the difference, not a new full bid. "}
          {`${result.listing.brand} is listed at $${result.listing.bidUsd}.`}
        </p>
        <p>
          <a href="/">Back to the board</a>
        </p>
      </main>
    );
  }

  return (
    <main className="board" data-return="success">
      <h1>You&apos;re on the board</h1>
      <p>
        {result.listing
          ? `${result.listing.brand} is listed at $${result.listing.bidUsd}.`
          : "Payment completed. Rank updates only after Polar reports paid."}
      </p>
      <p>
        <a href="/">Back to the board</a>
      </p>
    </main>
  );
}
