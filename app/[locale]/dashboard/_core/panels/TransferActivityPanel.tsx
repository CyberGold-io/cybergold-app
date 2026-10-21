"use client";

import { TransferActivityLineChartEcharts } from "../../../../components/transferActivityLineChartEcharts";
import { DualLineValue, InfoHint } from "./PanelPrimitives";

type RangeId = "24H" | "7D" | "1M";

type TransferActivityPoint = {
    label: string;
    cygld: number;
    tx: number;
};

type TransferActivityPanelProps = {
    t: (key: string) => string;
    locale: string;
    range: RangeId;
    onRangeChange: (range: RangeId) => void;
    hasTransferData: boolean;
    totalTransferredCygld: number;
    totalTransfers: number;
    activeTransferSeries: TransferActivityPoint[];
    activeTransferAxisLabels: string[];
    formatRawToken: (amount: number, symbol: "CYGLD", maxFractionDigits?: number) => string;
    formatTokenEquivalent: (amount: number, symbol: "CYGLD") => string;
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const RANGE_IDS: RangeId[] = ["24H", "7D", "1M"];

export function TransferActivityPanel({
    t,
    locale,
    range,
    onRangeChange,
    hasTransferData,
    totalTransferredCygld,
    totalTransfers,
    activeTransferSeries,
    activeTransferAxisLabels,
    formatRawToken,
    formatTokenEquivalent,
    formatNumber,
}: TransferActivityPanelProps) {
    return (
        <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <h3 className="text-md font-semibold text-[var(--text-input)] flex items-center gap-1">
                        {t("tradingActivity")}
                        <InfoHint text={t("tipTradingActivity")} />
                    </h3>
                    <p className="text-xs mt-1">{t("transferredByBucket")}</p>
                </div>
                <div className="inline-flex rounded-full border border-[var(--swap-container-border)] bg-[var(--background-input)] p-1">
                    {RANGE_IDS.map((rangeId) => (
                        <button
                            key={rangeId}
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
                    <p className="text-xs">{t("cygldTransferred")}</p>
                    <div className="mt-1">
                        <DualLineValue
                            primary={hasTransferData ? formatRawToken(totalTransferredCygld, "CYGLD", 6) : "N/A"}
                            secondary={hasTransferData ? formatTokenEquivalent(totalTransferredCygld, "CYGLD") : ""}
                            primaryClassName="text-lg text-[var(--text-input)] font-semibold leading-tight"
                            secondaryClassName="text-[10px] text-[var(--text-muted)] mt-1"
                        />
                    </div>
                </div>
                <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-3">
                    <p className="text-xs">{t("transfersCount")}</p>
                    <p className="text-lg text-[var(--text-input)] font-semibold mt-1">
                        {hasTransferData
                            ? `${formatNumber(totalTransfers, { maximumFractionDigits: 0 })} ${t("transfersAbbreviation")}`
                            : "N/A"}
                    </p>
                </div>
            </div>
            <div className="mt-4 pb-3">
                {hasTransferData ? (
                    <>
                        <div className="mb-1 flex justify-end">
                            <span className="mr-[8px] w-[64px] text-right text-[10px] text-[var(--text-muted)]">CYGLD</span>
                        </div>
                        <div data-page-chart-slot><TransferActivityLineChartEcharts
                            series={activeTransferSeries}
                            locale={locale}
                            transfersSuffix={t("transfersAbbreviation")}
                        /></div>
                        <div className="mt-2 flex items-center justify-between pl-[6px] pr-[72px] text-[10px] text-[var(--text-muted)]">
                            <span>{activeTransferAxisLabels[0]}</span>
                            <span>{activeTransferAxisLabels[Math.floor((activeTransferAxisLabels.length - 1) / 2)]}</span>
                            <span>{activeTransferAxisLabels[activeTransferAxisLabels.length - 1]}</span>
                        </div>
                    </>
                ) : (
                    <p className="text-xs text-[var(--text-muted)]">No on-chain transfer data for {range}</p>
                )}
            </div>
        </div>
    );
}
