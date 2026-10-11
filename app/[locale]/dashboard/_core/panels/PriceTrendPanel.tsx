"use client";

export function PriceTrendPanel({ t }: { t: (key: string) => string }) {
    return (
        <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4">
            <h3 className="text-md font-semibold text-[var(--text-input)]">{t("cygldPriceTrend")}</h3>
            <p className="text-sm mt-3">{t("priceHistoryUnavailable")}</p>
        </div>
    );
}
