"use client";
import { publicEnv } from "../config/publicEnvironment.ts";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
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
import { type erc20Token, type spendableToken } from "../config/tokens";
import { targetChainId } from "../config/chain";
import { useProtocolConfiguration } from "../context/protocolConfigurationContext";
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
import { WalletBalanceRow, WalletPanelFrame } from "./walletPresentation";
import { useLiquidityPositions } from "../hooks/useLiquidityPositions";
import { faucetFailureFeedback, faucetResponseError, FaucetRequestError, type FaucetFailureFeedback } from "../utils/faucetErrors";
import { useWalletDisplayCache } from "../hooks/useWalletDisplayCache";
import { parseWalletPresentationSnapshot, walletPresentationStorageKey } from "../utils/walletPresentationSnapshot";
import { tradeDisplayScopeKey } from "../utils/tradeDisplaySnapshot";
import { mergeWalletDisplayBalances, parseWalletDisplayBalances, parseWalletLiquidityDisplay,
    projectWalletDisplayBalances, walletDisplayBalance, walletDisplayCacheKey } from "../utils/walletDisplayCache";

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
    const { tokens, displayTokens } = useProtocolConfiguration();
    const locale = useLocale();
    const t = useTranslations("WalletBalances");
    const titleId = useId();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const {
        formatFiat,
        formatGoldAmount,
        selectedCurrency,
        selectedGoldUnit,
        selectedPriceDisplayMode,
        fxFetchedAt,
        isFxStale,
        isFxLoading,
    } = useCurrency();
    const isDarkMode = useIsDarkMode();
    const { importedTokens } = useImportedTokens();
    const allTokens = useMemo(() => [...new Map([...displayTokens, ...importedTokens].map(token => [token.id, token])).values()], [displayTokens, importedTokens]);
    const { address, isConnected, connector } = useObservedWalletAccount();
    const savedPresentation = useWalletDisplayCache(walletPresentationStorageKey(targetChainId, locale), parseWalletPresentationSnapshot);
    const presentationScope = tradeDisplayScopeKey({ chainId: targetChainId, locale, currency: selectedCurrency,
        goldUnit: selectedGoldUnit, priceDisplayMode: selectedPriceDisplayMode });
    const presentation = savedPresentation?.address.toLowerCase() === address?.toLowerCase()
        && savedPresentation?.scopeKey === presentationScope ? savedPresentation : undefined;
    const { balances, isRefreshing: areTokensRefreshing, rpcUnavailable, refreshWalletBalances } = useTokenWalletBalances(importedTokens);
    const orderedTokens = useMemo(() => {
        const priority = (id: string) => id === "eth" ? 0 : id === "cygld" ? 1 : 2;
        return allTokens.filter((token): token is spendableToken => token.type !== "basket")
            .sort((left, right) => priority(left.id) - priority(right.id));
    }, [allTokens]);
    const balanceByTokenId = useMemo(() => {
        return new Map(balances.map(({ id, balance }) => [id, balance]));
    }, [balances]);
    const observedDisplayBalances = useMemo(() => projectWalletDisplayBalances(orderedTokens, balances), [orderedTokens, balances]);
    const displayBalances = useWalletDisplayCache(walletDisplayCacheKey(targetChainId, address, "balances"),
        parseWalletDisplayBalances, observedDisplayBalances, mergeWalletDisplayBalances);
    const recovery = useRecoverySharePortfolio(address);
    const [isLiquidityExpanded, setIsLiquidityExpanded] = useState(false);
    useEffect(() => {
        try { setIsLiquidityExpanded(window.sessionStorage.getItem("cg:wallet-liquidity-open:v1") === "true"); } catch { /* optional display preference */ }
        const restore = (event: Event) => setIsLiquidityExpanded((event as CustomEvent<boolean>).detail);
        window.addEventListener("wallet-display-liquidity", restore);
        return () => window.removeEventListener("wallet-display-liquidity", restore);
    }, []);
    const changeLiquidityExpanded = (expanded: boolean) => {
        setIsLiquidityExpanded(expanded);
        try { window.sessionStorage.setItem("cg:wallet-liquidity-open:v1", String(expanded)); } catch { /* optional display preference */ }
    };
    const liquidity = useLiquidityPositions(address, isOpen);
    const observedLiquidityDisplay = useMemo(() => liquidity.data ? {
        positionCount: liquidity.data.positions.length, paxgAmount: liquidity.data.paxgAmount, cygldAmount: liquidity.data.cygldAmount,
    } : undefined, [liquidity.data]);
    const liquidityDisplay = useWalletDisplayCache(walletDisplayCacheKey(targetChainId, address, "liquidity"),
        parseWalletLiquidityDisplay, observedLiquidityDisplay);
    const isRefreshing = areTokensRefreshing || recovery.isRefreshing;
    const refreshBalances = async () => {
        await Promise.allSettled([
            refreshWalletBalances(), recovery.refetch(),
            liquidity.refetch(),
        ]);
    };
    const { basket, cygldRefGrams } = useBasketData();
    const {
        ouncePrice: goldSpotUsdPerOzt,
        fetchedAt: goldPriceFetchedAt,
        isStale: isGoldPriceStale,
        isLoading: isGoldPriceLoading,
    } = useGoldPrice();
    const cygldReferencePriceUsd = getUsdPriceFromGoldReference({
        goldRefGramsFp18: cygldRefGrams.data,
        goldSpotUsdPerOzt,
    });
    const isCygldPriceLoading = isGoldPriceLoading || cygldRefGrams.isLoading;
    const goldReferenceGramsByTokenId = useMemo(
        () => buildGoldReferenceGramsByTokenId(basket.data),
        [basket.data]
    );
    const displayPriceOverrides = useMemo(() => ({ cygld: cygldReferencePriceUsd }), [cygldReferencePriceUsd]);
    const { displayPrices, isLoading: isPricesLoading } = useTokenUsdPrices(allTokens, {
        goldSpotUsdPerOzt,
        goldReferenceGramsByTokenId,
    }, displayPriceOverrides);
    const [showFullAddress, setShowFullAddress] = useState(false);
    const restoredAddress = useRef<string | undefined>(undefined);
    useLayoutEffect(() => {
        const accountKey = address?.toLowerCase();
        if (restoredAddress.current === accountKey) return;
        restoredAddress.current = accountKey;
        setShowFullAddress(presentation?.showFullAddress === true);
    }, [address, presentation?.showFullAddress]);
    useEffect(() => {
        const restore = (event: Event) => setShowFullAddress((event as CustomEvent<boolean>).detail);
        window.addEventListener("wallet-display-address", restore);
        return () => window.removeEventListener("wallet-display-address", restore);
    }, []);
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

    const importableTokenById = useMemo(() => {
        return [...tokens, ...importedTokens].reduce<Record<string, erc20Token>>((acc, token) => {
            if (token.type === "erc20") {
                acc[token.id] = token;
            }
            return acc;
        }, {});
    }, [tokens, importedTokens]);

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
            <WalletPanelFrame titleId={titleId} networkName={networkName} address={address}
                showFullAddress={showFullAddress} isCopied={isCopied} isRefreshing={isRefreshing}
                isDisconnecting={isDisconnecting} onNetworkChange={onNetworkChange}
                onRefresh={() => void refreshBalances()} onDisconnect={onDisconnect} onClose={onClose}
                onCopyAddress={() => void handleCopyAddress()} onToggleFullAddress={() => setShowFullAddress((prev) => !prev)}>
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

                <div className="mt-4 space-y-2">
                        {orderedTokens.map(token => {
                            const { id, symbol: tokenSymbol, name: tokenName, decimals } = token;
                            const liveBalance = balanceByTokenId.get(id);
                            const balance = liveBalance ?? walletDisplayBalance(token, displayBalances);
                            const formatted = balance !== undefined ? formatUnits(balance, decimals) : undefined;
                            const amountNumber = formatted !== undefined ? Number(formatted) : undefined;
                            const roundedAmount = amountNumber !== undefined && Number.isFinite(amountNumber)
                                ? formatNumberWithCustomGrouping(amountNumber, locale, {
                                    minimumFractionDigits: 3,
                                    maximumFractionDigits: 3,
                                })
                                : formatted ?? "...";
                            const tokenPriceUsd = displayPrices[id];
                            const usdValueRaw = balance === 0n ? 0 : tokenPriceUsd !== undefined && formatted !== undefined
                                ? Number(formatted) * tokenPriceUsd : undefined;
                            const usdValue = usdValueRaw !== undefined && Number.isFinite(usdValueRaw)
                                ? usdValueRaw
                                : undefined;
                            const previousRow = presentation?.rows.find(row => row.tokenId === id);
                            const importableToken = importableTokenById[id];
                            const isImportingThisToken = importingTokenId === id;
                            const wasRecentlyImported = recentlyImportedTokenIds[id] === true;
                            const importState = importableToken ? isImportingThisToken ? "importing" : wasRecentlyImported ? "imported" : "import"
                                : previousRow?.importState ?? "import";
                            return (
                                <WalletBalanceRow key={id} tokenId={id} tokenName={tokenName} tokenSymbol={tokenSymbol}
                                    amountText={balance === undefined && previousRow ? previousRow.amount : `${roundedAmount} ${tokenSymbol}`}
                                    valueText={formatApproxDisplayValue(usdValue) ?? previousRow?.value ?? "..."}
                                    valueTitle={balance !== undefined && usdValue === undefined && !(id === "cygld" ? isCygldPriceLoading : isPricesLoading)
                                        ? t("priceUnavailable") : undefined} isDarkMode={isDarkMode}>
                                        {(importableToken || previousRow?.importLabel) && (
                                            <button
                                                type="button"
                                                onClick={() => void handleImportToken(id)}
                                                data-wallet-import={importState}
                                                disabled={!importableToken || Boolean(importingTokenId) || wasRecentlyImported}
                                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed ${
                                                    importState === "imported"
                                                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-white"
                                                        : "border border-[var(--swap-container-border)] text-[var(--text-input)] hover:border-gold-cg hover:text-gold-cg dark:text-white dark:hover:text-white"
                                                }`}
                                            >
                                                {importableToken ? t(importState) : previousRow?.importLabel}
                                            </button>
                                        )}
                                </WalletBalanceRow>
                            );
                        })}
                </div>
                <LiquidityProviderPanel
                    expanded={isLiquidityExpanded}
                    onExpandedChange={changeLiquidityExpanded}
                    liquidity={liquidity}
                    cachedDisplay={liquidityDisplay}
                    cachedValues={presentation?.liquidity?.values}
                    paxgPriceUsd={displayPrices.paxg}
                    cygldPriceUsd={displayPrices.cygld}
                    goldSpotUsdPerOzt={goldSpotUsdPerOzt}
                    formatValue={formatApproxDisplayValue}
                    isPricesLoading={isPricesLoading || isCygldPriceLoading}
                />
                <RecoverySharePortfolio holder={address} />
            </WalletPanelFrame>
        </dialog>
    );
}
