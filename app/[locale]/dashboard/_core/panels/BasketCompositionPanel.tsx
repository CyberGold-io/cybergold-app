"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import basketTokenEnrichmentData from "../../../../data/basket-token-enrichment.json";
import { FaChevronDown, FaChevronRight } from "react-icons/fa6";

type SupportedLocale = "en" | "fr" | "de" | "ru";
type LocalizedString = Record<string, string>;

type BasketTokenEnrichmentFact = {
    id: string;
    label: LocalizedString;
    value: LocalizedString;
    sourceIds: string[];
};

type BasketTokenEnrichmentSource = {
    title: string;
    url: string;
};

type BasketTokenEnrichmentToken = {
    facts: BasketTokenEnrichmentFact[];
};

type BasketTokenEnrichmentDataset = {
    sourceCatalog: Record<string, BasketTokenEnrichmentSource>;
    tokens: Record<string, BasketTokenEnrichmentToken>;
};

type BasketAsset = {
    address: string;
    symbol: string;
    targetPercent: number;
    actualPercent: number;
    decimals: number | null;
    reserveBalance: number | null;
    totalSupply: number | null;
    goldRefGrams: number | null;
    cygldPerToken: number | null;
};

type BasketComparisonEntry = {
    symbol: string;
    targetPercent: number;
    actualPercent: number;
    color: string;
};

