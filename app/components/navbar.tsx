"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FaBars, FaChevronDown, FaMoon, FaSun, FaTimes } from "react-icons/fa";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type SupportedLocale } from "@/i18n/routing";
import { useCurrency } from "../context/currencyContext";
import { useGovernanceSafe } from "../hooks/useGovernanceSafe";
import { useObservedWalletAccount } from "../hooks/useObservedWalletAccount";
import { useHelpersRouterFacts } from "../hooks/useHelpersRouterFacts";
import {
  hasGovernanceNavigationAccess,
  normalizeGovernanceAddress,
} from "../utils/governanceAuthority";
import { WalletConnectButton } from "./walletConnectButton";
import { THEME_PREFERENCE_KEY, type Theme } from "../lib/theme";

// Shared desktop and mobile presentation; colors come from globals.css.
const navbarStyles = {
  link:
    "relative text-base transition-transform duration-200 ease-out hover:-translate-y-px after:absolute after:-bottom-[0.2rem] after:-left-2 after:-right-2 after:h-0.5 after:origin-center after:scale-x-[0.35] after:rounded-full after:bg-gold-cg after:opacity-0 after:transition-[opacity,transform] after:duration-200 after:ease-out hover:after:scale-x-100 hover:after:opacity-100",
  activeLink:
    "font-semibold text-gold-cg",
  desktopOnly:
    "hidden min-[1025px]:flex",
  mobileOnly:
    "min-[1025px]:hidden",
  option:
    "rounded-full border px-3 py-2 text-[15px] transition-colors",
  activeOption:
    "border-gold-cg bg-gold-cg/10 text-gold-cg",
  inactiveOption:
    "border-swap-container-border text-text-input hover:bg-accent",
  dropdownTrigger:
    "flex items-center gap-2 rounded-full border border-swap-container-border bg-background-input px-3 py-1.5 text-[15px] text-text-input transition hover:bg-accent",
  dropdownOption:
    "w-full px-3 py-2 text-left text-text-input text-[15px] transition hover:bg-accent",
  externalLink:
    "text-base transition-colors hover:text-gold-cg",
  dropdown:
    "absolute right-0 z-30 mt-2 rounded-lg border border-swap-container-border bg-background-input text-text-input shadow-lg",
} as const;

