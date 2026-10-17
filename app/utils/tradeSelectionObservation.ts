import type { BasketPreviewRequest } from "./basketPreview.ts";
import type { TradeQuote, TradeQuoteRequest } from "./tradeQuote.ts";
import type { ProtocolDeployment } from "./protocolConfiguration.ts";
import type { DiagnosticReferences } from "./diagnosticReferences.ts";

export const TRADE_SELECTION_EVENT = "cybergold:trade-selection";

export type TradeSelectionObservation = {
  attemptId?: string;
  quote?: TradeQuote;
  deployment?: ProtocolDeployment;
  diagnostics?: DiagnosticReferences;
  intent?: TradeQuoteRequest;
  basketRequest?: BasketPreviewRequest;
};

/** In-memory observation of the actual click selection. Never sent to a collector. */
export function observeTradeSelection(observation: TradeSelectionObservation,
  publish: (value: TradeSelectionObservation) => void = value => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TRADE_SELECTION_EVENT, { detail: value }));
  }) {
  // The listener must not be able to mutate the plan being submitted. Optional
  // observation, including an injected test listener, cannot interrupt a trade.
  try { publish(structuredClone(observation)); } catch { /* No network, persistence or retry. */ }
}