type BasketCompositionPanelProps = {
    t: (key: string) => string;
    locale: string;
    hasBasketData: boolean;
    basketAssets: BasketAsset[];
    basketComparisonSeries: BasketComparisonEntry[];
    expandedBasketAssetAddress: string | null;
    setExpandedBasketAssetAddress: (value: string | null) => void;
    explorerBaseUrl: string;
    gramsPerTroyOunce: number;
    shortenAddress: (address: string) => string;
    formatPercent: (valuePercent: number, fractionDigits?: number, signed?: boolean) => string;
    formatAssetAmount: (amount: number | null, symbol: string, maxFractionDigits?: number) => string;
    formatGoldAmount: (amountOzt: number) => string;
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const TargetOverlayDonutEcharts = dynamic(
    () => import("../../../../components/targetOverlayDonutEcharts").then((module) => module.TargetOverlayDonutEcharts),
    { ssr: false }
);

const COMPACT_ENRICHMENT_FACT_ORDER = [
    "issuer",
    "jurisdiction",
    "custody_location",
    "allocation_model",
    "redeemability",
    "backing_ratio",
    "attestation_cadence",
    "transparency_updates",
] as const;

const COMPACT_ENRICHMENT_FACT_LIMIT = 4;

const ENRICHMENT_PANEL_LABELS: Record<SupportedLocale, { profile: string; sources: string }> = {
    en: { profile: "Token profile", sources: "Sources" },
    fr: { profile: "Profil token", sources: "Sources" },
    de: { profile: "Tokenprofil", sources: "Quellen" },
    ru: { profile: "Профиль токена", sources: "Источники" },
};

function resolveDashboardLocale(locale: string): SupportedLocale {
    if (locale === "fr") return "fr";
    if (locale === "de") return "de";
    if (locale === "ru") return "ru";
    return "en";
}

function getLocalizedString(strings: LocalizedString, locale: SupportedLocale) {
    return strings[locale] ?? strings.en ?? Object.values(strings)[0] ?? "";
}

function normalizeAddress(address: string) {
    return address.toLowerCase();
}

function tokenLogoSrc(symbol: string) {
    return `/tokens/${symbol.toLowerCase()}.png`;
}

function truncateForCard(text: string, maxLength = 88) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function getCompactEnrichmentFacts(facts: BasketTokenEnrichmentFact[]) {
    const selected: BasketTokenEnrichmentFact[] = [];
    for (const factId of COMPACT_ENRICHMENT_FACT_ORDER) {
        const found = facts.find((fact) => fact.id === factId);
        if (!found) continue;
        selected.push(found);
        if (selected.length >= COMPACT_ENRICHMENT_FACT_LIMIT) break;
    }
    return selected;
}

const enrichmentDataset = basketTokenEnrichmentData as BasketTokenEnrichmentDataset;

export function BasketCompositionPanel({
    t,
    locale,
    hasBasketData,
    basketAssets,
    basketComparisonSeries,
    expandedBasketAssetAddress,
    setExpandedBasketAssetAddress,
    explorerBaseUrl,
    gramsPerTroyOunce,
    shortenAddress,
    formatPercent,
    formatAssetAmount,
    formatGoldAmount,
    formatNumber,
}: BasketCompositionPanelProps) {
    const dashboardLocale = resolveDashboardLocale(locale);

    return (
        <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4">
            <div className="flex items-center">
                <h3 className="text-base font-semibold text-[var(--text-input)]">{t("basketCompositionSnapshot")}</h3>
            </div>
            <p className="text-xs mt-1">{t("targetVsActual")}</p>
            {hasBasketData ? (
                <div className="mt-3 h-[300px]">
                    <TargetOverlayDonutEcharts
                        data={basketComparisonSeries.map((entry) => ({
                            id: entry.symbol,
                            label: entry.symbol,
                            color: entry.color,
                            actualValue: entry.actualPercent,
                            targetValue: entry.targetPercent,
                        }))}
                        actualLabel={t("actualBasket")}
                        targetLabel={t("targetBasket")}
                    />
                </div>
            ) : null}
            <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">{t("weight")}</span>
                    <span className="w-16 text-right font-semibold">{t("target")}</span>
                    <span className="w-16 text-right font-semibold">{t("actual")}</span>
                </div>
                {hasBasketData ? (
                    basketAssets.map((asset) => {
                        const isExpanded = expandedBasketAssetAddress === asset.address;
                        const assetExplorerUrl = `${explorerBaseUrl}/address/${asset.address}`;
                        const enrichmentToken = enrichmentDataset.tokens[normalizeAddress(asset.address)] ?? null;
                        const compactFacts = enrichmentToken ? getCompactEnrichmentFacts(enrichmentToken.facts) : [];
                        const compactSourceIds = Array.from(new Set(compactFacts.flatMap((fact) => fact.sourceIds)));
                        const compactSources = compactSourceIds
                            .map((sourceId) => ({ sourceId, source: enrichmentDataset.sourceCatalog[sourceId] }))
                            .filter((entry): entry is { sourceId: string; source: BasketTokenEnrichmentSource } =>
                                Boolean(entry.source)
                            );

                        return (
                            <div key={asset.address} className="text-xs">
                                <button
                                    type="button"
                                    onClick={() => setExpandedBasketAssetAddress(isExpanded ? null : asset.address)}
                                    className="w-full flex items-center justify-between"
                                >
                                    <span className="inline-flex items-center gap-1">
                                        {isExpanded ? (
                                            <FaChevronDown className="text-[10px]" />
                                        ) : (
                                            <FaChevronRight className="text-[10px]" />
                                        )}
                                        <Image
                                            src={tokenLogoSrc(asset.symbol)}
                                            alt={asset.symbol}
                                            width={14}
                                            height={14}
                                            className="rounded-full"
                                        />
                                        {asset.symbol}
                                    </span>
                                    <span className="w-16 text-right">{formatPercent(asset.targetPercent, 0)}</span>
                                    <span className="w-16 text-right">{formatPercent(asset.actualPercent, 1)}</span>
                                </button>
                                {isExpanded ? (
                                    <div className="mt-2 rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] p-2 text-[10px] space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>{t("tokenAddress")}</span>
                                            <a
                                                href={assetExplorerUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-gold-cg hover:underline"
                                            >
                                                {shortenAddress(asset.address)}
                                            </a>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>{t("assetDecimals")}</span>
                                            <span>{asset.decimals ?? "N/A"}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>{t("reserveBalance")}</span>
                                            <span>{formatAssetAmount(asset.reserveBalance, asset.symbol, 4)}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>{t("tokenTotalSupply")}</span>
                                            <span>{formatAssetAmount(asset.totalSupply, asset.symbol, 2)}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>{t("pegReference")}</span>
                                            <span>
                                                {asset.goldRefGrams === null ? "N/A" : formatGoldAmount(asset.goldRefGrams / gramsPerTroyOunce)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <span>{t("conversionPerToken")}</span>
                                            <span>
                                                {asset.cygldPerToken === null
                                                    ? "N/A"
                                                    : `1 ${asset.symbol} ≈ ${formatNumber(asset.cygldPerToken, {
                                                          maximumFractionDigits: 6,
                                                      })} CYGLD`}
                                            </span>
                                        </div>
                                        {compactFacts.length > 0 ? (
                                            <div className="mt-2 border-t border-[var(--swap-container-border)] pt-2 space-y-1">
                                                <p className="text-[10px] font-semibold text-[var(--text-input)]">
                                                    {ENRICHMENT_PANEL_LABELS[dashboardLocale].profile}
                                                </p>
                                                {compactFacts.map((fact) => (
                                                    <div
                                                        key={`${asset.address}-${fact.id}`}
                                                        className="flex items-start justify-between gap-2"
                                                    >
                                                        <span className="text-[var(--text-muted)]">
                                                            {getLocalizedString(fact.label, dashboardLocale)}
                                                        </span>
                                                        <span
                                                            className="max-w-[66%] text-right text-[var(--text-input)] leading-tight"
                                                            title={getLocalizedString(fact.value, dashboardLocale)}
                                                        >
                                                            {truncateForCard(getLocalizedString(fact.value, dashboardLocale), 86)}
                                                        </span>
                                                    </div>
                                                ))}
                                                {compactSources.length > 0 ? (
                                                    <div className="flex items-center justify-between gap-2 pt-1">
                                                        <span className="text-[var(--text-muted)]">
                                                            {ENRICHMENT_PANEL_LABELS[dashboardLocale].sources}
                                                        </span>
                                                        <span className="inline-flex flex-wrap items-center justify-end gap-1">
                                                            {compactSources.slice(0, 3).map((entry, index) => (
                                                                <a
                                                                    key={`${asset.address}-${entry.sourceId}`}
                                                                    href={entry.source.url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-gold-cg hover:underline"
                                                                    title={entry.source.title}
                                                                >
                                                                    [{index + 1}]
                                                                </a>
                                                            ))}
                                                            {compactSources.length > 3 ? (
                                                                <span className="text-[var(--text-muted)]">
                                                                    +{compactSources.length - 3}
                                                                </span>
                                                            ) : null}
                                                        </span>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })
                ) : (
                    <p className="text-xs text-[var(--text-muted)]">No on-chain basket composition data</p>
                )}
            </div>
        </div>
    );
}
