import React from "react";
import { handleCheckoutReturn } from "../../../lib/polar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReturnPageProps = {
  searchParams?: Promise<{
    checkoutId?: string | string[];
    status?: string | string[];
  }>;
};

export default async function CheckoutReturnPage({
  searchParams,
}: ReturnPageProps) {
  const params = (await searchParams) ?? {};
  const result = await handleCheckoutReturn(params);

  if (result.status === "cancel") {
    return (
      <main className="board" data-return="cancel">
        <h1>Checkout canceled</h1>
        <p>
          No rank change. An unpaid checkout does not list. Rank updates only
          after Polar reports paid. An abandoned brief is not Terms as #1.
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
