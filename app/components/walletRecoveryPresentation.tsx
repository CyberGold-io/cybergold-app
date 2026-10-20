"use client";

import { useTranslations } from "next-intl";
import type { WalletRecoveryDisplay } from "../utils/walletDisplayCache";

const emptyDisplay: WalletRecoveryDisplay = { notConfigured: false, corePaused: false, rows: [] };

/** Text-only recovery information; settlement still uses its live portfolio. */
export function WalletRecoveryPresentation({ display = emptyDisplay, refreshing = false, stale = false }: {
    display?: WalletRecoveryDisplay;
    refreshing?: boolean;
    stale?: boolean;
}) {
    const t = useTranslations("RecoveryShares");
    if (display.notConfigured) return <>
        {stale && <p role="status" className="mt-4 text-xs text-text-amber">{t("stale")}</p>}
        <p data-wallet-recovery="status" className="mt-4 text-xs text-text-muted">{t("notConfigured")}</p>
    </>;
    if (!display.rows.length) return null;

    return (
        <section data-wallet-recovery="section"
            className="mt-4 border-t border-swap-container-border pt-4 text-xs text-text-muted" aria-busy={refreshing}>
            <h3 className="font-semibold text-text-input">{t("title")}</h3>
            {stale && <p role="status" className="mt-2 text-text-amber">{t("stale")}</p>}
            <p className="mt-1">{t("description")}</p>
            <div className="mt-3 space-y-3">
                <p data-wallet-recovery-field="corePaused" hidden={!display.corePaused} className="mt-2 text-text-amber">{t("paused")}</p>
                {display.rows.map(row => <div key={row.shareId} data-wallet-recovery-row={row.shareId}
                    className="rounded-xl border border-swap-container-border bg-background-input p-3">
                    <p data-wallet-recovery-field="assetLabel" className="font-semibold text-text-input">{row.assetLabel}</p>
                    <p data-wallet-recovery-field="balance" className="mt-1 text-text-input">{row.balance}</p>
                    <div className="mt-2 flex justify-between gap-3">
                        <span>{t("payout")}</span>
                        <span data-wallet-recovery-field="payout" className="font-medium text-text-input">{row.payout}</span>
                    </div>
                    <p data-wallet-recovery-field="fundOffer" hidden={!row.fundOffer} className="mt-2">{row.fundOffer}</p>
                    <button type="button" disabled hidden={!row.redeemLabel} data-wallet-recovery-field="redeemLabel"
                        className="mt-3 inline-flex [&[hidden]]:hidden items-center gap-2 rounded-lg bg-gold-cg px-3 py-2 font-semibold text-black disabled:cursor-not-allowed">{row.redeemLabel}</button>
                    <p data-wallet-recovery-field="zeroPayout" hidden={!row.zeroPayout} className="mt-2">{t("zeroPayout")}</p>
                </div>)}
            </div>
        </section>
    );
}
