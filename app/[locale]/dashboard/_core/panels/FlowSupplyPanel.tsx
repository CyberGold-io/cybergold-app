"use client";

import { IssuanceRedemptionSupplyChartEcharts } from "../../../../components/issuanceRedemptionSupplyChartEcharts";
import { DualLineValue } from "./PanelPrimitives";

type RangeId = "24H" | "7D" | "1M";

type FlowPoint = {
    label: string;
    mint: number;
    redeem: number;
    supply: number;
};

type FlowSupplyPanelProps = {
    t: (key: string) => string;
    locale: string;
    range: RangeId;
    onRangeChange: (range: RangeId) => void;
    hasFlowData: boolean;
    currentTotalSupply: number | null;
    totalNetFlow: number;
    activeFlowSeries: FlowPoint[];
    activeFlowAxisLabels: string[];
    formatRawToken: (amount: number, symbol: "CYGLD", maxFractionDigits?: number) => string;
    formatTokenEquivalent: (amount: number, symbol: "CYGLD") => string;
    formatSignedTokenEquivalent: (amount: number, symbol: "CYGLD") => string;
};

const RANGE_IDS: RangeId[] = ["24H", "7D", "1M"];

export function FlowSupplyPanel({
    t,
    locale,
    range,
    onRangeChange,
    hasFlowData,
    currentTotalSupply,
    totalNetFlow,
    activeFlowSeries,
    activeFlowAxisLabels,
    formatRawToken,
    formatTokenEquivalent,
    formatSignedTokenEquivalent,
}: FlowSupplyPanelProps) {
    return (
        <div className="cg-glass px-4 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <h3 className="text-md font-semibold text-[var(--text-input)]">{t("issuanceRedemptionAndSupply")}</h3>
                    <p className="text-xs mt-1">{t("mintRedeemVolume")}</p>
                </div>
                <div className="inline-flex rounded-full border border-[var(--swap-container-border)] bg-[var(--background-input)] p-1">
                    {RANGE_IDS.map((rangeId) => (
                        <button
                            key={`issue-${rangeId}`}
                            type="button"
                            onClick={() => onRangeChange(rangeId)}
                            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                                range === rangeId
                                    ? "bg-gold-cg text-white"
                                    : "text-[var(--text-muted)] hover:text-[var(--text-input)]"
                            }`}
                        >
                            {rangeId}
                        </button>
                    ))}
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-3">
                    <p className="text-xs">{t("currentTotalSupply")}</p>
                    <div className="mt-1">
                        <DualLineValue
                            primary={currentTotalSupply !== null ? formatRawToken(currentTotalSupply, "CYGLD", 6) : "N/A"}
                            secondary={currentTotalSupply !== null ? formatTokenEquivalent(currentTotalSupply, "CYGLD") : ""}
                            primaryClassName="text-lg text-[var(--text-input)] font-semibold leading-tight"
                            secondaryClassName="text-[10px] text-[var(--text-muted)] mt-1"
                        />
                    </div>
                </div>
                <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-3">
                    <p className="text-xs">
                        {t("netIssuanceWindow")} ({range})
                    </p>
                    <div className="mt-1">
                        <DualLineValue
                            primary={
                                hasFlowData
                                    ? `${totalNetFlow >= 0 ? "+" : "-"}${formatRawToken(Math.abs(totalNetFlow), "CYGLD", 6)}`
                                    : "N/A"
                            }
                            secondary={hasFlowData ? formatSignedTokenEquivalent(totalNetFlow, "CYGLD") : ""}
                            primaryClassName={`text-lg font-semibold leading-tight ${
                                totalNetFlow >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                            }`}
                            secondaryClassName="text-[10px] text-[var(--text-muted)] mt-1"
                        />
                    </div>
                </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[10px] text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-sm bg-green-500" />
                    {t("legendMint")}
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-sm bg-red-500" />
                    {t("legendRedeem")}
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-0.5 w-4 rounded bg-gold-cg" />
                    {t("axisSupplyShort")}
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-flex items-center gap-0.5">
                        <span className="inline-block h-2 w-2 rounded-full border-2 border-green-500 bg-white" />
                        <span className="inline-block h-2 w-2 rounded-full border-2 border-zinc-400 bg-white" />
                        <span className="inline-block h-2 w-2 rounded-full border-2 border-red-500 bg-white" />
                    </span>
                    {t("legendNetFlow")}
                </span>
            </div>
            <div className="mt-4 pb-3">
                {hasFlowData ? (
                    <>
                        <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                            <span>{t("axisMintRedeemShort")} (CYGLD)</span>
                            <span>{t("axisSupplyShort")} (CYGLD)</span>
                        </div>
                        <div data-page-chart-slot><IssuanceRedemptionSupplyChartEcharts series={activeFlowSeries} locale={locale} /></div>
                        <div className="mt-2 flex items-center justify-between pl-[56px] pr-[72px] text-[10px] text-[var(--text-muted)]">
                            <span>{activeFlowAxisLabels[0]}</span>
                            <span>{activeFlowAxisLabels[Math.floor((activeFlowAxisLabels.length - 1) / 2)]}</span>
                            <span>{activeFlowAxisLabels[activeFlowAxisLabels.length - 1]}</span>
                        </div>
                    </>
                ) : (
                    <p className="text-xs text-[var(--text-muted)]">No on-chain issuance/redemption data for {range}</p>
                )}
            </div>
        </div>
    );
}
