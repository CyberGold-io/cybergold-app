"use client";
import { publicEnv } from "../config/publicEnvironment.ts";

import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import Image from "next/image";
import { formatUnits } from "viem";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { useTokenWalletBalances } from "../hooks/useTokenWalletBalances";
import { useImportedTokens } from "../hooks/useImportedTokens";
import { useTokenUsdPrices } from "../hooks/useTokenUsdPrices";
import { useGoldPrice } from "../hooks/useGoldPrice";
import { useBasketData } from "../hooks/cybergold/useBasketData";
import { useObservedWalletAccount } from "../hooks/useObservedWalletAccount";
import { useIsDarkMode } from "../hooks/useIsDarkMode";
import { type erc20Token } from "../config/tokens";
import { useProtocolConfiguration } from "../context/protocolConfigurationContext";
import { IoCloseCircle, IoCopyOutline, IoEyeOutline, IoEyeOffOutline, IoGlobeOutline, IoPowerOutline, IoRefreshOutline } from "react-icons/io5";
import { formatNumberWithCustomGrouping } from "../utils/formatting";
import { resolveActiveProvider } from "../utils/ethereumProvider";
import { useCurrency } from "../context/currencyContext";
import { formatDisplayValueFromUsd } from "../utils/priceDisplay";
import { buildGoldReferenceGramsByTokenId, getUsdPriceFromGoldReference } from "../utils/goldReferencePricing";
import { resolveTokenImagePath } from "../utils/tokenImages";
import { RecoverySharePortfolio } from "./recoverySharePortfolio";
import { useRecoverySharePortfolio } from "../hooks/cybergold/useRecoverySharePortfolio";
import { MarketDataFreshnessNotice } from "./marketDataFreshnessNotice";
import { LiquidityProviderPanel } from "./liquidityProviderPanel";
import { WalletActionSlot } from "./walletActionSlot";
import { useLiquidityPositions } from "../hooks/useLiquidityPositions";
import { faucetFailureFeedback, faucetResponseError, FaucetRequestError, type FaucetFailureFeedback } from "../utils/faucetErrors";

type WalletBalanceModalProps = {
    isOpen: boolean;
    onClose: () => void;
    returnFocusRef: RefObject<HTMLButtonElement | null>;
    onDisconnect: () => void;
    isDisconnecting: boolean;
    networkName: string;
    isNetworkChooserOpen: boolean;
    onNetworkChange: () => void;
};

type FaucetResponse = {
    address: string;
    ethWei: string;
    tokens: Array<{ symbol: string; amount: string }>;
};

const isForkFaucetEnabled = publicEnv.NEXT_PUBLIC_FORK_FAUCET_ENABLED === "1";
const IMPORT_SUCCESS_FEEDBACK_MS = 5 * 60 * 1000;

