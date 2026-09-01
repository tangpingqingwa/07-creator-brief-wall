import React from "react";

export function AboutCopy({ occupied }: { occupied: boolean }) {
  return (
    <main
      className="board"
      data-page="about"
      data-occupied={occupied ? "true" : "false"}
    >
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
        Anyone can read the wall without an account. A brief appears only
        after payment is confirmed, and a canceled or abandoned checkout
        changes nothing.
      </p>
      <p>
        This site is <strong>independent</strong>. It is not affiliated with
        TikTok, YouTube, Instagram, Twitch, Meta, or Google. We do not invent
        follower counts, subscriber counts, average views, engagement rate, CPM,
        or “estimated reach.”
      </p>
      <p>
        The wall is in <strong>English</strong>, bids use{" "}
        <strong>USD</strong>, and creators can browse briefs from anywhere.
      </p>
      {occupied ? (
        <p className="about-raise" data-about-raise="">
          A raise charges the original payer only the difference. The new rank
          appears after payment is confirmed.
        </p>
      ) : null}
      <p>
        <a href="/rules">Read the rules</a> for the $5 minimum, older-wins ties,
        raise-pays-difference, the seven-day placement window, and banned chat
        / NSFW URLs.{" "}
        <a href="/">Back to the board</a>.
      </p>
    </main>
  );
}
