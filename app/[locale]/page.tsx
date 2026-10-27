'use client';
import { isEconomicQuote, type SelectedExactInputQuote } from "@/app/utils/economicQuotes";
import { ExactInputRetentionDisclosure, ExactInputSettlement } from "@/app/components/ExactInputSettlement";
import { useQuoteCacheScope } from "@/app/context/chainHeadContext";
import { useCachedTradeQuote } from "@/app/hooks/flows/quotes/useCachedTradeQuote";
import { useTradeModel } from "@/app/hooks/flows/quotes/useTradeModel";
import { useTradeFlow } from "@/app/hooks/flows/useTradeFlow";
import { captureTradeQuote, type TradeQuoteResult, type TradeQuoteRequest } from "@/app/utils/tradeQuote";
import { fetchBasketMax, type BasketMax } from "@/app/utils/basketMax";
import { observeTradeSelection } from "@/app/utils/tradeSelectionObservation";
import { tradeReceipt, type TradeReceipt } from "@/app/utils/tradeReceipt";
import { useLocalBasketModel } from "@/app/hooks/flows/quotes/useLocalBasketModel";
import { localBasketQuote } from "@/app/utils/localBasketQuote";
import { cygldPurchaseCapacity, cygldBasketPurchaseAmount, formatCygldCapacity } from "@/app/utils/cygldSupply";
import { adapterApprovalFromFacts, adapterCodePresentFromFacts, fetchHelpersRouterFacts } from "../utils/helpersRouterFacts";
import { useProtocolConfiguration } from "../context/protocolConfigurationContext";
import { useTokenPickerPresentation } from "../context/tokenPickerPresentationContext";
import { requireProtocolAddress } from "../utils/protocolConfiguration";
import { targetChainId, targetChainName } from "../config/chain";
import { waitForAppTransactionReceipt } from "@/app/utils/receiptWait";
import { useWalletAtomicStatus } from "@/app/hooks/useWalletAtomicStatus";
import { type WalletBatchSubmission, type WalletSwapBatch } from "@/app/utils/walletBatch";
import { prepareWalletSwapBatch, reportWalletRequestBatchDiagnostic, WalletRequestBatchStoppedError } from "@/app/utils/metaMaskRequestBatch";
import { resolveActiveProvider } from "@/app/utils/ethereumProvider";

import { ExecutionToleranceControl } from "@/app/components/executionToleranceControl";
import Image from "next/image";
import { toast } from "sonner";
import { FaBasketShopping } from "react-icons/fa6";
import { Spinner } from "@/components/ui/spinner";
import { useMemo, useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { TradeDisplayBootstrap, TradeBasketPresentationRow, finishTradeDisplayBootstrap, subscribeTradeDisplayInput, subscribeTradeDisplayFees } from "../components/tradeDisplayBootstrap";
import { readStoredTradeDisplayScope, readTradeDisplaySnapshot, tradeDisplayIntentKey,
  tradeDisplayScopeKey, tradeDisplaySnapshotStorageKey, writeTradeDisplaySnapshot,
  type TradeDisplaySnapshot, type TradeBasketDisplayRow } from "../utils/tradeDisplaySnapshot";
import { readSwapFeePreferences, writeSwapFeePreferences } from "../utils/swapFeePreferences";
import { useTransactionFees } from "@/app/hooks/useTransactionFees";
import { useRetainedQuoteDisplay } from "@/app/hooks/flows/quotes/useRetainedQuoteDisplay";
import { useQuoteDiagnostics } from "@/app/hooks/useQuoteDiagnostics";
import { DiagnosticReference } from "@/app/components/diagnosticReference";
import { diagnosticReference, diagnosticReferences } from "@/app/utils/diagnosticReferences";
import { createSwapDiagnostics, diagnosticReason, swapFailureOutcome } from "@/app/utils/clientDiagnostics";
import { useChainId, usePublicClient, useWalletClient } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { type erc20Token, type spendableToken } from ".././config/tokens";
import { useTokenUsdPrices } from ".././hooks/useTokenUsdPrices";
import { useTokenWalletBalances } from ".././hooks/useTokenWalletBalances";
import { useImportedTokens } from "../hooks/useImportedTokens";
import { checkSwapWalletBalances } from "../utils/walletBalanceSnapshot";
import { nativeSellMaxAmount } from "../utils/nativeSellMaxAmount";
import { useGoldPrice } from ".././hooks/useGoldPrice";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useObservedWalletAccount } from "../hooks/useObservedWalletAccount";
import { useWalletPresentationAddress } from "../hooks/useWalletPresentationRestoring";
import { useIsDarkMode } from "../hooks/useIsDarkMode";
import { useIssueFromBasketExactInFlow } from "../hooks/flows/useIssueFromBasketExactInFlow";
import { useRedeemToBasketExactInFlow } from "../hooks/flows/useRedeemToBasketExactInFlow";
import { useIsAdapterApproved } from "../hooks/cybergold-helpers/useIsAdapterApproved";
import { tokenFlowAdapterState } from "../utils/tokenFlowAdapterState";
import type { WalletConfirmationTracker } from "../hooks/flows/shared/types";
import { TokenPickerModal } from ".././components/tokenPickerModal";
import { MarketDataFreshnessNotice } from "../components/marketDataFreshnessNotice";
import { QuotePreviewError, quoteErrorMessage } from "../utils/quoteErrors";
import { purchaseBudgetAmounts } from "../utils/tradeBudget";
import { SwapTransactionNotice, type SwapTransactionNoticeProps } from "../components/swapTransactionNotice";
import { FaChevronDown } from "react-icons/fa";
import { LuArrowDownUp } from "react-icons/lu";
import { useLocale, useTranslations } from 'next-intl';
import { useBasketData } from "../hooks/cybergold/useBasketData";
import { useRecoverySharePortfolio } from "../hooks/cybergold/useRecoverySharePortfolio";
import { RecoveryShareAmount } from "../components/recoveryShareAmount";
import { useCurrency } from "../context/currencyContext";
import {
  NetworkFeeEstimate,
  BasketComponent,
  TokenIssueQuoteStatus as AsyncStatus,
  Prefill,
} from "../types";
import { formatUnits, formatEther, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { formatMeaningfulDecimalString, normalizeDecimalInput, formatNumberWithSpaces, formatWalletBalanceAmount, formatAmount, formatPpmAsPercent, truncateDecimalString, formatDecimalInputForCursor, getLocaleDecimalSeparator } from "../utils/formatting";
import { useHelperFeePpm } from "../hooks/cybergold-helpers/useHelperFeePpm";
import { useIssuanceFeePpm } from "../hooks/cybergold/useIssuanceFeePpm";
import { useProtocolFact, useProtocolFacts } from "../hooks/protocol/useProtocolFacts";
import { issuanceModelFromFacts } from "../utils/protocolFacts";
import { GAS_POLICY, DEFAULT_SLIPPAGE_BPS } from "../utils/swapPolicy";
import { deriveBasketComponentsAmountsFromSingleInput, proportionalBasketWalletMax } from "../utils/basketAmounts";
import { basketAmountsMapToOrderedBigIntArray, basketAmountsMapToStringMap } from "../utils/basketAmounts";
import { parseDisplayNumber, parseInputToBigInt } from "../utils/numberParsing";
import { buildBasketFromProtocolData } from "../utils/buildBasketFromProtocolData";
import { getEtherscanBaseUrl } from "../utils/getEtherscanBaseUrl";
import { findWalletBalanceByTokenId, isBasketComponentAmountOverWalletBalance as isBasketComponentAmountOverBalance } from "../utils/walletBalances";
import { computeBasketSideUsdTotal } from "../utils/basketUsdTotal";
import { computeTotalFeeUsd } from "../utils/feeUsdTotal";
import { buildGoldReferenceGramsByTokenId, getUsdPriceFromGoldReference } from "../utils/goldReferencePricing";
import { resolveFlowState } from "../utils/resolveFlowState";
import { resolveTokenImagePath } from "../utils/tokenImages";
import {
  buildCombinedDisplayValuePlaceholder,
  buildDisplayValuePlaceholder,
  formatCombinedDisplayValueFromUsd,
  formatDisplayValueFromUsd,
} from "../utils/priceDisplay";
import {
  readPersistedSwapFormState,
  writePersistedSwapFormState,
} from "../utils/swapFormState";
import { cn } from "@/lib/utils";
import {
  EXPECTED_CHAIN_ID,
  assertWalletOnExpectedChain,
} from "../utils/expectedChain";

type WalletConfirmationProgressState = {
  current: number;
  total: number;
  label: string;
};

function clampProgressPercent(value?: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getProgressPercentFromCounts(progress?: { completed: number; total: number }) {
  if (!progress) {
    return undefined;
  }

  if (progress.total <= 0) {
    return 0;
  }

  return clampProgressPercent((progress.completed / progress.total) * 100) ?? 0;
}

function useQuoteFailureToast(params: {
  enabled: boolean;
  status: AsyncStatus;
  error?: string;
  onFailure: () => void;
}) {
  const { enabled, status, error, onFailure } = params;
  const t = useTranslations("Home");
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || status !== "failed" || !error) {
      if (!enabled || status !== "failed") {
        lastErrorRef.current = null;
      }
      return;
    }

    if (lastErrorRef.current === error) {
      return;
    }

    lastErrorRef.current = error;
    // Capacity feedback belongs beside the CYGLD amount, without a second popup.
    if (error !== t("quoteIssuanceCapExceeded")) {
      toast.error(t("quoteFailed"), { description: error });
    }
    onFailure();
  }, [enabled, error, onFailure, status, t]);
}

const EMPTY_PREFILL: Prefill = {
  main: "",
  mainRaw: 0n,
  components: [],
  componentRaws: [],
};

function isNativeOrErc20Token(token: { type: string } | undefined): token is spendableToken {
  return token !== undefined && token.type !== "basket";
}

function isNativeEthToken(token: { id: string; type: string } | undefined) {
  return token?.type === "native" && token.id === "eth";
}

// Uniswap quotes use WETH for native ETH routes.
function resolveTokenQuoteAddress(token: { id: string; type: string; address?: `0x${string}` } | undefined, wrappedNative?: Address): Address | undefined {
  if (!token) return undefined;
  if (token.type === "erc20" && token.address) return token.address;
  if (isNativeEthToken(token)) return wrappedNative;
  return undefined;
}

// Shared presentation styles for both sides of the swap form.
const swapStyles = {
  amountBox:
    "p-3 sm:p-4 bg-background-swap border border-swap-container-border rounded-2xl transition-shadow duration-100",
  basketSummary:
    "w-full p-1 text-left rounded-md focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
  basketValue:
    "hidden text-xs text-text-minor-data tabular-nums sm:mt-1 sm:block",
  tokenPicker:
    "flex w-32 shrink-0 items-center space-x-2 sm:w-44 sm:space-x-3 p-2 shadow-sm bg-background-swap border border-swap-container-border rounded-xl hover:border-gold-cg/30 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  tokenValueRow:
    "mt-2 flex items-center justify-end gap-3 text-xs tabular-nums sm:justify-between",
  maxButton:
    "inline-flex h-5 w-14 shrink-0 items-center justify-center px-2 tracking-[0.12em] text-text-input rounded-full transition-colors hover:bg-gold-cg/15 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  basketBox:
    "mt-3 p-2 text-sm bg-background-swap border border-swap-container-border rounded-2xl",
  basketHeader:
    "flex items-center justify-between gap-2 p-1 border-b border-swap-container-border",
  basketRow:
    "grid grid-cols-[minmax(0,104px)_minmax(0,1fr)] items-center gap-2 p-2 text-xs sm:grid-cols-[104px_minmax(132px,170px)_minmax(0,1fr)]",
  feeValue:
    "min-w-0 break-words text-right font-semibold tabular-nums text-text-input",
  amountInput:
    "min-w-0 w-full rounded-md pl-1 pr-2 sm:pr-6 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring tabular-nums text-base sm:text-3xl font-semibold",
  amountOutput:
    "block min-w-0 w-full break-words pl-1 pr-2 sm:pr-6 select-text cursor-default tabular-nums text-base sm:text-3xl font-semibold",
  basketInput:
    "block min-w-0 w-full rounded-md border border-swap-container-border bg-background-swap p-2 text-start text-sm tabular-nums editable-caret transition-colors focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  basketOutput:
    "block min-w-0 w-full break-words p-2 text-start text-sm tabular-nums select-text cursor-default",
} as const;

function SwapTokenBalance({ text, label, side }: { text: string; label: string; side: "sell" | "buy" }) {
  return <span hidden={!text} role="note" data-testid={text ? `${side}-wallet-balance` : undefined} data-trade-display={`${side}Balance`}
    className="block min-w-0 truncate text-text-minor-data" title={text ? label : undefined} aria-label={text ? label : undefined}>{text}</span>;
}

export default function Home() {
  const locale = useLocale();
  return <TradeDisplayBootstrap chainId={EXPECTED_CHAIN_ID} locale={locale}><TradingScreen /></TradeDisplayBootstrap>;
}