export function Navbar({ initialTheme }: { initialTheme: Theme }) {
  const t = useTranslations("Navbar");
  const router = useRouter();
  const pathname = usePathname();
  const isSwapActive = pathname === "/";
  const isDashboardActive = pathname.startsWith("/dashboard");
  const isGovernanceActive = pathname.startsWith("/governance");
  const currentLocale = useLocale() as SupportedLocale;
  const { address, isConnected } = useObservedWalletAccount();
  const { owners: coreGovernanceOwners } = useGovernanceSafe({
    enabled: isConnected,
  });
  const helpersOwnerQuery = useHelpersRouterFacts(facts => facts.configuration.owner.status === "success"
    ? facts.configuration.owner.value : undefined, { enabled: isConnected });
  const helpersOwner = normalizeGovernanceAddress(helpersOwnerQuery.data);
  const { owners: helpersGovernanceOwners } = useGovernanceSafe({
    authorityAddress: helpersOwner,
    authorityKind: "owner",
    enabled: isConnected && helpersOwner !== undefined,
  });
  const canViewGovernance =
    isConnected &&
    hasGovernanceNavigationAccess(address, [
      coreGovernanceOwners,
      helpersGovernanceOwners,
    ]);
  const {
    selectedCurrency,
    setSelectedCurrency,
    supportedCurrencies,
    selectedGoldUnit,
    setSelectedGoldUnit,
    supportedGoldUnits,
    setSelectedPriceDisplayMode,
  } = useCurrency();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLocaleOpen, setIsLocaleOpen] = useState(false);
  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  const [isGoldUnitOpen, setIsGoldUnitOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const localeMenuRef = useRef<HTMLDivElement | null>(null);
  const localeToggleRef = useRef<HTMLButtonElement | null>(null);
  const currencyMenuRef = useRef<HTMLDivElement | null>(null);
  const currencyToggleRef = useRef<HTMLButtonElement | null>(null);
  const goldUnitMenuRef = useRef<HTMLDivElement | null>(null);
  const goldUnitToggleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    document.cookie = `${THEME_PREFERENCE_KEY}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [theme]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      if (
        isMenuOpen &&
        menuRef.current &&
        !menuRef.current.contains(target) &&
        toggleRef.current &&
        !toggleRef.current.contains(target)
      ) {
        setIsMenuOpen(false);
      }

      if (
        isLocaleOpen &&
        localeMenuRef.current &&
        !localeMenuRef.current.contains(target) &&
        localeToggleRef.current &&
        !localeToggleRef.current.contains(target)
      ) {
        setIsLocaleOpen(false);
      }

      if (
        isCurrencyOpen &&
        currencyMenuRef.current &&
        !currencyMenuRef.current.contains(target) &&
        currencyToggleRef.current &&
        !currencyToggleRef.current.contains(target)
      ) {
        setIsCurrencyOpen(false);
      }

      if (
        isGoldUnitOpen &&
        goldUnitMenuRef.current &&
        !goldUnitMenuRef.current.contains(target) &&
        goldUnitToggleRef.current &&
        !goldUnitToggleRef.current.contains(target)
      ) {
        setIsGoldUnitOpen(false);
      }
    };

    if (isMenuOpen || isLocaleOpen || isCurrencyOpen || isGoldUnitOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isCurrencyOpen, isGoldUnitOpen, isLocaleOpen, isMenuOpen]);

  const closeDesktopDropdowns = () => {
    setIsLocaleOpen(false);
    setIsCurrencyOpen(false);
    setIsGoldUnitOpen(false);
  };

  const closeAllMenus = () => {
    setIsMenuOpen(false);
    closeDesktopDropdowns();
  };

  const handleLanguageSelect = (nextLocale: SupportedLocale) => {
    if (nextLocale === currentLocale) {
      setIsLocaleOpen(false);
      return;
    }

    router.replace(pathname, { locale: nextLocale });
    closeAllMenus();
  };

  const handleCurrencySelect = (currency: (typeof supportedCurrencies)[number]) => {
    setSelectedCurrency(currency);
    setSelectedPriceDisplayMode("fiat");
    closeDesktopDropdowns();
  };

  const handleGoldUnitSelect = (unit: (typeof supportedGoldUnits)[number]) => {
    setSelectedGoldUnit(unit);
    setSelectedPriceDisplayMode("gold");
    closeDesktopDropdowns();
  };

  const handleThemeSelect = (nextTheme: Theme) => {
    setTheme(nextTheme);
    closeDesktopDropdowns();
  };

  const handleThemeToggle = () => {
    handleThemeSelect(theme === "dark" ? "light" : "dark");
  };

  const goldUnitLabel =
    selectedGoldUnit === "imperial" ? t("weightSystemImperialShort") : t("weightSystemMetricShort");

  const localeLabels: Record<SupportedLocale, string> = {
    en: "English",
    fr: "Français",
    de: "Deutsch",
  };


  return (
    <nav className="relative z-30 w-full border-b border-navbar-border bg-navbar text-base text-text-minor-data">
      <div className="relative mx-auto flex h-16 items-center justify-between gap-2 px-2 sm:px-4">
        <div className="flex items-center gap-2">
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={isMenuOpen}
            aria-controls="mobile-navigation"
            className={cn(navbarStyles.mobileOnly, "flex size-11 shrink-0 items-center justify-center rounded-lg border border-swap-container-border text-text-input hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring")}
            aria-label="Toggle navigation menu"
            onClick={() => {
              setIsMenuOpen((prev) => !prev);
              closeDesktopDropdowns();
            }}
          >
            {isMenuOpen ? <FaTimes aria-hidden="true" /> : <FaBars aria-hidden="true" />}
          </button>
          <div className="flex items-center gap-2">
            <Image
              src="/tokens/cygld.png"
              alt="CYGLD logo"
              width={2048}
              height={1716}
              sizes="22px"
              className="h-auto w-[22px] rounded"
            />
            <Link href="/" className={cn(navbarStyles.link, "font-semibold")}>
              CyberGold
            </Link>
          </div>
          <div className={cn(navbarStyles.desktopOnly, "ml-4 items-center gap-6")}>
            <Link
              href="/"
              className={cn(navbarStyles.link, isSwapActive && navbarStyles.activeLink)}
            >
              {t("swap")}
            </Link>
            <Link
              href="/dashboard"
              className={cn(navbarStyles.link, isDashboardActive && navbarStyles.activeLink)}
            >
              {t("dashboard")}
            </Link>
            {canViewGovernance && (
              <Link
                href="/governance"
                className={cn(navbarStyles.link, isGovernanceActive && navbarStyles.activeLink)}
              >
                {t("governance")}
              </Link>
            )}
            <Link
              target="_blank"
              rel="noopener noreferrer"
              href="https://cybergold-io.gitbook.io/white-paper"
              className={navbarStyles.link}
            >
              {t("whitePaper")}
            </Link>
            <Link
              target="_blank"
              rel="noopener noreferrer"
              href={`https://www.cybergold.io/${currentLocale}`}
              className={navbarStyles.link}
            >
              CyberGold.io
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className={cn(navbarStyles.desktopOnly, "items-center gap-4")}>
            <div className="relative">
              <button
                type="button"
                ref={localeToggleRef}
                aria-label={t("language")}
                className={navbarStyles.dropdownTrigger}
                onClick={() => {
                  setIsLocaleOpen((prev) => !prev);
                  setIsCurrencyOpen(false);
                  setIsGoldUnitOpen(false);
                }}
              >
                <span>{currentLocale.toUpperCase()}</span>
                <FaChevronDown className={cn("transition-transform", isLocaleOpen && "rotate-180")} />
              </button>
              {isLocaleOpen && (
                <div
                  ref={localeMenuRef}
                  className={cn(navbarStyles.dropdown, "w-32")}
                >
                  {routing.locales.map((locale) => (
                    <button
                      key={locale}
                      type="button"
                      className={navbarStyles.dropdownOption}
                      onClick={() => handleLanguageSelect(locale)}
                    >
                      {localeLabels[locale]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                type="button"
                ref={currencyToggleRef}
                aria-label={t("selectCurrency")}
                className={navbarStyles.dropdownTrigger}
                onClick={() => {
                  setIsCurrencyOpen((prev) => !prev);
                  setIsLocaleOpen(false);
                  setIsGoldUnitOpen(false);
                }}
              >
                <span>{selectedCurrency}</span>
                <FaChevronDown className={cn("transition-transform", isCurrencyOpen && "rotate-180")} />
              </button>
              {isCurrencyOpen && (
                <div
                  ref={currencyMenuRef}
                  className={cn(navbarStyles.dropdown, "w-24")}
                >
                  {supportedCurrencies.map((currency) => (
                    <button
                      key={currency}
                      type="button"
                      className={navbarStyles.dropdownOption}
                      onClick={() => handleCurrencySelect(currency)}
                    >
                      {currency}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                type="button"
                ref={goldUnitToggleRef}
                aria-label={t("selectGoldUnit")}
                className={navbarStyles.dropdownTrigger}
                onClick={() => {
                  setIsGoldUnitOpen((prev) => !prev);
                  setIsLocaleOpen(false);
                  setIsCurrencyOpen(false);
                }}
              >
                <span>{goldUnitLabel}</span>
                <FaChevronDown className={cn("transition-transform", isGoldUnitOpen && "rotate-180")} />
              </button>
              {isGoldUnitOpen && (
                <div
                  ref={goldUnitMenuRef}
                  className={cn(navbarStyles.dropdown, "w-36")}
                >
                  {supportedGoldUnits.map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      className={navbarStyles.dropdownOption}
                      onClick={() => handleGoldUnitSelect(unit)}
                    >
                      {unit === "imperial" ? t("weightSystemImperial") : t("weightSystemMetric")}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label={t("theme")}
              onClick={handleThemeToggle}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-swap-container-border bg-background-input transition-colors hover:bg-accent"
            >
              <FaMoon className="block text-text-input dark:hidden" />
              <FaSun className="hidden text-gold-cg dark:block" />
            </button>
          </div>
          <WalletConnectButton />
        </div>

        {isMenuOpen && (
          <div
            ref={menuRef}
            id="mobile-navigation"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setIsMenuOpen(false);
                toggleRef.current?.focus();
              }
            }}
            className={cn(navbarStyles.mobileOnly, "absolute left-0 top-full z-20 max-h-[calc(100dvh-4rem)] w-full overflow-y-auto overscroll-contain border-b border-navbar-border bg-background shadow-lg sm:w-80")}
          >
            <div className="grid grid-cols-2 gap-4 px-4 py-3">
              <Link
                href="/"
                className={cn(navbarStyles.link, isSwapActive && navbarStyles.activeLink)}
                onClick={() => setIsMenuOpen(false)}
              >
                {t("swap")}
              </Link>
              <Link
                href="/dashboard"
                className={cn(navbarStyles.link, isDashboardActive && navbarStyles.activeLink)}
                onClick={() => setIsMenuOpen(false)}
              >
                {t("dashboard")}
              </Link>
              {canViewGovernance && (
                <Link
                  href="/governance"
                  className={cn(navbarStyles.link, isGovernanceActive && navbarStyles.activeLink)}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {t("governance")}
                </Link>
              )}
              <Link
                target="_blank"
                rel="noopener noreferrer"
                href="https://cybergold-io.gitbook.io/white-paper"
                className={navbarStyles.externalLink}
                onClick={() => setIsMenuOpen(false)}
              >
                {t("whitePaper")}
              </Link>
              <Link
                target="_blank"
                rel="noopener noreferrer"
                href={`https://www.cybergold.io/${currentLocale}`}
                className={navbarStyles.externalLink}
                onClick={() => setIsMenuOpen(false)}
              >
                CyberGold.io
              </Link>
              <div className="order-first col-span-2 space-y-3 border-b border-swap-container-border pb-3">
                <div role="group" aria-label={t("language")} className="flex flex-wrap gap-2">
                  {routing.locales.map((locale) => (
                    <button
                      key={locale}
                      type="button"
                      aria-pressed={locale === currentLocale}
                      className={cn(navbarStyles.option, locale === currentLocale ? navbarStyles.activeOption : navbarStyles.inactiveOption)}
                      onClick={() => handleLanguageSelect(locale)}
                    >
                      {localeLabels[locale]}
                    </button>
                  ))}
                </div>
                <div role="group" aria-label={t("selectCurrency")} className="flex flex-wrap gap-2">
                  {supportedCurrencies.map((currency) => (
                    <button
                      key={currency}
                      type="button"
                      aria-pressed={currency === selectedCurrency}
                      className={cn(navbarStyles.option, currency === selectedCurrency ? navbarStyles.activeOption : navbarStyles.inactiveOption)}
                      onClick={() => handleCurrencySelect(currency)}
                    >
                      {currency}
                    </button>
                  ))}
                </div>
                <div role="group" aria-label={t("selectGoldUnit")} className="flex flex-wrap gap-2">
                  {supportedGoldUnits.map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      aria-pressed={unit === selectedGoldUnit}
                      className={cn(navbarStyles.option, unit === selectedGoldUnit ? navbarStyles.activeOption : navbarStyles.inactiveOption)}
                      onClick={() => handleGoldUnitSelect(unit)}
                    >
                      {unit === "imperial" ? t("weightSystemImperial") : t("weightSystemMetric")}
                    </button>
                  ))}
                </div>
                <div role="group" aria-label={t("theme")} className="flex flex-wrap gap-2">
                  {(["light", "dark"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={theme === option}
                      className={cn(navbarStyles.option, theme === option ? navbarStyles.activeOption : navbarStyles.inactiveOption)}
                      onClick={() => handleThemeSelect(option)}
                    >
                      {option === "light" ? t("lightMode") : t("darkMode")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
