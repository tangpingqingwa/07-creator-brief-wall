/**
 * Next invokes this hook during server preparation, before route handling.
 * Keep the Node-only database/provider imports behind the runtime check so an
 * Edge bundle cannot accidentally select the payment composition.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { assertRuntimeReady } = await import("./lib/polar");
  assertRuntimeReady();
}