export function WalletBalanceModal({ isOpen, onClose, returnFocusRef, onDisconnect, isDisconnecting, networkName, isNetworkChooserOpen, onNetworkChange }: WalletBalanceModalProps) {
    const { tokens } = useProtocolConfiguration();
    const locale = useLocale();
    const t = useTranslations("WalletBalances");
    const walletT = useTranslations("WalletMenu");
    const titleId = useId();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const {
        formatFiat,
        formatGoldAmount,
        selectedCurrency,
        selectedPriceDisplayMode,
        fxFetchedAt,
        isFxStale,
        isFxLoading,
    } = useCurrency();
    const isDarkMode = useIsDarkMode();
    const { importedTokens } = useImportedTokens();
    const allTokens = useMemo(() => [...tokens, ...importedTokens], [tokens, importedTokens]);
    const { address, isConnected, connector } = useObservedWalletAccount();
    const { balances, isLoading, isRefreshing: areTokensRefreshing, rpcUnavailable, refreshWalletBalances } = useTokenWalletBalances(importedTokens);
    const orderedTokens = useMemo(() => {
        const priority = (id: string) => id === "eth" ? 0 : id === "cygld" ? 1 : 2;
        return allTokens.filter(token => token.type !== "basket")
            .sort((left, right) => priority(left.id) - priority(right.id));
    }, [allTokens]);
    const balanceByTokenId = useMemo(() => {
        return new Map(balances.map(({ id, balance }) => [id, balance]));
    }, [balances]);
    const recovery = useRecoverySharePortfolio(address);
    const [isLiquidityExpanded, setIsLiquidityExpanded] = useState(false);
    const liquidity = useLiquidityPositions(address, isOpen);
    const isRefreshing = areTokensRefreshing || recovery.isRefreshing;
    const refreshBalances = async () => {
        await Promise.allSettled([
            refreshWalletBalances(), recovery.refetch(),
            liquidity.refetch(),
        ]);
    };
    const { basket, cygldRefGrams } = useBasketData();
    const {
        price: goldPriceUsdPerGram,
        ouncePrice: goldSpotUsdPerOzt,
        fetchedAt: goldPriceFetchedAt,
        isStale: isGoldPriceStale,
        isLoading: isGoldPriceLoading,
    } = useGoldPrice();
    const cygldReferencePriceUsd = getUsdPriceFromGoldReference({
        goldRefGramsFp18: cygldRefGrams.data,
        goldSpotUsdPerOzt,
    });
    const cygldPriceUsd = cygldReferencePriceUsd ?? (cygldRefGrams.isError ? goldPriceUsdPerGram : undefined);
    const isCygldPriceLoading = isGoldPriceLoading || cygldRefGrams.isLoading;
    const goldReferenceGramsByTokenId = useMemo(
        () => buildGoldReferenceGramsByTokenId(basket.data),
        [basket.data]
    );
    const { prices, isLoading: isPricesLoading } = useTokenUsdPrices(allTokens, {
        goldSpotUsdPerOzt,
        goldReferenceGramsByTokenId,
    });
    const [showFullAddress, setShowFullAddress] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const copyFeedbackTimeoutRef = useRef<number | null>(null);
    const [isFundingWallet, setIsFundingWallet] = useState(false);
    const [fundingFailure, setFundingFailure] = useState<(FaucetFailureFeedback & { address: string }) | null>(null);
    const [fundingReferenceCopy, setFundingReferenceCopy] = useState<{ reference: string; status: "copied" | "failed" } | null>(null);
    const [importingTokenId, setImportingTokenId] = useState<string | null>(null);
    const [recentlyImportedTokenIds, setRecentlyImportedTokenIds] = useState<Record<string, true>>({});
    const importFeedbackTimeoutsRef = useRef<Record<string, number>>({});
    const faucetRequestRef = useRef<{ address: string; requestId: string } | null>(null);
    const fundingReferenceCopyStatus = fundingFailure?.correlationId === fundingReferenceCopy?.reference
        ? fundingReferenceCopy?.status : undefined;

    const shortAddress = useMemo(() => {
        if (!address) return "";
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }, [address]);

    const importableTokenById = useMemo(() => {
        return allTokens.reduce<Record<string, erc20Token>>((acc, token) => {
            if (token.type === "erc20") {
                acc[token.id] = token;
            }
            return acc;
        }, {});
    }, [allTokens]);

    const tokenDecimalsBySymbol = useMemo(() => {
        return tokens.reduce<Record<string, number>>((acc, token) => {
            if (token.type === "erc20") {
                acc[token.symbol.toUpperCase()] = token.decimals;
            }
            return acc;
        }, { ETH: 18 });
    }, [tokens]);

    const formatApproxDisplayValue = (amountUsd?: number) => {
        if (amountUsd === undefined || !Number.isFinite(amountUsd) || amountUsd < 0) {
            return undefined;
        }

        const formatted = formatDisplayValueFromUsd({
            amountUsd,
            priceDisplayMode: selectedPriceDisplayMode,
            goldSpotUsdPerOzt,
            formatFiat,
            formatGoldAmount,
        });

        return formatted ? `~ ${formatted}` : undefined;
    };

    const handleCopyAddress = async () => {
        if (!address) return;
        try {
            await navigator.clipboard.writeText(address);
            if (copyFeedbackTimeoutRef.current !== null) {
                window.clearTimeout(copyFeedbackTimeoutRef.current);
            }
            setIsCopied(true);
            copyFeedbackTimeoutRef.current = window.setTimeout(() => {
                setIsCopied(false);
                copyFeedbackTimeoutRef.current = null;
            }, 1000);
        } catch {
            setIsCopied(false);
        }
    };

    const buildFundingSummary = (payload: FaucetResponse) => {
        const fundedAmounts = [
            `${formatUnits(BigInt(payload.ethWei), 18)} ETH`,
            ...payload.tokens.map(({ symbol, amount }) => {
                const normalizedSymbol = symbol.toUpperCase();
                const decimals = tokenDecimalsBySymbol[normalizedSymbol] ?? 18;
                const displaySymbol = normalizedSymbol === "XAUT" ? "XAUt" : symbol;
                return `${formatUnits(BigInt(amount), decimals)} ${displaySymbol}`;
            }),
        ];

        return fundedAmounts.join(", ");
    };

    const handleFundWallet = async () => {
        if (!address) return;

        try {
            setIsFundingWallet(true);
            setFundingFailure(null);
            setFundingReferenceCopy(null);
            const normalizedAddress = address.toLowerCase();
            if (faucetRequestRef.current?.address !== normalizedAddress) {
                faucetRequestRef.current = {
                    address: normalizedAddress,
                    requestId: crypto.randomUUID(),
                };
            }
            const requestId = faucetRequestRef.current.requestId;

            const response = await fetch("/api/faucet", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ address, requestId }),
            });

            const payload = await response.json().catch(() => undefined) as FaucetResponse | undefined;

            if (!response.ok) {
                if (
                    response.headers.get("x-cybergold-faucet-request-id") === "replace" &&
                    faucetRequestRef.current?.requestId === requestId
                ) {
                    faucetRequestRef.current = null;
                }
                throw faucetResponseError(response, payload);
            }
            if (!payload) throw new FaucetRequestError(response.status, "INVALID_RESPONSE");

            await refreshWalletBalances();
            if (faucetRequestRef.current?.requestId === requestId) {
                faucetRequestRef.current = null;
            }
            toast.success(t("funded"), {
                description: buildFundingSummary(payload),
            });
        } catch (error) {
            const feedback = faucetFailureFeedback(error);
            setFundingFailure({ ...feedback, address: address.toLowerCase() });
            const description = [
                t(feedback.messageKey),
                feedback.retryAfterSeconds ? t("fundRetryAfter", { seconds: feedback.retryAfterSeconds }) : "",
                feedback.correlationId ? t("fundReference", { reference: feedback.correlationId }) : "",
            ].filter(Boolean).join(" ");
            toast.error(t("fundFailed"), { description });
        } finally {
            setIsFundingWallet(false);
        }
    };

    const handleCopyFundingReference = async () => {
        const reference = fundingFailure?.correlationId;
        if (!reference) return;
        try {
            await navigator.clipboard.writeText(reference);
            setFundingReferenceCopy({ reference, status: "copied" });
        } catch {
            setFundingReferenceCopy({ reference, status: "failed" });
        }
    };

    const handleImportToken = async (tokenId: string) => {
        const token = importableTokenById[tokenId];
        if (!token) return;

        try {
            setImportingTokenId(tokenId);
            const provider = await resolveActiveProvider(connector ?? null);
            if (!provider) {
                throw new Error("No compatible wallet provider found.");
            }

            const imageUrl = `${window.location.origin}${resolveTokenImagePath(token.id, isDarkMode)}`;
            const walletAssetSymbol = token.id === "cygld" ? "CYGLD" : token.symbol;
            const result = await provider.request({
                method: "wallet_watchAsset",
                params: {
                    type: "ERC20",
                    options: {
                        address: token.address,
                        symbol: walletAssetSymbol,
                        name: token.name,
                        decimals: token.decimals,
                        image: imageUrl,
                    },
                },
            });

            if (result !== true) {
                toast.message(t("importCancelled"), {
                    description: t("importCancelledDescription", { symbol: token.symbol }),
                });
                return;
            }

            const existingTimeout = importFeedbackTimeoutsRef.current[tokenId];
            if (existingTimeout) {
                window.clearTimeout(existingTimeout);
            }

            setRecentlyImportedTokenIds((current) => ({
                ...current,
                [tokenId]: true,
            }));
            importFeedbackTimeoutsRef.current[tokenId] = window.setTimeout(() => {
                setRecentlyImportedTokenIds((current) => {
                    if (!current[tokenId]) {
                        return current;
                    }

                    const next = { ...current };
                    delete next[tokenId];
                    return next;
                });
                delete importFeedbackTimeoutsRef.current[tokenId];
            }, IMPORT_SUCCESS_FEEDBACK_MS);

            toast.success(t("importSuccess"), {
                description: t("importSuccessDescription", { symbol: token.symbol }),
            });
        } catch (error) {
            console.error("Token import failed", error);
            toast.error(t("importFailed"), { description: t("importFailedDescription") });
        } finally {
            setImportingTokenId(null);
        }
    };

    useEffect(() => {
        if (!isConnected || !isOpen) return;
        const dialog = dialogRef.current;
        const returnFocus = returnFocusRef.current;
        setShowFullAddress(false);
        setIsCopied(false);
        return () => {
            dialog?.close();
            returnFocus?.focus();
        };
    }, [isConnected, isOpen, returnFocusRef]);

    useEffect(() => {
        if (!isConnected || !isOpen) return;
        const dialog = dialogRef.current;
        const desktop = window.matchMedia("(min-width: 1025px)");
        const showPanel = () => {
            // A native mobile modal would make the network chooser's body
            // portal inert. Keep the wallet visible behind that chooser.
            const modal = !desktop.matches && !isNetworkChooserOpen;
            dialog?.close();
            dialog?.setAttribute("aria-modal", String(modal));
            if (modal) dialog?.showModal();
            else dialog?.show();
        };
        showPanel();
        desktop.addEventListener("change", showPanel);
        return () => {
            desktop.removeEventListener("change", showPanel);
            dialog?.close();
        };
    }, [isConnected, isOpen, isNetworkChooserOpen]);

    useEffect(() => {
        return () => {
            if (copyFeedbackTimeoutRef.current !== null) {
                window.clearTimeout(copyFeedbackTimeoutRef.current);
            }
            Object.values(importFeedbackTimeoutsRef.current).forEach((timeoutId) => {
                window.clearTimeout(timeoutId);
            });
            importFeedbackTimeoutsRef.current = {};
        };
    }, []);

    // Keep settlement state mounted while the native dialog is closed.
    
    return (
        <dialog ref={dialogRef} aria-labelledby={titleId}
            className="wallet-panel m-0 max-h-none max-w-none items-stretch justify-end bg-transparent p-0 open:flex backdrop:bg-black/30"
            onClick={onClose} onCancel={(event) => { event.preventDefault(); onClose(); }}
            onKeyDown={(event) => {
                if (!event.currentTarget.matches(":modal")) {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        onClose();
                    }
                    return;
                }
                if (event.key !== "Tab") return;
                const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
                )).filter(element => element.getClientRects().length > 0);
                const first = controls[0];
                const last = controls.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }}>
            <div
                className="flex h-full w-full min-w-0 flex-col overflow-y-auto border-l border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-5 py-5 shadow-xl shadow-black/70 sm:w-[440px] sm:max-w-[calc(100vw-2rem)] sm:px-6"
                data-testid="wallet-balance-modal"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-2">
                    <h2 id={titleId} className="min-w-0 flex-1 text-lg text-[var(--text-input)] min-[1025px]:text-xl">{t("walletTitle")}</h2>
                    <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={onNetworkChange}
                            aria-label={`${walletT("network")}: ${networkName}`}
                            title={`${walletT("network")}: ${networkName}`}
                            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-gold-cg bg-gold-cg text-black transition hover:opacity-90 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                            <IoGlobeOutline aria-hidden="true" className="size-5" />
                        </button>
                        <button type="button" onClick={() => void refreshBalances()} disabled={isRefreshing} aria-busy={isRefreshing}
                            aria-label={t(isRefreshing ? "refreshing" : "refresh")}
                            title={t(isRefreshing ? "refreshing" : "refresh")}
                            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-gold-cg bg-gold-cg text-black transition hover:opacity-90 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60">
                            <IoRefreshOutline aria-hidden="true" className={`size-5 ${isRefreshing ? "animate-spin" : ""}`} />
                        </button>
                        <button type="button" onClick={onDisconnect} disabled={isDisconnecting}
                            aria-label={walletT(isDisconnecting ? "disconnecting" : "disconnect")}
                            title={walletT(isDisconnecting ? "disconnecting" : "disconnect")}
                            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--swap-container-border)] bg-[var(--background-input)] text-[var(--text-input)] transition hover:border-gold-cg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60">
                            <IoPowerOutline aria-hidden="true" className="size-5" />
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="shrink-0 min-[1025px]:hidden"
                        aria-label={t("close")}
                    >
                        <IoCloseCircle className="text-xl text-[var(--text-muted)]" />
                    </button>
                </div>
                <div className="mt-4">
                    <div className="flex items-center gap-3">
                        <div className="flex-1 overflow-hidden rounded-xl border border-[var(--swap-container-border)] bg-[var(--background-input)] px-2 py-3 hover:border-gold-cg">
                            <p className={`text-xs tracking-wide text-[var(--text-input)] break-all ${showFullAddress ? "" : "truncate"}`}>
                                {showFullAddress ? address : shortAddress}
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                className={isCopied ? "text-gold-cg" : "text-[var(--text-input)]"}
                                aria-label={t("copyAddress")}
                                title={t("copyAddress")}
                                onClick={handleCopyAddress}
                            >
                                <IoCopyOutline className="text-base" />
                            </button>
                            <button
                                type="button"
                                className="text-gold-cg dark:text-white"
                                aria-label={t(showFullAddress ? "hideAddress" : "viewAddress")}
                                title={t(showFullAddress ? "hideAddress" : "viewAddress")}
                                aria-pressed={showFullAddress}
                                onClick={() => setShowFullAddress((prev) => !prev)}
                            >
                                {showFullAddress ? <IoEyeOffOutline aria-hidden="true" className="text-base" /> : <IoEyeOutline aria-hidden="true" className="text-base" />}
                            </button>
                        </div>
                    </div>
                </div>

                <MarketDataFreshnessNotice
                    className="mt-4"
                    locale={locale}
                    gold={{
                        fetchedAt: goldPriceFetchedAt,
                        isStale: isGoldPriceStale,
                        isLoading: isGoldPriceLoading,
                    }}
                    fx={
                        selectedCurrency === "USD"
                            ? undefined
                            : {
                                fetchedAt: fxFetchedAt,
                                isStale: isFxStale,
                                isLoading: isFxLoading,
                            }
                    }
                />

                {isForkFaucetEnabled && address && (
                    <div className="mt-4 rounded-2xl border border-gold-cg/20 bg-gold-cg/5 p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-[var(--text-input)]">{t("faucetTitle")}</p>
                                <p className="mt-1 text-xs text-[var(--text-muted)] dark:text-white">
                                    {t("faucetDescription")}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleFundWallet}
                                disabled={isFundingWallet}
                                className="shrink-0 rounded-full border border-gold-cg bg-gold-cg px-3 py-1.5 text-xs font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {t(isFundingWallet ? "funding" : "fund")}
                            </button>
                        </div>
                        {fundingFailure?.address === address.toLowerCase() && (
                            <div role="alert" className="mt-3 space-y-2 text-xs text-[var(--text-input)]">
                                <p>{t(fundingFailure.messageKey)}</p>
                                {fundingFailure.retryAfterSeconds && (
                                    <p>{t("fundRetryAfter", { seconds: fundingFailure.retryAfterSeconds })}</p>
                                )}
                                {fundingFailure.correlationId && (
                                    <>
                                        <p className="break-all">{t("fundReference", { reference: fundingFailure.correlationId })}</p>
                                        <button type="button" onClick={handleCopyFundingReference}
                                            className="rounded-full border border-[var(--swap-container-border)] px-3 py-1.5 font-medium hover:border-gold-cg">
                                            {t(fundingReferenceCopyStatus === "copied" ? "fundReferenceCopied" : "copyFundingReference")}
                                        </button>
                                        {fundingReferenceCopyStatus === "failed" && <p>{t("fundReferenceCopyFailed")}</p>}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {rpcUnavailable && (
                    <div className="mt-4 rounded-2xl border border-amber-300/70 bg-amber-50 p-4 dark:bg-amber-500/10">
                        <p className="text-sm font-medium text-amber-900 dark:text-white">{t("unavailable")}</p>
                        <p className="mt-1 text-xs text-amber-800 dark:text-white">
                            {t("unavailableDescription")}
                        </p>
                    </div>
                )}

                { isLoading && <p role="status" className="mt-3 text-xs text-[var(--text-input)]">{t("loading")}</p> }
                <div className="mt-4 space-y-2">
                        {orderedTokens.map(({ id, symbol: tokenSymbol, name: tokenName, decimals }) => {
                            const balance = balanceByTokenId.get(id);
                            const formatted = balance !== undefined ? formatUnits(balance, decimals) : undefined;
                            const amountNumber = formatted !== undefined ? Number(formatted) : undefined;
                            const roundedAmount = amountNumber !== undefined && Number.isFinite(amountNumber)
                                ? formatNumberWithCustomGrouping(amountNumber, locale, {
                                    minimumFractionDigits: 3,
                                    maximumFractionDigits: 3,
                                })
                                : formatted ?? "...";
                            const tokenPriceUsd = id === "cygld" ? cygldPriceUsd : prices?.[id];
                            const usdValueRaw = tokenPriceUsd !== undefined && formatted !== undefined
                                ? Number(formatted) * tokenPriceUsd
                                : undefined;
                            const usdValue = usdValueRaw !== undefined && Number.isFinite(usdValueRaw)
                                ? usdValueRaw
                                : undefined;
                            const importableToken = importableTokenById[id];
                            const isImportingThisToken = importingTokenId === id;
                            const wasRecentlyImported = recentlyImportedTokenIds[id] === true;
                            return (
                                <div
                                    key={id}
                                    className={`flex items-center justify-between gap-3 rounded-xl border p-3 hover:border-gold-cg ${id === "cygld"
                                        ? "border-gold-cg/40 bg-gold-cg/10"
                                        : "border-[var(--swap-container-border)] bg-[var(--background-input)]"}`}
                                    data-testid={`wallet-balance-row-${id}`}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="flex h-[22px] w-[22px] items-center justify-center">
                                            <Image
                                                src={resolveTokenImagePath(id, isDarkMode)}
                                                alt={`${tokenName} icon`}
                                                width={22}
                                                height={22}
                                                className="h-[22px] w-[22px] object-contain"
                                            />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-[var(--text-input)]" title={tokenName}>{tokenName}</p>
                                            <p
                                                className="text-xs font-medium text-[var(--text-input)]"
                                                data-testid={`wallet-balance-amount-${id}`}
                                            >
                                                {roundedAmount} {tokenSymbol}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <p className="whitespace-nowrap text-xs font-semibold text-black dark:text-white" data-testid={`wallet-balance-value-${id}`}
                                            title={balance !== undefined && usdValue === undefined && !(id === "cygld" ? isCygldPriceLoading : isPricesLoading)
                                                ? t("priceUnavailable") : undefined}>
                                            {formatApproxDisplayValue(usdValue) ?? "..."}
                                        </p>
                                        <WalletActionSlot>{importableToken && (
                                            <button
                                                type="button"
                                                onClick={() => void handleImportToken(id)}
                                                disabled={Boolean(importingTokenId) || wasRecentlyImported}
                                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                                    wasRecentlyImported
                                                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-white"
                                                        : "border border-[var(--swap-container-border)] text-[var(--text-input)] hover:border-gold-cg hover:text-gold-cg dark:text-white dark:hover:text-white"
                                                }`}
                                            >
                                                {t(isImportingThisToken ? "importing" : wasRecentlyImported ? "imported" : "import")}
                                            </button>
                                        )}</WalletActionSlot>
                                    </div>
                                </div>
                            );
                        })}
                </div>
                <LiquidityProviderPanel
                    expanded={isLiquidityExpanded}
                    onExpandedChange={setIsLiquidityExpanded}
                    liquidity={liquidity}
                    paxgPriceUsd={prices?.paxg}
                    cygldPriceUsd={cygldPriceUsd}
                    goldSpotUsdPerOzt={goldSpotUsdPerOzt}
                    formatValue={formatApproxDisplayValue}
                    isPricesLoading={isPricesLoading || isCygldPriceLoading}
                />
                <RecoverySharePortfolio holder={address} />
            </div>
        </dialog>
    );
}
