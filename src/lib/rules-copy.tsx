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
        The wall follows the published rules below. There are no hidden ranking
        factors: rank is the bid.
      </p>

      <h2>Ranking</h2>
      <table>
        <tbody>
          <tr>
            <th>Rank is the bid</th>
            <td>
              Briefs are ordered by bid from highest to lowest. Clicks,
              recency, editorial preference, and follower counts do not affect
              rank.
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
            <td>The brief placed first keeps the higher rank.</td>
          </tr>
          <tr>
            <th>Raise</th>
            <td>
              The same cleaned brief link may raise while its placement is
              active. The original payer is charged only the{" "}
              <strong>difference</strong>, and the new total must be at least
              $1 higher.
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
              Rank changes only after payment is confirmed. An incomplete or
              abandoned checkout never appears on the wall.
            </td>
          </tr>
        </tbody>
      </table>
      {occupied ? (
        <p className="rules-raise" data-rules-raise="">
          A raise charges the original payer only the difference. The new rank
          appears after payment is confirmed.
        </p>
      ) : null}

      <h2>Rolling seven-day window</h2>
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
              Each placement keeps its own seven-day window. The wall does not
              reset for everyone at Monday midnight.
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
        If nobody has paid for an active placement, the wall has no #1 brief.
      </p>

      <h2>No fake followers</h2>
      <p>
        We never display follower counts, subscriber counts, average views,
        engagement rate, CPM, or estimated reach. Public{" "}
        <strong>clicks</strong> on the brief URL are the only counter.
      </p>

      <h2>Brief URL hygiene</h2>
      <ol>
        <li>Use a secure, public brief link.</li>
        <li>Tracking, referral, and affiliate parameters are removed.</li>
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
          Link shorteners and private, local-only, credentialed, or otherwise
          unsafe destinations are rejected.
        </li>
        <li>
          Two briefs on the same host stay distinct: identity is origin + path
          (plus any remaining non-tracker query).
        </li>
      </ol>
      <p>
        Rejected links never create a listing or start a charge.{" "}
        <a href="/about">About</a> · <a href="/">Back to the board</a>.
      </p>
    </main>
  );
}
