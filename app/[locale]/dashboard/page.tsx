"use client";
import { publicEnv } from "../../config/publicEnvironment.ts";
import { useProtocolConfiguration } from "../../context/protocolConfigurationContext";

import { useEffect, useMemo, useSyncExternalStore, useState } from "react";
import { CoreProtocolTab } from "./_core/CoreProtocolTab";
import { dashboardExpandedAssetKey, dashboardSummaryDisplayKey, parseDashboardDisplaySummary, type DashboardOnchainSummary } from "./_core/dashboardDisplayState";
import { usePublicDisplayCache } from "../../hooks/usePublicDisplayCache";
import { goldDisplayCacheKey, writePublicDisplayCache } from "../../utils/publicDisplayCache";
import { parseGoldMarketDataPayload } from "../../utils/marketDataValidation";
import { RetainedPageDisplay } from "../../components/retainedPageDisplay";
import { LuRefreshCw } from "react-icons/lu";
import { useLocale, useTranslations } from "next-intl";
import { zeroAddress } from "viem";
import { useCurrency } from "../../context/currencyContext";
import { formatNumberWithCustomGrouping } from "../../utils/formatting";
import { dashboardGoldReference } from "../../utils/dashboardGoldReference";
import { useGoldPrice } from "../../hooks/useGoldPrice";
import { MarketDataFreshnessNotice } from "../../components/marketDataFreshnessNotice";

const DASHBOARD_TAB_IDS = ["core-protocol", "staking-pool", "governance"] as const;
type DashboardTabId = (typeof DASHBOARD_TAB_IDS)[number];
type TokenSymbol = "CYGLD" | "XAUt" | "PAXG";
type PegRange = "24H" | "7D" | "1M";
const GRAMS_PER_TROY_OUNCE = 31.1034768;
const FALLBACK_PROTOCOL_ADDRESS = zeroAddress;



function resolveHashTab(hash: string): DashboardTabId {
    const cleaned = hash.replace("#", "");
    if ((DASHBOARD_TAB_IDS as readonly string[]).includes(cleaned)) {
        return cleaned as DashboardTabId;
    }
    return "core-protocol";
}

function shortenAddress(address: string) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return "N/A";
    }
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortenTxHash(hash: string) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
        return "N/A";
    }
    return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

const RANGE_IDS: PegRange[] = ["24H", "7D", "1M"];
const BASKET_COMPARISON_COLORS: Record<string, string> = {
    XAUt: "hsl(46, 71%, 56%)",
    PAXG: "hsl(40, 2%, 70%)",
};

function basketColorFor(symbol: string, index: number) {
    const predefined = BASKET_COMPARISON_COLORS[symbol];
    if (predefined) return predefined;
    return `hsl(${(index * 67 + 24) % 360} 65% 56%)`;
}

function isPegRange(value: string | null): value is PegRange {
    return value === "24H" || value === "7D" || value === "1M";
}

const rangeMemory = new Map<string, PegRange>();
let expandedAssetMemory: string | null = null;
let hasExpandedAssetMemory = false;

function usePersistentRange(storageKey: string, fallback: PegRange) {
    const value = useSyncExternalStore(
        (onStoreChange) => {
            if (typeof window === "undefined") return () => {};

            const handleStorage = (event: Event) => {
                if (event instanceof StorageEvent) {
                    if (event.key && event.key !== storageKey) return;
                    onStoreChange();
                    return;
                }

                const customEvent = event as CustomEvent<{ key?: string }>;
                if (customEvent.detail?.key === storageKey) {
                    onStoreChange();
                }
            };

            window.addEventListener("storage", handleStorage);
            window.addEventListener("cybergold:range-storage", handleStorage as EventListener);

            return () => {
                window.removeEventListener("storage", handleStorage);
                window.removeEventListener("cybergold:range-storage", handleStorage as EventListener);
            };
        },
        () => {
            if (typeof window === "undefined") return fallback;
            if (rangeMemory.has(storageKey)) return rangeMemory.get(storageKey)!;
            try {
                const stored = window.localStorage.getItem(storageKey);
                return isPegRange(stored) ? stored : fallback;
            } catch { return rangeMemory.get(storageKey) ?? fallback; }
        },
        () => fallback
    );

    const setValue = (next: PegRange) => {
        if (typeof window === "undefined") return;
        rangeMemory.set(storageKey, next);
        try { window.localStorage.setItem(storageKey, next); } catch { /* Keep ordinary range selection usable. */ }
        window.dispatchEvent(new CustomEvent("cybergold:range-storage", { detail: { key: storageKey } }));
    };

    return [value, setValue] as const;
}

