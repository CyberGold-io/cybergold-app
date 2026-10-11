"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

type CoreSectionWrapperProps = {
    children: ReactNode;
};

type CoreSectionFrameProps = CoreSectionWrapperProps & {
    title: string;
    className?: string;
};

function CoreSectionFrame({ title, className = "", children }: CoreSectionFrameProps) {
    return (
        <section className={className}>
            <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-[var(--text-input)] whitespace-nowrap">{title}</h3>
                <div className="h-px flex-1 bg-[var(--swap-container-border)] opacity-80" />
            </div>
            {children}
        </section>
    );
}

export function ProtocolHealthSection({ children }: CoreSectionWrapperProps) {
    const t = useTranslations("Dashboard");
    return (
        <CoreSectionFrame title={t("coreSectionProtocolHealth")} className="mt-5">
            {children}
        </CoreSectionFrame>
    );
}

export function ReserveBasketSection({ children }: CoreSectionWrapperProps) {
    const t = useTranslations("Dashboard");
    return <CoreSectionFrame title={t("coreSectionReserveBasket")}>{children}</CoreSectionFrame>;
}

export function FlowsSupplySection({ children }: CoreSectionWrapperProps) {
    const t = useTranslations("Dashboard");
    return <CoreSectionFrame title={t("coreSectionFlowsSupply")}>{children}</CoreSectionFrame>;
}

export function PriceMarketSection({ children }: CoreSectionWrapperProps) {
    const t = useTranslations("Dashboard");
    return (
        <CoreSectionFrame title={t("coreSectionPriceMarket")} className="mt-6">
            {children}
        </CoreSectionFrame>
    );
}