function TradingScreen() {
  const { addresses, tokens, displayTokens, tokenAddresses, identity: configurationIdentity,
    isLoading: isConfigurationLoading, isRefreshing: isConfigurationRefreshing } = useProtocolConfiguration();
  const HELPERS_DIAMOND_ADDRESS = addresses.helpers;
  const observedQuoteScope = useQuoteCacheScope();

  // Configuration and market data.
  const cygldTokenId = "cygld";
  const cygldDecimals = tokens.find((token): token is erc20Token => token.id === cygldTokenId)?.decimals || 18;
  const QUOTE_INPUT_DEBOUNCE_MS = 100;

  const t = useTranslations('Home');
  const walletBalancesT = useTranslations("WalletBalances");
  const marketT = useTranslations("MarketSwap");
  const locale = useLocale();
  const isDarkMode = useIsDarkMode();
  const localeDecimalSeparator = useMemo(
    () => getLocaleDecimalSeparator(locale),
    [locale]
  );
  const zeroAmountPlaceholder = `0${localeDecimalSeparator}0`;
  const loadingAmountPlaceholder = "...";

  const { data: helperFeePpm } = useHelperFeePpm();
  const { data: issuanceFeePpm } = useIssuanceFeePpm();
  const coreHelperFeePercent = formatPpmAsPercent(helperFeePpm);
  const issuanceFeePercent = formatPpmAsPercent(issuanceFeePpm);

  const {
    formatFiat,
    formatGoldAmount,
    selectedCurrency,
    selectedGoldUnit,
    selectedPriceDisplayMode,
    fxFetchedAt,
    isFxStale,
    isFxLoading,
    isFxRefreshing,
  } = useCurrency();
  const displayAmountPlaceholder = buildDisplayValuePlaceholder({
    zeroAmountPlaceholder: loadingAmountPlaceholder,
    priceDisplayMode: selectedPriceDisplayMode,
    selectedCurrency,
    selectedGoldUnit,
    locale,
  });
  const amountEquivalentsPlaceholder = buildCombinedDisplayValuePlaceholder({
    zeroAmountPlaceholder: loadingAmountPlaceholder,
    selectedCurrency,
    selectedGoldUnit,
    locale,
  });
  const loadingAmountEquivalentsPlaceholder = buildCombinedDisplayValuePlaceholder({
    zeroAmountPlaceholder: loadingAmountPlaceholder,
    selectedCurrency,
    selectedGoldUnit,
    locale,
  });
  const {
    price: goldPriceUsdPerGram,
    ouncePrice: goldSpotUsdPerOzt,
    fetchedAt: goldPriceFetchedAt,
    isStale: isGoldPriceStale,
    isLoading: isGoldPriceLoading,
    isRefreshing: isGoldPriceRefreshing,
  } = useGoldPrice();

  const { address, isConnected, chainId: walletChainId, connector } = useObservedWalletAccount();
  const restoringWalletAddress = useWalletPresentationAddress() ?? "";
  useRecoverySharePortfolio(address);
  const configuredChainId = useChainId();
  // Account observations can precede a connector; preserve the configured-chain fallback.
  const connectedChainId = walletChainId ?? configuredChainId;
  const publicClient = usePublicClient({ chainId: EXPECTED_CHAIN_ID });
  const { data: walletClient } = useWalletClient();
  const walletAtomic = useWalletAtomicStatus(walletClient, isConnected ? address : undefined);
  const { openConnectModal } = useConnectModal();

  const applyLocalizedInputValue = useCallback(
    (
      input: HTMLInputElement,
      rawValue: string,
      setter: (value: string) => void
    ) => {
      const { value, selectionStart } = formatDecimalInputForCursor(
        rawValue,
        locale,
        input.selectionStart
      );
      setter(value);
      // Restore the caret after React applies the localized input value.
      requestAnimationFrame(() => {
        if (document.activeElement === input) {
          input.setSelectionRange(selectionStart, selectionStart);
        }
      });
    },
    [locale]
  );

  const { importedTokens, importToken } = useImportedTokens();
  const allTokens = useMemo(() => [...tokens, ...importedTokens], [tokens, importedTokens]);
  // Cached selector metadata can paint the form; funding and quotes use allTokens above.
  const displayAllTokens = useMemo(() => [...displayTokens, ...importedTokens], [displayTokens, importedTokens]);
  const resolveImportedToken = useCallback((token: Address, signal: AbortSignal) => importToken(token, isConnected ? address : undefined, signal), [importToken, isConnected, address]);
  const { balances, nonZeroBalances, isLoading: isWalletBalancesLoading, refreshWalletBalances, readWalletBalancesForSwap } = useTokenWalletBalances(importedTokens);

  const { basket, cygldRefGrams } = useBasketData();
  const basketReadFailed = basket.isError;
  const cygldReferencePriceUsd = getUsdPriceFromGoldReference({
    goldRefGramsFp18: cygldRefGrams.data,
    goldSpotUsdPerOzt,
  });
  const cygldPriceUsd = cygldReferencePriceUsd ?? (cygldRefGrams.isError ? goldPriceUsdPerGram : undefined);
  const { data: protocolPaused, refetch: refreshProtocolFacts } = useProtocolFact(facts => facts.pause, {
    retry: 1,
  });
  const { data: protocolFacts } = useProtocolFacts();
  const isProtocolPaused = protocolPaused === true;

  const announceTransactionSuccess = useCallback((hash?: Hex) => {
    void refreshProtocolFacts();
    const explorerBaseUrl = getEtherscanBaseUrl();
    const txUrl = explorerBaseUrl && hash ? `${explorerBaseUrl}/tx/${hash}` : undefined;

    toast.success(t("transactionConfirmed"), {
      action: txUrl
        ? {
            label: t("viewTransaction"),
            onClick: () => window.open(txUrl, "_blank", "noopener,noreferrer"),
          }
        : undefined,
    });
  }, [refreshProtocolFacts, t]);

  const confirmTransaction = useCallback(async (
    hash: Hex
  ) => {
    const receipt = publicClient ? await waitForAppTransactionReceipt(publicClient, { hash }) : undefined;
    if (!receipt || receipt.status !== "success") {
      const error = new Error("Transaction failed");
      error.name = receipt?.status === "reverted" ? "TransactionRevertedError" : "ReceiptUnavailableError";
      throw error;
    }
    announceTransactionSuccess(hash);
    return receipt;
  }, [announceTransactionSuccess, publicClient]);

  // Form state.
  const [showOnlyWalletTokens, setShowOnlyWalletTokens] = useState(false);
  const [sellAmount, setSellAmount] = useState("");
  // Preserve exact MAX balances while displaying shortened decimal amounts.
  const [sellAmountRawOverride, setSellAmountRawOverride] = useState<bigint | undefined>(undefined);
  const [driverAmountRawOverride, setDriverAmountRawOverride] = useState<bigint | undefined>(undefined);
  const [basketMaxAmounts, setBasketMaxAmounts] = useState<BasketMax>();
  const { isSellModalOpen, setIsSellModalOpen, isBuyModalOpen, setIsBuyModalOpen } = useTokenPickerPresentation();
  // The driver is the editable basket component used to derive the other amounts.
  const [driverToken, setDriverToken] = useState<Address | undefined>(undefined);
  const [driverAmountStr, setDriverAmountStr] = useState<string>("");
  const [displayedQuoteProgressPercent, setDisplayedQuoteProgressPercent] = useState(0);
  const [isSubmittingSwap, setIsSubmittingSwap] = useState(false);
  const [frozenTrade, setFrozenTrade] = useState<TradeQuoteResult>();
  const [frozenUniversal, setFrozenUniversal] = useState<SelectedExactInputQuote>();
  const [swapFailureReference, setSwapFailureReference] = useState<string>();
  const [isSubmittedSwapCleanupInProgress, setIsSubmittedSwapCleanupInProgress] = useState(false);
  const [transactionNotice, setTransactionNotice] = useState<SwapTransactionNoticeProps>();
  const [confirmedTrade, setConfirmedTrade] = useState<{ receipt: TradeReceipt; input?: spendableToken; output?: spendableToken }>();
  const [walletConfirmationProgress, setWalletConfirmationProgress] =
    useState<WalletConfirmationProgressState | undefined>(undefined);
  const [hasHydratedPersistedSwapForm, setHasHydratedPersistedSwapForm] = useState(false);
  const [restoredTradeDisplay, setRestoredTradeDisplay] = useState<TradeDisplaySnapshot>();
  const latestTradeDisplay = useRef<TradeDisplaySnapshot | undefined>(undefined);

  const mainSellInputRef = useRef<HTMLInputElement | null>(null);
  const sellMaxRequestRef = useRef(0);
  const basketMaxRequestRef = useRef(0);
  const basketMaxAbortRef = useRef<AbortController | null>(null);
  const sellTokenPickerRef = useRef<HTMLButtonElement | null>(null);
  const buyTokenPickerRef = useRef<HTMLButtonElement | null>(null);
  const basketSellInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const shouldFocusEditableInputRef = useRef(false);
  const hasRestoredPersistedSwapFormRef = useRef(false);
  // Refs keep consecutive wallet steps in sync before the next React render.
  const walletConfirmationCurrentStepRef = useRef(0);
  const walletConfirmationTotalStepsRef = useRef(0);

  // Flows supply a simulated fee once the execution payload is ready.
  const [executionNetworkFeeEstimate, setNetworkFeeEstimate] = useState<NetworkFeeEstimate | null>(null);
  const [isExecutionFeeEstimateLoading, setIsNetworkFeeEstimateLoading] = useState(false);
  const [isFeeDetailsOpen, setIsFeeDetailsOpen] = useState(false);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);

  // Basket data and token choices.
  const basketWithGoldTokens = useMemo(() => {
   return buildBasketFromProtocolData(basket.data);
  }, [basket.data]);

  const basketComponents = useMemo(() => basketWithGoldTokens?.components ?? [], [basketWithGoldTokens]);
  const hasBasketComponents = basketComponents.length > 0;
  const goldReferenceGramsByTokenId = useMemo(
    () => buildGoldReferenceGramsByTokenId(basket.data),
    [basket.data]
  );

  const tokensListWithBasket = useMemo(() => {
    if (!basketWithGoldTokens || !hasBasketComponents) return allTokens;
    return [basketWithGoldTokens, ...allTokens];
  }, [basketWithGoldTokens, hasBasketComponents, allTokens]);
  const displayTokensWithBasket = useMemo(() => basketWithGoldTokens && hasBasketComponents
    ? [basketWithGoldTokens, ...displayAllTokens] : displayAllTokens,
    [basketWithGoldTokens, hasBasketComponents, displayAllTokens]);

  // Distinguish failed basket reads from successful reads with no usable basket.
  const basketMissingAfterRead = basket.isFetched && !basket.isLoading && !basket.isError && !basketWithGoldTokens;
  const shouldShowBasketWarning = basketReadFailed || basketMissingAfterRead;
  const basketWarningClassName = cn(
    "mb-4 p-3 text-center text-xs font-medium bg-amber-50 text-text-amber border-text-amber rounded-2xl",
    "dark:bg-amber-900/20 dark:border-amber-900/40"
  );

  const goldBasketId: string = basketWithGoldTokens?.id || "goldbasket";

  const defaultSellTokenId = "eth";

  const [sellTokenId, setSellTokenId] = useState<string>(defaultSellTokenId);
  const [buyTokenId, setBuyTokenId] = useState<string>(cygldTokenId);
  const sellToken = tokensListWithBasket.find((token) => token.id === sellTokenId);
  const buyToken = tokensListWithBasket.find((token) => token.id === buyTokenId);
  const tokenAddressMap = useMemo(() => {
    const tokenMap = new Map<string, erc20Token>();
    for (const token of allTokens) {
      if (token.type === "erc20") {
        tokenMap.set(token.address.toLowerCase(), token);
      }
    }
    return tokenMap;
  }, [allTokens]);
  const isSellTokenSpendable = isNativeOrErc20Token(sellToken);
  const isBuyTokenSpendable = isNativeOrErc20Token(buyToken);
  const isSellTokenNative = sellToken?.type === "native" && sellToken.id === "eth";
  const isBuyTokenNative = buyToken?.type === "native" && buyToken.id === "eth";
  const sellTokenQuoteAddress = resolveTokenQuoteAddress(sellToken, tokenAddresses.WETH);
  const buyTokenQuoteAddress = resolveTokenQuoteAddress(buyToken, tokenAddresses.WETH);
  const buyTokenDecimals = isBuyTokenSpendable ? buyToken.decimals : undefined;
  const sellTokenDecimals = isSellTokenSpendable ? sellToken.decimals : undefined;

  const tokensWithoutCygld = useMemo(
    () => displayTokensWithBasket.filter((token) => token.id !== cygldTokenId),
    [displayTokensWithBasket, cygldTokenId]
  );
  const buySelectableTokens = displayTokensWithBasket;

  // Protocol gold references override market prices for gold-backed assets.
  const displayPriceOverrides = useMemo(() => ({ cygld: cygldReferencePriceUsd }), [cygldReferencePriceUsd]);
  const { prices, displayPrices, isRefreshing: isTokenPricesRefreshing } = useTokenUsdPrices(tokensListWithBasket, {
    goldSpotUsdPerOzt,
    goldReferenceGramsByTokenId,
  }, displayPriceOverrides);
  const displayedCygldPriceUsd = displayPrices.cygld ?? cygldPriceUsd;
  const sellTokenPriceUsd = sellTokenId === cygldTokenId ? displayedCygldPriceUsd : displayPrices[sellTokenId];
  const buyTokenPriceUsd = buyTokenId === cygldTokenId ? displayedCygldPriceUsd : displayPrices[buyTokenId];
  const isDisplayRefreshing = isConfigurationRefreshing || isTokenPricesRefreshing || isGoldPriceRefreshing || isFxRefreshing;

  // Clear quote feedback while preserving entered values for a retry.
  const clearFailedQuoteFormState = useCallback(() => {
    setDisplayedQuoteProgressPercent(0);
    setNetworkFeeEstimate(null);
    setIsNetworkFeeEstimateLoading(false);
    shouldFocusEditableInputRef.current = true;
  }, []);

  // Clear submitted amounts while retaining the token pair.
  const clearSubmittedSwapFormState = useCallback(() => {
    setDriverToken(undefined);
    setDriverAmountStr("");
    setSellAmount("");
    setSellAmountRawOverride(undefined);
    setDriverAmountRawOverride(undefined);
    setBasketMaxAmounts(undefined);
    clearFailedQuoteFormState();
  }, [clearFailedQuoteFormState]);

  const resetWalletConfirmationProgress = useCallback(() => {
    walletConfirmationCurrentStepRef.current = 0;
    walletConfirmationTotalStepsRef.current = 0;
    setWalletConfirmationProgress(undefined);
  }, []);

  const walletConfirmationTracker = useMemo<WalletConfirmationTracker>(
    () => ({
      setTotal(total) {
        const safeTotal = Math.max(0, total);
        walletConfirmationCurrentStepRef.current = 0;
        walletConfirmationTotalStepsRef.current = safeTotal;
        setWalletConfirmationProgress({
          current: 0,
          total: safeTotal,
          label: "Preparing MetaMask confirmations",
        });
      },
      requestNext(_kind, label) {
        const nextCurrent = walletConfirmationCurrentStepRef.current + 1;
        const total = Math.max(
          walletConfirmationTotalStepsRef.current,
          nextCurrent
        );
        walletConfirmationCurrentStepRef.current = nextCurrent;
        walletConfirmationTotalStepsRef.current = total;
        setWalletConfirmationProgress({
          current: nextCurrent,
          total,
          label,
        });
      },
    }),
    []
  );

  useLayoutEffect(() => subscribeTradeDisplayInput((field, value, driver) => {
    if (field === "driverAmountStr") {
      if (driver) setDriverToken(driver);
      setBasketMaxAmounts(undefined);
      setDriverAmountRawOverride(undefined);
      setDriverAmountStr(normalizeDecimalInput(value, locale));
    } else {
      setSellAmountRawOverride(undefined);
      setSellAmount(normalizeDecimalInput(value, locale));
    }
  }), [locale]);

  useLayoutEffect(() => subscribeTradeDisplayFees(preferences => {
    if (preferences.detailsOpen !== undefined) setIsFeeDetailsOpen(preferences.detailsOpen);
    if (preferences.slippageBps !== undefined) setSlippageBps(preferences.slippageBps);
  }), []);

  // Restore stored values once so later locale or basket updates cannot replace user edits.
  useLayoutEffect(() => {
    if (hasRestoredPersistedSwapFormRef.current) {
      return;
    }
    hasRestoredPersistedSwapFormRef.current = true;

    const feePreferences = readSwapFeePreferences();
    setIsFeeDetailsOpen(feePreferences.detailsOpen ?? false);
    setSlippageBps(feePreferences.slippageBps ?? DEFAULT_SLIPPAGE_BPS);

    const persistedSwapFormState = readPersistedSwapFormState();
    setRestoredTradeDisplay(readTradeDisplaySnapshot(
      tradeDisplaySnapshotStorageKey(EXPECTED_CHAIN_ID, locale),
      tradeDisplayIntentKey(persistedSwapFormState ?? {}),
      tradeDisplayScopeKey(readStoredTradeDisplayScope(EXPECTED_CHAIN_ID, locale)),
    ));

    if (persistedSwapFormState) {
      setShowOnlyWalletTokens(persistedSwapFormState.showOnlyWalletTokens ?? false);
      setSellTokenId(persistedSwapFormState.sellTokenId || defaultSellTokenId);
      setBuyTokenId(persistedSwapFormState.buyTokenId ?? cygldTokenId);
      setSellAmount(
        normalizeDecimalInput(persistedSwapFormState.sellAmount ?? "", locale)
      );
      setDriverToken(persistedSwapFormState.driverToken);
      setDriverAmountStr(
        normalizeDecimalInput(persistedSwapFormState.driverAmountStr ?? "", locale)
      );
    }

    setHasHydratedPersistedSwapForm(true);
  }, [cygldTokenId, defaultSellTokenId, locale]);

  const walletTokenIds = useMemo(
    () => new Set(nonZeroBalances.map((balance) => balance.id)),
    [nonZeroBalances]
  );

  // The wallet must hold every component for the basket to pass the wallet-only filter.
  const basketAvailable = hasBasketComponents &&
    basketComponents.every((component) => walletTokenIds.has(component.token.id));

  const sellSelectableTokens = useMemo(() => {
    if (!isConnected || !showOnlyWalletTokens) return displayTokensWithBasket;
    const available = displayAllTokens.filter((token) => walletTokenIds.has(token.id));
    if (basketAvailable) {
      available.push(basketWithGoldTokens!);
    }
    return available;
  }, [
    showOnlyWalletTokens,
    isConnected,
    walletTokenIds,
    basketAvailable,
    displayTokensWithBasket,
    displayAllTokens,
    basketWithGoldTokens,
  ]);

  const persistedFormState = useMemo(() => {
    const persistedDriver = basketComponents.find(component => component.token.address === driverToken);
    return {
      showOnlyWalletTokens,
      sellAmount: sellAmountRawOverride !== undefined && isNativeOrErc20Token(sellToken)
        ? formatUnits(sellAmountRawOverride, sellToken.decimals).replace(".", getLocaleDecimalSeparator(locale)) : sellAmount,
      sellTokenId,
      buyTokenId,
      driverToken,
      driverAmountStr: driverAmountRawOverride !== undefined && persistedDriver
        ? formatUnits(driverAmountRawOverride, persistedDriver.token.decimals)
          .replace(".", getLocaleDecimalSeparator(locale)) : driverAmountStr,
    };
  }, [
    buyTokenId,
    driverAmountStr,
    driverToken,
    sellAmountRawOverride,
    sellToken,
    driverAmountRawOverride,
    basketComponents,
    locale,
    sellAmount,
    sellTokenId,
    showOnlyWalletTokens,
  ]);

  // Match the pre-paint display to the same canonical input draft that is saved.
  useLayoutEffect(() => {
    if (!hasHydratedPersistedSwapForm) return;
    writePersistedSwapFormState(persistedFormState);
    writeSwapFeePreferences({ detailsOpen: isFeeDetailsOpen, slippageBps });
  }, [hasHydratedPersistedSwapForm, persistedFormState, isFeeDetailsOpen, slippageBps]);

  const displayIntentKey = tradeDisplayIntentKey(persistedFormState);
  const displayScopeKey = tradeDisplayScopeKey({ chainId: EXPECTED_CHAIN_ID, locale,
    currency: selectedCurrency, goldUnit: selectedGoldUnit, priceDisplayMode: selectedPriceDisplayMode });
  const storedDisplayScopeKey = tradeDisplayScopeKey(readStoredTradeDisplayScope(EXPECTED_CHAIN_ID, locale));
  const savedTradeDisplay = latestTradeDisplay.current?.intentKey === displayIntentKey &&
    latestTradeDisplay.current.scopeKey === storedDisplayScopeKey ? latestTradeDisplay.current : restoredTradeDisplay;
  const matchingTradeDisplay = savedTradeDisplay?.intentKey === displayIntentKey &&
    savedTradeDisplay.scopeKey === storedDisplayScopeKey ? savedTradeDisplay : undefined;
  const cachedTradeDisplay = matchingTradeDisplay?.values;
  const cachedWalletMatches = Boolean(cachedTradeDisplay?.walletAddress &&
    (isConnected ? address?.toLowerCase() === cachedTradeDisplay.walletAddress :
      restoringWalletAddress.toLowerCase() === cachedTradeDisplay.walletAddress));
  const showWalletPresentation = isConnected || Boolean(restoringWalletAddress);
  const restoreFormattedDisplay = Boolean(cachedTradeDisplay && displayScopeKey !== storedDisplayScopeKey);

  // Keep the selected token label even if the wallet filter hides it from the options.
  const sellTokenOnTokenPicker = useMemo(
    () =>
      sellSelectableTokens.find((token) => token.id === sellTokenId) ??
      displayTokensWithBasket.find((token) => token.id === sellTokenId),
    [sellSelectableTokens, sellTokenId, displayTokensWithBasket]
  );

  // Selecting a receive asset sets the matching CYGLD side below.
  const buyTokenOnTokenPicker = useMemo(
    () => buySelectableTokens.find((token) => token.id === buyTokenId),
    [buySelectableTokens, buyTokenId]
  );
  const sellTokenDisplaySymbol = sellTokenOnTokenPicker?.symbol ?? cachedTradeDisplay?.sellSymbol ??
    (sellTokenId === goldBasketId ? t("basket") : sellTokenId ? sellTokenId.toUpperCase() : t("selectToken"));
  const buyTokenDisplaySymbol = buyTokenOnTokenPicker?.symbol ?? cachedTradeDisplay?.buySymbol ??
    (buyTokenId === goldBasketId ? t("basket") : buyTokenId ? buyTokenId.toUpperCase() : t("selectToken"));

  const derivedBasketAmountsAsBigIntMap = useMemo(
    () => basketMaxAmounts ? Object.fromEntries(basketComponents.map(component => [component.token.address,
      BigInt(basketMaxAmounts.maximumAmountsIn[basketMaxAmounts.orderedCoreAssets.findIndex(
        asset => asset.toLowerCase() === component.token.address.toLowerCase())] ?? "0"),
    ])) : deriveBasketComponentsAmountsFromSingleInput(basketComponents, driverToken, driverAmountStr, driverAmountRawOverride, locale),
    [basketMaxAmounts, basketComponents, driverToken, driverAmountStr, driverAmountRawOverride, locale]
  );

  // Preview amounts must follow the protocol's basket component order.
  const derivedBasketAmountsAsBigIntLst = useMemo(() => {
    return basketMaxAmounts ? basketMaxAmounts.maximumAmountsIn.map(BigInt)
      : basketAmountsMapToOrderedBigIntArray(basketComponents, derivedBasketAmountsAsBigIntMap);
  }, [basketMaxAmounts, basketComponents, derivedBasketAmountsAsBigIntMap]);

  const hasDerivedBasketAmounts = useMemo(
    () => derivedBasketAmountsAsBigIntLst.some((amount) => amount > 0n),
    [derivedBasketAmountsAsBigIntLst]
  );

  const derivedBasketAmountsAsStringMap = useMemo(() => {
    return basketAmountsMapToStringMap(basketComponents, derivedBasketAmountsAsBigIntMap, locale);
  }, [basketComponents, derivedBasketAmountsAsBigIntMap, locale]);

  const showSellBasket = sellTokenId === goldBasketId;
  const showBuyBasket = buyTokenId === goldBasketId;
  const isSellBasket = hasBasketComponents && showSellBasket;
  const isBuyBasket = hasBasketComponents && showBuyBasket;

  // Basket amounts are edited in component rows; the opposite side is supplied by quotes.
  const isMainInputSellReadOnly = isSellBasket;

  const sellSelectDisabled = isSubmittingSwap;
  const isSellTokenChoicesLoading = isConnected && showOnlyWalletTokens && isWalletBalancesLoading;

  // Resolve the direction and route of the spend-side intent.
  const flowState = useMemo(() => {
    return resolveFlowState({
      sellTokenId,
      buyTokenId,
      hasBasketComponents,
      cygldTokenId,
      basketTokenId: goldBasketId,
    });
  }, [buyTokenId, cygldTokenId, goldBasketId, hasBasketComponents, sellTokenId]);

  const isIssueFromBasketExactIn = flowState?.direction === "issue" && flowState.route === "basket";
  const isRedeemToBasketExactIn = flowState?.direction === "redeem" && flowState.route === "basket";
  const isIssueFromTokenExactIn = flowState?.direction === "issue" && flowState.route === "token";
  const isRedeemToTokenExactIn = flowState?.direction === "redeem" && flowState.route === "token";

  const isIssue = flowState?.direction === "issue";
  const isRedeem = flowState?.direction === "redeem";
  const isActiveTokenFlow = flowState?.route === "token";

  useEffect(() => {
    if (!hasHydratedPersistedSwapForm) return;

    const activeElement = document.activeElement;
    const nothingFocused =
      !activeElement ||
      activeElement === document.body ||
      activeElement === document.documentElement;

    // Move focus only after an explicit form action or when nothing is focused.
    if (!nothingFocused && !shouldFocusEditableInputRef.current) return;

    const targetInput = (() => {
      if (sellTokenId === "goldbasket") {
        const driverIndex = basketComponents.findIndex((component) => (component.token.address as Address) === driverToken);
        return basketSellInputRefs.current[driverIndex >= 0 ? driverIndex : 0] ?? null;
      }

      if (!isMainInputSellReadOnly) return mainSellInputRef.current;

      return null;
    })();

    if (!targetInput) return;

    if (activeElement === targetInput) {
      shouldFocusEditableInputRef.current = false;
      return;
    }

    shouldFocusEditableInputRef.current = false;

    // The effect runs after refs attach. Deferring this focus could steal it
    // from a token picker the user opens before the next animation frame.
    targetInput.focus({ preventScroll: true });
    targetInput.select();
  }, [
    basketComponents,
    buyTokenId,
    driverToken,
    hasHydratedPersistedSwapForm,
    isMainInputSellReadOnly,
    sellTokenId,
  ]);

  // Balance feedback follows the edited input, independently of quote debounce.
  const editedSellAmount = isNativeOrErc20Token(sellToken)
    ? sellAmountRawOverride ?? parseInputToBigInt(sellAmount, sellToken.decimals, locale) ?? 0n : 0n;

  const rawQuoteAmount = editedSellAmount;
  const rawTradeIntent: Omit<TradeQuoteRequest, "deadline" | "retainedPlan"> = {
    side: isIssue ? "buy" : "sell", mode: "exact-in",
    counterToken: (isIssue ? sellTokenQuoteAddress : buyTokenQuoteAddress) ?? "",
    native: isIssue ? isSellTokenNative : isBuyTokenNative,
    amount: String(rawQuoteAmount), recipient: address ?? zeroAddress, slippageBps,
  };
  const exactBrowserHit = useCachedTradeQuote(rawTradeIntent, isActiveTokenFlow && rawQuoteAmount > 0n);
  const localBasketModel = useLocalBasketModel();
  const issuanceModel = issuanceModelFromFacts(protocolFacts, localBasketModel);

  // Direct Basket previews start with the edited amount. Token route searches
  // retain their input debounce; exact cached quotes and MAX remain immediate.
  const immediatePageQuote = flowState?.route === "basket" || exactBrowserHit;
  const debouncedSellAmount = useDebouncedValue(sellAmount, QUOTE_INPUT_DEBOUNCE_MS, immediatePageQuote);

  const sellAmountFromInputBigInt = useMemo(() => {
    if (!isNativeOrErc20Token(sellToken)) return 0n;
    if (sellAmountRawOverride !== undefined) return sellAmountRawOverride;
    const parsed = parseInputToBigInt(debouncedSellAmount, sellToken.decimals, locale);
    return parsed ?? 0n;
  }, [debouncedSellAmount, locale, sellToken, sellAmountRawOverride]);

  // Disable/cancel the old token intent on the raw edit, before the replacement
  // amount passes its typing debounce.
  const quoteInputPending = sellAmount !== debouncedSellAmount;

  // Keep every flow hook mounted and select its activity through enabled flags.
  const issueFromBasketExactInFlow = useIssueFromBasketExactInFlow({
    slippageBps,
    enabled: isIssueFromBasketExactIn,
    amountsIn: derivedBasketAmountsAsBigIntLst,
    basketComponents,
    onNetworkFeeEstimate: setNetworkFeeEstimate,
    onNetworkFeeEstimateLoadingChange: setIsNetworkFeeEstimateLoading,
  });
  const netCygldIssueFromBasketExactIn = issueFromBasketExactInFlow.netCygldOut;

  const redeemToBasketExactInFlow = useRedeemToBasketExactInFlow({
    slippageBps,
    enabled: isRedeemToBasketExactIn,
    grossCygldIn: sellAmountFromInputBigInt,
    basketComponents,
    onNetworkFeeEstimate: setNetworkFeeEstimate,
    onNetworkFeeEstimateLoadingChange: setIsNetworkFeeEstimateLoading,
  });
  const basketAmountsOutObtained = redeemToBasketExactInFlow.amountsOut;

  const tradeInput = { ...rawTradeIntent, amount: String(sellAmountFromInputBigInt) };
  const tradeFlow = useTradeFlow({ input: tradeInput, frozen: frozenTrade, enabled: isActiveTokenFlow && !quoteInputPending,
    onNetworkFeeEstimate: setNetworkFeeEstimate, onNetworkFeeEstimateLoadingChange: setIsNetworkFeeEstimateLoading });
  const helperFeePercent = tradeFlow.selected?.value.strategy === "market"
    ? formatPpmAsPercent(BigInt(tradeFlow.selected.value.providerQuote.fee.ratePpm)) : coreHelperFeePercent;
  // Lightweight Backend estimates follow edited amounts. Execution tolerance
  // changes only the displayed guard and the later preparation request.
  const localTradeEstimate = useTradeModel({ side: rawTradeIntent.side, mode: rawTradeIntent.mode,
    counterToken: rawTradeIntent.counterToken, native: rawTradeIntent.native, amount: rawTradeIntent.amount }, isActiveTokenFlow);
  const localQuoteAmount = localTradeEstimate?.quotedOutput;
  // Existing basket interactions remain separate. Token amounts share one Backend-selected plan.
  const issueFromTokenExactInFlow = tradeFlow;
  const redeemToTokenExactInFlow = tradeFlow;
  const netCygldIssueFromTokenExactIn = tradeFlow.displayNetCygldOut;
  const netAmountOutRedeemToTokenExactIn = tradeFlow.displayNetAmountOut;

  // Shared display state and submission must refer to the same active flow.
  const activeFlow = isIssueFromBasketExactIn ? issueFromBasketExactInFlow
    : isIssueFromTokenExactIn ? issueFromTokenExactInFlow
    : isRedeemToBasketExactIn ? redeemToBasketExactInFlow
    : isRedeemToTokenExactIn ? redeemToTokenExactInFlow
    : undefined;
  const activeUniversalQuote = isActiveTokenFlow ? (tradeFlow.selected?.value.strategy === "universal" ? tradeFlow.selected.value : undefined)
    : isIssueFromBasketExactIn ? issueFromBasketExactInFlow.universalQuote : isRedeemToBasketExactIn ? redeemToBasketExactInFlow.universalQuote : undefined;
  const activeQuoteStatus = activeFlow?.quoteStatus;
  const activeQuoteError = activeFlow?.quoteError;
  const purchaseCapacity = cygldPurchaseCapacity(issuanceModel);
  const remainingNetCapacity = isActiveTokenFlow ? undefined : purchaseCapacity?.available;
  const requestedBasketPurchase = isIssueFromBasketExactIn
    ? cygldBasketPurchaseAmount(issuanceModel, derivedBasketAmountsAsBigIntLst) : undefined;
  const requestedGrossIssuance = isIssueFromBasketExactIn ? requestedBasketPurchase?.gross
    : undefined;
  const remainingGrossCapacity = isActiveTokenFlow ? undefined : purchaseCapacity?.grossRemaining;
  const activeQuoteFailure = isActiveTokenFlow ? tradeFlow.quoteFailure : activeFlow && "error" in activeFlow ? activeFlow.error : undefined;
  const isIssuanceCapError = activeQuoteStatus === "failed" && activeQuoteFailure instanceof QuotePreviewError
    && activeQuoteFailure.code === "issuance-cap-exceeded";
  const observedCap = isIssuanceCapError ? activeQuoteFailure.constraint : undefined;
  const isIssuanceCapacityExhausted = isIssuanceCapError && (
    observedCap?.availableRaw !== undefined ? observedCap.availableRaw === "0" : purchaseCapacity?.available === 0n
  );
  const isPurchaseCapacityExhausted = isIssuanceCapError ? isIssuanceCapacityExhausted : remainingNetCapacity === 0n;
  // MAX was sized and previewed by the Backend; a cached model cannot override it.
  const isObservedBasketPurchaseOverCap = !basketMaxAmounts && (
    (remainingNetCapacity === 0n && (rawQuoteAmount > 0n || hasDerivedBasketAmounts)) || (
    requestedGrossIssuance !== undefined && remainingGrossCapacity !== undefined && requestedGrossIssuance > remainingGrossCapacity
  ));
  const isPurchaseOverCap = !isActiveTokenFlow && isIssue && (isIssuanceCapError || isObservedBasketPurchaseOverCap);
  const purchaseCapacityLabel = isPurchaseCapacityExhausted
    ? t("cygldSupplyCapReached")
    : isIssuanceCapError ? t("reduceAmountToSupplyLimit")
    : remainingNetCapacity !== undefined ? t(isPurchaseOverCap ? "cygldPurchaseCapExceeded" : "cygldAvailableToBuy", {
      amount: formatCygldCapacity(remainingNetCapacity, cygldDecimals, locale),
    }) : undefined;
  const purchaseCapacityDetails = purchaseCapacity || (observedCap?.limitRaw && observedCap.currentSupplyRaw) ? t("cygldSupplyCapDetails", {
    cap: formatCygldCapacity(observedCap?.limitRaw ? BigInt(observedCap.limitRaw) : purchaseCapacity!.cap, cygldDecimals, locale),
    supply: formatCygldCapacity(observedCap?.currentSupplyRaw ? BigInt(observedCap.currentSupplyRaw) : purchaseCapacity!.supply, cygldDecimals, locale),
  }) : undefined;
  useEffect(() => {
    if (isIssuanceCapError) void refreshProtocolFacts();
  }, [isIssuanceCapError, refreshProtocolFacts]);
  const selectedQuote = isActiveTokenFlow ? tradeFlow.selected : undefined;
  const diagnosticContext = flowState ? { direction: flowState.direction, route: flowState.route,
    inputMode: flowState.inputMode, chainId: EXPECTED_CHAIN_ID, assetCount: basketComponents.length,
    ...(isActiveTokenFlow ? { side: tradeInput.side, amount: tradeInput.amount, strategy: selectedQuote?.value.strategy,
      tokenIn: selectedQuote?.value.tokenIn, tokenOut: selectedQuote?.value.tokenOut,
      inputMaximum: selectedQuote?.inputMaximum.toString(), outputMinimum: selectedQuote?.outputMinimum.toString(),
      blockNumber: selectedQuote?.value.context.blockNumber, blockHash: selectedQuote?.value.context.blockHash } : {}) } : undefined;
  const activeQuoteReferences = selectedQuote?.diagnostics ?? diagnosticReferences(activeFlow && "quote" in activeFlow ? activeFlow.quote : undefined);
  const quoteDiagnostics = useQuoteDiagnostics(diagnosticContext, activeQuoteStatus, activeQuoteFailure, activeQuoteReferences);

  const executionBoundsReady = activeQuoteStatus === "success" && !isPurchaseOverCap && !quoteInputPending;
  const formatBound = (amount: bigint, decimals: number, symbol: string) =>
    `${formatUnits(amount, decimals).replace(".", getLocaleDecimalSeparator(locale))} ${symbol}`;
  const currentMinimumExecutionOutput = executionBoundsReady && activeFlow ? (
    "minimumOutputAmount" in activeFlow && activeFlow.minimumOutputAmount !== undefined
      ? formatBound(activeFlow.minimumOutputAmount, buyTokenDecimals ?? cygldDecimals, buyToken?.symbol ?? "CYGLD")
      : "minimumOutputAmounts" in activeFlow && activeFlow.minimumOutputAmounts
        ? activeFlow.minimumOutputAmounts.map((amount, index) => {
          const component = basketComponents[index];
          return component ? formatBound(amount, component.token.decimals, component.token.symbol) : "";
        }).filter(Boolean).join(" + ") : loadingAmountPlaceholder
  ) : loadingAmountPlaceholder;
  // Tolerance changes retain presentation terms; executable quote identity still includes bps.
  const retainedBounds = useRetainedQuoteDisplay([configurationIdentity, observedQuoteScope,
    { ...rawTradeIntent, slippageBps: undefined }],
    { slippageBps, minimum: currentMinimumExecutionOutput },
    quoteInputPending ? "idle" : activeQuoteStatus, isSubmittingSwap);
  const isToleranceOnlyRefresh = isActiveTokenFlow && retainedBounds.retained
    && retainedBounds.value.slippageBps !== slippageBps;
  const minimumExecutionOutput = isToleranceOnlyRefresh ? retainedBounds.value.minimum : currentMinimumExecutionOutput;

  // Quote previews determine whether this operation actually needs swap legs.
  const activeTokenFlow = isIssueFromTokenExactIn ? issueFromTokenExactInFlow
    : isRedeemToTokenExactIn ? redeemToTokenExactInFlow
    : undefined;
  const requiresTokenFlowAdapter = activeTokenFlow?.requiresSwapAdapter ?? false;
  const tokenFlowAdapter = activeTokenFlow?.adapter ?? addresses.adapter;
  const hasConfiguredTokenFlowAdapter =
    typeof tokenFlowAdapter === "string" &&
    isAddress(tokenFlowAdapter) &&
    tokenFlowAdapter !== zeroAddress;
  const tokenFlowAdapterApproval = useIsAdapterApproved(
    requiresTokenFlowAdapter && hasConfiguredTokenFlowAdapter
      ? tokenFlowAdapter
      : undefined
  );
  const adapterState = tokenFlowAdapterState({
    requiresSwapAdapter: requiresTokenFlowAdapter,
    hasConfiguredAdapter: hasConfiguredTokenFlowAdapter,
    approval: tokenFlowAdapterApproval,
  });
  const isTokenFlowAdapterReady = adapterState.ready;
  const isTokenFlowAdapterCheckPending = adapterState.pending;
  const tokenFlowAdapterError = adapterState.error ? t(adapterState.error) : undefined;

  // Approximate gas scales with token count; amount edits reuse the gas-price query.
  const issueBasketInputCount = isIssueFromBasketExactIn
    ? issueFromBasketExactInFlow.permitted.length
    : 0;
  const estimatedSwapGas = isIssue
    ? GAS_POLICY.ISSUE_BASE_GAS + BigInt(Math.max(issueBasketInputCount, 1)) * GAS_POLICY.ISSUE_PER_TOKEN_GAS
    : isRedeem
      ? GAS_POLICY.REDEEM_BASE_GAS + BigInt(Math.max(basketComponents.length, 1)) * GAS_POLICY.REDEEM_PER_TOKEN_GAS
      : undefined;

  // The operation estimate and head-scoped gas price do not require a wallet.
  const canEstimateNetworkFee = estimatedSwapGas !== undefined;
  const networkGasFees = useTransactionFees(canEstimateNetworkFee);
  const maxFeePerGas = networkGasFees.data?.maxFeePerGas ?? 0n;
  const approximateNetworkFeeEstimate: NetworkFeeEstimate | null =
    estimatedSwapGas !== undefined && maxFeePerGas > 0n && !networkGasFees.isError
      ? {
          wei: estimatedSwapGas * maxFeePerGas,
          gas: estimatedSwapGas,
          maxFeePerGas,
          mode: "approx",
        }
      : null;
  // Prefer execution simulation when available, with the approximate fee as a fallback.
  const hasEnteredSwapAmount = isIssueFromBasketExactIn
    ? hasDerivedBasketAmounts : rawQuoteAmount > 0n;
  const displayedSpendAmount = parseDisplayNumber(showSellBasket ? driverAmountStr : sellAmount, locale);
  const isSpendAmountZero = hasHydratedPersistedSwapForm && (displayedSpendAmount ?? 0) === 0;
  const evaluationDraftKey = JSON.stringify([displayIntentKey, slippageBps]);
  const [reloadEvaluation, setReloadEvaluation] = useState<{ draft: string; unchanged: boolean }>();
  useLayoutEffect(() => {
    if (!hasHydratedPersistedSwapForm) return;
    setReloadEvaluation(previous => previous === undefined ? { draft: evaluationDraftKey, unchanged: true }
      : previous.unchanged && previous.draft !== evaluationDraftKey ? { ...previous, unchanged: false } : previous);
  }, [hasHydratedPersistedSwapForm, evaluationDraftKey]);
  // A matching, confirmed presentation survives background refresh/reload.
  // An edited draft has no matching snapshot, so its estimate is grey before
  // the route-search debounce, until the Backend qualifies the new intent.
  const cachedEvaluationConfirmed = cachedTradeDisplay?.evaluationStatus === "confirmed" ||
    (cachedTradeDisplay?.evaluationStatus === undefined && cachedTradeDisplay?.quoteComplete === "true");
  const keepConfirmedEvaluation = cachedEvaluationConfirmed && (reloadEvaluation === undefined ||
    (reloadEvaluation.unchanged && reloadEvaluation.draft === evaluationDraftKey)) &&
    activeQuoteStatus !== "failed" && !isPurchaseOverCap;
  const evaluationStatus = executionBoundsReady || keepConfirmedEvaluation ? "confirmed"
    : (displayedSpendAmount ?? 0) > 0 ? "pending" : "empty";
  const networkFeeEstimate = canEstimateNetworkFee && hasEnteredSwapAmount
    ? executionNetworkFeeEstimate && maxFeePerGas > 0n && !networkGasFees.isError
      ? { ...executionNetworkFeeEstimate, maxFeePerGas, wei: executionNetworkFeeEstimate.gas * maxFeePerGas }
      : approximateNetworkFeeEstimate
    : null;
  const isNetworkFeeEstimateLoading = canEstimateNetworkFee && hasEnteredSwapAmount &&
    (isExecutionFeeEstimateLoading || (!executionNetworkFeeEstimate && networkGasFees.isLoading));

  // Recovery shares are separate outputs and are excluded from fiat/gold amount totals.
  const displayedRecoveryShareQuote = useMemo(() => {
    const quote = isRedeemToBasketExactIn
      ? {
          assets: redeemToBasketExactInFlow.orderedRecoveryAssets,
          amounts: redeemToBasketExactInFlow.recoverySharesOut,
        }
      : isRedeemToTokenExactIn
          ? {
              assets: redeemToTokenExactInFlow.orderedRecoveryAssets,
              amounts: redeemToTokenExactInFlow.recoverySharesOut,
            }
          : undefined;
    return quote?.assets?.length && quote.amounts?.some((amount) => amount > 0n)
      ? quote
      : undefined;
  }, [
    isRedeemToBasketExactIn,
    isRedeemToTokenExactIn,
    redeemToBasketExactInFlow.orderedRecoveryAssets,
    redeemToBasketExactInFlow.recoverySharesOut,
    redeemToTokenExactInFlow.orderedRecoveryAssets,
    redeemToTokenExactInFlow.recoverySharesOut,
  ]);
