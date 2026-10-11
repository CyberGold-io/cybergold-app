"use client";

import { BasketCompositionPanel } from "./panels/BasketCompositionPanel";
import { FlowSupplyPanel } from "./panels/FlowSupplyPanel";
import { PegTrackingPanel } from "./panels/PegTrackingPanel";
import { DualLineValue, InfoHint } from "./panels/PanelPrimitives";
import { PriceTrendPanel } from "./panels/PriceTrendPanel";
import { ProtocolParametersPanel } from "./panels/ProtocolParametersPanel";
import { TransferActivityPanel } from "./panels/TransferActivityPanel";
import { RecoveryOverviewPanel, type RecoveryOverview } from "./panels/RecoveryOverviewPanel";
import {
    FlowsSupplySection,
    PriceMarketSection,
    ProtocolHealthSection,
    ReserveBasketSection,
} from "./sections/CoreSectionWrappers";

type RangeId = "24H" | "7D" | "1M";
type TokenSymbol = "CYGLD" | "XAUt" | "PAXG";

type TransferActivityPoint = {
    label: string;
    cygld: number;
    tx: number;
};

type FlowPoint = {
    label: string;
    mint: number;
    redeem: number;
    supply: number;
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

type ProtocolUpdateRef = {
    txHash: string | null;
} | null;

type CoreProtocolTabProps = {
    t: (key: string) => string;
    locale: string;
    gramsPerTroyOunce: number;
    cygldReference: { grams: number | null; usd: number | null };

    currentTotalSupply: number | null;
    holderCount: number | null;

    activityRange: RangeId;
    setActivityRange: (range: RangeId) => void;
    issueRange: RangeId;
    setIssueRange: (range: RangeId) => void;

    hasTransferData: boolean;
    totalTransferredCygld: number;
    totalTransfers: number;
    activeTransferSeries: TransferActivityPoint[];
    activeTransferAxisLabels: string[];

    hasBasketData: boolean;
    basketAssets: BasketAsset[];
    basketComparisonSeries: BasketComparisonEntry[];
    expandedBasketAssetAddress: string | null;
    setExpandedBasketAssetAddress: (value: string | null) => void;
    explorerBaseUrl: string;

    hasFlowData: boolean;
    totalNetFlow: number;
    activeFlowSeries: FlowPoint[];
    activeFlowAxisLabels: string[];

    protocolStatusClass: string;
    protocolIsActive: boolean | null;
    isValidProtocolAddress: boolean;
    protocolAddress: string;
    protocolExplorerUrl: string;
    issuanceFeePercent: number | null;
    redemptionFeePercent: number | null;
    protocolUpdateTimestamp: string;
    parameterUpdateTimestamp: string;
    protocolLogicUpdate: ProtocolUpdateRef;
    protocolParameterUpdate: ProtocolUpdateRef;
    recovery: RecoveryOverview | null;
    protocolUpdateTxUrl: string;
    parameterUpdateTxUrl: string;

    formatFiat: (amountUsd: number, options?: { compact?: boolean }) => string;
    formatGoldAmount: (amountOzt: number) => string;
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
    formatPercent: (valuePercent: number, fractionDigits?: number, signed?: boolean) => string;
    formatRawToken: (amount: number, symbol: TokenSymbol, maxFractionDigits?: number) => string;
    formatAssetAmount: (amount: number | null, symbol: string, maxFractionDigits?: number) => string;
    formatTokenEquivalent: (amount: number, symbol: TokenSymbol) => string;
    formatSignedTokenEquivalent: (amount: number, symbol: TokenSymbol) => string;
    shortenAddress: (address: string) => string;
    shortenTxHash: (hash: string) => string;
};

export function CoreProtocolTab({
    t,
    locale,
    gramsPerTroyOunce,
    cygldReference,
    currentTotalSupply,
    holderCount,
    activityRange,
    setActivityRange,
    issueRange,
    setIssueRange,
    hasTransferData,
    totalTransferredCygld,
    totalTransfers,
    activeTransferSeries,
    activeTransferAxisLabels,
    hasBasketData,
    basketAssets,
    basketComparisonSeries,
    expandedBasketAssetAddress,
    setExpandedBasketAssetAddress,
    explorerBaseUrl,
    hasFlowData,
    totalNetFlow,
    activeFlowSeries,
    activeFlowAxisLabels,
    protocolStatusClass,
    protocolIsActive,
    isValidProtocolAddress,
    protocolAddress,
    protocolExplorerUrl,
    issuanceFeePercent,
    redemptionFeePercent,
    protocolUpdateTimestamp,
    parameterUpdateTimestamp,
    protocolLogicUpdate,
    protocolParameterUpdate,
    recovery,
    protocolUpdateTxUrl,
    parameterUpdateTxUrl,
    formatFiat,
    formatGoldAmount,
    formatNumber,
    formatPercent,
    formatRawToken,
    formatAssetAmount,
    formatTokenEquivalent,
    formatSignedTokenEquivalent,
    shortenAddress,
    shortenTxHash,
}: CoreProtocolTabProps) {
    return (
        <section
            id="dashboard-panel-core-protocol"
            role="tabpanel"
            aria-labelledby="dashboard-tab-core-protocol"
            className="w-full min-w-0 mt-4 gap-4 items-center text-[var(--text-muted)]"
        >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--text-input)]">{t("coreProtocolTab")}</h2>
                    <p className="text-sm mt-1">{t("coreProtocolSubtitle")}</p>
                </div>
            </div>

            <ProtocolHealthSection>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mt-4 [&>*]:min-w-0 [&>*]:break-words">
                    <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4">
                        <p className="text-sm flex items-center gap-1">
                            {t("cygldCirculatingSupply")}
                            <InfoHint text={t("tipCygldCirculatingSupply")} />
                        </p>
                        <div className="mt-2">
                            <DualLineValue
                                primary={currentTotalSupply !== null ? formatRawToken(currentTotalSupply, "CYGLD", 6) : "N/A"}
                                secondary={currentTotalSupply !== null ? formatTokenEquivalent(currentTotalSupply, "CYGLD") : ""}
                                primaryClassName="text-2xl text-[var(--text-input)] font-semibold leading-tight"
                                secondaryClassName="text-xs text-[var(--text-muted)] mt-1"
                            />
                        </div>
                    </div>
                    <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4">
                        <p className="text-sm flex items-center gap-1">
                            {t("backingRatio")}
                            <InfoHint text={t("tipBackingRatio")} />
                        </p>
                        <p className="text-2xl 2xl:text-3xl font-semibold mt-2">N/A</p>
                        <p className="text-xs mt-1">{t("backingRatioUnavailable")}</p>
                    </div>
                    <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4">
                        <p className="text-sm flex items-center gap-1">
                            {t("cygldGoldReference")}
                            <InfoHint text={t("tipCygldGoldReference")} />
                        </p>
                        <div className="mt-2">
                            <DualLineValue
                                primary={cygldReference.usd !== null ? formatFiat(cygldReference.usd) : "N/A"}
                                secondary={cygldReference.grams !== null ? `1 CYGLD = ${formatGoldAmount(cygldReference.grams / gramsPerTroyOunce)}` : ""}
                                primaryClassName="text-2xl text-[var(--text-input)] font-semibold leading-tight"
                                secondaryClassName="text-xs text-[var(--text-muted)] mt-1"
                            />
                        </div>
                    </div>
                    <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4">
                        <p className="text-sm flex items-center gap-1">
                            {t("holders")}
                            <InfoHint text={t("tipHolders")} />
                        </p>
                        <p className="text-2xl 2xl:text-3xl text-[var(--text-input)] font-semibold mt-2">
                            {holderCount !== null ? formatNumber(holderCount, { maximumFractionDigits: 0 }) : "N/A"}
                        </p>
                    </div>
                    <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4">
                        <p className="text-sm flex items-center gap-1">
                            {t("pegDeviation")}
                            <InfoHint text={t("tipPegDeviation")} />
                        </p>
                        <p className="text-2xl 2xl:text-3xl font-semibold mt-2">N/A</p>
                        <p className="text-xs mt-1">{t("pegDataUnavailable")}</p>
                    </div>
                </div>

                <div className="grid min-w-0 grid-cols-1 lg:grid-cols-2 gap-4 mt-4 [&>*]:min-w-0">
                    <PegTrackingPanel t={t} />

                    <ProtocolParametersPanel
                        t={t}
                        protocolStatusClass={protocolStatusClass}
                        protocolIsActive={protocolIsActive}
                        isValidProtocolAddress={isValidProtocolAddress}
                        protocolAddress={protocolAddress}
                        protocolExplorerUrl={protocolExplorerUrl}
                        issuanceFeePercent={issuanceFeePercent}
                        redemptionFeePercent={redemptionFeePercent}
                        protocolUpdateTimestamp={protocolUpdateTimestamp}
                        parameterUpdateTimestamp={parameterUpdateTimestamp}
                        protocolLogicUpdate={protocolLogicUpdate}
                        protocolParameterUpdate={protocolParameterUpdate}
                        protocolUpdateTxUrl={protocolUpdateTxUrl}
                        parameterUpdateTxUrl={parameterUpdateTxUrl}
                        shortenAddress={shortenAddress}
                        shortenTxHash={shortenTxHash}
                        formatPercent={formatPercent}
                    />
                </div>
            </ProtocolHealthSection>

            <RecoveryOverviewPanel recovery={recovery} t={t} />

            <div className={`grid min-w-0 grid-cols-1 gap-4 mt-4 [&>*]:min-w-0 ${hasBasketData ? "lg:grid-cols-2" : ""}`}>
                {hasBasketData ? (
                    <ReserveBasketSection>
                        <BasketCompositionPanel
                            t={t}
                            locale={locale}
                            hasBasketData={hasBasketData}
                            basketAssets={basketAssets}
                            basketComparisonSeries={basketComparisonSeries}
                            expandedBasketAssetAddress={expandedBasketAssetAddress}
                            setExpandedBasketAssetAddress={setExpandedBasketAssetAddress}
                            explorerBaseUrl={explorerBaseUrl}
                            gramsPerTroyOunce={gramsPerTroyOunce}
                            shortenAddress={shortenAddress}
                            formatPercent={formatPercent}
                            formatAssetAmount={formatAssetAmount}
                            formatGoldAmount={formatGoldAmount}
                            formatNumber={formatNumber}
                        />
                    </ReserveBasketSection>
                ) : null}

                <FlowsSupplySection>
                    <FlowSupplyPanel
                        t={t}
                        locale={locale}
                        range={issueRange}
                        onRangeChange={setIssueRange}
                        hasFlowData={hasFlowData}
                        currentTotalSupply={currentTotalSupply}
                        totalNetFlow={totalNetFlow}
                        activeFlowSeries={activeFlowSeries}
                        activeFlowAxisLabels={activeFlowAxisLabels}
                        formatRawToken={formatRawToken}
                        formatTokenEquivalent={formatTokenEquivalent}
                        formatSignedTokenEquivalent={formatSignedTokenEquivalent}
                    />
                </FlowsSupplySection>
            </div>

            <PriceMarketSection>
                <div className="grid min-w-0 grid-cols-1 lg:grid-cols-2 gap-4 mt-4 [&>*]:min-w-0">
                    <TransferActivityPanel
                        t={t}
                        locale={locale}
                        range={activityRange}
                        onRangeChange={setActivityRange}
                        hasTransferData={hasTransferData}
                        totalTransferredCygld={totalTransferredCygld}
                        totalTransfers={totalTransfers}
                        activeTransferSeries={activeTransferSeries}
                        activeTransferAxisLabels={activeTransferAxisLabels}
                        formatRawToken={formatRawToken}
                        formatTokenEquivalent={formatTokenEquivalent}
                        formatNumber={formatNumber}
                    />

                    <PriceTrendPanel t={t} />
                </div>
            </PriceMarketSection>

        </section>
    );
}
