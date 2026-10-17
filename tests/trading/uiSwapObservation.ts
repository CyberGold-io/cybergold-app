import type { Page } from "@playwright/test";

export type UiSwapObservation = {
  attemptId: string;
  outcome?: "started" | "submitted" | "succeeded" | "failed" | "reverted" | "unconfirmed";
  transactionHash?: `0x${string}`;
};
type ObservationWindow = Window & { __cybergoldSwapObservations?: UiSwapObservation[] };

/** Observe the product's safe local lifecycle before best-effort collection.
 * Only attempt identity, outcome and a public transaction hash cross this test
 * boundary. No provider is wrapped and no wallet/RPC request is made.
 */
export function installUiSwapObservation(scope: ObservationWindow = window) {
  scope.__cybergoldSwapObservations = [];
  scope.addEventListener("cybergold:diagnostic", event => {
    const value: unknown = (event as CustomEvent).detail;
    if (!value || typeof value !== "object") return;
    const source = value as Record<string, unknown>;
    if (source.operation !== "swap" || typeof source.attemptId !== "string"
      || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(source.attemptId)) return;
    const row: UiSwapObservation = { attemptId: source.attemptId };
    if (["started", "submitted", "succeeded", "failed", "reverted", "unconfirmed"].includes(String(source.outcome)))
      row.outcome = source.outcome as UiSwapObservation["outcome"];
    if (typeof source.transactionHash === "string" && /^0x[0-9a-f]{64}$/i.test(source.transactionHash))
      row.transactionHash = source.transactionHash as `0x${string}`;
    scope.__cybergoldSwapObservations!.push(row);
  });
}

/** A late event for a previous attempt cannot become the current submission. */
export async function uiSwapObservation(page: Page, attemptId?: string): Promise<UiSwapObservation | undefined> {
  return page.evaluate(expected => {
    const rows = (window as ObservationWindow).__cybergoldSwapObservations ?? [];
    const id = expected ?? rows.findLast(row => row.outcome === "started")?.attemptId;
    const matches = rows.filter(row => row.attemptId === id);
    if (!id || !matches.length) return;
    return { attemptId: id, outcome: matches.at(-1)?.outcome,
      transactionHash: matches.findLast(row => row.transactionHash)?.transactionHash };
  }, attemptId);
}