useQuoteFailureToast({
  enabled: isIssueFromBasketExactIn,
  status: issueFromBasketExactInFlow.quoteStatus,
  error: issueFromBasketExactInFlow.quoteError,
  onFailure: clearFailedQuoteFormState,
});

useQuoteFailureToast({
  enabled: isRedeemToBasketExactIn,
  status: redeemToBasketExactInFlow.quoteStatus,
  error: redeemToBasketExactInFlow.quoteError,
  onFailure: clearFailedQuoteFormState,
});

useQuoteFailureToast({
  enabled: isActiveTokenFlow,
  status: tradeFlow.quoteStatus,
  error: tradeFlow.quoteError,
  onFailure: clearFailedQuoteFormState,
});

// Fee display.
const activeFees = activeFlow?.fees;

const protocolFeeUsd = useMemo(() => {
  const cygldUsdPrice = Number.isFinite(cygldPriceUsd) ? cygldPriceUsd : undefined;
  if (!activeFees) return undefined;
  if (activeFees.protocolFeeCygld === 0n) return 0;
  if (cygldUsdPrice === undefined) return undefined;
  return Number(formatUnits(activeFees.protocolFeeCygld, cygldDecimals)) * cygldUsdPrice;
}, [activeFees, cygldDecimals, cygldPriceUsd]);

