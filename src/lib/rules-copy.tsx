import React from "react";

export function RulesCopy({ occupied }: { occupied: boolean }) {
  return (
    <main
      className="board"
      data-page="rules"
      data-occupied={occupied ? "true" : "false"}
    >
      <h1>Rules</h1>
      <p>
        These rules are the product. A bidder can predict rank from this page
        alone. Rank is the bid.
      </p>

      <h2>Ranking</h2>
      <table>
        <tbody>
          <tr>
            <th>Rank is the bid</th>
            <td>
              Sort by <code>bidUsd</code> descending. Nothing else — not clicks,
              not recency except ties, not “quality,” not follower counts.
            </td>
          </tr>
          <tr>
            <th>Whole dollars</th>
            <td>USD only. Integers. No cents. Step is $1.</td>
          </tr>
          <tr>
            <th>Minimum</th>
            <td>
              First bid for a listing this week must be <strong>$5</strong>.
            </td>
          </tr>
          <tr>
            <th>Maximum</th>
            <td>
              Any bid (first or raise) must be <strong>≤ $50,000</strong>.
            </td>
          </tr>
          <tr>
            <th>Below #1 still lists</th>
            <td>
              Paying less than #1 still appears at the rank that bid can take.
              Those briefs are not the #1 brief this week.
            </td>
          </tr>
          <tr>
            <th>Equal bids</th>
            <td>
              <strong>Older wins ties.</strong> Compare <code>createdAt</code>{" "}
              ascending (earlier first payment), then listing id.
            </td>
          </tr>
          <tr>
            <th>Raise</th>
            <td>
              Same canonical brief URL still inside last 7 days raises.{" "}
              <code>weekId</code> stays an audit label — not raise identity.{" "}
              <strong>Raise pays difference</strong> only (
              <code>new − current</code>). New amount must be a whole dollar ≥
              current + $1.
            </td>
          </tr>
          <tr>
            <th>Cannot steal the difference</th>
            <td>
              A different brief that wants that rank must pay the{" "}
              <strong>full</strong> target amount, not the incumbent’s
              difference. To take #1, the new bid must be at least $1 above the
              current top bid.
            </td>
          </tr>
          <tr>
            <th>Payment claims rank</th>
            <td>
              A completed Polar payment claims the rank. Unpaid checkout stays
              off the board until Polar reports paid. An abandoned brief is not
              Terms as #1. We do not invent a paid brief.
            </td>
          </tr>
        </tbody>
      </table>
      {occupied ? (
        <p className="rules-raise" data-rules-raise="">
          Polar charges the difference on a raise — not a new full bid. Unpaid Polar checkout stays off the wall until Polar reports paid.
        </p>
      ) : null}

      <h2>Weekly UTC reset</h2>
      <table>
        <tbody>
          <tr>
            <th>Period</th>
            <td>
              Rolling last 7 days from paid placement. Live rank is that window
              only.
            </td>
          </tr>
          <tr>
            <th>Boundary</th>
            <td>
              <strong>Rolling last 7 days. Not Monday 00:00 UTC.</strong> A brand
              outside civil midnight does not lose the plaster on a timezone
              tax. <code>weekId</code> stays an ISO week label (
              <code>YYYY-Www</code>, Monday 00:00:00.000 UTC) for Polar/audit.
            </td>
          </tr>
          <tr>
            <th>
              <code>weekId</code>
            </th>
            <td>
              ISO week in UTC, <code>YYYY-Www</code> (e.g. <code>2026-W34</code>
              ). Label only — not the live expiry.
            </td>
          </tr>
          <tr>
            <th>What resets</th>
            <td>
              Live rank after seven days from first paid placement. Clicks and
              bids do not carry once that window ends.
            </td>
          </tr>
          <tr>
            <th>What does not carry</th>
            <td>
              A bid paid more than seven days ago. Want this window’s #1? Pay
              again.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        An empty week is valid. There is no #1 brief until someone pays. Do not
        invent a listing.
      </p>

      <h2>No fake followers</h2>
      <p>
        We never display follower counts, subscriber counts, average views,
        engagement rate, CPM, or estimated reach. Those fields are not on the
        card and not in the database. Public <strong>clicks</strong> on the
        brief URL are the only counter.
      </p>

      <h2>Brief URL hygiene</h2>
      <ol>
        <li>
          Require <code>https:</code>. Reject <code>http:</code>,{" "}
          <code>javascript:</code>, and <code>data:</code>.
        </li>
        <li>
          Strip tracking and affiliate query keys: <code>utm_*</code>,{" "}
          <code>fbclid</code>, <code>gclid</code>, <code>gbraid</code>,{" "}
          <code>wbraid</code>, <code>mc_eid</code>, <code>ref</code>,{" "}
          <code>ref_</code>, <code>affiliate</code>, <code>aff</code>,{" "}
          <code>irclickid</code>. If the query is only trackers, drop it
          entirely. Path and a non-tracker query (a brief id) may stay.
        </li>
        <li>
          Reject chat / invite hosts: Telegram, WhatsApp, Discord, Messenger,
          Signal, Slack invite, and similar group-chat links. The board is
          briefs, not chats.
        </li>
        <li>
          Reject <strong>NSFW</strong> / adult / porn hosts and paths. If it is
          NSFW, it does not belong.
        </li>
        <li>
          Known shorteners (<code>bit.ly</code>, <code>t.co</code>,{" "}
          <code>tinyurl.com</code>, <code>lnkd.in</code>, and similar) are
          rejected. We do not silently replace them.
        </li>
        <li>
          Two briefs on the same host stay distinct: identity is origin + path
          (plus any remaining non-tracker query).
        </li>
      </ol>
      <p>
        Chat / invite, NSFW, shorteners, and non-https fail as{" "}
        <code>400</code>. No listing. No charge.{" "}
        <a href="/about">About</a> · <a href="/">Back to the board</a>.
      </p>
    </main>
  );
}
