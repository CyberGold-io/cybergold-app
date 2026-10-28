import type { BasketPreviewRequest, BasketPreview } from "./basketPreview.ts";
import type { ActiveTradeQuote, TradeQuoteRequest } from "./tradeQuote.ts";
import type { ProtocolDeployment } from "./protocolConfiguration.ts";
import type { DiagnosticReferences } from "./diagnosticReferences.ts";
import type { EconomicQuote } from "./economicQuotes.ts";

export const TRADE_SELECTION_EVENT = "cybergold:trade-selection";

export type TradeSelectionObservation = {
  attemptId?: string;
  quote?: ActiveTradeQuote;
  deployment?: ProtocolDeployment;
  diagnostics?: DiagnosticReferences;
  intent?: TradeQuoteRequest;
  universalQuote?: import("./universalExactInput.ts").UniversalExactInputQuote;
  economicQuote?: EconomicQuote;
  basketRequest?: BasketPreviewRequest;
  basketPreview?: BasketPreview;
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