const helpersFeeUsd = useMemo(() => {
  const cygldUsdPrice = Number.isFinite(cygldPriceUsd) ? cygldPriceUsd : undefined;
  if (!activeFees) return undefined;
  if (activeFees.helperFeeCygld === 0n) return 0;
  if (cygldUsdPrice === undefined) return undefined;
  return Number(formatUnits(activeFees.helperFeeCygld, cygldDecimals)) * cygldUsdPrice;
}, [activeFees, cygldDecimals, cygldPriceUsd]);

const isQuoteLoading =
  isTokenFlowAdapterCheckPending || activeQuoteStatus === "loading";

const activeQuoteProgressCounts = (() => {
  if (isSubmittingSwap) {
    return undefined;
  }

  if (isIssueFromTokenExactIn && sellAmountFromInputBigInt > 0n) {
    return issueFromTokenExactInFlow.quoteStatus === "loading"
      ? issueFromTokenExactInFlow.progressCounts
      : undefined;
  }

  if (isRedeemToTokenExactIn && sellAmountFromInputBigInt > 0n) {
    return redeemToTokenExactInFlow.quoteStatus === "loading"
      ? redeemToTokenExactInFlow.progressCounts
      : undefined;
  }

  return undefined;
})();

const activeQuoteProgressPercent = getProgressPercentFromCounts(activeQuoteProgressCounts);

const quoteProcessingLabel = t("quoteProcessing");


useEffect(() => {
  if (isSubmittingSwap) {
    return;
  }
  setDisplayedQuoteProgressPercent(0);
}, [
  isSubmittingSwap,
  flowState?.direction,
  flowState?.route,
  flowState?.inputMode,
  sellTokenId,
  buyTokenId,
  sellAmountFromInputBigInt,
]);

useEffect(() => {
  if (isSubmittingSwap || !isQuoteLoading) {
    return;
  }
  // Keep progress monotonic within a quote and below 100 until quoting finishes.
  const nextProgress = Math.min(99, clampProgressPercent(activeQuoteProgressPercent) ?? 0);
  setDisplayedQuoteProgressPercent((current) =>
    nextProgress > current ? nextProgress : current
  );
}, [activeQuoteProgressPercent, isQuoteLoading, isSubmittingSwap]);

useEffect(() => {
  if (isQuoteLoading) {
    return;
  }
  setDisplayedQuoteProgressPercent(0);
}, [isQuoteLoading]);