function usePersistentExpandedAsset() {
    const value = useSyncExternalStore(
        listener => {
            window.addEventListener("cybergold:dashboard-expanded-asset", listener);
            return () => window.removeEventListener("cybergold:dashboard-expanded-asset", listener);
        },
        () => {
            if (hasExpandedAssetMemory) return expandedAssetMemory;
            try { return window.sessionStorage.getItem(dashboardExpandedAssetKey); } catch { return expandedAssetMemory; }
        },
        () => null,
    );
    return [value, (next: string | null) => {
        expandedAssetMemory = next;
        hasExpandedAssetMemory = true;
        try {
            if (next === null) window.sessionStorage.removeItem(dashboardExpandedAssetKey);
            else window.sessionStorage.setItem(dashboardExpandedAssetKey, next);
        } catch { /* Optional display preferences do not affect data retrieval. */ }
        window.dispatchEvent(new Event("cybergold:dashboard-expanded-asset"));
    }] as const;
}

function buildRangeDates(range: PegRange, endAtHour: Date): Date[] {
    const intervals = range === "24H" ? 24 : range === "7D" ? 28 : 30;
    const stepHours = range === "24H" ? 1 : range === "7D" ? 6 : 24;

    return Array.from({ length: intervals + 1 }, (_, index) => {
        const offset = (intervals - index) * stepHours;
        return new Date(endAtHour.getTime() - offset * 60 * 60 * 1000);
    });
}

