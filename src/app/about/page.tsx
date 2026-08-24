import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "About · Creator Brief Wall",
  description:
    "No ads, no API keys, no revenue share. Brands pay to be seen by creators. Rank is the bid.",
};

export default function AboutPage() {
  return (
    <main className="board" data-page="about">
      <h1>About</h1>
      <p>
        Creator Brief Wall is a public pay-to-rank board where brands auction
        the #1 brief worth taking this week in front of mid-tier TikTok,
        YouTube, Instagram, and Twitch creators. Brands pay to be{" "}
        <strong>seen by creators</strong>, not by consumers.
      </p>
      <p>
        <strong>Rank is the bid.</strong> Nothing else. Paying less than #1
        still lists at the rank that bid can take. Equal bids: the older listing
        keeps the higher rank.
      </p>
      <p>
        There are <strong>no ads</strong>, <strong>no API keys</strong>, and{" "}
        <strong>no revenue share</strong> with creators or listed brands. Polar
        is Merchant of Record in live; that fee is the operator&apos;s cost, not
        a cut of a creator payout. There is no API-key product.
      </p>
      <p>
        This site is <strong>independent</strong>. It is not affiliated with
        TikTok, YouTube, Instagram, Twitch, Meta, or Google. We do not invent
        follower counts, subscriber counts, average views, engagement rate, CPM,
        or “estimated reach.”
      </p>
      <p>
        Copy is <strong>English</strong>. Currency is <strong>USD</strong>. The
        market is <strong>global</strong> — there is no China-city default. This
        is the <strong>creator-brief-wall</strong> vertical, a clone of{" "}
        <a href="https://outbid.lol">outbid.lol</a> pay-to-rank mechanics.
      </p>
      <p>
        Anyone can read the board without an account. Payment is the only write
        path. Live money is Polar Checkout. Tests use a fixture so they never
        call live Polar. Abandoned checkout does not invent a brief.
      </p>
      <p>
        <a href="/rules">Read the rules</a> for the $5 minimum, older-wins ties,
        raise-pays-difference, weekly reset (rolling last 7 days, not Monday
        00:00 UTC), and banned chat / NSFW URLs.{" "}
        <a href="/">Back to the board</a>.
      </p>
    </main>
  );
}
