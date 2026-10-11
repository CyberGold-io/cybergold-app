"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { IoChevronDownOutline, IoLayersOutline, IoOpenOutline, IoRefreshOutline } from "react-icons/io5";
import { targetChainId } from "../config/chain.ts";
import { LIQUIDITY_POOL } from "../config/liquidityPool.ts";
import { useCurrency } from "../context/currencyContext";
import { formatNumberWithCustomGrouping } from "../utils/formatting";
import { formatDisplayValueFromUsd } from "../utils/priceDisplay";
import type { LiquidityPositionsSnapshot } from "../utils/liquidityPositions";
import { WalletActionSlot } from "./walletActionSlot";

type LiquidityProviderPanelProps = {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  liquidity: {
    data?: LiquidityPositionsSnapshot;
    isLoading: boolean;
    error: unknown;
    isRefreshing: boolean;
    refetch: () => unknown;
  };
  paxgPriceUsd?: number;
  cygldPriceUsd?: number;
  goldSpotUsdPerOzt?: number;
  isPricesLoading?: boolean;
  formatValue: (amountUsd?: number) => string | undefined;
};

function tokenValue(amount: number, price?: number) {
  if (amount === 0) return 0;
  return price !== undefined ? amount * price : undefined;
}

export function LiquidityProviderPanel({
  expanded,
  onExpandedChange,
  liquidity,
  paxgPriceUsd,
  cygldPriceUsd,
  goldSpotUsdPerOzt,
  isPricesLoading = false,
  formatValue,
}: LiquidityProviderPanelProps) {
  const t = useTranslations("LiquidityProvider");
  const locale = useLocale();
  const { formatFiat, formatGoldAmount, selectedCurrency } = useCurrency();
  const contentId = useId();
  const titleId = useId();
  const { data, error, isLoading, isRefreshing } = liquidity;
  const positionCount = data?.positions.length;
  const paxgValueUsd = data ? tokenValue(Number(data.paxgAmount), paxgPriceUsd) : undefined;
  const cygldValueUsd = data ? tokenValue(Number(data.cygldAmount), cygldPriceUsd) : undefined;
  const combinedValueUsd = paxgValueUsd !== undefined && cygldValueUsd !== undefined
    ? paxgValueUsd + cygldValueUsd
    : undefined;
  const totalValueUsd = combinedValueUsd !== undefined && Number.isFinite(combinedValueUsd)
    ? combinedValueUsd
    : undefined;
  const displayTotal = (priceDisplayMode: "fiat" | "gold") => {
    if (totalValueUsd === undefined) return undefined;
    const formatted = formatDisplayValueFromUsd({
      amountUsd: totalValueUsd,
      priceDisplayMode,
      goldSpotUsdPerOzt,
      formatFiat,
      formatGoldAmount,
    });
    return formatted ? `~ ${formatted}` : undefined;
  };
  const formatTokenAmount = (amount: string) => formatNumberWithCustomGrouping(Number(amount), locale, {
    maximumFractionDigits: 6,
  });
  const isInitialLoading = !data && (isLoading || !error);
  const focusClass = "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

  return (
    <section className="mt-4 rounded-xl border border-swap-container-border bg-background-input" data-testid="liquidity-provider-panel">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => onExpandedChange(!expanded)}
          className={`flex w-full items-center justify-between gap-3 rounded-xl p-3 text-left transition hover:bg-gold-cg/5 ${focusClass}`}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex size-[22px] shrink-0 items-center justify-center text-gold-cg">
              <IoLayersOutline aria-hidden="true" className="size-[22px]" />
            </span>
            <span className="min-w-0">
              <span id={titleId} className="block text-sm font-medium text-text-input">{t("title")}</span>
              <span className="block text-xs font-medium text-text-input">
                {positionCount !== undefined ? t("positions", { count: positionCount }) : "PAXG / CYGLD"}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="whitespace-nowrap text-xs font-semibold text-black dark:text-white" data-testid="liquidity-collapsed-value">
              {isInitialLoading || (data && totalValueUsd === undefined && isPricesLoading)
                ? "..."
                : formatValue(totalValueUsd) ?? t("valueUnavailable")}
            </span>
            <WalletActionSlot>
              <IoChevronDownOutline aria-hidden="true" className={`size-4 text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
            </WalletActionSlot>
          </span>
        </button>
      </h3>

      <div id={contentId} hidden={!expanded} aria-labelledby={titleId} className="border-t border-swap-container-border p-4">
        {targetChainId !== 1 && (
          <p className="mb-3 rounded-lg border border-gold-cg/20 bg-gold-cg/5 p-3 text-xs leading-relaxed text-text-amber">
            {t("sandboxWarning")}
          </p>
        )}

        {isInitialLoading && (
          <div aria-busy="true">
            <p role="status" className="text-xs text-text-muted">{t("loading")}</p>
            <div aria-hidden="true" className="mt-3 h-24 animate-pulse rounded-xl bg-background-swap-container" />
          </div>
        )}

        {Boolean(error) && (
          <div role="status" className="mb-3 text-xs text-text-amber">
            <p>{t(data ? "stale" : "unavailable")}</p>
            <button
              type="button"
              onClick={() => void liquidity.refetch()}
              disabled={isRefreshing}
              className={`mt-2 inline-flex items-center gap-1.5 rounded-lg border border-swap-container-border px-3 py-2 font-semibold text-text-input hover:border-gold-cg disabled:opacity-60 ${focusClass}`}
            >
              <IoRefreshOutline aria-hidden="true" className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              {t(isRefreshing ? "refreshing" : "retry")}
            </button>
          </div>
        )}

        {data && (
          <div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <p className="font-medium text-text-input" data-testid="liquidity-position-count">{t("positions", { count: positionCount ?? 0 })}</p>
              {isRefreshing && !error && <p role="status" className="text-text-muted">{t("refreshing")}</p>}
            </div>
            {positionCount === 0 && <p className="mt-1 text-xs text-text-muted">{t("empty")}</p>}

            <div className="mt-3 rounded-xl border border-gold-cg/25 bg-gold-cg/5 p-3">
              <p className="text-xs text-text-muted">{t("totalValue")}</p>
              <dl className="mt-2 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <dt className="text-xs text-text-muted">{t("fiatValue", { currency: selectedCurrency })}</dt>
                  <dd className="text-base font-semibold tabular-nums text-text-input" data-testid="liquidity-fiat-value">
                    {displayTotal("fiat") ?? t("valueUnavailable")}
                  </dd>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <dt className="text-xs text-text-muted">{t("goldValue")}</dt>
                  <dd className="text-sm font-medium tabular-nums text-text-input" data-testid="liquidity-gold-value">
                    {displayTotal("gold") ?? t("valueUnavailable")}
                  </dd>
                </div>
              </dl>
            </div>

            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                <dt className="text-text-muted">PAXG</dt>
                <dd className="font-medium tabular-nums text-text-input">{formatTokenAmount(data.paxgAmount)}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                <dt className="text-text-muted">CYGLD</dt>
                <dd className="font-medium tabular-nums text-text-input">{formatTokenAmount(data.cygldAmount)}</dd>
              </div>
            </dl>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <a href={LIQUIDITY_POOL.positionsUrl} target="_blank" rel="noopener noreferrer"
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-swap-container-border px-3 py-2.5 text-center text-xs font-semibold text-text-input transition hover:border-gold-cg ${focusClass}`}>
            {t("seePositions")}
            <IoOpenOutline aria-hidden="true" className="size-3.5 shrink-0" />
          </a>
          <a href={LIQUIDITY_POOL.addLiquidityUrl} target="_blank" rel="noopener noreferrer"
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-gold-cg bg-gold-cg px-3 py-2.5 text-center text-xs font-semibold text-black transition hover:opacity-90 ${focusClass}`}>
            {t("addLiquidity")}
            <IoOpenOutline aria-hidden="true" className="size-3.5 shrink-0" />
          </a>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-text-muted">{t("walletHint")}</p>
      </div>
    </section>
  );
}
