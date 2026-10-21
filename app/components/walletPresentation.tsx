"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { IoCloseCircle, IoCopyOutline, IoEyeOutline, IoEyeOffOutline, IoGlobeOutline, IoPowerOutline, IoRefreshOutline } from "react-icons/io5";
import { resolveTokenImagePath } from "../utils/tokenImages";
import { WalletActionSlot } from "./walletActionSlot";

export const walletPillBaseClass = "rounded-full border px-3 py-1.5 text-[15px] transition disabled:opacity-60 disabled:cursor-not-allowed";
export function walletConnectedPillClass(isOpen: boolean) {
    return `${walletPillBaseClass} ${isOpen
        ? "border-[var(--text-input)] bg-[var(--text-input)] text-[var(--background-input)] hover:opacity-90"
        : "border-[var(--swap-container-border)] bg-[var(--background-input)] text-[var(--text-input)] hover:bg-zinc-200"}`;
}

export type WalletPanelFrameProps = {
    titleId: string;
    networkName: string;
    address?: string;
    showFullAddress?: boolean;
    isCopied?: boolean;
    isRefreshing?: boolean;
    isDisconnecting?: boolean;
    actionsDisabled?: boolean;
    onNetworkChange?: () => void;
    onRefresh?: () => void;
    onDisconnect?: () => void;
    onClose?: () => void;
    onCopyAddress?: () => void;
    onToggleFullAddress?: () => void;
    testId?: string | false;
    children?: ReactNode;
};

/** The same shell presents live observations and the last tab-local display. */
export function WalletPanelFrame({ titleId, networkName, address, showFullAddress = false, isCopied = false,
    isRefreshing = false, isDisconnecting = false, actionsDisabled = false, onNetworkChange, onRefresh,
    onDisconnect, onClose, onCopyAddress, onToggleFullAddress, testId = "wallet-balance-modal", children }: WalletPanelFrameProps) {
    const t = useTranslations("WalletBalances");
    const walletT = useTranslations("WalletMenu");
    const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";

    return (
        <div
            className="flex h-full w-full min-w-0 flex-col overflow-y-auto border-l border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-5 py-5 shadow-xl shadow-black/70 sm:w-[440px] sm:max-w-[calc(100vw-2rem)] sm:px-6"
            data-testid={testId || undefined}
            data-wallet-panel-content
            data-wallet-network-name={networkName}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="flex items-center gap-2">
                <h2 id={titleId} className="min-w-0 flex-1 text-lg text-[var(--text-input)] min-[1025px]:text-xl">{t("walletTitle")}</h2>
                <div className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={onNetworkChange} disabled={actionsDisabled}
                        data-wallet-display="network"
                        data-wallet-network-label={walletT("network")}
                        aria-label={`${walletT("network")}: ${networkName}`}
                        title={`${walletT("network")}: ${networkName}`}
                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-gold-cg bg-gold-cg text-black transition hover:opacity-90 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                        <IoGlobeOutline aria-hidden="true" className="size-5" />
                    </button>
                    <button type="button" onClick={onRefresh} disabled={actionsDisabled || isRefreshing} aria-busy={isRefreshing}
                        aria-label={t("refresh")}
                        title={t("refresh")}
                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-gold-cg bg-gold-cg text-black transition hover:opacity-90 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed">
                        <IoRefreshOutline aria-hidden="true" className="size-5" />
                    </button>
                    <button type="button" onClick={onDisconnect} disabled={actionsDisabled || isDisconnecting}
                        aria-label={walletT(isDisconnecting ? "disconnecting" : "disconnect")}
                        title={walletT(isDisconnecting ? "disconnecting" : "disconnect")}
                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--swap-container-border)] bg-[var(--background-input)] text-[var(--text-input)] transition hover:border-gold-cg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed">
                        <IoPowerOutline aria-hidden="true" className="size-5" />
                    </button>
                </div>
                <button type="button" onClick={onClose} data-wallet-close
                    className="shrink-0 min-[1025px]:hidden" aria-label={t("close")}>
                    <IoCloseCircle className="text-xl text-[var(--text-muted)]" />
                </button>
            </div>
            <div className="mt-4">
                <div className="flex items-center gap-3">
                    <div className="flex-1 overflow-hidden rounded-xl border border-[var(--swap-container-border)] bg-[var(--background-input)] px-2 py-3 hover:border-gold-cg">
                        <p data-wallet-display="address"
                            className={`text-xs tracking-wide text-[var(--text-input)] break-all ${showFullAddress ? "" : "truncate"}`}>
                            {showFullAddress ? address : shortAddress}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button type="button" className={isCopied ? "text-gold-cg" : "text-[var(--text-input)]"}
                            data-wallet-copy-address
                            aria-label={t("copyAddress")} title={t("copyAddress")}
                            onClick={onCopyAddress}>
                            <IoCopyOutline className="text-base" />
                        </button>
                        <button type="button" className="text-gold-cg dark:text-white"
                            data-wallet-toggle-address
                            aria-label={t(showFullAddress ? "hideAddress" : "viewAddress")}
                            title={t(showFullAddress ? "hideAddress" : "viewAddress")}
                            aria-pressed={showFullAddress} onClick={onToggleFullAddress}>
                            <span data-wallet-address-eye="show" hidden={showFullAddress}><IoEyeOutline aria-hidden="true" className="text-base" /></span>
                            <span data-wallet-address-eye="hide" hidden={!showFullAddress}><IoEyeOffOutline aria-hidden="true" className="text-base" /></span>
                        </button>
                    </div>
                </div>
            </div>
            {children}
        </div>
    );
}