// Show the receive quote while execution is prepared.
const computedReceiveQuote = useMemo((): Prefill => {

  if (isIssueFromBasketExactIn) {
    if (!issueFromBasketExactInFlow.canSubmit) {
      return EMPTY_PREFILL;
    }
    const netCygldOut = isPurchaseOverCap
      ? requestedBasketPurchase?.net ?? netCygldIssueFromBasketExactIn ?? 0n
      : netCygldIssueFromBasketExactIn ?? 0n;
    return {
      main: formatAmount(netCygldOut, cygldDecimals),
      mainRaw: netCygldOut,
      components: [],
      componentRaws: [],
    };
  }
  if (isIssueFromTokenExactIn) {
    if (!issueFromTokenExactInFlow.canSubmit &&
      !(issueFromTokenExactInFlow.quoteStatus === "loading" && (netCygldIssueFromTokenExactIn ?? 0n) > 0n)) {
      return EMPTY_PREFILL;
    }
    return {
      main: formatAmount(netCygldIssueFromTokenExactIn ?? 0n, cygldDecimals),
      mainRaw: netCygldIssueFromTokenExactIn ?? 0n,
      components: [],
      componentRaws: [],
    };
  }
  if (isRedeemToBasketExactIn) {
    if (
      !redeemToBasketExactInFlow.canSubmit ||
      !Array.isArray(basketAmountsOutObtained) ||
      basketAmountsOutObtained.length !== basketComponents.length
    ) {
      return EMPTY_PREFILL;
    }
    const components = basketComponents.map((component, index) => {
      const componentAmountBigInt = basketAmountsOutObtained?.[index] ?? 0n;
      return formatAmount(componentAmountBigInt, component.token.decimals);
    });
    return {
      main: "",
      mainRaw: 0n,
      components,
      componentRaws: [...basketAmountsOutObtained],
    };
  }
  if (isRedeemToTokenExactIn) {
    if ((!redeemToTokenExactInFlow.canSubmit && !(redeemToTokenExactInFlow.quoteStatus === "loading" && (netAmountOutRedeemToTokenExactIn ?? 0n) > 0n)) || buyTokenDecimals === undefined) {
      return EMPTY_PREFILL;
    }
    return {
      main: formatAmount(netAmountOutRedeemToTokenExactIn ?? 0n, buyTokenDecimals),
      mainRaw: netAmountOutRedeemToTokenExactIn ?? 0n,
      components: [],
      componentRaws: [],
    };
  }
  return EMPTY_PREFILL;
}, [isPurchaseOverCap, requestedBasketPurchase?.net, cygldDecimals, basketComponents, netCygldIssueFromBasketExactIn, netCygldIssueFromTokenExactIn, basketAmountsOutObtained, netAmountOutRedeemToTokenExactIn, issueFromBasketExactInFlow.canSubmit, issueFromTokenExactInFlow.canSubmit, issueFromTokenExactInFlow.quoteStatus, isIssueFromBasketExactIn, isIssueFromTokenExactIn, isRedeemToBasketExactIn, isRedeemToTokenExactIn, redeemToBasketExactInFlow.canSubmit, redeemToTokenExactInFlow.canSubmit, redeemToTokenExactInFlow.quoteStatus, buyTokenDecimals]);

  const displayQuoteIdentity = [flowState?.direction, flowState?.route, flowState?.inputMode,
    sellTokenId, buyTokenId, configurationIdentity,
    sellAmount, sellAmountRawOverride,
    driverToken, driverAmountStr, driverAmountRawOverride,
    derivedBasketAmountsAsBigIntLst,
    basketComponents.map(component => [component.token.address, component.token.decimals, component.targetWeight])];
  const retainedReceiveQuote = useRetainedQuoteDisplay(displayQuoteIdentity,
    quoteInputPending ? EMPTY_PREFILL : computedReceiveQuote, quoteInputPending ? "idle" : activeQuoteStatus, isSubmittingSwap);
  const localPrefill: Prefill | undefined = localQuoteAmount !== undefined && localQuoteAmount > 0n &&
    (quoteInputPending || activeQuoteStatus === "loading" || isPurchaseOverCap) && !retainedReceiveQuote.retained ? {
      main: formatAmount(localQuoteAmount, buyTokenDecimals ?? 18),
      mainRaw: localQuoteAmount, components: [], componentRaws: [],
    } : undefined;
  const localBasketPrefill = useMemo<Prefill | undefined>(() => {
    if (flowState?.route !== "basket" || (activeQuoteStatus !== "loading" && !isPurchaseOverCap) || retainedReceiveQuote.retained) return undefined;
    const mode = flowState.direction === "issue" ? "issue-exact-in" : "redeem-exact-in";
    if (mode === "issue-exact-in" && basketMaxAmounts) {
      const amount = BigInt(basketMaxAmounts.netCygldOut);
      return { main: amount > 0n ? formatAmount(amount, cygldDecimals) : "", mainRaw: amount, components: [], componentRaws: [] };
    }
    const value = localBasketQuote(localBasketModel, mode, basketComponents.map(c => c.token.address), rawQuoteAmount, derivedBasketAmountsAsBigIntLst, issuanceModel);
    if (!value) return undefined;
    const amounts = value.componentAmounts ?? [];
    const amount = mode === "issue-exact-in" && isPurchaseOverCap
      ? requestedBasketPurchase?.net ?? value.amount ?? 0n
      : value.amount ?? 0n;
    return { main: amount > 0n ? formatAmount(amount, cygldDecimals) : "", mainRaw: amount,
      components: amounts.map((n, i) => formatAmount(n, basketComponents[i].token.decimals)), componentRaws: amounts };
  }, [flowState, activeQuoteStatus, isPurchaseOverCap, retainedReceiveQuote.retained,
    basketMaxAmounts, requestedBasketPurchase?.net, localBasketModel, issuanceModel, basketComponents, rawQuoteAmount, derivedBasketAmountsAsBigIntLst, cygldDecimals]);
  const receiveQuote = localBasketPrefill ? localBasketPrefill
    : localPrefill && retainedReceiveQuote.value.mainRaw <= 0n ? localPrefill : retainedReceiveQuote.value;
  const buyAmountBigInt = receiveQuote.mainRaw;

  const sellAmountBigInt = sellAmountFromInputBigInt;

  const walletBalanceByTokenId = useMemo(() => {
    return findWalletBalanceByTokenId(balances);
  }, [balances]);

  const sellTokenWalletBalance = walletBalanceByTokenId[sellTokenId] ?? 0n;
  const sellTokenBalanceKnown = walletBalanceByTokenId[sellTokenId] !== undefined;

  const isBasketComponentAmountOverWalletBalance = useCallback(
    (component: BasketComponent, amountStr: string) => {
      if (!isConnected) return false;
      return isBasketComponentAmountOverBalance({
        component,
        amountStr,
        walletBalanceByTokenId,
        locale,
      });
    },
    [isConnected, locale, walletBalanceByTokenId]
  );

  // Suppress token balance warnings while quotes or post-submission balances are changing.
  const isTokenSellAmountOverWalletBalance = useMemo(() => {

    if (isSubmittingSwap) return false;
    if (isSubmittedSwapCleanupInProgress) return false;
    if (!isConnected) return false;
    if (!isSellTokenSpendable) return false;
    if (!sellTokenBalanceKnown) return false;
    const amount = isIssueFromTokenExactIn
      ? activeQuoteStatus === "success" && !quoteInputPending ? selectedQuote?.inputMaximum : undefined
      : editedSellAmount;
    if (amount === undefined || amount <= 0n) return false;
    return amount > sellTokenWalletBalance;
  }, [
    isConnected,
    isSubmittedSwapCleanupInProgress,
    isSubmittingSwap,
    isSellTokenSpendable,
    editedSellAmount,
    isIssueFromTokenExactIn,
    activeQuoteStatus,
    quoteInputPending,
    selectedQuote,
    sellTokenWalletBalance,
    sellTokenBalanceKnown,
  ]);

  const canUseSellMax = isConnected && isSellTokenSpendable && sellToken !== undefined && sellTokenBalanceKnown;
  const basketWalletMax = useMemo(() => proportionalBasketWalletMax(basketComponents, walletBalanceByTokenId),
    [basketComponents, walletBalanceByTokenId]);
  const basketMaxInputKey = JSON.stringify([
    basketWalletMax?.driverToken, basketWalletMax?.maximumAmountsIn.map(String),
    basketComponents.map(component => [component.token.address, component.token.decimals, String(component.targetWeight)]),
  ]);
  const canUseBasketSellMax = isConnected && isSellBasket && basketWalletMax !== undefined;
  const { data: currentGasFees, isError: gasFeesUnavailable,
    isFetching: isFetchingGasFees, refetch: refetchGasFees } = networkGasFees;

  // A fee read started by MAX must not overwrite a later edit or wallet change.
  useEffect(() => () => { sellMaxRequestRef.current++; }, [
    address, connectedChainId, isConnected, sellTokenId, buyTokenId,
    sellAmount, sellAmountRawOverride, driverToken, driverAmountStr, driverAmountRawOverride,
    sellTokenWalletBalance, estimatedSwapGas, slippageBps,
  ]);

  useEffect(() => () => { basketMaxRequestRef.current++; basketMaxAbortRef.current?.abort(); }, [
    address, connectedChainId, isConnected, sellTokenId, buyTokenId,
    sellAmount, sellAmountRawOverride, driverToken, driverAmountStr, driverAmountRawOverride,
    basketMaxInputKey, configurationIdentity, locale,
  ]);

  const getSpendableInputForMax = useCallback(async () => {
    if (!isConnected || !sellTokenBalanceKnown || !isSellTokenSpendable) return undefined;
    let amount = sellTokenWalletBalance;
    if (isSellTokenNative) {
      if (estimatedSwapGas === undefined) return undefined;
      let fees = currentGasFees;
      if (!fees || gasFeesUnavailable || isFetchingGasFees) {
        const result = await refetchGasFees({ cancelRefetch: false });
        if (result.isError || !result.data) return undefined;
        fees = result.data;
      }
      amount = nativeSellMaxAmount(amount, estimatedSwapGas * fees.maxFeePerGas);
    }
    return amount;
  }, [isConnected, sellTokenBalanceKnown, isSellTokenSpendable, sellTokenWalletBalance, isSellTokenNative,
    estimatedSwapGas, currentGasFees, gasFeesUnavailable, isFetchingGasFees, refetchGasFees]);

  const handleSetSellMax = useCallback(async () => {
    if (!isNativeOrErc20Token(sellToken) || !canUseSellMax) return;
    const request = ++sellMaxRequestRef.current;
    const amount = await getSpendableInputForMax();
    if (amount === undefined || request !== sellMaxRequestRef.current) return;
    setSellAmountRawOverride(amount);
    setSellAmount(truncateDecimalString(formatUnits(amount, sellToken.decimals), 3));
  }, [canUseSellMax, sellToken, getSpendableInputForMax]);

  const handleSetBasketSellMax = useCallback(async () => {
    if (!canUseBasketSellMax || !basketWalletMax) return;
    const request = ++basketMaxRequestRef.current;
    basketMaxAbortRef.current?.abort();
    const controller = new AbortController();
    basketMaxAbortRef.current = controller;
    try {
      const maximum = await fetchBasketMax({ driverToken: basketWalletMax.driverToken,
        maximumAmountsIn: basketWalletMax.maximumAmountsIn.map(String) }, controller.signal);
      if (controller.signal.aborted || request !== basketMaxRequestRef.current) return;
      const amount = BigInt(maximum.driverAmount);
      const driver = basketComponents.find(component => component.token.address === basketWalletMax.driverToken)!;
      setDriverToken(basketWalletMax.driverToken);
      setDriverAmountRawOverride(amount);
      setBasketMaxAmounts(maximum);
      setDriverAmountStr(truncateDecimalString(formatUnits(amount, driver.token.decimals), 3)
        .replace(".", getLocaleDecimalSeparator(locale)));
    } catch (error) {
      if (controller.signal.aborted || request !== basketMaxRequestRef.current) return;
      toast.error(t("quoteFailed"), { description: quoteErrorMessage(error instanceof Error ? error : new Error(), t) });
    }
  }, [canUseBasketSellMax, basketWalletMax, basketComponents, locale, t]);

  const isSellAmountOverWalletBalance = useMemo(() => {

    if (!isConnected) return false;

    if (isIssueFromBasketExactIn) {
      return basketComponents.some((component) => {
        const componentAddress = component.token.address as `0x${string}`;
        const displayedValue =
          componentAddress === driverToken
            ? driverAmountStr
            : (derivedBasketAmountsAsStringMap[componentAddress] ?? "");

        return isBasketComponentAmountOverWalletBalance(component, displayedValue);
      });
    }

    return isTokenSellAmountOverWalletBalance;
  }, [
    isConnected,
    isIssueFromBasketExactIn,
    isTokenSellAmountOverWalletBalance,
    basketComponents,
    driverToken,
    driverAmountStr,
    derivedBasketAmountsAsStringMap,
    isBasketComponentAmountOverWalletBalance,
  ]);

  const buyPriceUsd = Number.isFinite(buyTokenPriceUsd) ? buyTokenPriceUsd : undefined;
  const sellPriceUsd = Number.isFinite(sellTokenPriceUsd) ? sellTokenPriceUsd: undefined;
  const wethPriceCandidate = prices?.weth ?? prices?.eth;
  const wethPriceUsd = Number.isFinite(wethPriceCandidate) ? wethPriceCandidate : undefined;

  // Value and amount share the current rendered frame; quote debounce applies only to requests.
  const buyValuationAmount = buyAmountBigInt;
  const sellValuationAmount = sellAmountRawOverride !== undefined && sellTokenDecimals !== undefined
    ? Number(formatUnits(sellAmountRawOverride, sellTokenDecimals)) : parseDisplayNumber(sellAmount, locale);
  const buyAmountUsdApprox =
    buyPriceUsd !== undefined &&
    buyTokenDecimals !== undefined &&
    buyValuationAmount > 0n
      ? Number(formatUnits(buyValuationAmount, buyTokenDecimals)) * buyPriceUsd
      : undefined;

  const sellAmountUsdApprox =
    sellPriceUsd !== undefined &&
    sellValuationAmount !== undefined && sellValuationAmount > 0
      ? sellValuationAmount * sellPriceUsd
      : undefined;

  const networkFeeUsd =
    networkFeeEstimate && wethPriceUsd !== undefined
      ? Number(formatEther(networkFeeEstimate.wei)) * wethPriceUsd
      : undefined;

  const totalFeeUsd = useMemo(() => {
    return computeTotalFeeUsd({
      activeFees, retainedInputCharges: activeUniversalQuote?.estimatedRetainedInputCharges,
      cygldDecimals,
      cygldPriceUsd,
      cygldTokenId,
      networkFeeUsd,
      networkFeeWei: networkFeeEstimate?.wei,
      prices,
      tokenAddressMap,
    });
  }, [activeFees, activeUniversalQuote?.estimatedRetainedInputCharges, cygldDecimals, cygldPriceUsd, cygldTokenId, networkFeeEstimate?.wei, networkFeeUsd, prices, tokenAddressMap]);

  // Only the presentation retains previous fees. Submission continues to use
  // the current quote, current balances and existing execution readiness.
  const areFeesUpdating = quoteInputPending || isQuoteLoading || isNetworkFeeEstimateLoading;
  const retainedFees = useRetainedQuoteDisplay(
    [flowState?.direction, flowState?.route, flowState?.inputMode, sellTokenId, buyTokenId, configurationIdentity,
      basketComponents.map(component => [component.token.address, component.token.decimals, component.targetWeight])],
    { fees: activeFees, protocolFeeUsd, helpersFeeUsd, networkFeeEstimate, networkFeeUsd, totalFeeUsd,
      strategy: tradeFlow.strategy, helperFeePercent, issuanceFeePercent },
    !hasEnteredSwapAmount ? "empty" : quoteInputPending ? "loading" : activeQuoteStatus,
    isSubmittingSwap
  );
  const feeDisplay = retainedFees.value;
  const isFeeDisplayUpdating = hasEnteredSwapAmount &&
    ((areFeesUpdating && !isToleranceOnlyRefresh) || isDisplayRefreshing);

  const formatApproxDisplayValue = (
    amountUsd?: number,
    placeholder = displayAmountPlaceholder
  ) => {
    if (amountUsd === undefined || !Number.isFinite(amountUsd) || amountUsd <= 0) {
      return placeholder;
    }

    const formatted = formatDisplayValueFromUsd({
      amountUsd,
      priceDisplayMode: selectedPriceDisplayMode,
      goldSpotUsdPerOzt,
      formatFiat,
      formatGoldAmount,
    });

    return formatted ? `~ ${formatted}` : placeholder;
  };

  const formatApproxFiatValue = (
    amountUsd?: number,
    placeholder = displayAmountPlaceholder
  ) => {
    if (amountUsd === undefined || !Number.isFinite(amountUsd) || amountUsd < 0) {
      return placeholder;
    }

    return `~ ${formatFiat(amountUsd)}`;
  };

  // These strings retain presentation only; execution keeps its live quote.
  const feeText = (slot: string, current?: string, fiatAvailable = true) => {
    const cached = cachedTradeDisplay?.[slot];
    if (cached !== undefined && (restoreFormattedDisplay || activeQuoteStatus !== "success" || quoteInputPending || current === undefined || !fiatAvailable)) {
      return cached;
    }
    return current ?? "...";
  };
  const feeLabel = (slot: string, current: string, plain: string) =>
    cachedTradeDisplay?.[slot] && (restoreFormattedDisplay || activeQuoteStatus !== "success" || quoteInputPending)
      ? cachedTradeDisplay[slot] : feeDisplay.fees ? current : cachedTradeDisplay?.[slot] ?? plain;
  const feePresentation = {
    feeTotal: feeText("feeTotal", feeDisplay.totalFeeUsd !== undefined
      ? formatApproxFiatValue(feeDisplay.totalFeeUsd) : undefined),
    feeProtocolLabel: feeLabel("feeProtocolLabel",
      `${t("protocolFee")}${feeDisplay.strategy !== "market" && feeDisplay.issuanceFeePercent ? ` (${feeDisplay.issuanceFeePercent})` : ""}:`, `${t("protocolFee")}:`),
    feeProtocolValue: feeText("feeProtocolValue", feeDisplay.fees
      ? feeDisplay.strategy === "market" ? "—" : `${formatMeaningfulDecimalString(formatUnits(feeDisplay.fees.protocolFeeCygld, cygldDecimals), locale)} CYGLD (${feeDisplay.protocolFeeUsd !== undefined ? formatApproxFiatValue(feeDisplay.protocolFeeUsd) : "..."})` : undefined,
      feeDisplay.strategy === "market" || feeDisplay.protocolFeeUsd !== undefined),
    feeHelpersLabel: feeLabel("feeHelpersLabel",
      `${t("helpersFee")}${feeDisplay.strategy !== "market" && feeDisplay.helperFeePercent ? ` (${feeDisplay.helperFeePercent})` : ""}:`, `${t("helpersFee")}:`),
    feeHelpersValue: feeText("feeHelpersValue", feeDisplay.fees
      ? feeDisplay.strategy === "market" ? "—" : `${formatMeaningfulDecimalString(formatUnits(feeDisplay.fees.helperFeeCygld, cygldDecimals), locale)} CYGLD (${feeDisplay.helpersFeeUsd !== undefined ? formatApproxFiatValue(feeDisplay.helpersFeeUsd) : "..."})` : undefined,
      feeDisplay.strategy === "market" || feeDisplay.helpersFeeUsd !== undefined),
    feeApplicationLabel: feeLabel("feeApplicationLabel",
      `${t("applicationFee")}${feeDisplay.strategy === "market" && feeDisplay.helperFeePercent ? ` (${feeDisplay.helperFeePercent})` : ""}:`, `${t("applicationFee")}:`),
    feeApplicationValue: feeText("feeApplicationValue", feeDisplay.fees
      ? feeDisplay.strategy === "universal" ? `${formatMeaningfulDecimalString(formatUnits("marketFeeCygld" in feeDisplay.fees ? feeDisplay.fees.marketFeeCygld as bigint : 0n, cygldDecimals), locale)} CYGLD`
        : feeDisplay.strategy !== "market" ? "—" : `${formatMeaningfulDecimalString(formatUnits(feeDisplay.fees.helperFeeCygld, cygldDecimals), locale)} CYGLD (${feeDisplay.helpersFeeUsd !== undefined ? formatApproxFiatValue(feeDisplay.helpersFeeUsd) : "..."})` : undefined,
      feeDisplay.strategy !== "market" || feeDisplay.helpersFeeUsd !== undefined),
    feeNetworkValue: feeText("feeNetworkValue", feeDisplay.networkFeeEstimate
      ? `~ ${formatMeaningfulDecimalString(formatEther(feeDisplay.networkFeeEstimate.wei), locale)} ETH (${feeDisplay.networkFeeUsd !== undefined ? formatApproxFiatValue(feeDisplay.networkFeeUsd) : "..."})` : undefined,
      feeDisplay.networkFeeUsd !== undefined),
    feeMinimumOutput: feeText("feeMinimumOutput", minimumExecutionOutput !== loadingAmountPlaceholder ? minimumExecutionOutput : undefined),
  };
  const isFeeDisplayMuted = false;
  const feeValueClassName = cn(swapStyles.feeValue, isFeeDisplayMuted && "text-text-input-disabled");

  const formatAmountEquivalentDisplayValue = (
    amountUsd?: number,
    placeholder = amountEquivalentsPlaceholder
  ) => {
    if (amountUsd === undefined || !Number.isFinite(amountUsd) || amountUsd <= 0) {
      return placeholder;
    }

    const formatted = formatCombinedDisplayValueFromUsd({
      amountUsd,
      goldSpotUsdPerOzt,
      formatFiat,
      formatGoldAmount,
    });

    return formatted ? `~ ${formatted}` : placeholder;
  };

  const cygldUsdReferenceLabel = useMemo(() => {
    if (restoreFormattedDisplay && cachedTradeDisplay?.reference) return cachedTradeDisplay.reference;
    const currentCygldPriceUsd = Number.isFinite(displayedCygldPriceUsd)
        ? displayedCygldPriceUsd
        : undefined;

    if (currentCygldPriceUsd !== undefined) {
      const formatted = formatDisplayValueFromUsd({
        amountUsd: currentCygldPriceUsd,
        priceDisplayMode: selectedPriceDisplayMode,
        goldSpotUsdPerOzt,
        formatFiat,
        formatGoldAmount,
      });

      if (formatted) {
        return `1 CYGLD ≈ ${formatted}`;
      }
    }
    return cachedTradeDisplay?.reference ?? "1 CYGLD ≈ ...";
  }, [
    displayedCygldPriceUsd,
    formatFiat,
    formatGoldAmount,
    goldSpotUsdPerOzt,
    selectedPriceDisplayMode,
    cachedTradeDisplay?.reference,
    restoreFormattedDisplay,
  ]);

  const sellBasketComponentsUsdTotal = useMemo(() => {
    return computeBasketSideUsdTotal({
      tokenId: sellTokenId,
      basketComponents,
      prices: displayPrices,
      driverToken,
      driverAmountStr,
      derivedBasketAmountsAsStringMap,
      isSideInputEnabled: true,
      quotedComponents: [],
      locale,
    });
  }, [ sellTokenId, basketComponents, driverToken, driverAmountStr, derivedBasketAmountsAsStringMap, locale, displayPrices,
  ]);

  const buyBasketComponentsUsdTotal = useMemo(() => {
    return computeBasketSideUsdTotal({
      tokenId: buyTokenId,
      basketComponents,
      prices: displayPrices,
      driverToken,
      driverAmountStr,
      derivedBasketAmountsAsStringMap,
      isSideInputEnabled: false,
      quotedComponents: receiveQuote.components,
      locale,
    });
  }, [ buyTokenId, basketComponents, driverToken, driverAmountStr, derivedBasketAmountsAsStringMap, locale, receiveQuote.components, displayPrices,
  ]);

  const hasMissingSwapAmount =
    isIssueFromBasketExactIn
      ? !hasDerivedBasketAmounts
      : sellAmountBigInt <= 0n;

  const swapActionError = useMemo(() => {
    if (isProtocolPaused && (!isActiveTokenFlow || (tradeFlow.strategy === "core" || (tradeFlow.selected?.value.strategy === "universal" && tradeFlow.selected.value.routeFamily !== "market")))) {
      return t("protocolPausedSwapBlocked");
    }
    if (tokenFlowAdapterError) {
      return tokenFlowAdapterError;
    }

    if (isSellAmountOverWalletBalance) {
      return t("reduceAmountToBalance");
    }
    if (isPurchaseOverCap) return isPurchaseCapacityExhausted ? t("cygldSupplyCapReached") : t("reduceAmountToSupplyLimit");
    if (activeQuoteStatus === "failed") {
      if (isIssuanceCapError) return isIssuanceCapacityExhausted
        ? t("cygldSupplyCapReached") : t("reduceAmountToSupplyLimit");
      return activeQuoteError;
    }
    return undefined;
  }, [
    isProtocolPaused,
    isActiveTokenFlow,
    tradeFlow.strategy,
    tradeFlow.selected,
    tokenFlowAdapterError,
    activeQuoteStatus,
    activeQuoteError,
    isIssuanceCapError,
    isIssuanceCapacityExhausted,
    isPurchaseOverCap,
    isPurchaseCapacityExhausted,
    isSellAmountOverWalletBalance,
    t,
  ]);

  const hasMissingFlowQuotes = !activeFlow ||
    activeQuoteStatus !== "success" || !activeFlow.canSubmit;
  const isSwapDataLoading = hasEnteredSwapAmount && (isConfigurationLoading ||
    ((showSellBasket || showBuyBasket) && basket.isLoading));

  const isWalletOnWrongNetwork = isConnected && connectedChainId !== EXPECTED_CHAIN_ID;
  const isSwapActionDisabled =
    isSubmittingSwap ||
    (isActiveTokenFlow && !isTokenFlowAdapterReady) ||
    isWalletOnWrongNetwork ||
    isQuoteLoading ||
    quoteInputPending ||
    hasMissingFlowQuotes ||
    !!swapActionError ||
    hasMissingSwapAmount ||
    isTokenSellAmountOverWalletBalance;

  const shouldMuteQuotedBuyAmounts = false;

  const shouldBlockQuotedBuyInput = isQuoteLoading;
  const shouldHideQuotedBasketBuyAmounts = shouldBlockQuotedBuyInput && !localBasketPrefill;

  const hasProgressiveBuyEstimate = (isIssueFromTokenExactIn || isRedeemToTokenExactIn || isIssueFromBasketExactIn) &&
    (activeQuoteStatus === "loading" || quoteInputPending) && !retainedReceiveQuote.retained && receiveQuote.mainRaw > 0n;
  const liveDisplayedQuotedBuyAmount = formatMeaningfulDecimalString(receiveQuote.main, locale);
  const keepCompletedQuotePresentation = !isSpendAmountZero && cachedTradeDisplay?.quoteComplete === "true" &&
    (quoteInputPending || activeQuoteStatus !== "success");
  const showPurchaseSpending = !showSellBasket;
  const readySpendingQuote = activeQuoteStatus === "success" && !quoteInputPending
    ? selectedQuote ?? (isRedeemToBasketExactIn ? { quotedInput: editedSellAmount, inputMaximum: editedSellAmount } : undefined)
    : undefined;
  const indicativeSpending = !readySpendingQuote && activeQuoteStatus !== "failed" && localTradeEstimate?.quotedInput !== undefined
    // The range models output capacity. Universal execution still acquires the full declared input.
    ? { quotedInput: editedSellAmount, inputMaximum: editedSellAmount } : undefined;
  const currentPurchaseSpending = showPurchaseSpending ? purchaseBudgetAmounts(editedSellAmount,
    readySpendingQuote ?? indicativeSpending) : undefined;
  const formatBudgetAmount = (amount: bigint) => `${formatNumberWithSpaces(formatUnits(amount, sellTokenDecimals ?? 18), locale)} ${sellTokenDisplaySymbol}`;
  const cachedSpendingValue = cachedTradeDisplay?.purchaseSpendingValue ?? cachedTradeDisplay?.purchaseEstimatedSpend;
  const purchaseSpendingPresentation = keepCompletedQuotePresentation && cachedSpendingValue ? {
    purchaseSpendingVisible: String(showPurchaseSpending),
    purchaseSpendingValue: cachedSpendingValue,
    purchaseSpendingLimited: cachedTradeDisplay?.purchaseSpendingLimited ?? String(Boolean(cachedTradeDisplay?.purchaseEstimatedSpend)),
  } : {
    purchaseSpendingVisible: String(showPurchaseSpending),
    purchaseSpendingValue: currentPurchaseSpending ? formatBudgetAmount(currentPurchaseSpending.spending) : "…",
    purchaseSpendingLimited: String(currentPurchaseSpending !== undefined && !currentPurchaseSpending.matchesBudget),
  };
  const purchaseSpendingLimited = purchaseSpendingPresentation.purchaseSpendingLimited === "true";
  const spendAmountLabel = buyTokenId === cygldTokenId ? t("purchaseBudgetLabel") : t("youSell");
  // A cleared draft and a rejected, never-qualified estimate cannot restore
  // their own cached placeholder/value. Confirmed refresh retention is above.
  const displayedQuotedBuyAmount = isSpendAmountZero ? zeroAmountPlaceholder
    : keepCompletedQuotePresentation ? cachedTradeDisplay?.buyAmount
    : liveDisplayedQuotedBuyAmount || (activeQuoteStatus !== "failed" ? cachedTradeDisplay?.buyAmount : undefined);

  const sellAmountPlaceholderText = zeroAmountPlaceholder;
  const buyAmountPlaceholderText = isSpendAmountZero ? zeroAmountPlaceholder : loadingAmountPlaceholder;
  const zeroAmountEquivalents = `~ ${formatCombinedDisplayValueFromUsd({
    amountUsd: 0, formatFiat, formatGoldAmount,
  })}`;
  const spendingUsd = currentPurchaseSpending && sellTokenDecimals !== undefined && sellPriceUsd !== undefined
    ? Number(formatUnits(currentPurchaseSpending.spending, sellTokenDecimals)) * sellPriceUsd : undefined;
  const spendingValueMatchesCache = purchaseSpendingPresentation.purchaseSpendingValue === cachedSpendingValue;
  const cachedSpendingEquivalent = spendingValueMatchesCache ? cachedTradeDisplay?.purchaseSpendingEquivalent : undefined;
  const spendingEquivalent = (keepCompletedQuotePresentation || restoreFormattedDisplay) && cachedSpendingEquivalent
    ? cachedSpendingEquivalent : currentPurchaseSpending?.spending === 0n ? zeroAmountEquivalents
    : currentPurchaseSpending ? formatAmountEquivalentDisplayValue(spendingUsd, cachedSpendingEquivalent ?? amountEquivalentsPlaceholder)
    : "…";
  const sellAmountEquivalentsPlaceholderText = isSpendAmountZero ? zeroAmountEquivalents : cachedTradeDisplay?.sellEquivalent ?? amountEquivalentsPlaceholder;
  const buyAmountEquivalentsPlaceholderText = isSpendAmountZero ? zeroAmountEquivalents : shouldBlockQuotedBuyInput
    ? cachedTradeDisplay?.buyEquivalent ?? loadingAmountEquivalentsPlaceholder
    : cachedTradeDisplay?.buyEquivalent ?? amountEquivalentsPlaceholder;
  const sellMobileAmountEquivalentDisplayValue = restoreFormattedDisplay && cachedTradeDisplay?.sellEquivalent
    ? cachedTradeDisplay.sellEquivalent : isSpendAmountZero ? zeroAmountEquivalents : isSellBasket
    ? formatAmountEquivalentDisplayValue(
        sellBasketComponentsUsdTotal,
        sellAmountEquivalentsPlaceholderText
      )
    : sellAmountUsdApprox !== undefined
        ? formatAmountEquivalentDisplayValue(sellAmountUsdApprox, sellAmountEquivalentsPlaceholderText)
        : sellAmountEquivalentsPlaceholderText;
  const buyMobileAmountEquivalentDisplayValue = isSpendAmountZero ? zeroAmountEquivalents
    : (restoreFormattedDisplay || keepCompletedQuotePresentation) && cachedTradeDisplay?.buyEquivalent
    ? cachedTradeDisplay.buyEquivalent : isBuyBasket
    ? formatAmountEquivalentDisplayValue(
        buyBasketComponentsUsdTotal,
        buyAmountEquivalentsPlaceholderText
      )
    : buyAmountUsdApprox !== undefined
        ? formatAmountEquivalentDisplayValue(buyAmountUsdApprox, buyAmountEquivalentsPlaceholderText)
        : buyAmountEquivalentsPlaceholderText;

  const balancePresentation = (side: "sell" | "buy", tokenId: string) => {
    const token = displayAllTokens.find(token => token.id === tokenId);
    const liveBalance = isConnected ? walletBalanceByTokenId[tokenId] : undefined;
    if (isNativeOrErc20Token(token) && liveBalance !== undefined) {
      return {
        text: `${formatWalletBalanceAmount(liveBalance, token.decimals, locale)} ${token.symbol}`,
        label: walletBalancesT("balance", {
          amount: formatNumberWithSpaces(formatUnits(liveBalance, token.decimals), locale), symbol: token.symbol,
        }),
      };
    }
    return {
      text: cachedWalletMatches ? cachedTradeDisplay?.[`${side}Balance`] ?? "" : "",
      label: cachedWalletMatches ? cachedTradeDisplay?.[`${side}BalanceLabel`] ?? cachedTradeDisplay?.[`${side}Balance`] ?? "" : "",
    };
  };
  const sellBalancePresentation = balancePresentation("sell", sellTokenId);
  const previousRows = matchingTradeDisplay?.basketRows ??
    (savedTradeDisplay?.scopeKey === storedDisplayScopeKey ? savedTradeDisplay.basketRows : undefined) ?? [];
  const basketComponentWarnings: Record<string, boolean> = {};
  const basketRowsFor = (side: "sell" | "buy"): TradeBasketDisplayRow[] => {
    if ((side === "sell" ? !showSellBasket : !showBuyBasket)) return [];
    if (!hasBasketComponents) return previousRows.filter(row => row.side === side).map(row => ({ ...row,
      amount: side === "buy" && isSpendAmountZero ? zeroAmountPlaceholder
        : matchingTradeDisplay ? row.amount : side === "sell" && row.address === driverToken ? driverAmountStr : "",
      equivalent: side === "buy" && isSpendAmountZero ? zeroAmountEquivalents
        : matchingTradeDisplay ? row.equivalent : amountEquivalentsPlaceholder,
      driver: side === "sell" && row.address === driverToken,
    }));
    return basketComponents.map((component, index) => {
      const address = component.token.address;
      const driver = address === driverToken;
      const previous = matchingTradeDisplay?.basketRows?.find(row => row.side === side && row.tokenId === component.token.id);
      const amount = side === "sell" ? driver ? driverAmountStr : derivedBasketAmountsAsStringMap[address] ?? ""
        : keepCompletedQuotePresentation && previous ? previous.amount : receiveQuote.components.length
          ? formatMeaningfulDecimalString(receiveQuote.components[index] ?? "", locale)
          : isSpendAmountZero ? zeroAmountPlaceholder : shouldHideQuotedBasketBuyAmounts ? loadingAmountPlaceholder : zeroAmountPlaceholder;
      if (side === "sell") basketComponentWarnings[component.token.id] = isBasketComponentAmountOverWalletBalance(component, amount);
      const price = displayPrices[component.token.id];
      const equivalent = side === "buy" && isSpendAmountZero ? zeroAmountEquivalents
        : side === "buy" && keepCompletedQuotePresentation && previous ? previous.equivalent :
        price !== undefined ? formatApproxDisplayValue((parseDisplayNumber(amount, locale) ?? 0) * price,
          previous?.equivalent ?? displayAmountPlaceholder) : previous?.equivalent ?? displayAmountPlaceholder;
      return { side, tokenId: component.token.id, symbol: component.token.symbol, address,
        weight: `${Number(component.targetWeight) / 1_000_000 * 100}%`, amount, equivalent,
        label: t(side === "sell" ? "sellAmount" : "buyAmount", { symbol: component.token.symbol }), driver };
    });
  };
  const sellBasketPresentation = basketRowsFor("sell");
  const buyBasketPresentation = basketRowsFor("buy");
  const sellBasketEquivalent = formatAmountEquivalentDisplayValue(isSpendAmountZero ? 0 : sellBasketComponentsUsdTotal,
    cachedTradeDisplay?.sellBasketEquivalent ?? sellAmountEquivalentsPlaceholderText);
  const buyBasketEquivalent = keepCompletedQuotePresentation && cachedTradeDisplay?.buyBasketEquivalent
    ? cachedTradeDisplay.buyBasketEquivalent : formatAmountEquivalentDisplayValue(isSpendAmountZero ? 0 : buyBasketComponentsUsdTotal,
      cachedTradeDisplay?.buyBasketEquivalent ?? buyAmountEquivalentsPlaceholderText);
  const mainActionCurrent = !isConnected ? t("pleaseConnectWallet") : isWalletOnWrongNetwork
    ? t("wrongNetwork", { network: targetChainName }) : swapActionError ??
      (isQuoteLoading || isSwapDataLoading || quoteInputPending ? `${quoteProcessingLabel}${displayedQuoteProgressPercent > 0 ? ` ${displayedQuoteProgressPercent}%` : ""}` :
        isSwapActionDisabled ? t("enterValidAmountsForSwap") : t("swapCurrencies"));
  const mainActionPresentation = !isSubmittingSwap && cachedTradeDisplay?.mainAction &&
    ((restoringWalletAddress && !isConnected) || (!swapActionError && !isWalletOnWrongNetwork &&
      (isQuoteLoading || isSwapDataLoading || quoteInputPending || (keepCompletedQuotePresentation && isSwapActionDisabled))))
    ? cachedTradeDisplay.mainAction : mainActionCurrent;

  // This is a presentation snapshot; it never restores a quote or execution plan.
  useLayoutEffect(() => {
    if (!hasHydratedPersistedSwapForm) return;
    if (!finishTradeDisplayBootstrap()) return;
    if (displayScopeKey !== storedDisplayScopeKey) return;
    const snapshot: TradeDisplaySnapshot = {
      intentKey: displayIntentKey, scopeKey: displayScopeKey,
      basketRows: [...sellBasketPresentation, ...buyBasketPresentation],
      values: {
        sellIsBasket: String(showSellBasket), buyIsBasket: String(showBuyBasket),
        sellBasketEquivalent, buyBasketEquivalent,
        walletVisible: String(showWalletPresentation), walletAddress: isConnected ? address?.toLowerCase() ?? "" :
          cachedWalletMatches ? cachedTradeDisplay?.walletAddress ?? "" : "",
        walletFilter: String(showOnlyWalletTokens), sellBalance: sellBalancePresentation.text,
        sellBalanceLabel: sellBalancePresentation.label,
        mainAction: isSubmittingSwap ? cachedTradeDisplay?.mainAction ?? t("swapCurrencies") : mainActionPresentation,
        quoteComplete: String((activeQuoteStatus === "success" && !quoteInputPending) || keepCompletedQuotePresentation),
        retentionDisclosure: document.querySelector('[data-trade-live] [data-trade-display="retentionDisclosure"]')?.textContent ?? "",
        evaluationStatus,
        sellTokenId, buyTokenId, sellSymbol: sellTokenDisplaySymbol, buySymbol: buyTokenDisplaySymbol,
        sellAmount: showSellBasket ? driverAmountStr : sellAmount,
        spendAmountField: showSellBasket ? "driverAmountStr" : "sellAmount",
        spendAmountLabel,
        pendingEquivalent: amountEquivalentsPlaceholder,
        buyAmount: displayedQuotedBuyAmount || buyAmountPlaceholderText,
        sellEquivalent: sellMobileAmountEquivalentDisplayValue,
        buyEquivalent: buyMobileAmountEquivalentDisplayValue,
        reference: cygldUsdReferenceLabel,
        ...purchaseSpendingPresentation,
        purchaseSpendingEquivalent: spendingEquivalent,
        spendingZeroEquivalent: zeroAmountEquivalents,
        ...feePresentation,
        feeProtocolPlainLabel: `${t("protocolFee")}:`,
        feeHelpersPlainLabel: `${t("helpersFee")}:`,
        feeApplicationPlainLabel: `${t("applicationFee")}:`,
      },
    };
    latestTradeDisplay.current = snapshot;
    writeTradeDisplaySnapshot(tradeDisplaySnapshotStorageKey(EXPECTED_CHAIN_ID, locale), snapshot);
  });

  // Reversal changes the spend asset, so begin a fresh input-driven intent.
  const handleToggleDirection = useCallback(() => {
    shouldFocusEditableInputRef.current = true;
    setSellTokenId(buyTokenId);
    setBuyTokenId(sellTokenId);
    setSellAmount("");
    setSellAmountRawOverride(undefined);
    setDriverToken(undefined);
    setDriverAmountStr("");
    setDriverAmountRawOverride(undefined);
    setBasketMaxAmounts(undefined);
    setDisplayedQuoteProgressPercent(0);
  }, [buyTokenId, sellTokenId]);

  // An amount survives token selection only when its spend asset and units do.
  const resetQuoteStateForTokenChange = useCallback((params: {
    nextSellTokenId: string;
    nextBuyTokenId: string;
    changedSide: "sell" | "buy";
  }) => {
    if (params.nextSellTokenId === sellTokenId) return;
    setSellAmount("");
    setSellAmountRawOverride(undefined);
    setDriverToken(undefined);
    setDriverAmountStr("");
    setDriverAmountRawOverride(undefined);
    setBasketMaxAmounts(undefined);
  }, [sellTokenId]);

  // Keep CYGLD on exactly one side, choosing a valid counterpart when sell becomes CYGLD.
  const handleSellTokenChange = (value: string) => {
    if (value === sellTokenId) {
      setIsSellModalOpen(false);
      return;
    }
    const nextBuyTokenId =
      value === cygldTokenId
        ? [buyTokenId, sellTokenId].find((tokenId) =>
            tokensWithoutCygld.some((token) => token.id === tokenId)
          ) ??
          tokensWithoutCygld.find((token) => token.id === goldBasketId)?.id ??
          tokensWithoutCygld[0]?.id ??
          ""
        : cygldTokenId;
    setSellTokenId(value);
    setBuyTokenId(nextBuyTokenId);
    resetQuoteStateForTokenChange({
      nextSellTokenId: value,
      nextBuyTokenId,
      changedSide: "sell",
    });
    setIsSellModalOpen(false);
  };

  // Every receive asset is selectable; keep CYGLD on exactly one side.
  const handleBuyTokenChange = (value: string) => {
    if (value === buyTokenId) {
      setIsBuyModalOpen(false);
      return;
    }
    const nextSellTokenId = value === cygldTokenId
      ? (sellTokenId !== cygldTokenId ? sellTokenId
        : tokensWithoutCygld.find(token => token.id === buyTokenId)?.id
          ?? tokensWithoutCygld.find(token => token.id === goldBasketId)?.id
          ?? tokensWithoutCygld[0]?.id ?? "")
      : cygldTokenId;
    setSellTokenId(nextSellTokenId);
    setBuyTokenId(value);
    resetQuoteStateForTokenChange({
      nextSellTokenId,
      nextBuyTokenId: value,
      changedSide: "buy",
    });
    setIsBuyModalOpen(false);
  };

  // Submission and wallet confirmation.
  const handleSwapClick = async () => {

    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    if (isSwapActionDisabled || !address || !publicClient || !activeFlow) return;
    // The accepted visible amount supersedes any earlier MAX response.
    sellMaxRequestRef.current++;
    basketMaxRequestRef.current++;
    basketMaxAbortRef.current?.abort();
    // Capture the execution closure and visible terms before the first await.
    const executionFlow = activeFlow;
    const selectedTrade = isActiveTokenFlow ? tradeFlow.selected : undefined;
    const diagnostics = createSwapDiagnostics({ ...diagnosticContext, ...activeQuoteReferences },
      activeQuoteReferences.attemptId ?? quoteDiagnostics.current?.id);
    setSwapFailureReference(undefined);
    let executionHelpers: Address;
    try { executionHelpers = requireProtocolAddress((activeUniversalQuote?.deployment.helpers as Address | undefined) ?? selectedTrade?.deployment?.helpers ?? HELPERS_DIAMOND_ADDRESS, "Helpers"); }
    catch (error) {
      diagnostics.failed(error); setSwapFailureReference(diagnosticReference(error) ?? diagnostics.id);
      toast.error(t("transactionFailed"), { description: t("transactionFailedDescription") }); return;
    }
    const receiptInput = isNativeOrErc20Token(sellToken) ? sellToken : undefined;
    const receiptOutput = isNativeOrErc20Token(buyToken) ? buyToken : undefined;
    setConfirmedTrade(undefined);
    const frozenSelection = selectedTrade && captureTradeQuote(selectedTrade);
    setFrozenTrade(frozenSelection);
    setFrozenUniversal(activeUniversalQuote && structuredClone(activeUniversalQuote));
    if (frozenSelection?.value.strategy === "universal" && isEconomicQuote(frozenSelection.value)) {
      observeTradeSelection({ attemptId: diagnostics.id, economicQuote: frozenSelection.value,
        deployment: frozenSelection.deployment, diagnostics: frozenSelection.diagnostics });
    } else if (frozenSelection) {
      observeTradeSelection({ attemptId: diagnostics.id, quote: frozenSelection.value,
        deployment: frozenSelection.deployment, diagnostics: frozenSelection.diagnostics,
        intent: { ...tradeInput, deadline: frozenSelection.value.providerRequest.deadline } });
    } else if (activeUniversalQuote) {
      observeTradeSelection({ attemptId: diagnostics.id, ...(isEconomicQuote(activeUniversalQuote)
        ? { economicQuote: structuredClone(activeUniversalQuote) } : { universalQuote: structuredClone(activeUniversalQuote) }),
        deployment: { core: addresses.core, helpers: activeUniversalQuote.deployment.helpers as Address, adapter: activeUniversalQuote.deployment.adapter as Address } });

    }
    const confirmSelectedTransaction = async (hash: Hex) => {
      const receipt = await diagnostics.confirm(() => confirmTransaction(hash));
      if (selectedTrade || activeUniversalQuote) {
        const measured = tradeReceipt(receipt.logs, executionHelpers, address, selectedTrade?.value.strategy ?? "universal",
          (selectedTrade?.value.tokenIn ?? activeUniversalQuote?.inputs[0]?.currency) as Address);
        if (measured) setConfirmedTrade({ receipt: measured, input: receiptInput, output: receiptOutput });
      }
      return receipt;
    };
    // Supported atomic accounts retain priority. "ready" may use non-atomic
    // SDK request batching; this app never requests an account upgrade.
    const atomicStatus = walletAtomic.data;
    let walletBatch: WalletSwapBatch | undefined;
    const requiredBalances = isIssueFromBasketExactIn
      ? basketComponents.map((component, index) => ({ tokenId: component.token.id,
          amount: issueFromBasketExactInFlow.amountsInUsed?.[index] ?? 0n }))
      : [{ tokenId: sellTokenId, amount: frozenSelection?.inputMaximum ?? editedSellAmount }];
    setIsSubmittingSwap(true);
    diagnostics.stage("balance");
    try {
      // These fresh observations are independent. Both retain their existing
      // checks before any wallet prompt; neither waits for the other to start.
      const [snapshot, , preparedBatch] = await Promise.all([
        readWalletBalancesForSwap(requiredBalances.map(row => row.tokenId)).catch(error => {
          diagnostics.stage("balance");
          throw new Error(t("swapBalanceRefreshFailed"), { cause: error });
        }),
        (async () => {
          if (!requiresTokenFlowAdapter) return;
          if (!hasConfiguredTokenFlowAdapter || !tokenFlowAdapter) {
            throw new Error(t("tokenSwapAdapterInvalid"));
          }
          const facts = await fetchHelpersRouterFacts(undefined, fetch, tokenFlowAdapter)
            .catch(error => {
              if (error instanceof QuotePreviewError) throw error;
              throw new Error(t("tokenSwapAdapterApprovalUnavailable"));
            });
          const approved = (() => {
            try { return adapterApprovalFromFacts(facts, tokenFlowAdapter); }
            catch { throw new Error(t("tokenSwapAdapterApprovalUnavailable")); }
          })();
          if (approved !== true) throw new Error(t("tokenSwapAdapterNotApproved"));
          const codePresent = (() => {
            try { return adapterCodePresentFromFacts(facts); }
            catch { throw new Error(t("tokenSwapAdapterApprovalUnavailable")); }
          })();
          if (!codePresent) throw new Error(t("tokenSwapAdapterInvalid"));
        })().catch(error => { diagnostics.stage("preparation"); throw error; }),
        walletClient ? prepareWalletSwapBatch(walletClient, address, executionHelpers, {
          chainId: targetChainId, atomicStatus,
          getProvider: () => resolveActiveProvider(connector ?? null),
          waitReceipt: hash => waitForAppTransactionReceipt(publicClient, { hash }),
        }).catch(error => { diagnostics.stage("preparation"); throw error; }) : undefined,
      ]);
      walletBatch = preparedBatch;
      diagnostics.stage("balance");
      const issue = checkSwapWalletBalances(snapshot, requiredBalances);
      if (issue) {
        const symbol = tokensListWithBasket.find(token => token.id === issue.tokenId)?.symbol ?? issue.tokenId.toUpperCase();
        throw new Error(t(issue.reason === "unavailable" ? "swapBalanceUnavailable" : "swapBalanceInsufficient", { symbol }));
      }
    } catch (error) {
      diagnostics.failed(error);
      setSwapFailureReference(diagnosticReference(error) ?? diagnostics.id);
      setIsSubmittingSwap(false);
      setFrozenTrade(undefined);
      setFrozenUniversal(undefined);
      toast.error(t("transactionFailed"), { description: error instanceof QuotePreviewError ? quoteErrorMessage(error, t)
        : error instanceof Error ? error.message : t("swapBalanceRefreshFailed") });
      return;
    }
    try {
      diagnostics.stage("network");
      // The wallet may have switched networks during the balance read.
      await assertWalletOnExpectedChain(walletClient);
    } catch (error) {
      diagnostics.failed(error);
      setSwapFailureReference(diagnosticReference(error) ?? diagnostics.id);
      setIsSubmittingSwap(false);
      setFrozenTrade(undefined);
      setFrozenUniversal(undefined);
      toast.error(t("wrongNetwork", { network: targetChainName }));
      return;
    }

    diagnostics.stage("preparation");
    let shouldCleanUpSubmittedSwap = false;
    let submittedHash: Hex | undefined;
    let submittedBatch: WalletBatchSubmission | undefined;
    const confirmBatch = async (submission: WalletBatchSubmission) => {
      const result = await diagnostics.confirm(() => submission.wait());
      announceTransactionSuccess(result.transactionHash);
      if (result.logs && (selectedTrade || activeUniversalQuote)) {
        const measured = tradeReceipt(result.logs, executionHelpers, address, selectedTrade?.value.strategy ?? "universal", (selectedTrade?.value.tokenIn ?? activeUniversalQuote?.inputs[0]?.currency) as Address);
        if (measured) setConfirmedTrade({ receipt: measured, input: receiptInput, output: receiptOutput });
      }
      return result;
    };
    setWalletConfirmationProgress({
      current: 0,
      total: 0,
      label: "Preparing MetaMask confirmations",
    });
    walletConfirmationCurrentStepRef.current = 0;
    walletConfirmationTotalStepsRef.current = 0;
    const feeEstimate = new AbortController();

    try {
      const submission = await executionFlow.submit({
        owner: address,
        recipient: address,
        feeEstimateSignal: feeEstimate.signal,
        walletBatch,
        diagnosticStage: diagnostics.stage,
        walletConfirmationTracker: {
          setTotal: walletConfirmationTracker.setTotal,
          requestNext(kind, label) {
            diagnostics.walletStep(kind);
            walletConfirmationTracker.requestNext(kind, label);
          },
        },
      });
      submittedHash = typeof submission === "string" ? submission : undefined;
      submittedBatch = typeof submission === "string" ? undefined : submission;
      diagnostics.submitted(submittedHash ?? submittedBatch?.transactionHashes?.at(-1));
      // Either a returned transaction hash or bundle ID means submitted. A
      // later confirmation outage does not make this attempt safe to resend.
      shouldCleanUpSubmittedSwap = true;
      resetWalletConfirmationProgress();
      if (typeof submission === "string") await confirmSelectedTransaction(submission);
      else await confirmBatch(submission);

    } catch (error) {
      if (error instanceof WalletRequestBatchStoppedError) {
        // An approval hash is not evidence that the Helpers swap was sent.
        // Only a known Helpers hash makes this submitted. Approval-only stops
        // retain the form; every stopped batch retains its public diagnostics.
        reportWalletRequestBatchDiagnostic({ outcome: "stopped", transactionHashes: error.transactionHashes });
        if (error.submission) {
          submittedBatch = error.submission;
          shouldCleanUpSubmittedSwap = true;
          diagnostics.submitted(submittedBatch.transactionHashes?.at(-1));
        }
        if (error.transactionHashes.length) void refreshWalletBalances();
      }
      diagnostics.failed(error);
      setSwapFailureReference(diagnosticReference(error) ?? diagnostics.id);
      const outcome = swapFailureOutcome(error, Boolean(submittedHash || submittedBatch));
      const reason = diagnosticReason(error);
      const knownRouteErrors = [t("tokenSwapAdapterInvalid"), t("tokenSwapAdapterApprovalUnavailable"), t("tokenSwapAdapterNotApproved")];
      const message = error instanceof Error && knownRouteErrors.includes(error.message)
        ? error.message
        : error instanceof Error && error.message === "Permit2 address is unavailable"
          ? t("authorizationUnavailable")
          : reason === "wallet_rejected" ? t("transactionCancelledDescription")
            : t("transactionFailedDescription");
      if (submittedHash) {
        const hash = submittedHash;
        setTransactionNotice({ hash, outcome: outcome === "reverted" ? "reverted" : "unconfirmed",
          recheck: () => confirmSelectedTransaction(hash) });
      } else if (submittedBatch) {
        const submission = submittedBatch;
        setTransactionNotice({ batchId: submission.id, hash: submission.transactionHashes?.at(-1), outcome,
          recheck: () => confirmBatch(submission) });
      }
      if (outcome === "unconfirmed") {
        toast.info(t("confirmationUnavailable"), { description: t("confirmationUnavailableDescription") });
      } else if (outcome === "reverted") {
        toast.error(t("transactionReverted"), { description: t("transactionRevertedDescription") });
      } else if (reason === "wrong_chain") {
        toast.error(t("wrongNetwork", { network: targetChainName }));
      } else {
        toast.error(t(reason === "wallet_rejected" ? "transactionCancelled" : "transactionFailed"), { description: message });
      }
    } finally {
      // A late fee hint cannot update the next form after this attempt ends.
      feeEstimate.abort();
      resetWalletConfirmationProgress();
      if (shouldCleanUpSubmittedSwap) {
        setIsSubmittedSwapCleanupInProgress(true);
        clearSubmittedSwapFormState();
        await refreshWalletBalances();
        // Render cleared inputs and refreshed balances before restoring token balance warnings.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        setIsSubmittedSwapCleanupInProgress(false);
      }
      setIsSubmittingSwap(false);
      setFrozenTrade(undefined);
      setFrozenUniversal(undefined);
    }
  };

  const submittingSwapButtonLabel = useMemo(() => {
    const isIssueFromNativeEthFlow =
      isNativeEthToken(sellToken) &&
      (isIssueFromTokenExactIn);

    const translateConfirmationLabel = (label: string) => {
      if (isIssueFromNativeEthFlow) {
        switch (label) {
          case "Wrap ETH to WETH":
            return t("wrapEthToWeth");
          case "Token approval":
            return t("approveWethForIssuingCygld");
          case "Permit signature":
          case "Token permit signature":
            return t("signWethPermit");
          case "Transaction confirmation":
            return t("issueCygldFromWeth");
          case "Unwrap WETH to ETH":
            return t("unwrapRemainingWethToEth");
          default:
            return label;
        }
      }

      switch (label) {
        case "Wrap ETH to WETH":
          return t("wrapEthToWeth");
        case "Token approval":
          return t("tokenApproval");
        case "Permit signature":
        case "Token permit signature":
          return t("permitSignature");
        case "Transaction confirmation":
          return t("transactionConfirmation");
        case "Unwrap WETH to ETH":
          return t("unwrapWethToEth");
        default:
          return label;
      }
    };

    if (!walletConfirmationProgress) {
      return isIssueFromNativeEthFlow
        ? t("processingEthIssueFlow")
        : t("processingTransaction");
    }

    if (walletConfirmationProgress.total <= 0) {
      return isIssueFromNativeEthFlow
        ? t("preparingEthIssueFlowConfirmations")
        : t("preparingMetaMaskConfirmations");
    }

    if (walletConfirmationProgress.current <= 0) {
      if (isIssueFromNativeEthFlow) {
        return t("metamaskWillRequestEthIssueFlowConfirmations");
      }
      const confirmationLabel = walletConfirmationProgress.total === 1
        ? t("confirmationSingular")
        : t("confirmationPlural");
      return t("metamaskWillRequestConfirmations", {
        count: walletConfirmationProgress.total,
        confirmationLabel,
      });
    }

    return t("metamaskConfirmationProgress", {
      current: walletConfirmationProgress.current,
      total: walletConfirmationProgress.total,
      label: translateConfirmationLabel(walletConfirmationProgress.label),
    });
  }, [
    isIssueFromTokenExactIn,
    sellToken,
    t,
    walletConfirmationProgress,
  ]);

  return (
    <div className="swap-page-background relative z-10 flex flex-1 flex-col justify-start overflow-x-clip overflow-y-visible py-6 transition-colors duration-300">
      <div aria-hidden="true" className="swap-page-backdrop" />
      <div className="relative z-10 mx-auto w-full min-w-0 max-w-lg px-3 sm:max-w-xl sm:px-6 lg:max-w-2xl lg:px-10">
          <div className="relative">
            <div
              aria-hidden="true"
              className="glass-container swap-panel-underlay pointer-events-none absolute -inset-x-[1cm] -inset-y-[1cm] rounded-[calc(1.5rem+1cm)]"
            />
            <section id="swapsection" data-trade-evaluation={evaluationStatus}
              className="glass-container swap-panel-surface relative z-10 flex w-full min-w-0 flex-col rounded-3xl p-3 sm:p-5 lg:p-6"
            >
            <MarketDataFreshnessNotice
              className="mb-3"
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
            {/* Protocol availability */}
            {shouldShowBasketWarning && (sellTokenId === goldBasketId || buyTokenId === goldBasketId) && (
              <div className={basketWarningClassName}>
                <p className="font-semibold">{t("basketReadErrorTitle")}</p>

                <p className="mt-1">
                  {basketReadFailed ? basket.error instanceof QuotePreviewError
                    ? quoteErrorMessage(basket.error, t) : t("basketReadErrorRpc") : t("basketReadErrorEmpty")}
                </p>

              </div>
            )}

        {/* Sell form */}

        <div className={cn("relative", isSellModalOpen && "z-40")}>
          <div className="flex flex-wrap items-end justify-between mb-2 gap-2">
            <div className="flex items-center gap-2">
              <label id="sell-amount-label" data-trade-display="spendAmountLabel" htmlFor={!showSellBasket ? "sell-amount" : undefined} className="text-sm text-text-input">{spendAmountLabel}</label>
            </div>
            <div data-trade-wallet hidden={!showWalletPresentation} className="flex items-center gap-2 p-1 text-text-input bg-background-badge rounded-2xl">
              <label htmlFor="wallet-only-tokens" className="text-xs">
                <span className="hidden md:inline">{t('showOnlyWalletTokens')}</span>
                <span className="md:hidden">{t('showOnlyWalletTokensShort')}</span>
              </label>
              <button data-trade-wallet-filter data-slot="switch" id="wallet-only-tokens" type="button" role="switch"
                aria-label={t('showOnlyWalletTokens')} aria-checked={showOnlyWalletTokens}
                data-state={showOnlyWalletTokens ? "checked" : "unchecked"}
                onClick={() => setShowOnlyWalletTokens(current => !current)}
                className="peer data-[state=checked]:bg-primary data-[state=checked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50">
                <span data-slot="switch-thumb" data-state={showOnlyWalletTokens ? "checked" : "unchecked"}
                  className="block size-4 rounded-full bg-white shadow-sm border ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 dark:bg-white" />
              </button>
            </div>
          </div>
          <div className={cn(swapStyles.amountBox, isPurchaseOverCap ? "ring-1 ring-red-500" : isTokenSellAmountOverWalletBalance && "ring-1 ring-text-amber")}>
            <div className="flex items-center justify-between gap-2 sm:gap-4">
              <div className="relative min-w-0 flex-1">

                <>
                  <button data-trade-basket="sell" hidden={!showSellBasket}
                    type="button"
                    disabled={isSubmittingSwap}
                    className={swapStyles.basketSummary}
                    aria-label={t("editSellBasketAmounts")}
                    onClick={() => {
                      shouldFocusEditableInputRef.current = true;

                      requestAnimationFrame(() => {
                        basketSellInputRefs.current[0]?.focus();
                      });
                    }}
                  >
                    <span className="hidden text-2xl sm:block text-text-minor-data">
                      {t("basketAssets")}
                    </span>

                    <span data-trade-display="sellBasketEquivalent" className={swapStyles.basketValue}>
                      {sellBasketEquivalent}
                    </span>
                  </button>

                  <div data-trade-single="sell" hidden={showSellBasket}>
                  <input
                    ref={mainSellInputRef}
                    id="sell-amount"
                    data-trade-display="sellAmount"
                    data-trade-spend-input={!showSellBasket ? "" : undefined}
                    aria-labelledby="sell-amount-label sell-token-label"
                    className={cn(
                      swapStyles.amountInput,
                      !isMainInputSellReadOnly && "editable-caret",
                      isPurchaseOverCap ? "text-red-500 placeholder:text-red-500" : isTokenSellAmountOverWalletBalance
                        ? "text-text-amber placeholder:text-text-amber"
                        : "text-text-input"
                    )}
                    readOnly={isMainInputSellReadOnly}
                    disabled={isSubmittingSwap}
                    aria-invalid={isPurchaseOverCap || isTokenSellAmountOverWalletBalance || undefined}
                    aria-describedby={[
                      isPurchaseOverCap && "purchase-cap-warning",
                      isTokenSellAmountOverWalletBalance && isSellTokenSpendable && sellToken && "sell-wallet-balance-warning",
                    ].filter(Boolean).join(" ") || undefined}
                    type="text"
                    inputMode="decimal"
                    value={sellAmount}
                    min={0}
                    placeholder={sellAmountPlaceholderText}
                    onClick={() => { if (!sellTokenId) { setIsBuyModalOpen(false); setIsSellModalOpen(true); } }}
                    onChange={(event) => {
                      if (!sellTokenId) { setIsBuyModalOpen(false); setIsSellModalOpen(true); }
                      setSellAmountRawOverride(undefined);
                      applyLocalizedInputValue(
                        event.currentTarget,
                        event.currentTarget.value,
                        setSellAmount
                      );
                    }}
                  />
                  </div>
                </>
              </div>

              <div className="relative flex shrink-0 flex-col items-end gap-2">
                <button
                  type="button"
                  ref={sellTokenPickerRef}
                  disabled={sellSelectDisabled}
                  aria-haspopup="dialog"
                  aria-expanded={isSellModalOpen}
                  aria-controls={isSellModalOpen ? "dropdown-from" : undefined}
                  onClick={() => {
                    setIsBuyModalOpen(false);
                    setIsSellModalOpen((isOpen) => !isOpen);
                  }}
                  className={cn(swapStyles.tokenPicker, !sellTokenId && "w-auto whitespace-nowrap border-gold-cg bg-gold-cg text-black")}
                >
                  {sellTokenOnTokenPicker ? (
                    <>
                      {sellTokenOnTokenPicker.id === goldBasketId ? (
                        <FaBasketShopping className="text-gold-cg" />
                      ) : (
                          <Image
                            src={resolveTokenImagePath(sellTokenOnTokenPicker.id, isDarkMode)}
                            data-trade-asset-image="sell"
                            alt={sellTokenOnTokenPicker.symbol}
                            width={22}
                            height={22}
                            className="h-[22px] w-[22px] shrink-0 object-contain"
                          />
                      )}
                      <span id="sell-token-label" data-trade-display="sellSymbol" className="text-sm font-semibold text-text-input">{sellTokenDisplaySymbol}</span>
                    </>
                  ) : (
                    <>
                      {showSellBasket ? <FaBasketShopping className="text-gold-cg" /> : sellTokenId ? <Image src={resolveTokenImagePath(sellTokenId, isDarkMode)} data-trade-asset-image="sell" alt={sellTokenId.toUpperCase()} width={22} height={22} className="h-[22px] w-[22px] shrink-0 object-contain" /> : null}
                      <span id="sell-token-label" data-trade-display="sellSymbol" className="text-sm font-semibold text-text-input">{sellTokenDisplaySymbol}</span>
                    </>
                  )}
                  <FaChevronDown className={cn("ml-auto", sellTokenId ? "text-text-input" : "text-black")} />
                </button>
                <TokenPickerModal
                  side="sell"
                  open={isSellModalOpen}
                  onClose={() => setIsSellModalOpen(false)}
                  tokens={sellSelectableTokens}
                  selectedId={sellTokenId}
                  onSelect={handleSellTokenChange}
                  onImport={resolveImportedToken}
                  walletOnly={isConnected && showOnlyWalletTokens}
                  isLoading={isConfigurationLoading || isSellTokenChoicesLoading}
                  triggerRef={sellTokenPickerRef}
                />
              </div>
            </div>

            <span
              data-testid="sell-amount-equivalents"
              data-trade-display="sellEquivalent"
              className={`mt-2 block text-center text-xs leading-tight tabular-nums sm:hidden
                ${isTokenSellAmountOverWalletBalance && !showSellBasket ? "text-text-amber" : "text-text-muted"}`}
            >
              {sellMobileAmountEquivalentDisplayValue}
            </span>

            {isTokenSellAmountOverWalletBalance && isSellTokenSpendable && sellToken && (
              <span id="sell-wallet-balance-warning" className="sr-only">
                {t('amountExceedsWalletBalance', {
                  balance: formatNumberWithSpaces(
                    formatUnits(sellTokenWalletBalance, sellToken.decimals),
                    locale
                  ),
                  symbol: sellToken.symbol,
                })}
              </span>
            )}

            <div data-trade-single="sell" hidden={showSellBasket} className={swapStyles.tokenValueRow}>
                <span data-testid="sell-amount-equivalents" data-trade-display="sellEquivalent" className={`hidden sm:inline  ${isTokenSellAmountOverWalletBalance ? "text-text-amber" : "text-text-minor-data"}`}>
                  {sellMobileAmountEquivalentDisplayValue}
                </span>
                <div className="ml-auto flex min-w-0 items-center justify-end gap-2 sm:gap-3">
                  <div data-trade-wallet hidden={!showWalletPresentation} className="contents"><SwapTokenBalance {...sellBalancePresentation} side="sell" /></div>
                  <button data-trade-wallet data-trade-max hidden={!showWalletPresentation || !sellTokenId}
                    type="button" onClick={handleSetSellMax} disabled={isSubmittingSwap || !canUseSellMax}
                    aria-label={t("useMaximumSellAmount")} className={swapStyles.maxButton}>MAX</button>
                </div>
              </div>
              <div data-trade-spending data-testid="purchase-spending" hidden={purchaseSpendingPresentation.purchaseSpendingVisible !== "true"}
                className="mt-3 flex items-center justify-between gap-3 border-t border-swap-container-border pt-3 text-xs tabular-nums">
                <span className="text-text-minor-data">{t("purchaseSpending")}</span>
                <span className="group/spending relative min-w-0 text-right">
                  <output data-trade-spending-value data-trade-estimate data-trade-display="purchaseSpendingValue" data-limited={purchaseSpendingLimited}
                    tabIndex={purchaseSpendingLimited ? 0 : undefined}
                    aria-describedby={purchaseSpendingLimited ? "purchase-spending-explanation" : undefined}
                    className="break-words text-text-input data-[limited=true]:text-text-amber focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    {purchaseSpendingPresentation.purchaseSpendingValue}
                  </output>
                  <span data-trade-estimate data-trade-display="purchaseSpendingEquivalent" className="mt-1 block text-text-minor-data">
                    {spendingEquivalent}
                  </span>
                  <span data-trade-spending-tooltip id="purchase-spending-explanation" role="tooltip" hidden={!purchaseSpendingLimited}
                    className="pointer-events-none invisible absolute bottom-full right-0 z-20 mb-2 w-64 max-w-[calc(100vw-4rem)] rounded-lg border border-swap-container-border bg-background-input p-3 text-left text-xs font-normal text-text-input shadow-lg group-hover/spending:visible group-focus-within/spending:visible">
                    {t("purchaseSpendingLimited")}
                  </span>
                </span>
              </div>
          </div>
        </div>

        {/* Basket component inputs */}

        <div id="sell-basket-composition" data-trade-basket="sell" hidden={!showSellBasket} className={swapStyles.basketBox}>
          <div className={swapStyles.basketHeader}>
            <div className="flex items-center gap-2"><FaBasketShopping className="text-gold-cg" /><span className="text-text-input">{t('basket')}</span></div>
            <div className="flex items-center gap-3">
              <button data-trade-wallet data-trade-max hidden={!showWalletPresentation} type="button" onClick={handleSetBasketSellMax}
                disabled={isSubmittingSwap || !canUseBasketSellMax} aria-label={t("useMaximumSellAmount")} className={swapStyles.maxButton}>MAX</button>
            </div>
          </div>
          <div data-trade-basket-rows="sell">
            {!sellBasketPresentation.length && <div className={swapStyles.basketRow} aria-busy={basket.isLoading}><span>...</span><span>...</span></div>}
            {sellBasketPresentation.map((row, index) => <TradeBasketPresentationRow key={row.tokenId} row={row} isDarkMode={isDarkMode}
              disabled={isSubmittingSwap} inputRef={element => { basketSellInputRefs.current[index] = element; }}
              inputClassName={cn(swapStyles.basketInput, isPurchaseOverCap ? "text-red-500 border-red-500" :
                basketComponentWarnings[row.tokenId] ? "text-text-amber border-text-amber" : "text-text-input focus:border-gold-cg/45", "focus:ring-0")}
              onFocus={event => {
                const next = !row.amount || (parseDisplayNumber(row.amount, locale) ?? 0) === 0 ? "" : row.amount;
                if (driverToken !== row.address) {
                  setBasketMaxAmounts(undefined);
                  setDriverAmountRawOverride(derivedBasketAmountsAsBigIntMap[row.address as Address]);
                  setDriverToken(row.address as Address); setDriverAmountStr(next);
                }
                const input = event.currentTarget;
                if (input.dataset.tradeHandoffFocus === undefined) requestAnimationFrame(() => { if (document.activeElement === input) input.select(); });
              }}
              onChange={event => {
                setBasketMaxAmounts(undefined); setDriverAmountRawOverride(undefined);
                if (driverToken !== row.address) setDriverToken(row.address as Address);
                applyLocalizedInputValue(event.currentTarget, event.currentTarget.value, setDriverAmountStr);
              }} />)}
          </div>
        </div>

         {/* Swap direction */}

        <div className="flex justify-center my-4 rounded-2xl bg-background-swap text-text-input text-sm">
          <button
            type="button"
            className="flex items-center gap-2 p-3 tabular-nums"
            onClick={handleToggleDirection}
            disabled={isSubmittingSwap}
            aria-label={t("reverseSwapDirection")}
            title={t("reverseSwapDirection")}
          >
              <LuArrowDownUp
                className="h-6 w-6 shrink-0 text-gold-cg"
                strokeWidth={2.6}
              />
              <span data-trade-display="reference" className="">{cygldUsdReferenceLabel}</span>
          </button>
        </div>

        {/* Buy form */}

        <div className={cn("relative", isBuyModalOpen && "z-40")}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <label id="buy-amount-label" htmlFor={!showBuyBasket ? "buy-amount" : undefined} className="shrink-0 text-sm text-text-input">{t('youBuy')}</label>
            {buyTokenId === cygldTokenId && ((showSellBasket && (!basketMaxAmounts || basketMaxAmounts.netCygldOut === "0")) || isIssuanceCapError) && (
              <span
                role="note"
                data-testid="cygld-purchase-capacity"
                className={cn("min-w-0 truncate text-xs tabular-nums", isPurchaseOverCap || isPurchaseCapacityExhausted ? "text-red-500" : "text-text-minor-data")}
                title={purchaseCapacityDetails}
                aria-label={[purchaseCapacityLabel, purchaseCapacityDetails].filter(Boolean).join(". ")}
              >
                {purchaseCapacityLabel ?? "..."}
              </span>
            )}
          </div>
            <p id="receive-amount-description" className="sr-only">{t("receiveAmountDescription")}</p>
            <div className={cn(swapStyles.amountBox, isPurchaseOverCap && "ring-1 ring-red-500")}>
              <div className="flex items-center justify-between gap-2 sm:gap-4">
                <div className="relative min-w-0 flex-1">

                <>
                  <div data-trade-basket="buy" hidden={!showBuyBasket} className={swapStyles.basketSummary}>
                    <span className="hidden text-2xl sm:block text-text-minor-data">
                      {t("basketAssets")}
                    </span>

                    <span data-trade-estimate data-trade-display="buyBasketEquivalent" className={swapStyles.basketValue}>
                      {buyBasketEquivalent}
                    </span>
                  </div>
                  <div data-trade-single="buy" hidden={showBuyBasket}>
                  {hasProgressiveBuyEstimate && (
                    <span id="quote-buy-estimate" data-testid="quote-estimate-description" className="sr-only">{t('quoteEstimate')}</span>
                  )}
                  <output
                    id="buy-amount"
                    data-trade-estimate
                    data-trade-display="buyAmount"
                    aria-labelledby="buy-amount-label buy-token-label"
                    className={cn(
                      swapStyles.amountOutput,
                      isPurchaseOverCap ? "text-red-500" : shouldMuteQuotedBuyAmounts ? "text-text-input-disabled" : "text-text-input"
                    )}
                    aria-busy={shouldBlockQuotedBuyInput || undefined}
                    aria-describedby={["receive-amount-description", isPurchaseOverCap && "purchase-cap-warning",
                      hasProgressiveBuyEstimate && "quote-buy-estimate"].filter(Boolean).join(" ")}
                  >
                    {displayedQuotedBuyAmount || buyAmountPlaceholderText}
                  </output>
                  </div>
                </>
              </div>
              <div className="relative flex shrink-0 flex-col items-end gap-2">
                <button
                  type="button"
                  ref={buyTokenPickerRef}
                  disabled={isSubmittingSwap}
                  aria-haspopup="dialog"
                  aria-expanded={isBuyModalOpen}
                  aria-controls={isBuyModalOpen ? "dropdown-from" : undefined}
                  onClick={() => {
                    setIsSellModalOpen(false);
                    setIsBuyModalOpen((isOpen) => !isOpen);
                  }}
                  className={cn(swapStyles.tokenPicker, !buyTokenId && "w-auto whitespace-nowrap border-gold-cg bg-gold-cg text-black")}
                >
                  {buyTokenOnTokenPicker ? (
                    <>
                      {buyTokenOnTokenPicker.id === goldBasketId ? (
                        <FaBasketShopping className="text-gold-cg" />
                      ) : (
                          <Image
                            src={resolveTokenImagePath(buyTokenOnTokenPicker.id, isDarkMode)}
                            data-trade-asset-image="buy"
                            alt={buyTokenOnTokenPicker.symbol}
                            width={22}
                            height={22}
                            className="h-[22px] w-[22px] shrink-0 object-contain"
                          />
                      )}
                      <span id="buy-token-label" data-trade-display="buySymbol" className="text-sm font-semibold text-text-input">{buyTokenDisplaySymbol}</span>
                    </>
                  ) : (
                    <>
                      {showBuyBasket ? <FaBasketShopping className="text-gold-cg" /> : buyTokenId ? <Image src={resolveTokenImagePath(buyTokenId, isDarkMode)} data-trade-asset-image="buy" alt={buyTokenId.toUpperCase()} width={22} height={22} className="h-[22px] w-[22px] shrink-0 object-contain" /> : null}
                      <span id="buy-token-label" data-trade-display="buySymbol" className="text-sm font-semibold text-text-input">{buyTokenDisplaySymbol}</span>
                    </>
                  )}
                  <FaChevronDown className={cn("ml-auto", buyTokenId ? "text-text-input" : "text-black")} />
                </button>
                <TokenPickerModal
                  side="buy"
                  open={isBuyModalOpen}
                  onClose={() => setIsBuyModalOpen(false)}
                  tokens={buySelectableTokens}
                  selectedId={buyTokenId}
                  onSelect={handleBuyTokenChange}
                  onImport={resolveImportedToken}
                  isLoading={isConfigurationLoading}
                  triggerRef={buyTokenPickerRef}
                />
              </div>
            </div>

            <span data-trade-estimate data-testid="buy-amount-equivalents" data-trade-display="buyEquivalent" className="mt-2 block text-center text-xs text-text-muted leading-tight tabular-nums sm:hidden">
              {buyMobileAmountEquivalentDisplayValue}
            </span>

            <div data-trade-single="buy" hidden={showBuyBasket} className={swapStyles.tokenValueRow}>
                <span data-trade-estimate data-testid="buy-amount-equivalents" data-trade-display="buyEquivalent" className="hidden text-text-minor-data sm:inline">
                  {buyMobileAmountEquivalentDisplayValue}
                </span>
              </div>
          </div>
        </div>

        {isPurchaseOverCap && <p id="purchase-cap-warning" role="status" className="mt-2 text-xs text-red-500">
          {t(isPurchaseCapacityExhausted ? "purchaseCapReachedWarning" : "purchaseCapWarning")}
        </p>}

         {/* Basket component inputs */}

        <div id="buy-basket-composition" data-trade-basket="buy" hidden={!showBuyBasket} className={swapStyles.basketBox}>
          <div className={swapStyles.basketHeader}><div className="flex items-center gap-2"><FaBasketShopping className="text-gold-cg" /><span className="text-text-input">{t('basket')}</span></div></div>
          <div data-trade-basket-rows="buy">
            {!buyBasketPresentation.length && <div className={swapStyles.basketRow} aria-busy={basket.isLoading}><span>...</span><span>...</span></div>}
            {buyBasketPresentation.map(row => <TradeBasketPresentationRow key={row.tokenId} row={row} isDarkMode={isDarkMode} busy={shouldBlockQuotedBuyInput} />)}
          </div>
        </div>
        <div data-trade-basket-template hidden><TradeBasketPresentationRow isDarkMode={isDarkMode}
          row={{ side: "sell", tokenId: "eth", symbol: "", address: "", weight: "", amount: "", equivalent: "", label: "", driver: false }} /></div>
        <div data-trade-basket-icon-template hidden><FaBasketShopping className="text-gold-cg" /></div>

        {displayedRecoveryShareQuote?.assets &&
        displayedRecoveryShareQuote.amounts ? (
          <div className="order-6 mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
            <p className="font-semibold">{t("recoveryOutputTitle")}</p>
            <p className="mt-1">{t("recoveryOutputDescription")}</p>
            <div className="mt-2 space-y-1 font-mono">
              {displayedRecoveryShareQuote.assets.map((asset, index) => (
                <div key={asset} className="flex justify-between gap-3">
                  <span>
                    {`${asset.slice(0, 6)}…${asset.slice(-4)}`}
                  </span>
                  <span>
                    <RecoveryShareAmount asset={asset} amount={displayedRecoveryShareQuote.amounts?.[index] ?? 0n} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

         {/* Fee breakdown */}

          <details data-trade-fees data-testid="swap-fees" open={isFeeDetailsOpen} suppressHydrationWarning
            onToggle={event => setIsFeeDetailsOpen(event.currentTarget.open)}
            aria-busy={isFeeDisplayUpdating} className="group order-6 my-4 text-xs text-text-muted">
            <summary
              role="button"
              suppressHydrationWarning
              className="flex w-full cursor-pointer list-none items-center justify-between p-2 bg-background-swap border border-swap-container-border rounded-2xl text-xs [&::-webkit-details-marker]:hidden"
              aria-expanded={isFeeDetailsOpen}
            >
              <span>{t('totalFee')}</span>
              <span className={cn("inline-flex items-center gap-2 font-semibold tabular-nums", isFeeDisplayMuted ? "text-text-input-disabled" : "text-text-input")}>
                <span data-trade-estimate data-trade-display="feeTotal">{feePresentation.feeTotal}</span>
                <FaChevronDown className="text-xs text-text-muted transition-transform group-open:rotate-180" />
              </span>
            </summary>

              <div className="flex flex-col space-y-2 mt-2 p-2 bg-background-swap border border-swap-container-border rounded-2xl text-xs">
                <div className="flex justify-between gap-3" data-testid="swap-protocol-fee">
                  <span data-trade-display="feeProtocolLabel">{feePresentation.feeProtocolLabel}</span>
                  <span data-trade-estimate data-trade-display="feeProtocolValue" className={feeValueClassName}>{feePresentation.feeProtocolValue}</span>
                </div>
                <div className="flex justify-between gap-3" data-testid="swap-helpers-fee">
                  <span data-trade-display="feeHelpersLabel">{feePresentation.feeHelpersLabel}</span>
                  <span data-trade-estimate data-trade-display="feeHelpersValue" className={feeValueClassName}>{feePresentation.feeHelpersValue}</span>
                </div>
                <div className="flex justify-between gap-3" data-testid="swap-front-end-fee">
                  <span data-trade-display="feeApplicationLabel">{feePresentation.feeApplicationLabel}</span>
                  <span data-trade-estimate data-trade-display="feeApplicationValue" className={feeValueClassName}>{feePresentation.feeApplicationValue}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 border-t pt-2 bg-background-swap text-xs" data-testid="swap-network-fee">
                  <span>{t('transactionFee')}:</span>
                  <span data-trade-estimate data-trade-display="feeNetworkValue" className={feeValueClassName}>{feePresentation.feeNetworkValue}</span>
                </div>
                <div className="space-y-3 border-t border-swap-container-border pt-3">
                  <ExecutionToleranceControl value={slippageBps} onChange={setSlippageBps} disabled={isSubmittingSwap} />
                  <div className="border-t border-swap-container-border pt-2" aria-live="polite">
                    <div className="flex justify-between gap-3" data-testid="swap-minimum-output">
                      <span className="shrink-0">{t("minimumOutput")}:</span>
                      <span data-trade-estimate data-trade-display="feeMinimumOutput" className={cn("min-w-0 break-all text-right text-text-input tabular-nums", isFeeDisplayMuted && "text-text-input-disabled")}>{feePresentation.feeMinimumOutput}</span>
                    </div>
                  </div>
                </div>
              </div>
          </details>

        <ExactInputRetentionDisclosure charges={(frozenUniversal ?? activeUniversalQuote)?.estimatedRetainedInputCharges ?? []}
          presentation={restoreFormattedDisplay || !(frozenUniversal ?? activeUniversalQuote)
            ? cachedTradeDisplay?.retentionDisclosure?.replace(cachedTradeDisplay.retentionDisclosurePlain ?? "", "").trim() : undefined} />

        <div className="order-3 mt-3 flex flex-col items-end gap-2">
          <button type="button" data-trade-refresh onClick={() => void activeFlow?.refresh()}
            disabled={!activeFlow || !hasEnteredSwapAmount || isSubmittingSwap || activeFlow.refreshing || quoteInputPending}
            aria-busy={activeFlow?.refreshing || undefined}
            className={cn("text-sm text-text-muted underline underline-offset-4 disabled:opacity-50",
              (!activeFlow || !hasEnteredSwapAmount) && "invisible")}>
            {t("refreshQuote")}
          </button>
          {activeFlow?.refreshError && <p role="alert" className="text-sm text-text-amber">
            {t("quoteRefreshFailed")} {activeFlow.refreshError}
          </p>}
        </div>
        {confirmedTrade && <section data-testid="trade-receipt" role="status" className="order-5 my-3 rounded-xl border border-swap-container-border p-3 text-sm">
          <p className="font-semibold">{confirmedTrade.receipt.strategy === "market" ? marketT("confirmed") : t("transactionConfirmed")}</p>
          {confirmedTrade.receipt.strategy === "universal" && <ExactInputSettlement receipt={confirmedTrade.receipt} />}
          <dl className="mt-2 space-y-1">
            {confirmedTrade.input && confirmedTrade.output && confirmedTrade.receipt.strategy !== "universal" && ([["actualInput", confirmedTrade.receipt.inputUsed, confirmedTrade.input],
              ["actualOutput", confirmedTrade.receipt.amountOut, confirmedTrade.output],
              ["inputRefund", confirmedTrade.receipt.inputRefund, confirmedTrade.input],
              ["outputRefund", confirmedTrade.receipt.outputRefund, confirmedTrade.output]] as const).map(([label, amount, token]) =>
              <div key={label} className="flex justify-between gap-3"><dt>{label === "actualInput" || label === "actualOutput" ? t(label === "actualInput" ? "tradeActualInput" : "tradeActualOutput") : marketT(label)}</dt><dd>{formatMeaningfulDecimalString(formatUnits(amount, token.decimals), locale)} {token.symbol}</dd></div>)}
            {confirmedTrade.receipt.strategy !== "market" && <div className="flex justify-between gap-3"><dt>{t("protocolFee")}</dt><dd>{formatMeaningfulDecimalString(formatUnits(confirmedTrade.receipt.protocolFeeCygld, cygldDecimals), locale)} CYGLD</dd></div>}
            <div className="flex justify-between gap-3"><dt>{t(confirmedTrade.receipt.strategy === "market" ? "applicationFee" : "helpersFee")}</dt><dd>{formatMeaningfulDecimalString(formatUnits(confirmedTrade.receipt.helperFeeCygld, cygldDecimals), locale)} CYGLD</dd></div>
            {confirmedTrade.receipt.strategy === "universal" && <div className="flex justify-between gap-3"><dt>{t("applicationFee")}</dt><dd>{formatMeaningfulDecimalString(formatUnits(confirmedTrade.receipt.marketFeeCygld ?? 0n, cygldDecimals), locale)} CYGLD</dd></div>}
          {confirmedTrade.receipt.feeRecipient && <div className="flex justify-between gap-3"><dt>{marketT("feeRecipient")}</dt><dd className="break-all text-xs">{confirmedTrade.receipt.feeRecipient}</dd></div>}
          </dl>
          {confirmedTrade.receipt.recoveryAssets.map((asset, index) => <RecoveryShareAmount key={asset}
            asset={asset} amount={confirmedTrade.receipt.recoveryShareAmounts[index]} />)}
        </section>}

        {/* Swap submission */}

        {transactionNotice && <SwapTransactionNotice key={transactionNotice.hash ?? transactionNotice.batchId} {...transactionNotice} />}
        {(swapFailureReference || activeQuoteStatus === "failed") && <div className="order-5">
          <DiagnosticReference reference={swapFailureReference ?? diagnosticReference(activeQuoteFailure)} />
        </div>}

        <button data-trade-action
            className={`order-4 w-full my-4 rounded-2xl bg-gold-cg p-3 text-sm font-semibold text-black shadow-md transition-all ${
              isConnected && isSwapActionDisabled
                ? "cursor-not-allowed"
                : "hover:opacity-90"
            }`}
            onClick={handleSwapClick}
            type="button"
            title={!isConnected && !restoringWalletAddress ? t("pleaseConnectWallet") : undefined}
            disabled={Boolean(restoringWalletAddress) || (isConnected && isSwapActionDisabled)}
          >
            {isSubmittingSwap ? <span className="flex items-center justify-center gap-2">
              <Spinner aria-hidden="true" role={undefined} aria-label={undefined} className="size-4 text-current" />
              <span>{submittingSwapButtonLabel}</span>
            </span> : <span data-trade-display="mainAction">{mainActionPresentation}</span>}

        </button>
            </section>
          </div>
      </div>
    </div>
  );
}
