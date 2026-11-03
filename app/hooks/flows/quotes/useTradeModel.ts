"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { notifyManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { zeroAddress } from "viem";
import { targetChainId } from "@/app/config/chain";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { useQuoteCacheScope } from "@/app/context/chainHeadContext";
import { usePageVisible } from "@/app/hooks/usePageVisible";
import { fetchTradeModel, receiveTradeModel, type TradeModelRequest } from "@/app/utils/tradeQuote";
import { getTradeBudgetRange, subscribeQuoteModels, tradeDisplayModelScope } from "@/app/utils/quoteModelStore";
import { arithmeticEconomicEstimate, fittingEconomicQuote, fullBudgetEconomicEstimate, upperEconomicQuote, type ArithmeticEconomicEstimate } from "@/app/utils/nearbyEconomicEstimate";

type TradeDisplayEstimate = Partial<ArithmeticEconomicEstimate> & {
  quotedOutput: bigint; quotedInput?: bigint; inputMaximum?: bigint; fullBudget?: true; limited?: true;
};

export function useTradeModel(input: TradeModelRequest, enabled: boolean): TradeDisplayEstimate | undefined {
  const { identity, addresses } = useProtocolConfiguration(), generation = useSandboxForkGeneration();
  const scope = useQuoteCacheScope(), visible = usePageVisible();
  const displayScope = tradeDisplayModelScope(identity, generation), inputKey = JSON.stringify(input);
  const readRange = useCallback(() => enabled ? getTradeBudgetRange(JSON.parse(inputKey), displayScope) : undefined,
    [enabled, inputKey, displayScope]);
  const range = useSyncExternalStore(subscribeQuoteModels, readRange, () => undefined);
  const client = useQueryClient(), key = JSON.stringify(["trade-model", targetChainId, generation, scope, input, identity]);
  const subscribe = useCallback((changed: () => void) => {
    const notify = notifyManager.batchCalls(changed);
    return client.getQueryCache().subscribe(event => {
      if (event.query.queryKey[0] === "economic-quote") notify();
    });
  }, [client]);
  // Return the original stable quote object to useSyncExternalStore. Arithmetic
  // is performed after reading it, without creating snapshots during render.
  const readQuote = useCallback((lookup: typeof upperEconomicQuote) => {
    const captured: TradeModelRequest = JSON.parse(inputKey);
    if (!enabled || captured.mode !== "exact-in" || !addresses.core) return undefined;
    const counter = captured.native ? zeroAddress : captured.counterToken;
    return lookup(client, { intent: captured.side === "buy" ? 0 : 1,
      inputs: [{ currency: captured.side === "buy" ? counter : addresses.core, amount: captured.amount }],
      outputCurrency: captured.side === "buy" ? addresses.core : counter },
      { chainId: targetChainId, configuration: identity, generation });
  }, [client, enabled, inputKey, addresses.core, identity, generation]);
  const readUpper = useCallback(() => readQuote(upperEconomicQuote), [readQuote]);
  const readFitting = useCallback(() => readQuote(fittingEconomicQuote), [readQuote]);
  const upper = useSyncExternalStore(subscribe, readUpper, () => undefined);
  const fitting = useSyncExternalStore(subscribe, readFitting, () => undefined);
  const query = useQuery({ queryKey: ["trade-model", targetChainId, generation, scope, input, identity],
    enabled: enabled && visible && Boolean(input.counterToken), retry: false, staleTime: 10_000,
    queryFn: ({ signal }) => fetchTradeModel(input, signal) });
  useEffect(() => { if (query.data) receiveTradeModel(query.data, identity, displayScope); }, [query.data, identity, displayScope]);
  useEffect(() => {
    if (!enabled || !visible) void client.cancelQueries({ queryKey: JSON.parse(key), exact: true });
  }, [client, enabled, visible, key]);
  if (!enabled) return undefined;
  if (fitting?.reuseSample?.inputLimitObserved) return { quotedOutput: BigInt(fitting.quotedOutput),
    quotedInput: BigInt(fitting.inputs[0].amount), inputMaximum: BigInt(fitting.inputs[0].amount), limited: true,
    fees: { protocolFeeCygld: BigInt(fitting.fees.coreProtocolFeeCygld), helperFeeCygld: BigInt(fitting.fees.coreHelpersFeeCygld),
      marketFeeCygld: BigInt(fitting.fees.marketFeeCygld) } };
  const fullBudget = fitting && fullBudgetEconomicEstimate(fitting, BigInt(input.amount));
  const local = upper?.reuseSample && arithmeticEconomicEstimate(upper.reuseSample, BigInt(input.amount));
  const rangeFunding = range ? { quotedInput: BigInt(range.quotedInput), inputMaximum: BigInt(range.minimumBudget) } : undefined;
  if (local) return { ...local, ...rangeFunding };
  if (fullBudget && range) return { ...rangeFunding, quotedOutput: BigInt(range.quotedOutput) };
  if (fullBudget) return { ...fullBudget, fullBudget: true };
  const estimate = query.data?.estimate;
  if (estimate?.strategy === "universal") {
    return { quotedOutput: BigInt(estimate.amount), basis: estimate.basis,
      fees: { protocolFeeCygld: BigInt(estimate.fees.coreProtocolFeeCygld),
        helperFeeCygld: BigInt(estimate.fees.coreHelpersFeeCygld), marketFeeCygld: BigInt(estimate.fees.marketFeeCygld) } };
  }
  if (range) return { quotedInput: BigInt(range.quotedInput), quotedOutput: BigInt(range.quotedOutput),
    inputMaximum: BigInt(range.minimumBudget) };
  return estimate ? { quotedOutput: BigInt(estimate.amount) } : undefined;
}