function formatRangeLabel(date: Date, range: PegRange, locale: string) {
    if (range === "24H") {
        return new Intl.DateTimeFormat(locale, {
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(date);
    }

    if (range === "7D") {
        return new Intl.DateTimeFormat(locale, {
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(date);
    }

    return new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "2-digit",
    }).format(date);
}

function formatRangeAxisLabel(date: Date, range: PegRange, locale: string) {
    if (range === "7D" || range === "1M") {
        return new Intl.DateTimeFormat(locale, {
            month: "short",
            day: "2-digit",
        }).format(date);
    }

    return formatRangeLabel(date, range, locale);
}

function buildRangeAxisLabels(range: PegRange, locale: string, endAtHour: Date): string[] {
    return buildRangeDates(range, endAtHour).map((date) => formatRangeAxisLabel(date, range, locale));
}

export default function Dashboard() {
    const { addresses } = useProtocolConfiguration();
    const t = useTranslations("Dashboard");
    const locale = useLocale();
    const {
        formatFiat,
        formatGoldAmount,
        selectedCurrency,
        fxFetchedAt,
        isFxStale,
    } = useCurrency();
    const {
        ouncePrice: liveGoldSpotUsdPerOzt,
        fetchedAt: goldPriceFetchedAt,
        isStale: isGoldPriceStale,
    } = useGoldPrice();
    const activeTab = useSyncExternalStore(
        listener => {
            window.addEventListener("hashchange", listener);
            window.addEventListener("cybergold:dashboard-tab", listener);
            return () => {
                window.removeEventListener("hashchange", listener);
                window.removeEventListener("cybergold:dashboard-tab", listener);
            };
        },
        () => resolveHashTab(window.location.hash),
        () => "core-protocol" as DashboardTabId,
    );
    const [activityRange, setActivityRange] = usePersistentRange("dashboard-range-activity", "7D");
    const [issueRange, setIssueRange] = usePersistentRange("dashboard-range-issue", "7D");
    const [expandedBasketAssetAddress, setExpandedBasketAssetAddress] = usePersistentExpandedAsset();
    const cachedSummary = usePublicDisplayCache(dashboardSummaryDisplayKey(publicEnv.NEXT_PUBLIC_CHAIN_ID), parseDashboardDisplaySummary);
    const [liveSummary, setOnchainSummary] = useState<DashboardOnchainSummary | null>(null);
    const onchainSummary = liveSummary ?? cachedSummary ?? null;
    const [onchainSummaryError, setOnchainSummaryError] = useState<string | null>(null);
    const [summaryRefreshCount, setSummaryRefreshCount] = useState(0);
    const [isRefreshingSummary, setIsRefreshingSummary] = useState(false);
    const refreshOnchainSummary = () => setSummaryRefreshCount((count) => count + 1);
    // A completed observation remains a displayed approximation during refresh;
    // configured fallback data never becomes an observed dashboard price.
    const cachedGold = usePublicDisplayCache(goldDisplayCacheKey, parseGoldMarketDataPayload);
    const goldQuoteForReference = isGoldPriceStale || (selectedCurrency !== "USD" && isFxStale)
        ? cachedGold?.price : liveGoldSpotUsdPerOzt;
    const cygldReference = dashboardGoldReference(
        onchainSummary?.enabled ? onchainSummary.basket?.cygldRefGrams : null,
        goldQuoteForReference
    );
    const handleTabChange = (tabId: DashboardTabId) => {
        if (typeof window !== "undefined") {
            const nextHash = `#${tabId}`;
            if (window.location.hash !== nextHash) {
                window.history.pushState(null, "", nextHash);
                window.dispatchEvent(new Event("cybergold:dashboard-tab"));
            }
        }
    };

    const chartEndTime = useMemo(() => {
        const end = new Date();
        end.setMinutes(0, 0, 0);
        return end;
    }, []);
    const axisLabelsByRange = useMemo<Record<PegRange, string[]>>(
        () => ({
            "24H": buildRangeAxisLabels("24H", locale, chartEndTime),
            "7D": buildRangeAxisLabels("7D", locale, chartEndTime),
            "1M": buildRangeAxisLabels("1M", locale, chartEndTime),
        }),
        [chartEndTime, locale]
    );

    const onchainFlowSeriesByRange = useMemo<Record<PegRange, Array<{ label: string; mint: number; redeem: number; supply: number }>>>(
        () => {
            const empty: Record<PegRange, Array<{ label: string; mint: number; redeem: number; supply: number }>> = {
                "24H": [],
                "7D": [],
                "1M": [],
            };
        const series = onchainSummary?.series;
            if (!series) return empty;

            const mapped = { ...empty };
        for (const range of RANGE_IDS) {
            const rangeBuckets = series[range];
            if (!rangeBuckets || rangeBuckets.length === 0) continue;

            mapped[range] = rangeBuckets.map((bucket) => ({
                label: formatRangeLabel(new Date(bucket.bucketStartMs), range, locale),
                mint: bucket.mintCygld,
                redeem: bucket.redeemCygld,
                supply: bucket.supplyCygld,
            }));
        }
        return mapped;
        },
        [locale, onchainSummary]
    );

    const onchainTransferSeriesByRange = useMemo<Record<PegRange, Array<{ label: string; cygld: number; tx: number }>>>(
        () => {
            const empty: Record<PegRange, Array<{ label: string; cygld: number; tx: number }>> = {
                "24H": [],
                "7D": [],
                "1M": [],
            };
            const series = onchainSummary?.series;
            if (!series) return empty;

            const mapped = { ...empty };
            for (const range of RANGE_IDS) {
                const rangeBuckets = series[range];
                if (!rangeBuckets || rangeBuckets.length === 0) continue;

                mapped[range] = rangeBuckets.map((bucket) => ({
                    label: formatRangeLabel(new Date(bucket.bucketStartMs), range, locale),
                    cygld: bucket.transferredCygld,
                    tx: bucket.transferTxCount,
                }));
            }
            return mapped;
        },
        [locale, onchainSummary]
    );

    const flowSeriesByRange = onchainFlowSeriesByRange;
    const transferSeriesByRange = onchainTransferSeriesByRange;

    const activeFlowSeries = flowSeriesByRange[issueRange];
    const hasFlowData = activeFlowSeries.length > 0;
    const totalMintVolume = activeFlowSeries.reduce((sum, entry) => sum + entry.mint, 0);
    const totalRedeemVolume = activeFlowSeries.reduce((sum, entry) => sum + entry.redeem, 0);
    const totalNetFlow = totalMintVolume - totalRedeemVolume;
    const currentTotalSupply =
        onchainSummary?.metrics?.currentTotalSupplyCygld ??
        flowSeriesByRange["24H"][flowSeriesByRange["24H"].length - 1]?.supply ??
        null;
    const holderCount = onchainSummary?.metrics?.holderCount ?? null;
    const basketAssets = useMemo(() => onchainSummary?.basket?.assets ?? [], [onchainSummary]);
    const hasBasketData = basketAssets.length > 0;
    const activeExpandedBasketAssetAddress =
        expandedBasketAssetAddress && basketAssets.some((asset) => asset.address === expandedBasketAssetAddress)
            ? expandedBasketAssetAddress
            : null;
    const basketComparisonSeries = useMemo(
        () =>
            basketAssets.map((asset, index) => ({
                symbol: asset.symbol,
                targetPercent: asset.targetPercent,
                actualPercent: asset.actualPercent,
                color: basketColorFor(asset.symbol, index),
            })),
        [basketAssets]
    );
    const activeFlowAxisLabels = axisLabelsByRange[issueRange];

    const activeTransferSeries = transferSeriesByRange[activityRange];
    const activeTransferAxisLabels = axisLabelsByRange[activityRange];
    const hasTransferData = activeTransferSeries.length > 0;
    const totalTransferredCygld = activeTransferSeries.reduce((sum, entry) => sum + entry.cygld, 0);
    const totalTransfers = activeTransferSeries.reduce((sum, entry) => sum + entry.tx, 0);

    const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
        formatNumberWithCustomGrouping(value, locale, {
            minimumFractionDigits: options?.minimumFractionDigits,
            maximumFractionDigits: options?.maximumFractionDigits,
        });

    const formatPercent = (valuePercent: number, fractionDigits = 2, signed = false) => {
        const formattedValue = new Intl.NumberFormat(locale, {
            style: "percent",
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        }).format(Math.abs(valuePercent) / 100);

        if (!signed) {
            return formattedValue;
        }

        return `${valuePercent >= 0 ? "+" : "-"}${formattedValue}`;
    };

    const formatRawToken = (amount: number, symbol: TokenSymbol, maxFractionDigits = 2) =>
        `${formatNumber(amount, { maximumFractionDigits: maxFractionDigits })} ${symbol}`;

    const formatAssetAmount = (amount: number | null, symbol: string, maxFractionDigits = 4) => {
        if (amount === null) return "N/A";
        return `${formatNumber(amount, { maximumFractionDigits: maxFractionDigits })} ${symbol}`;
    };

    const formatTokenEquivalent = (amount: number, symbol: TokenSymbol) => {
        const reference = symbol === "CYGLD" ? cygldReference : dashboardGoldReference(
            basketAssets.find((asset) => asset.symbol === symbol)?.goldRefGrams,
            goldQuoteForReference
        );
        if (reference.grams === null) return "";
        const gold = formatGoldAmount(amount * reference.grams / GRAMS_PER_TROY_OUNCE);
        if (reference.usd === null) return gold;
        const usdValue = amount * reference.usd;
        return `${gold} • ${formatFiat(usdValue, { compact: Math.abs(usdValue) >= 1_000_000 })}`;
    };

    const formatSignedTokenEquivalent = (amount: number, symbol: TokenSymbol) => {
        const sign = amount >= 0 ? "+" : "-";
        const equivalent = formatTokenEquivalent(Math.abs(amount), symbol);
        return equivalent ? `${sign}${equivalent}` : "";
    };

    const configuredProtocolAddress = addresses.core ?? FALLBACK_PROTOCOL_ADDRESS;
    const isValidProtocolAddress = /^0x[a-fA-F0-9]{40}$/.test(configuredProtocolAddress);
    const protocolAddress = isValidProtocolAddress ? configuredProtocolAddress : FALLBACK_PROTOCOL_ADDRESS;
    const explorerBaseUrl = (publicEnv.NEXT_PUBLIC_BLOCK_EXPLORER_URL ?? "https://etherscan.io").replace(/\/$/, "");
    const protocolExplorerUrl = `${explorerBaseUrl}/address/${protocolAddress}`;
    const formatUtcTimestamp = (timestampMs: number) =>
        `${new Intl.DateTimeFormat(locale, {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: "UTC",
        }).format(new Date(timestampMs))} UTC`;
    const protocolLogicUpdate = onchainSummary?.protocolLogicUpdate ?? null;
    const protocolParameterUpdate = onchainSummary?.protocolParameterUpdate ?? null;
    const protocolUpdateTimestamp = protocolLogicUpdate ? formatUtcTimestamp(protocolLogicUpdate.timestampMs) : "N/A";
    const parameterUpdateTimestamp = protocolParameterUpdate ? formatUtcTimestamp(protocolParameterUpdate.timestampMs) : "N/A";
    const protocolUpdateTxUrl = protocolLogicUpdate?.txHash ? `${explorerBaseUrl}/tx/${protocolLogicUpdate.txHash}` : "";
    const parameterUpdateTxUrl = protocolParameterUpdate?.txHash ? `${explorerBaseUrl}/tx/${protocolParameterUpdate.txHash}` : "";
    const mintingFeePercent = onchainSummary?.metrics?.issuanceFeePercent ?? null;
    const redemptionFeePercent = onchainSummary?.metrics?.redemptionFeePercent ?? null;
    const protocolIsActive = onchainSummary?.metrics?.paused === null ? null : onchainSummary?.metrics?.paused === undefined ? null : !onchainSummary.metrics.paused;
    const protocolStatusClass =
        protocolIsActive === null
            ? "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
            : protocolIsActive
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
              : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200";

    useEffect(() => {
        let cancelled = false;
        let intervalId: number | null = null;

        const loadOnchainSummary = async () => {
            setIsRefreshingSummary(true);
            try {
                const response = await fetch("/api/dashboard/onchain-summary", { cache: "no-store" });
                const payload = (await response.json()) as DashboardOnchainSummary & { error?: string };
                if (!response.ok) {
                    console.warn("[dashboard] on-chain summary API warning", {
                        status: response.status,
                        payload,
                    });
                    if (!cancelled) {
                        setOnchainSummaryError(payload.error ?? `On-chain summary API failed with status ${response.status}`);
                    }
                    return;
                }
                if (payload.enabled) {
                    const missing: string[] = [];
                    if (payload.metrics?.currentTotalSupplyCygld === null || payload.metrics?.currentTotalSupplyCygld === undefined) {
                        missing.push("metrics.currentTotalSupplyCygld");
                    }
                    if (payload.metrics?.netIssuance24hCygld === null || payload.metrics?.netIssuance24hCygld === undefined) {
                        missing.push("metrics.netIssuance24hCygld");
                    }
                    if (payload.metrics?.issuanceFeePercent === null || payload.metrics?.issuanceFeePercent === undefined) {
                        missing.push("metrics.issuanceFeePercent");
                    }
                    if (payload.metrics?.redemptionFeePercent === null || payload.metrics?.redemptionFeePercent === undefined) {
                        missing.push("metrics.redemptionFeePercent");
                    }
                    if (payload.metrics?.paused === null || payload.metrics?.paused === undefined) {
                        missing.push("metrics.paused");
                    }
                    if (!payload.basket?.assets) {
                        missing.push("basket.assets");
                    }
                    for (const range of RANGE_IDS) {
                        if (!payload.series?.[range]) {
                            missing.push(`series.${range}`);
                        }
                    }
                    if (missing.length > 0) {
                        console.warn("[dashboard] Missing on-chain fields:", missing);
                    }
                } else {
                    console.warn("[dashboard] On-chain summary disabled");
                }

                if (!cancelled) {
                    if (payload.enabled) {
                        writePublicDisplayCache(dashboardSummaryDisplayKey(publicEnv.NEXT_PUBLIC_CHAIN_ID), payload);
                        setOnchainSummary(previous => JSON.stringify(previous) === JSON.stringify(payload) ? previous : payload);
                    }
                    setOnchainSummaryError(payload.enabled ? null : t("onchainDataDisabled"));
                }
            } catch (error) {
                console.error("[dashboard] Failed to load on-chain summary", error);
                if (!cancelled) {
                    setOnchainSummaryError(error instanceof Error ? error.message : t("onchainDataUnavailableDescription"));
                }
            } finally {
                if (!cancelled) setIsRefreshingSummary(false);
            }
        };

        void loadOnchainSummary();
        intervalId = window.setInterval(() => {
            void loadOnchainSummary();
        }, 30_000);

        return () => {
            cancelled = true;
            if (intervalId !== null) {
                window.clearInterval(intervalId);
            }
        };
    }, [t, summaryRefreshCount]);



    return (
        <RetainedPageDisplay page="dashboard" ready={onchainSummary !== null || onchainSummaryError !== null}>
        <div className="flex flex-1 flex-col items-center font-sans">
            <div className="flex min-w-0 flex-col w-full max-w-7xl mx-auto px-3 py-4 sm:px-6 lg:px-8">
                {/* HEADER SECTION */}
                <section className="flex w-full min-w-0 flex-wrap justify-between gap-3 pt-2 sm:pt-4 mt-2 sm:mt-4 items-center text-[var(--text-input)]">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-semibold">{t("title")}</h1>
                        <p className="mt-1 text-sm">{t("subtitle")}</p>
                    </div>
                    <button type="button" onClick={refreshOnchainSummary} aria-label={t("refreshData")} aria-busy={isRefreshingSummary} className="md:hidden p-3 rounded-xl bg-gold-cg/10 w-fit items-center text-xs text-gold-cg hover:scale-102 transition-all mr-2">
                        <LuRefreshCw />
                    </button>
                    <button type="button" onClick={refreshOnchainSummary} aria-busy={isRefreshingSummary} className="hidden md:flex px-4 py-2 rounded-full bg-gold-cg text-black text-sm font-semibold flex items-center space-x-2 hover:scale-102 shadow-lg shadow-accent/20 transition-all">
                        <LuRefreshCw className="inline-block mr-2" />
                        {t("refreshData")}
                    </button>
                </section>

                {onchainSummary?.chainHeadTimestampMs != null ? (
                    <p className="mt-3 text-xs text-[var(--text-muted)]" data-testid="dashboard-snapshot-time">
                        {t("dataThrough", { timestamp: formatUtcTimestamp(onchainSummary.chainHeadTimestampMs) })}
                        {publicEnv.NEXT_PUBLIC_CHAIN_ID === "1" ? ` · ${t("mainnetFinalityNotice")}` : ""}
                    </p>
                ) : null}

                <MarketDataFreshnessNotice
                    className="mt-4"
                    locale={locale}
                    gold={{
                        fetchedAt: goldPriceFetchedAt,
                        isStale: isGoldPriceStale,
                    }}
                    fx={
                        selectedCurrency === "USD"
                            ? undefined
                            : {
                                fetchedAt: fxFetchedAt,
                                isStale: isFxStale,
                            }
                    }
                />

                {onchainSummaryError ? (
                    <section className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                        <p className="font-semibold">{t("onchainDataUnavailableTitle")}</p>
                        <p className="mt-1 break-words">{onchainSummaryError}</p>
                    </section>
                ) : null}

                {/* TABS SELECTOR */}
                <section className="w-full mt-4">
                    <nav
                        role="tablist"
                        aria-label={t("title")}
                        className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto rounded-full border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] p-1"
                    >
                        {DASHBOARD_TAB_IDS.map((tabId) => {
                            const isActive = tabId === activeTab;
                            const labelKey =
                                tabId === "core-protocol"
                                    ? "coreProtocolTab"
                                    : tabId === "staking-pool"
                                      ? "stakingPoolTab"
                                      : "governanceTab";

                            return (
                                <button
                                    key={tabId}
                                    id={`dashboard-tab-${tabId}`}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    aria-controls={`dashboard-panel-${tabId}`}
                                    onClick={() => handleTabChange(tabId)}
                                    className={`shrink-0 whitespace-nowrap rounded-full px-3 sm:px-4 py-2 text-sm font-semibold transition-all ${
                                        isActive
                                            ? "bg-gold-cg text-black shadow-md"
                                            : "text-[var(--text-muted)] hover:text-[var(--text-input)] hover:bg-black/5 dark:hover:bg-white/10"
                                    }`}
                                >
                                    {t(labelKey)}
                                </button>
                            );
                        })}
                    </nav>
                </section>

                {/* CORE PROTOCOL */}
                {activeTab === "core-protocol" ? (
                    <CoreProtocolTab
                        t={t}
                        locale={locale}
                        gramsPerTroyOunce={GRAMS_PER_TROY_OUNCE}
                        cygldReference={cygldReference}
                        currentTotalSupply={currentTotalSupply}
                        holderCount={holderCount}
                        activityRange={activityRange}
                        setActivityRange={setActivityRange}
                        issueRange={issueRange}
                        setIssueRange={setIssueRange}
                        hasTransferData={hasTransferData}
                        totalTransferredCygld={totalTransferredCygld}
                        totalTransfers={totalTransfers}
                        activeTransferSeries={activeTransferSeries}
                        activeTransferAxisLabels={activeTransferAxisLabels}
                        hasBasketData={hasBasketData}
                        basketAssets={basketAssets}
                        basketComparisonSeries={basketComparisonSeries}
                        expandedBasketAssetAddress={activeExpandedBasketAssetAddress}
                        setExpandedBasketAssetAddress={setExpandedBasketAssetAddress}
                        explorerBaseUrl={explorerBaseUrl}
                        hasFlowData={hasFlowData}
                        totalNetFlow={totalNetFlow}
                        activeFlowSeries={activeFlowSeries}
                        activeFlowAxisLabels={activeFlowAxisLabels}
                        protocolStatusClass={protocolStatusClass}
                        protocolIsActive={protocolIsActive}
                        isValidProtocolAddress={isValidProtocolAddress}
                        protocolAddress={protocolAddress}
                        protocolExplorerUrl={protocolExplorerUrl}
                        issuanceFeePercent={mintingFeePercent}
                        redemptionFeePercent={redemptionFeePercent}
                        protocolUpdateTimestamp={protocolUpdateTimestamp}
                        parameterUpdateTimestamp={parameterUpdateTimestamp}
                        protocolLogicUpdate={protocolLogicUpdate}
                        protocolParameterUpdate={protocolParameterUpdate}
                        recovery={onchainSummary?.recovery ?? null}
                        protocolUpdateTxUrl={protocolUpdateTxUrl}
                        parameterUpdateTxUrl={parameterUpdateTxUrl}
                        formatFiat={formatFiat}
                        formatGoldAmount={formatGoldAmount}
                        formatNumber={formatNumber}
                        formatPercent={formatPercent}
                        formatRawToken={formatRawToken}
                        formatAssetAmount={formatAssetAmount}
                        formatTokenEquivalent={formatTokenEquivalent}
                        formatSignedTokenEquivalent={formatSignedTokenEquivalent}
                        shortenAddress={shortenAddress}
                        shortenTxHash={shortenTxHash}
                    />
                ) : null}

                {/* STAKING POOL */}
                {activeTab === "staking-pool" ? (
                <section
                    id="dashboard-panel-staking-pool"
                    role="tabpanel"
                    aria-labelledby="dashboard-tab-staking-pool"
                    className="flex flex-col gap-4 w-full mt-4 text-[var(--text-muted)]"
                >
                    <div>
                        <h2 className="text-xl font-semibold text-[var(--text-input)]">{t("stakingPoolTab")}</h2>
                        <p className="text-sm mt-1">{t("stakingPoolSubtitle")}</p>
                    </div>
                    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
                        <p className="font-semibold">{t("stakingDataUnavailableTitle")}</p>
                        <p className="mt-1 text-sm">{t("stakingDataUnavailableDescription")}</p>
                    </div>
                </section>
                ) : null}

                {/* GOVERNANCE */}
                {activeTab === "governance" ? (
                <section
                    id="dashboard-panel-governance"
                    role="tabpanel"
                    aria-labelledby="dashboard-tab-governance"
                    className="flex flex-col gap-4 w-full mt-4 pb-8 text-[var(--text-muted)]"
                >
                    <div>
                        <h2 className="text-xl font-semibold text-[var(--text-input)]">{t("governanceTab")}</h2>
                        <p className="text-sm mt-1">{t("governanceSubtitle")}</p>
                    </div>
                    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
                        <p className="font-semibold">{t("governanceDataUnavailableTitle")}</p>
                        <p className="mt-1 text-sm">{t("governanceDataUnavailableDescription")}</p>
                    </div>
                </section>
                ) : null}
            </div>
        </div>
        </RetainedPageDisplay>
    );
}
