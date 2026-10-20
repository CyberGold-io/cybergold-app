"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { DisplayCurrency, useFxRates } from "../hooks/useFxRates";
import { useLocale } from "next-intl";
import {
  formatCurrencyWithCustomGrouping,
  formatGoldAmountForDisplay,
} from "../utils/formatting";

const CURRENCY_STORAGE_KEY = "display-currency";
const GOLD_UNIT_STORAGE_KEY = "display-gold-unit";
const PRICE_DISPLAY_MODE_STORAGE_KEY = "display-price-mode";
const DISPLAY_PREFS_EVENT = "display-prefs-change";

const DISPLAYED_CURRENCIES: readonly DisplayCurrency[] = ["USD", "EUR", "CHF"];
const SUPPORTED_GOLD_UNITS = ["imperial", "metric"] as const;
const SUPPORTED_PRICE_DISPLAY_MODES = ["fiat", "gold"] as const;

export type GoldUnit = (typeof SUPPORTED_GOLD_UNITS)[number];
export type PriceDisplayMode = (typeof SUPPORTED_PRICE_DISPLAY_MODES)[number];
type FiatFormatOptions = {
  compact?: boolean;
};

type CurrencyContextValue = {
  selectedCurrency: DisplayCurrency;
  setSelectedCurrency: (currency: DisplayCurrency) => void;
  supportedCurrencies: readonly DisplayCurrency[];
  selectedGoldUnit: GoldUnit;
  setSelectedGoldUnit: (unit: GoldUnit) => void;
  supportedGoldUnits: readonly GoldUnit[];
  selectedPriceDisplayMode: PriceDisplayMode;
  setSelectedPriceDisplayMode: (mode: PriceDisplayMode) => void;
  formatFiat: (amountUsd: number, options?: FiatFormatOptions) => string;
  formatGoldAmount: (amountOzt: number) => string;
  fxFetchedAt?: string;
  isFxStale: boolean;
  isFxLoading: boolean;
  isFxRefreshing: boolean;
  isFxError: boolean;
};

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

function isDisplayedCurrency(value: string | null): value is DisplayCurrency {
  return value !== null && DISPLAYED_CURRENCIES.includes(value as DisplayCurrency);
}

function isSupportedGoldUnit(value: string | null): value is GoldUnit {
  return value !== null && SUPPORTED_GOLD_UNITS.includes(value as GoldUnit);
}

function isSupportedPriceDisplayMode(value: string | null): value is PriceDisplayMode {
  return value !== null && SUPPORTED_PRICE_DISPLAY_MODES.includes(value as PriceDisplayMode);
}

function readStoredCurrency(): DisplayCurrency {
  if (typeof window === "undefined") {
    return "USD";
  }
  const stored = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
  return isDisplayedCurrency(stored) ? stored : "USD";
}

function readStoredGoldUnit(): GoldUnit {
  if (typeof window === "undefined") {
    return "metric";
  }
  const stored = window.localStorage.getItem(GOLD_UNIT_STORAGE_KEY);
  return isSupportedGoldUnit(stored) ? stored : "metric";
}

function readStoredPriceDisplayMode(): PriceDisplayMode {
  if (typeof window === "undefined") {
    return "fiat";
  }
  const stored = window.localStorage.getItem(PRICE_DISPLAY_MODE_STORAGE_KEY);
  return isSupportedPriceDisplayMode(stored) ? stored : "fiat";
}

function subscribeDisplayPrefs(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(DISPLAY_PREFS_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(DISPLAY_PREFS_EVENT, handler);
  };
}

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const selectedCurrency = useSyncExternalStore<DisplayCurrency>(
    subscribeDisplayPrefs,
    readStoredCurrency,
    () => "USD"
  );
  const selectedGoldUnit = useSyncExternalStore<GoldUnit>(
    subscribeDisplayPrefs,
    readStoredGoldUnit,
    () => "metric"
  );
  const selectedPriceDisplayMode = useSyncExternalStore<PriceDisplayMode>(
    subscribeDisplayPrefs,
    readStoredPriceDisplayMode,
    () => "fiat"
  );
  const { rates, fetchedAt, isStale, isLoading, isRefreshing, isError } = useFxRates();

  const setSelectedCurrency = useCallback((currency: DisplayCurrency) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
    window.dispatchEvent(new Event(DISPLAY_PREFS_EVENT));
  }, []);

  const setSelectedGoldUnit = useCallback((unit: GoldUnit) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GOLD_UNIT_STORAGE_KEY, unit);
    window.dispatchEvent(new Event(DISPLAY_PREFS_EVENT));
  }, []);

  const setSelectedPriceDisplayMode = useCallback((mode: PriceDisplayMode) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PRICE_DISPLAY_MODE_STORAGE_KEY, mode);
    window.dispatchEvent(new Event(DISPLAY_PREFS_EVENT));
  }, []);

  const formatFiat = useCallback(
    (amountUsd: number, options?: FiatFormatOptions) => {
      const rate = rates[selectedCurrency] ?? 1;
      const converted = amountUsd * rate;
      const maximumFractionDigits = selectedCurrency === "RUB" ? 0 : 2;
      return formatCurrencyWithCustomGrouping(converted, locale, selectedCurrency, {
        compact: options?.compact,
        maximumFractionDigits: options?.compact ? 0 : maximumFractionDigits,
        minimumFractionDigits: options?.compact ? 0 : undefined,
      });
    },
    [locale, rates, selectedCurrency]
  );

  const formatGoldAmount = useCallback(
    (amountOzt: number) => formatGoldAmountForDisplay(amountOzt, locale, selectedGoldUnit),
    [locale, selectedGoldUnit]
  );

  const value = useMemo<CurrencyContextValue>(
    () => ({
      selectedCurrency,
      setSelectedCurrency,
      supportedCurrencies: DISPLAYED_CURRENCIES,
      selectedGoldUnit,
      setSelectedGoldUnit,
      supportedGoldUnits: SUPPORTED_GOLD_UNITS,
      selectedPriceDisplayMode,
      setSelectedPriceDisplayMode,
      formatFiat,
      formatGoldAmount,
      fxFetchedAt: fetchedAt,
      isFxStale: isStale,
      isFxLoading: isLoading,
      isFxRefreshing: isRefreshing,
      isFxError: isError,
    }),
    [
      formatFiat,
      formatGoldAmount,
      fetchedAt,
      isError,
      isLoading,
      isRefreshing,
      isStale,
      selectedCurrency,
      selectedGoldUnit,
      selectedPriceDisplayMode,
      setSelectedCurrency,
      setSelectedGoldUnit,
      setSelectedPriceDisplayMode,
    ]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within CurrencyProvider");
  }
  return context;
}
