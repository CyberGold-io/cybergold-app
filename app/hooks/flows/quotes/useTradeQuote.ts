"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { zeroAddress } from "viem";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { QuotePreviewError, quoteErrorMessage } from "@/app/utils/quoteErrors";
import { economicTradeQuote, tradeAdapter, tradeQuoteResult, type TradeQuoteRequest } from "@/app/utils/tradeQuote";
import type { UpperEstimateDisplayPolicy } from "@/app/utils/economicQuoteSearch";
import { useEconomicQuote } from "./useEconomicQuote";
import { useLegacyTradeQuote } from "./useLegacyTradeQuote";

export function useTradeQuote(input: Omit<TradeQuoteRequest, "deadline" | "retainedPlan">, enabled: boolean, upperEstimate?: UpperEstimateDisplayPolicy) {
  const { addresses } = useProtocolConfiguration(), t = useTranslations("Home");
  const inputKey = JSON.stringify(input);
  const legacy = useLegacyTradeQuote(input, enabled && input.mode !== "exact-in");
  const counter = input.native ? zeroAddress : input.counterToken;
  const economic = useEconomicQuote({ intent: input.side === "buy" ? 0 : 1,
    inputs: [{ currency: input.side === "buy" ? counter : addresses.core ?? zeroAddress, amount: input.amount }],
    outputCurrency: input.side === "buy" ? addresses.core ?? zeroAddress : counter },
    enabled && input.mode === "exact-in" && Boolean(addresses.core && addresses.helpers), upperEstimate);
  const data = useMemo(() => {
    if (!enabled || !economic.data) return undefined;
    const captured: Omit<TradeQuoteRequest, "deadline" | "retainedPlan"> = JSON.parse(inputKey);
    const value = tradeQuoteResult(economicTradeQuote(economic.data, captured), captured.slippageBps);
    return { ...value, deployment: { core: addresses.core, helpers: value.value.deployment.helpers as `0x${string}`,
      adapter: tradeAdapter(value.value) } };
  }, [enabled, economic.data, inputKey, addresses.core]);
  const captureEconomicReady = economic.captureReady;
  const captureReady = useCallback(() => {
    if (!enabled) return undefined;
    const current = captureEconomicReady();
    if (!current) return undefined;
    const captured: Omit<TradeQuoteRequest, "deadline" | "retainedPlan"> = JSON.parse(inputKey);
    const value = tradeQuoteResult(economicTradeQuote(current, captured), captured.slippageBps);
    return { ...value, deployment: { core: addresses.core, helpers: value.value.deployment.helpers as `0x${string}`,
      adapter: tradeAdapter(value.value) } };
  }, [enabled, captureEconomicReady, inputKey, addresses.core]);
  if (input.mode !== "exact-in") return { ...legacy, refresh: async () => undefined,
    refreshing: false, refreshError: undefined as string | undefined,
    captureReady: () => legacy.data, stopSearch: () => {}, invalidated: false };
  return { data, status: !enabled ? "idle" as const : data ? "success" as const
      : economic.isError ? "failed" as const : "loading" as const,
    error: economic.isError && !data ? quoteErrorMessage(economic.error ?? new Error("Quote unavailable"), t) : undefined,
    errorCode: economic.isError && !data && economic.error instanceof QuotePreviewError ? economic.error.code : undefined,
    failure: economic.isError && !data ? economic.error : undefined,
    estimate: undefined, optimizing: enabled && Boolean(data) && economic.optimizing,
    progress: undefined, refresh: economic.refresh, refreshing: economic.isFetching,
    refreshError: economic.refreshError ? quoteErrorMessage(economic.refreshError, t) : undefined,
    captureReady, stopSearch: economic.stopSearch, invalidated: economic.invalidated };
}
