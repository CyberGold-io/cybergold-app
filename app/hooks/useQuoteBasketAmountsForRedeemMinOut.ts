import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { BasketComponent, RouteSearchProgress, TokenIssueQuoteStatus } from "../types";
import { useProgressiveEstimate } from "./flows/quotes/useProgressiveEstimate";
import { useQuoteCacheScope } from "../context/chainHeadContext";
import { fetchRouteQuotes } from "../utils/routeSearch";

// Amounts remain aligned to basketComponents; one server search quotes the wave.
export function useQuoteBasketAmountsUniswapExactOut({
  enabled, buyTokenAddress, tokenBudgetsExactOut, buyAmountFromInputBigInt, basketComponents, debug,
}: {
  enabled: boolean;
  buyTokenAddress?: Address;
  tokenBudgetsExactOut?: readonly { asset: Address; targetOut: bigint }[];
  buyAmountFromInputBigInt?: bigint;
  basketComponents: readonly BasketComponent[];
  debug?: (message: string, payload: Record<string, unknown>) => void;
}) {
  const quoteScope = useQuoteCacheScope();
  const [basketAmounts, setBasketAmounts] = useState<bigint[] | undefined>();
  const [status, setStatus] = useState<TokenIssueQuoteStatus>("idle");
  const [error, setError] = useState<string | undefined>();
  const [progress, setProgress] = useState<RouteSearchProgress | undefined>();

  const { estimate: estimatedBasketAmounts, publish: publishEstimatedAmounts } = useProgressiveEstimate<bigint[]>(
    [buyTokenAddress, tokenBudgetsExactOut, buyAmountFromInputBigInt, basketComponents], enabled
  );

  useEffect(() => {
    if (!enabled || !buyTokenAddress || !tokenBudgetsExactOut || !buyAmountFromInputBigInt || buyAmountFromInputBigInt <= 0n) {
      setBasketAmounts(undefined);
      setStatus("idle");
      setError(undefined);
      setProgress(undefined);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setBasketAmounts(undefined);
    setStatus("loading");
    setError(undefined);
    setProgress(undefined);
    const outputAsset = buyTokenAddress;
    const budgets = tokenBudgetsExactOut;
    async function quoteBasketAmounts() {
      try {
        const targets = budgets.filter(row => row.targetOut > 0n && row.asset.toLowerCase() !== outputAsset.toLowerCase())
          .map(row => ({ inputAsset: row.asset, outputAsset, amount: row.targetOut }));
        function orderAmounts(results: Awaited<ReturnType<typeof fetchRouteQuotes>>) {
          const byAsset = new Map(targets.map((target, index) => [target.inputAsset.toLowerCase(), results[index]]));
          const amounts = new Map(budgets.map(row => {
          if (row.targetOut <= 0n) return [row.asset.toLowerCase(), 0n] as const;
          if (row.asset.toLowerCase() === outputAsset.toLowerCase()) return [row.asset.toLowerCase(), row.targetOut] as const;
          const selected = byAsset.get(row.asset.toLowerCase());
          if (!selected) throw new Error(`No exact-out route found for basket asset ${row.asset}`);
          return [row.asset.toLowerCase(), selected.quote] as const;
        }));
          return basketComponents.map(component => amounts.get(component.token.address.toLowerCase()) ?? 0n);

        }
        const results = await fetchRouteQuotes({ scope: quoteScope, targets, mode: "exact-out", signal: controller.signal,
          onCandidates: values => {
            if (!cancelled && values.every(Boolean)) publishEstimatedAmounts(orderAmounts(values));
          },
        });
        const ordered = orderAmounts(results);
        if (cancelled) return;
        debug?.("computed-redeem-exact-out-basket-amounts", {
          buyToken: outputAsset, targetOut: String(buyAmountFromInputBigInt), quotedBasketAmounts: ordered.map(String),
        });
        setBasketAmounts(ordered);
        setStatus("success");
        setProgress({ completed: targets.length, total: targets.length, percent: 100 });
      } catch (failure) {
        if (cancelled) return;
        publishEstimatedAmounts(undefined);
        setBasketAmounts(undefined);
        setStatus("failed");
        setError(failure instanceof Error ? failure.message : "Failed to compute redeem exact-out basket amounts");
      }
    }
    void quoteBasketAmounts();
    return () => { cancelled = true; controller.abort(); };
  }, [quoteScope, enabled, buyTokenAddress, tokenBudgetsExactOut, buyAmountFromInputBigInt, basketComponents, debug, publishEstimatedAmounts]);
  return { basketAmounts, estimatedBasketAmounts, status, error, progress };
}

export const useQuoteBasketAmountsForRedeemMinOut = useQuoteBasketAmountsUniswapExactOut;