export type WalletBalanceRowProps = {
    tokenId: string;
    tokenName: string;
    tokenSymbol: string;
    amountText: string;
    valueText: string;
    amountMuted?: boolean;
    valueMuted?: boolean;
    valueTitle?: string;
    isDarkMode?: boolean;
    testIds?: boolean;
    children?: ReactNode;
};

export function WalletBalanceRow({ tokenId, tokenName, tokenSymbol, amountText, valueText, amountMuted = false,
    valueMuted = false, valueTitle, isDarkMode = false, testIds = true, children }: WalletBalanceRowProps) {
    return (
        <div
            className={`flex items-center justify-between gap-3 rounded-xl border p-3 hover:border-gold-cg ${tokenId === "cygld"
                ? "border-gold-cg/40 bg-gold-cg/10"
                : "border-[var(--swap-container-border)] bg-[var(--background-input)]"}`}
            data-wallet-row={tokenId}
            data-wallet-symbol={tokenSymbol}
            data-testid={testIds ? `wallet-balance-row-${tokenId}` : undefined}
        >
            <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-[22px] w-[22px] items-center justify-center">
                    <Image src={resolveTokenImagePath(tokenId, isDarkMode)} alt={`${tokenName} icon`}
                        data-wallet-image={tokenId} width={22} height={22} className="h-[22px] w-[22px] object-contain" />
                </div>
                <div className="min-w-0">
                    <p data-wallet-field="name" className="truncate text-sm font-medium text-[var(--text-input)]" title={tokenName}>{tokenName}</p>
                    <p data-wallet-field="amount"
                        className={`text-xs font-medium text-[var(--text-input)] ${amountMuted ? "opacity-60" : ""}`}
                        data-testid={testIds ? `wallet-balance-amount-${tokenId}` : undefined}>
                        {amountText}
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
                <p data-wallet-field="value"
                    className={`whitespace-nowrap text-xs font-semibold text-black dark:text-white ${valueMuted ? "opacity-60" : ""}`}
                    data-testid={testIds ? `wallet-balance-value-${tokenId}` : undefined} title={valueTitle}>
                    {valueText}
                </p>
                <WalletActionSlot><span data-wallet-action-slot>{children}</span></WalletActionSlot>
            </div>
        </div>
    );
}
