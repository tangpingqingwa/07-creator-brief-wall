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
    intent?: string | string[];
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
          No rank was claimed. A canceled or incomplete checkout never creates
          a listing or becomes #1.
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
          $
          <span data-raise-charge-usd="">{result.payment.chargeUsd}</span>
          {" was charged — the difference, not a new full bid. "}
          {`${result.listing.brand} is listed at $${result.listing.bidUsd}.`}
        </p>
        <p>
          <a href="/">Back to the board</a>
        </p>
      </main>
    );
  }

  if (result.status === "pending") {
    return (
      <main className="board" data-return="pending">
        <h1>Payment pending</h1>
        <p>
          Payment has not been confirmed yet. No rank change has been made;
          check the board again shortly.
        </p>
        <p>
          <a href="/">Back to the board</a>
        </p>
      </main>
    );
  }

  if (result.status === "unknown") {
    return (
      <main className="board" data-return="unknown">
        <h1>Payment status unknown</h1>
        <p>
          We do not have a confirmed result for this payment yet. No rank
          change has been made. Keep your receipt and contact support if the
          listing does not appear.
        </p>
        <p>
          <a href="/">Back to the board</a>
        </p>
      </main>
    );
  }

  if (result.status === "reconciliation") {
    return (
      <main className="board" data-return="reconciliation">
        <h1>Payment needs review</h1>
        <p>
          The payment needs review before it can change the wall. No rank
          change has been made. Do not pay again; keep your receipt for
          support.
        </p>
        <p>
          <a href="/">Back to the board</a>
        </p>
      </main>
    );
  }

  if (result.status === "rejected") {
    return (
      <main className="board" data-return="rejected">
        <h1>Payment not accepted</h1>
        <p>
          The payment was not accepted. No listing or rank change was made.
          Return to the board and try again if you still want to claim the
          brief.
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
          : "Payment is confirmed, but the board has not received a settled listing yet. No rank change has been made."}
      </p>
      <p>
        <a href="/">Back to the board</a>
      </p>
    </main>
  );
}
