"use client";

import Image from "next/image";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FiExternalLink } from "react-icons/fi";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { type SupportedLocale } from "@/i18n/routing";
import { useGovernanceSafe } from "../hooks/useGovernanceSafe";
import { useObservedWalletAccount } from "../hooks/useObservedWalletAccount";
import { useHelpersRouterFacts } from "../hooks/useHelpersRouterFacts";
import { hasGovernanceNavigationAccess, normalizeGovernanceAddress } from "../utils/governanceAuthority";
import { WalletConnectButton } from "./walletConnectButton";
import { NavbarSettings } from "./navbarSettings";
import { THEME_PREFERENCE_KEY, type Theme } from "../lib/theme";
import { useTabFlag } from "../hooks/useTabFlag";
import { useWalletDisplayCache } from "../hooks/useWalletDisplayCache";
import { useWalletPresentationAddress } from "../hooks/useWalletPresentationRestoring";
import { subscribeWalletPanel, walletPanelState } from "../utils/walletPanelState";
import { targetChainId } from "../config/chain";

const subscribeHydration = () => () => undefined;
const clientHydrated = () => true;
const serverHydrated = () => false;

type NavigationDisplay = { address: string; visible: boolean };
function parseNavigationDisplay(value: unknown): NavigationDisplay | undefined {
  if (value && typeof value === "object" && "address" in value && "visible" in value
    && typeof value.address === "string" && typeof value.visible === "boolean") {
    return { address: value.address, visible: value.visible };
  }
}

