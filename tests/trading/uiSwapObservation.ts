import type { Page } from "@playwright/test";

export type UiSwapObservation = {
  attemptId: string;
  outcome?: "started" | "submitted" | "succeeded" | "failed" | "reverted" | "unconfirmed";
  transactionHash?: `0x${string}`;
  stage?: "quote" | "balance" | "network" | "authorization" | "preparation" | "simulation" | "submission" | "confirmation";
  walletStep?: "approval" | "signature" | "transaction";
  /** Only an explicit native rejection can establish no trade submission. */
  walletRejected?: true;
};
type ObservationWindow = Window & { __cybergoldSwapObservations?: UiSwapObservation[] };

/** Observe the product's safe local lifecycle before best-effort collection.
 * Only attempt identity, enum progress and a public transaction hash cross this
 * test boundary. No provider is wrapped and no wallet/RPC request is made.
 */
export function installUiSwapObservation(scope: ObservationWindow = window) {
  scope.__cybergoldSwapObservations = [];
  scope.addEventListener("cybergold:diagnostic", event => {
    const value: unknown = (event as CustomEvent).detail;
    if (!value || typeof value !== "object") return;
    const source = value as Record<string, unknown>;
    if (!["swap", "wallet"].includes(String(source.operation)) || typeof source.attemptId !== "string"
      || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(source.attemptId)) return;
    const row: UiSwapObservation = { attemptId: source.attemptId };
    if (source.operation === "swap" && ["started", "submitted", "succeeded", "failed", "reverted", "unconfirmed"].includes(String(source.outcome)))
      row.outcome = source.outcome as UiSwapObservation["outcome"];
    if (["quote", "balance", "network", "authorization", "preparation", "simulation", "submission", "confirmation"].includes(String(source.stage)))
      row.stage = source.stage as UiSwapObservation["stage"];
    if (source.operation === "wallet" && ["approval", "signature", "transaction"].includes(String(source.walletStep)))
      row.walletStep = source.walletStep as UiSwapObservation["walletStep"];
    if (source.operation === "swap" && source.outcome === "failed" && source.reason === "wallet_rejected")
      row.walletRejected = true;
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
    const stage = matches.findLast(row => row.stage)?.stage;
    const walletStep = matches.findLast(row => row.walletStep)?.walletStep;
    return { attemptId: id, outcome: matches.findLast(row => row.outcome)?.outcome,
      transactionHash: matches.findLast(row => row.transactionHash)?.transactionHash,
      ...(stage ? { stage } : {}), ...(walletStep ? { walletStep } : {}),
      ...(matches.some(row => row.walletRejected) ? { walletRejected: true as const } : {}) };
  }, attemptId);
}
