"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { FiBarChart2, FiCheck, FiChevronDown, FiChevronRight, FiGlobe, FiMoon, FiSettings } from "react-icons/fi";
import { LuCoins } from "react-icons/lu";
import { routing, type SupportedLocale } from "@/i18n/routing";
import { useCurrency } from "../context/currencyContext";
import { useTabFlag } from "../hooks/useTabFlag";
import type { Theme } from "../lib/theme";

type NavbarSettingsProps = {
  locale: SupportedLocale;
  menuKey: string;
  theme: Theme;
  onThemeSelect: (theme: Theme) => void;
  onLanguageSelect: (locale: SupportedLocale) => void;
  onOpen: () => void;
};

export function NavbarSettings({ locale, menuKey, theme, onThemeSelect, onLanguageSelect, onOpen }: NavbarSettingsProps) {
  const t = useTranslations("Navbar");
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useTabFlag(`${menuKey}settings`);
  const [languageOpen, setLanguageOpen] = useTabFlag(`${menuKey}locale`);
  const [goldOpen, setGoldOpen] = useTabFlag(`${menuKey}goldUnit`);
  const [currencyOpen, setCurrencyOpen] = useTabFlag(`${menuKey}currency`);
  const [themeOpen, setThemeOpen] = useTabFlag(`${menuKey}theme`);
  const { selectedCurrency, setSelectedCurrency, supportedCurrencies, selectedGoldUnit,
    setSelectedGoldUnit, supportedGoldUnits, setSelectedPriceDisplayMode } = useCurrency();
  const groups = [
    { name: "locale", label: t("language"), icon: FiGlobe, open: languageOpen, set: setLanguageOpen },
    { name: "goldUnit", label: t("goldMetrics"), icon: FiBarChart2, open: goldOpen, set: setGoldOpen },
    { name: "currency", label: t("currency"), icon: LuCoins, open: currencyOpen, set: setCurrencyOpen },
    { name: "theme", label: t("theme"), icon: FiMoon, open: themeOpen, set: setThemeOpen },
  ];

  const close = useCallback(() => {
    setOpen(false);
    setLanguageOpen(false); setGoldOpen(false); setCurrencyOpen(false); setThemeOpen(false);
  }, [setOpen, setLanguageOpen, setGoldOpen, setCurrencyOpen, setThemeOpen]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("cg:close-navbar-settings", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("cg:close-navbar-settings", close);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    try { panelRef.current.scrollTop = Number(sessionStorage.getItem(`${menuKey}settingsScroll`) ?? 0) || 0; }
    catch { /* Optional disclosure position. */ }
  }, [open, menuKey]);

  const focusEdge = (last: boolean) => requestAnimationFrame(() => {
    const buttons = panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    const visible = [...(buttons ?? [])].filter(button => button.getClientRects().length > 0);
    (last ? visible.at(-1) : visible[0])?.focus();
  });
  const handlePanelKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")]
      .filter(element => element.getClientRects().length > 0);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    event.preventDefault(); items[next]?.focus();
  };
  const localeLabels: Record<SupportedLocale, string> = { en: "English", fr: "French", de: "German" };

  return <div ref={rootRef} className="cg-settings"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}
    onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.preventDefault(); event.stopPropagation(); close(); triggerRef.current?.focus();
      }
    }}>
    <button ref={triggerRef} type="button" className="cg-settings-trigger" aria-label="Settings"
      aria-expanded={open} aria-controls={`${id}-panel`} data-navbar-toggle="settings" suppressHydrationWarning
      onClick={() => { if (open) close(); else { onOpen(); setOpen(true); } }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); onOpen(); setOpen(true); focusEdge(event.key === "ArrowUp");
        }
      }}>
      <FiSettings className="cg-settings-gear" aria-hidden="true" focusable="false" />
      <span className="cg-settings-divider" aria-hidden="true" />
      <FiChevronDown className="cg-settings-chevron" aria-hidden="true" focusable="false" />
    </button>
    <div ref={panelRef} id={`${id}-panel`} className="cg-settings-panel" role="region" aria-label="Settings"
      hidden={!open} data-navbar-menu="settings" suppressHydrationWarning onKeyDown={handlePanelKeys}
      onScroll={event => {
        try { sessionStorage.setItem(`${menuKey}settingsScroll`, String(event.currentTarget.scrollTop)); }
        catch { /* Optional disclosure position. */ }
      }}>
      {groups.map(group => {
        const Icon = group.icon;
        // Keep the theme controls and callbacks available, but hide their group.
        return <div className="cg-settings-group" key={group.name} hidden={group.name === "theme"}>
          <button type="button" className="cg-settings-row" aria-expanded={group.open} suppressHydrationWarning
            aria-controls={`${id}-${group.name}`} data-navbar-toggle={group.name}
            data-testid={group.name === "currency" ? "display-currency-control" : group.name === "goldUnit" ? "display-gold-unit-control" : undefined}
            onClick={() => groups.forEach(item => item.set(item.name === group.name ? !group.open : false))}>
            <Icon className="cg-settings-group-icon" aria-hidden="true" focusable="false" />
            <span>{group.label}</span><FiChevronRight className="cg-settings-group-chevron" aria-hidden="true" focusable="false" />
          </button>
          <ul id={`${id}-${group.name}`} className="cg-settings-options" hidden={!group.open}
            data-navbar-menu={group.name} suppressHydrationWarning>
            {group.name === "locale" && routing.locales.map(option => <li key={option}>
              <button type="button" className="cg-settings-option" aria-current={option === locale ? "page" : undefined}
                onClick={() => { onLanguageSelect(option); close(); }}>
                <span>{localeLabels[option]}</span><FiCheck className="cg-settings-check" aria-hidden="true" focusable="false" />
              </button>
            </li>)}
            {group.name === "goldUnit" && supportedGoldUnits.map(unit => <li key={unit}>
              <button type="button" className="cg-settings-option" aria-pressed={unit === selectedGoldUnit}
                data-navbar-gold-unit-option={unit} suppressHydrationWarning
                onClick={() => { setSelectedGoldUnit(unit); setSelectedPriceDisplayMode("gold"); close(); }}>
                <span>{t(unit === "imperial" ? "weightSystemImperial" : "weightSystemMetric")}</span>
                <FiCheck className="cg-settings-check" aria-hidden="true" focusable="false" />
              </button>
            </li>)}
            {group.name === "currency" && supportedCurrencies.map(currency => <li key={currency}>
              <button type="button" className="cg-settings-option" aria-pressed={currency === selectedCurrency}
                data-navbar-currency-option={currency} suppressHydrationWarning
                onClick={() => { setSelectedCurrency(currency); setSelectedPriceDisplayMode("fiat"); close(); }}>
                <span>{currency}</span><FiCheck className="cg-settings-check" aria-hidden="true" focusable="false" />
              </button>
            </li>)}
            {group.name === "theme" && (["light", "dark"] as const).map(option => <li key={option}>
              <button type="button" className="cg-settings-option" aria-pressed={option === theme}
                onClick={() => { onThemeSelect(option); close(); }}>
                <span>{t(option === "light" ? "lightMode" : "darkMode")}</span><FiCheck className="cg-settings-check" aria-hidden="true" focusable="false" />
              </button>
            </li>)}
          </ul>
        </div>;
      })}
    </div>
  </div>;
}