export function Navbar({ initialTheme }: { initialTheme: Theme }) {
  const navbarId = useId();
  const t = useTranslations("Navbar");
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = useLocale() as SupportedLocale;
  const { address, isConnected } = useObservedWalletAccount();
  const coreGovernance = useGovernanceSafe({
    enabled: isConnected,
  });
  const helpersOwnerQuery = useHelpersRouterFacts(facts => facts.configuration.owner.status === "success"
    ? facts.configuration.owner.value : undefined, { enabled: isConnected });
  const helpersOwner = normalizeGovernanceAddress(helpersOwnerQuery.data);
  const helpersGovernance = useGovernanceSafe({
    authorityAddress: helpersOwner,
    authorityKind: "owner",
    enabled: isConnected && helpersOwner !== undefined,
  });
  const liveGovernanceVisible =
    isConnected &&
    hasGovernanceNavigationAccess(address, [
      coreGovernance.owners,
      helpersGovernance.owners,
    ]);
  const navigationKey = `cg:navbar-governance:v1:${targetChainId}`;
  const observedNavigation = useMemo<NavigationDisplay | undefined>(() => {
    const complete = coreGovernance.source !== "unknown" && helpersGovernance.source !== "unknown"
      && !coreGovernance.isLoading && !helpersGovernance.isLoading && !coreGovernance.error && !helpersGovernance.error;
    return address && isConnected && (liveGovernanceVisible || complete)
      ? { address: address.toLowerCase(), visible: liveGovernanceVisible } : undefined;
  }, [address, isConnected, liveGovernanceVisible, coreGovernance.source, coreGovernance.isLoading, coreGovernance.error,
    helpersGovernance.source, helpersGovernance.isLoading, helpersGovernance.error]);
  const navigation = useWalletDisplayCache(navigationKey, parseNavigationDisplay, observedNavigation);
  const restoringAddress = useWalletPresentationAddress();
  const displayedAddress = address?.toLowerCase() ?? restoringAddress;
  const canViewGovernance = liveGovernanceVisible || Boolean(navigation?.visible
    && displayedAddress === navigation.address && !observedNavigation);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const menuKey = `cg:navbar-ui:v1:${currentLocale}:${pathname}:`;
  const [isMenuOpen, setIsMenuOpen] = useTabFlag(`${menuKey}mobile`);
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const navRef = useRef<HTMLElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      if (spacerRef.current) spacerRef.current.style.paddingTop = `${nav.clientHeight}px`;
    };
    const scroll = () => { nav.dataset.scrolled = String(window.scrollY > 12); };
    const resize = () => {
      measure();
      if (window.matchMedia("(min-width: 992px)").matches) setIsMenuOpen(false);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav); measure(); scroll(); resize();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", scroll);
    };
  }, [setIsMenuOpen]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.colorScheme = theme;
    root.classList.toggle("dark", theme === "dark");
    document.cookie = `${THEME_PREFERENCE_KEY}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [theme]);

  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer || !isMenuOpen || !window.matchMedia("(max-width: 991.98px)").matches) return;
    try { drawer.scrollTop = Number(sessionStorage.getItem(`${menuKey}mobileScroll`) ?? 0) || 0; }
    catch { /* Optional disclosure position. */ }
    const focusable = () => [...drawer.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")]
      .filter(element => element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); setIsMenuOpen(false);
        // Return focus after React removes the drawer's focus trap.
        requestAnimationFrame(() => toggleRef.current?.focus());
      } else if (event.key === "Tab") {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    const focusin = (event: FocusEvent) => {
      if (!drawer.contains(event.target as Node)) closeRef.current?.focus({ preventScroll: true });
    };
    const walletOpened = () => { if (walletPanelState().isOpen) setIsMenuOpen(false); };
    const unsubscribe = subscribeWalletPanel(walletOpened);
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    return () => {
      cancelAnimationFrame(frame); unsubscribe();
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
    };
  }, [isMenuOpen, menuKey, setIsMenuOpen]);

  const closeDrawer = (returnFocus = false) => {
    setIsMenuOpen(false);
    if (returnFocus) requestAnimationFrame(() => toggleRef.current?.focus());
  };

  return <>
    <div ref={spacerRef} className="cg-navbar-spacer" aria-hidden="true" />
    <nav ref={navRef} id={navbarId} data-navbar-ready={hydrated || undefined} data-drawer-open={isMenuOpen}
      data-scrolled="false" suppressHydrationWarning className="cg-navbar" aria-label={t("mainNavigation")}>
      <div className="cg-navbar-inner">
        <a href={`https://www.cybergold.io/${currentLocale}/`} className="cg-navbar-brand">
          <Image src="/branding/logo-cybergold-new.png" alt="" width={2048} height={1716}
            sizes="23px" className="cg-navbar-logo" />
          <span>CyberGold</span>
        </a>
        <button type="button" tabIndex={-1} className="cg-drawer-backdrop" aria-label={t("closeNavigation")}
          data-open={isMenuOpen} suppressHydrationWarning onClick={() => closeDrawer(true)} />
        <div ref={drawerRef} id={`${navbarId}-navigation`} className="cg-primary-navigation" data-navbar-menu="mobile"
          data-open={isMenuOpen} suppressHydrationWarning
          role={isMenuOpen ? "dialog" : undefined} aria-modal={isMenuOpen || undefined}
          aria-label={isMenuOpen ? t("menu") : undefined}
          onScroll={event => {
            try { sessionStorage.setItem(`${menuKey}mobileScroll`, String(event.currentTarget.scrollTop)); }
            catch { /* Optional disclosure position. */ }
          }}>
          <div className="cg-drawer-header">
            <h2>{t("menu")}:</h2>
            <button type="button" ref={closeRef} className="cg-drawer-close" aria-label={t("closeNavigation")}
              onClick={() => closeDrawer(true)}><span aria-hidden="true">{"\ued3b"}</span></button>
          </div>
          <div className="cg-primary-links">
            <Link href="/" className="cg-primary-link" onClick={() => closeDrawer()}>{t("swap")}</Link>
            <Link href="/dashboard" className="cg-primary-link" onClick={() => closeDrawer()}>{t("dashboard")}</Link>
            {(canViewGovernance || !hydrated) && <Link href="/governance" className="cg-primary-link"
              data-navbar-governance hidden={!canViewGovernance} suppressHydrationWarning
              onClick={() => closeDrawer()}>{t("governance")}</Link>}
            <a href="https://litepaper.cybergold.io/" target="_blank" rel="noopener" className="cg-primary-link"
              onClick={() => closeDrawer()}>Litepaper<FiExternalLink className="cg-external-icon" aria-hidden="true" focusable="false" />
              <span className="sr-only"> ({t("opensInNewTab")})</span>
            </a>
          </div>
        </div>
        <div className="cg-navbar-actions">
          <div className="cg-navbar-wallet"><WalletConnectButton /></div>
          <button ref={toggleRef} type="button" className="cg-navbar-hamburger" aria-label={t("openNavigation")}
            aria-expanded={isMenuOpen} aria-controls={`${navbarId}-navigation`} data-navbar-toggle="mobile" suppressHydrationWarning
            onClick={() => {
              document.dispatchEvent(new Event("cg:close-navbar-settings"));
              setIsMenuOpen(value => !value);
            }}><span /><span /><span /></button>
          <NavbarSettings key={`${currentLocale}:${pathname}`} locale={currentLocale} menuKey={menuKey} theme={theme}
            onThemeSelect={setTheme} onLanguageSelect={locale => {
              if (locale !== currentLocale) router.replace(`${pathname}${window.location.search}${window.location.hash}`, { locale });
              closeDrawer();
            }} onOpen={() => closeDrawer()} />
        </div>
      </div>
      <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: `(${restoreNavbarPresentation.toString()})(${JSON.stringify(navbarId)},${JSON.stringify(menuKey)},${JSON.stringify(navigationKey)});` }} />
    </nav>
  </>;
}

