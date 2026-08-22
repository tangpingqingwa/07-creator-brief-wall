export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main>
      <h1>Creator Brief Wall</h1>
      <p>This week’s briefs, ranked by money.</p>
      <p data-empty-week="true">
        This week’s board is empty. No brand has paid to list a brief yet. We do
        not seed listings or invent follower counts.
      </p>
      <p>Rank is the bid. Minimum $5. The board resets Monday 00:00 UTC.</p>
    </main>
  );
}
