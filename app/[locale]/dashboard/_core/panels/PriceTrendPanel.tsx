"use client";

export function PriceTrendPanel({ t }: { t: (key: string) => string }) {
    return (
        <div className="cg-glass px-4 py-4">
            <h3 className="text-md font-semibold text-[var(--text-input)]">{t("cygldPriceTrend")}</h3>
            <p className="text-sm mt-3">{t("priceHistoryUnavailable")}</p>
        </div>
    );
}