// Keep saved selections/disclosures stable before the existing stores hydrate.
// This restores presentation only; cached governance never grants authority.
function restoreNavbarPresentation(navbarId: string, menuKey: string, navigationKey: string) {
  try {
    const navbar = document.getElementById(navbarId);
    const narrow = matchMedia("(max-width: 991.98px)").matches;
    for (const name of ["mobile", "settings", "locale", "currency", "goldUnit", "theme"]) {
      const open = sessionStorage.getItem(`${menuKey}${name}`) === "true";
      const menu = navbar?.querySelector<HTMLElement>(`[data-navbar-menu="${name}"]`);
      const trigger = navbar?.querySelector(`[data-navbar-toggle="${name}"]`);
      trigger?.setAttribute("aria-expanded", String(open));
      if (name === "mobile") {
        navbar?.setAttribute("data-drawer-open", String(open && narrow));
        menu?.setAttribute("data-open", String(open && narrow));
        navbar?.querySelector(".cg-drawer-backdrop")?.setAttribute("data-open", String(open && narrow));
        if (open && narrow && menu) {
          menu.setAttribute("role", "dialog"); menu.setAttribute("aria-modal", "true");
          menu.scrollTop = Number(sessionStorage.getItem(`${menuKey}mobileScroll`) ?? 0) || 0;
        }
      } else if (menu) {
        menu.hidden = !open;
        if (name === "settings") menu.scrollTop = Number(sessionStorage.getItem(`${menuKey}settingsScroll`) ?? 0) || 0;
      }
    }
    const currency = localStorage.getItem("display-currency") ?? "USD";
    const goldUnit = localStorage.getItem("display-gold-unit") ?? "metric";
    for (const [attribute, selected] of [["data-navbar-currency-option", currency], ["data-navbar-gold-unit-option", goldUnit]]) {
      for (const option of navbar?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? []) {
        const active = option.getAttribute(attribute) === selected;
        option.setAttribute("aria-pressed", String(active));
      }
    }
    navbar?.setAttribute("data-scrolled", String(scrollY > 12));
    const navigation = JSON.parse(sessionStorage.getItem(navigationKey) ?? "null");
    const wallet = navbar?.querySelector<HTMLElement>("[data-wallet-cached]:not([hidden])");
    if (navigation?.visible === true && navigation.address === wallet?.dataset.walletAddress?.toLowerCase()) {
      for (const link of navbar?.querySelectorAll<HTMLElement>("[data-navbar-governance]") ?? []) link.hidden = false;
    }
  } catch { /* Browser storage is optional; ordinary controls remain usable. */ }
}
