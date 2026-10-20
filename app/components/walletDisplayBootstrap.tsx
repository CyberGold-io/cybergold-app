"use client";

import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useConfig } from "wagmi";
import { targetChainId } from "../config/chain";
import { publicEnv } from "../config/publicEnvironment";
import { useCurrency } from "../context/currencyContext";
import { useObservedWalletAccount } from "../hooks/useObservedWalletAccount";
import { setWalletPanelOpen, walletPanelState } from "../utils/walletPanelState";
import { parseWalletPresentationSnapshot, walletPresentationStorageKey, type WalletPresentationSnapshot } from "../utils/walletPresentationSnapshot";
import { readStoredTradeDisplayScope, tradeDisplayScopeKey } from "../utils/tradeDisplaySnapshot";
import { parseWalletRecoveryDisplay } from "../utils/walletDisplayCache";
import { resolveTokenImagePath } from "../utils/tokenImages";
import { WalletBalanceRow, WalletPanelFrame, walletConnectedPillClass, walletPillBaseClass } from "./walletPresentation";
import { WalletRecoveryPresentation } from "./walletRecoveryPresentation";
import { LiquidityProviderPanel } from "./liquidityProviderPanel";

const subscribeHydration = () => () => undefined;
const clientHydrated = () => true;
const serverHydrated = () => false;

/** The island contains only this app's templates filled with saved primitive text. */
function bootstrapWalletDisplay(rootId: string, storageKey: string, chainId: number, locale: string,
  parse: typeof parseWalletPresentationSnapshot, readScope: typeof readStoredTradeDisplayScope,
  scopeKey: typeof tradeDisplayScopeKey, tokenImage: typeof resolveTokenImagePath,
  parseRecovery: typeof parseWalletRecoveryDisplay, labels: { open: string; close: string; view: string; hide: string }) {
  try {
    const root = document.getElementById(rootId);
    const live = root?.querySelector<HTMLElement>("[data-wallet-live]");
    const cached = root?.querySelector<HTMLElement>("[data-wallet-cached]");
    const template = root?.querySelector<HTMLElement>("[data-wallet-template]");
    const snapshot = parse(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null"));
    if (!root || !live || !cached || !template || !snapshot
      || snapshot.scopeKey !== scopeKey(readScope(chainId, locale, window.localStorage))) return;
    cached.replaceChildren(...[...template.childNodes].map(node => node.cloneNode(true)));
    const ids = new Map<string, string>();
    for (const node of cached.querySelectorAll<HTMLElement>("[id]")) {
      const id = `${rootId}-presentation-${node.id}`;
      ids.set(node.id, id);
      node.id = id;
    }
    for (const node of cached.querySelectorAll<HTMLElement>("*")) {
      for (const attribute of ["for", "aria-labelledby", "aria-describedby", "aria-controls"]) {
        const value = node.getAttribute(attribute);
        if (value) node.setAttribute(attribute, value.split(" ").map(id => ids.get(id) ?? id).join(" "));
      }
    }
    cached.dataset.walletAddress = snapshot.address;
    const pill = cached.querySelector<HTMLButtonElement>("[data-wallet-connected-button]")!;
    const pillLabel = pill.querySelector("span")!;
    pillLabel.textContent = snapshot.label;
    const networkSwitch = cached.querySelector<HTMLButtonElement>("[data-wallet-network-switch]")!;
    networkSwitch.textContent = snapshot.networkSwitchLabel ?? "";
    networkSwitch.hidden = !snapshot.networkSwitchLabel;
    const dialog = cached.querySelector<HTMLDialogElement>("dialog")!;
    const panel = dialog.querySelector<HTMLElement>("[data-wallet-panel-content]")!;
    panel.dataset.testid = "wallet-cached-panel";
    const addressLabel = panel.querySelector<HTMLElement>('[data-wallet-display="address"]')!;
    const shortAddress = `${snapshot.address.slice(0, 6)}...${snapshot.address.slice(-4)}`;
    addressLabel.textContent = snapshot.showFullAddress ? snapshot.address : shortAddress;
    addressLabel.classList.toggle("truncate", !snapshot.showFullAddress);
    const network = panel.querySelector<HTMLElement>('[data-wallet-display="network"]')!;
    const networkLabel = `${network.dataset.walletNetworkLabel}: ${snapshot.networkName}`;
    network.setAttribute("aria-label", networkLabel);
    network.setAttribute("title", networkLabel);
    const rows = panel.querySelector<HTMLElement>("[data-wallet-rows]")!;
    for (const row of snapshot.rows) {
      const rowTemplate = root.querySelector<HTMLElement>(`[data-wallet-row-template="${row.tokenId === "cygld" ? "cygld" : "other"}"]`)!;
      const node = rowTemplate.firstElementChild!.cloneNode(true) as HTMLElement;
      node.dataset.walletRow = row.tokenId;
      node.dataset.walletSymbol = row.symbol;
      for (const field of ["name", "amount", "value"] as const) {
        const label = node.querySelector<HTMLElement>(`[data-wallet-field="${field}"]`)!;
        label.textContent = row[field];
        if (field === "name") label.title = row.name;
      }
      const image = node.querySelector<HTMLImageElement>("[data-wallet-image]")!;
      image.removeAttribute("srcset");
      image.src = tokenImage(row.tokenId, document.documentElement.classList.contains("dark"));
      image.alt = `${row.name} icon`;
      if (row.importLabel) {
        const action = document.createElement("button");
        action.type = "button";
        action.disabled = true;
        action.dataset.walletImport = row.importState ?? "import";
        action.textContent = row.importLabel;
        action.className = `rounded-full px-2.5 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed ${row.importState === "imported"
          ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-white"
          : "border border-[var(--swap-container-border)] text-[var(--text-input)] dark:text-white"}`;
        node.querySelector("[data-wallet-action-slot]")?.append(action);
      }
      rows.append(node);
    }
    const liquidity = panel.querySelector<HTMLElement>("[data-wallet-liquidity-section]")!;
    if (snapshot.liquidity) {
      for (const field of liquidity.querySelectorAll<HTMLElement>("[data-wallet-liquidity]")) {
        const value = snapshot.liquidity.values[field.dataset.walletLiquidity!];
        field.textContent = value ?? "";
        if (field.dataset.walletLiquidity === "empty") field.hidden = value === undefined;

      }
      const trigger = liquidity.querySelector<HTMLButtonElement>("h3 button")!;
      const content = liquidity.querySelector<HTMLElement>("h3 + div")!;
      const savedExpanded = window.sessionStorage.getItem("cg:wallet-liquidity-open:v1");
      let expanded = savedExpanded === null ? snapshot.liquidity.expanded : savedExpanded === "true";
      const setExpanded = () => {
        trigger.setAttribute("aria-expanded", String(expanded));
        trigger.querySelector(".transition-transform")?.classList.toggle("rotate-180", expanded);
        content.hidden = !expanded;
      };
      setExpanded();
      trigger.addEventListener("click", () => {
        expanded = !expanded;
        setExpanded();
        try { window.sessionStorage.setItem("cg:wallet-liquidity-open:v1", String(expanded)); } catch { /* optional preference */ }
        window.dispatchEvent(new CustomEvent("wallet-display-liquidity", { detail: expanded }));
      });
    } else liquidity.hidden = true;
    let recovery: ReturnType<typeof parseRecovery>;
    try { recovery = parseRecovery(JSON.parse(window.sessionStorage.getItem(
      `cybergold:wallet-display:v1:${chainId}:${snapshot.address.toLowerCase()}:recovery:${locale}`) ?? "null")); }
    catch { /* This optional section cannot interrupt the saved button/panel. */ }
    const recoveryRoot = panel.querySelector<HTMLElement>("[data-wallet-recovery-root]")!;
    if (recovery?.notConfigured) {
      const status = root.querySelector<HTMLElement>('[data-wallet-recovery-template="status"]')!;
      recoveryRoot.append(...[...status.childNodes].map(node => node.cloneNode(true)));
    } else if (recovery?.rows.length) {
      const section = root.querySelector<HTMLElement>('[data-wallet-recovery-template="section"]')!.firstElementChild!.cloneNode(true) as HTMLElement;
      const row = section.querySelector<HTMLElement>("[data-wallet-recovery-row]")!;
      const rowContainer = row.parentElement!;
      row.remove();
      const paused = section.querySelector<HTMLElement>('[data-wallet-recovery-field="corePaused"]')!;
      paused.hidden = !recovery.corePaused;
      for (const entry of recovery.rows) {
        const node = row.cloneNode(true) as HTMLElement;
        node.dataset.walletRecoveryRow = entry.shareId;
        for (const key of ["assetLabel", "balance", "payout", "fundOffer", "redeemLabel"] as const) {
          const field = node.querySelector<HTMLElement>(`[data-wallet-recovery-field="${key}"]`)!;
          field.textContent = entry[key] ?? "";
          if (key === "fundOffer" || key === "redeemLabel") field.hidden = entry[key] === undefined;
        }
        node.querySelector<HTMLElement>('[data-wallet-recovery-field="zeroPayout"]')!.hidden = !entry.zeroPayout;
        rowContainer.append(node);
      }
      recoveryRoot.append(section);
    }
    const savePreference = (update: Partial<WalletPresentationSnapshot>) => {
      Object.assign(snapshot, update);
      try { window.sessionStorage.setItem(storageKey, JSON.stringify(snapshot)); } catch { /* optional display preference */ }
    };
    let fullAddress = snapshot.showFullAddress === true;
    const toggleAddress = panel.querySelector<HTMLButtonElement>("[data-wallet-toggle-address]")!;
    const displayAddress = () => {
      addressLabel.textContent = fullAddress ? snapshot.address : shortAddress;
      addressLabel.classList.toggle("truncate", !fullAddress);
      toggleAddress.setAttribute("aria-pressed", String(fullAddress));
      toggleAddress.setAttribute("aria-label", fullAddress ? labels.hide : labels.view);
      toggleAddress.title = fullAddress ? labels.hide : labels.view;
      panel.querySelector<HTMLElement>('[data-wallet-address-eye="show"]')!.hidden = fullAddress;
      panel.querySelector<HTMLElement>('[data-wallet-address-eye="hide"]')!.hidden = !fullAddress;
    };
    displayAddress();
    toggleAddress.addEventListener("click", () => {
      fullAddress = !fullAddress;
      displayAddress();
      savePreference({ showFullAddress: fullAddress });
      window.dispatchEvent(new CustomEvent("wallet-display-address", { detail: fullAddress }));
    });
    panel.querySelector("[data-wallet-copy-address]")?.addEventListener("click", () => {
      void navigator.clipboard.writeText(snapshot.address).catch(() => undefined);
    });
    panel.addEventListener("click", event => event.stopPropagation());
    panel.addEventListener("scroll", () => savePreference({ scrollTop: panel.scrollTop }), { passive: true });
    const desktop = window.matchMedia("(min-width: 1025px)");
    let isOpen = window.sessionStorage.getItem("cg:wallet-panel-open:v1") === "true";
    const presentPanel = () => {
      pill.className = isOpen ? pill.dataset.openClass! : pill.dataset.closedClass!;
      pill.setAttribute("aria-expanded", String(isOpen));
      pill.setAttribute("aria-label", isOpen ? labels.close : labels.open);
      if (dialog.open) dialog.close();
      if (isOpen) {
        dialog.setAttribute("aria-modal", String(!desktop.matches));
        if (desktop.matches) dialog.show(); else dialog.showModal();
      }
    };
    const togglePanel = (open: boolean) => {
      isOpen = open;
      try { window.sessionStorage.setItem("cg:wallet-panel-open:v1", String(open)); } catch { /* local preference */ }
      presentPanel();
      window.dispatchEvent(new CustomEvent("wallet-display-panel", { detail: open }));
      if (!open) pill.focus({ preventScroll: true });
    };
    pill.addEventListener("click", () => togglePanel(!isOpen));
    panel.querySelector("[data-wallet-close]")?.addEventListener("click", () => togglePanel(false));
    dialog.addEventListener("cancel", event => { event.preventDefault(); togglePanel(false); });
    dialog.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); togglePanel(false); }
    });
    dialog.addEventListener("click", event => { if (event.target === dialog) togglePanel(false); });
    const onResize = () => { if (!cached.hidden) presentPanel(); };
    desktop.addEventListener("change", onResize);
    root.addEventListener("wallet-display-finished", () => desktop.removeEventListener("change", onResize), { once: true });
    live.hidden = true;
    cached.hidden = false;
    presentPanel();
    panel.scrollTop = snapshot.scrollTop ?? 0;
  } catch { /* Optional presentation must never interrupt the live wallet. */ }
}

export function clearWalletPresentation() {
  try {
    const prefix = `cybergold:wallet-presentation:v1:${targetChainId}:`;
    for (let index = window.sessionStorage.length - 1; index >= 0; index--) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(prefix)) window.sessionStorage.removeItem(key);
    }
  } catch { /* optional storage */ }
}

/** Keep the initial presentation until the actual connector and dialog take over. */
export function WalletDisplayBootstrap({ children }: { children: ReactNode }) {
  const id = `wallet-display-${useId()}`;
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const rootRef = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const t = useTranslations("WalletMenu");
  const balancesT = useTranslations("WalletBalances");
  const config = useConfig();
  const account = useObservedWalletAccount();
  const currentAccount = useRef(account);
  const { selectedCurrency, selectedGoldUnit, selectedPriceDisplayMode } = useCurrency();
  const scope = tradeDisplayScopeKey({ chainId: targetChainId, locale, currency: selectedCurrency,
    goldUnit: selectedGoldUnit, priceDisplayMode: selectedPriceDisplayMode });
  const currentScope = useRef(scope);
  useLayoutEffect(() => {
    currentAccount.current = account;
    currentScope.current = scope;
  }, [account, scope]);
  useLayoutEffect(() => {
    const root = rootRef.current!;
    const live = root.querySelector<HTMLElement>("[data-wallet-live]")!;
    const cached = root.querySelector<HTMLElement>("[data-wallet-cached]")!;
    const key = walletPresentationStorageKey(targetChainId, locale);
    let restoring = config.state.status === "connecting" || config.state.status === "reconnecting";
    let restorationFinished = config.state.status === "connected";
    let scheduled = false;
    let disposed = false;
    const publishResult = (result: "connected" | "disconnected") => {
      if (root.dataset.walletRestoration === result) return;
      root.dataset.walletRestoration = result;
      root.dispatchEvent(new Event("wallet-display-finished"));
    };
    const finish = (result: "connected" | "disconnected") => {
      if (cached.hidden) { publishResult(result); return; }
      // A native mobile shell must leave the top layer before the live dialog
      // receives focus. Both changes happen in this one rendering task.
      const hadFocus = cached.contains(document.activeElement);
      const savedScroll = cached.querySelector<HTMLElement>("[data-wallet-panel-content]")?.scrollTop;
      cached.querySelector<HTMLDialogElement>("dialog")?.close();
      cached.hidden = true;
      live.hidden = false;
      const livePanel = live.querySelector<HTMLElement>("[data-wallet-panel-content]");
      if (livePanel && savedScroll !== undefined) livePanel.scrollTop = savedScroll;
      cached.replaceChildren();
      if (hadFocus) {
        const dialog = live.querySelector<HTMLDialogElement>("dialog[open]");
        const control = dialog?.querySelector<HTMLButtonElement>("button:not([disabled])")
          ?? live.querySelector<HTMLButtonElement>("[data-wallet-connected-button]");
        control?.focus({ preventScroll: true });
      }
      publishResult(result);
    };
    const sync = () => {
      scheduled = false;
      if (disposed) return;
      if (live.querySelector('[data-wallet-disconnecting="true"]')) {
        clearWalletPresentation();
        finish("disconnected");
        return;
      }
      const observed = currentAccount.current;
      const pill = live.querySelector<HTMLButtonElement>("[data-wallet-connected-button]");
      const address = observed.isConnected ? observed.address?.toLowerCase() : undefined;
      if (address && cached.dataset.walletAddress && cached.dataset.walletAddress.toLowerCase() !== address) finish("connected");
      if ((restorationFinished && config.state.status === "disconnected")
        || (observed.connector && observed.hasObservedProviderAccounts && !observed.isConnected)) {
        clearWalletPresentation();
        finish("disconnected");
        return;
      }
      if (!pill || !address || pill.dataset.walletAddress !== address) return;
      // Once the initial display has handed over, later real connections must
      // replace a previous disconnected outcome even without a cached shell.
      if (cached.hidden) publishResult("connected");
      const dialog = live.querySelector<HTMLDialogElement>("dialog");
      const panel = dialog?.querySelector<HTMLElement>("[data-wallet-panel-content]");
      const open = walletPanelState().isOpen;
      const preferencesRestored = currentScope.current === tradeDisplayScopeKey(readStoredTradeDisplayScope(targetChainId, locale));
      if (!cached.hidden && preferencesRestored && pill.getAttribute("aria-expanded") === String(open) && (!open || dialog?.open)) finish("connected");
      if (!cached.hidden) return;
      let previous: WalletPresentationSnapshot | undefined;
      try { previous = parseWalletPresentationSnapshot(JSON.parse(window.sessionStorage.getItem(key) ?? "null")); }
      catch { /* Restricted or malformed storage cannot interrupt the live view. */ }
      const rows = panel ? [...panel.querySelectorAll<HTMLElement>("[data-wallet-row]")].map(row => ({
        tokenId: row.dataset.walletRow!, symbol: row.dataset.walletSymbol ?? "",
        name: row.querySelector('[data-wallet-field="name"]')?.textContent ?? "",
        amount: row.querySelector('[data-wallet-field="amount"]')?.textContent ?? "",
        value: row.querySelector('[data-wallet-field="value"]')?.textContent ?? "",
        ...(row.querySelector("[data-wallet-import]") ? {
          importLabel: row.querySelector("[data-wallet-import]")!.textContent ?? "",
          importState: row.querySelector<HTMLElement>("[data-wallet-import]")!.dataset.walletImport as "import" | "importing" | "imported",
        } : {}),
      })) : previous?.address.toLowerCase() === address ? previous.rows : [];
      const liquidity = panel?.querySelector<HTMLElement>('[data-testid="liquidity-provider-panel"]');
      const snapshot: WalletPresentationSnapshot = {
        scopeKey: currentScope.current, address: observed.address!, label: pill.textContent?.trim() ?? "", rows,
        showFullAddress: panel?.querySelector("[data-wallet-toggle-address]")?.getAttribute("aria-pressed") === "true",
        scrollTop: panel && !live.hidden ? panel.scrollTop : previous?.scrollTop ?? 0,
        ...(live.querySelector("[data-wallet-network-switch]") ? { networkSwitchLabel: live.querySelector("[data-wallet-network-switch]")!.textContent?.trim() ?? "" } : {}),
        networkName: panel?.dataset.walletNetworkName ?? (previous?.address.toLowerCase() === address ? previous.networkName : ""),
        ...(liquidity ? { liquidity: {
          expanded: liquidity.querySelector("h3 button")?.getAttribute("aria-expanded") === "true",
          values: Object.fromEntries([...liquidity.querySelectorAll<HTMLElement>("[data-wallet-liquidity]")]
            .map(node => [node.dataset.walletLiquidity!, node.textContent ?? ""])),
        } } : previous?.address.toLowerCase() === address && previous.liquidity ? { liquidity: previous.liquidity } : {}),
      };
      try { window.sessionStorage.setItem(key, JSON.stringify(snapshot)); } catch { /* optional display cache */ }
    };
    const schedule = () => { if (!scheduled) { scheduled = true; queueMicrotask(sync); } };
    // Children subscribe in layout effects before Wagmi begins reconnecting in
    // its passive hydration effect. Initial disconnected is not its outcome.
    const unsubscribe = config.subscribe(state => state.status, status => {
      if (status === "connecting" || status === "reconnecting") restoring = true;
      else if (restoring || status === "connected") restorationFinished = true;
      schedule();
    });
    const observer = new MutationObserver(schedule);
    observer.observe(live, { childList: true, subtree: true, characterData: true, attributes: true });
    live.addEventListener("scroll", schedule, true);
    const onPanel = (event: Event) => { setWalletPanelOpen((event as CustomEvent<boolean>).detail); schedule(); };
    window.addEventListener("wallet-display-panel", onPanel);
    root.addEventListener("wallet-display-observed", schedule);
    schedule();
    return () => {
      disposed = true; observer.disconnect(); unsubscribe();
      live.removeEventListener("scroll", schedule, true);
      window.removeEventListener("wallet-display-panel", onPanel);
      root.removeEventListener("wallet-display-observed", schedule);
    };
  }, [config, locale]);
  useLayoutEffect(() => { rootRef.current?.dispatchEvent(new Event("wallet-display-observed")); }, [account, scope]);
  const script = `(${bootstrapWalletDisplay.toString()})(${[
    JSON.stringify(id), JSON.stringify(walletPresentationStorageKey(targetChainId, locale)), targetChainId, JSON.stringify(locale),
    `(${parseWalletPresentationSnapshot.toString()})`, `(${readStoredTradeDisplayScope.toString()})`,
    `(${tradeDisplayScopeKey.toString()})`, `(${resolveTokenImagePath.toString()})`, `(${parseWalletRecoveryDisplay.toString()})`,
    JSON.stringify({ open: t("menu"), close: balancesT("close"), view: balancesT("viewAddress"), hide: balancesT("hideAddress") }),
  ].join(",")});`;
  return <div ref={rootRef} id={id} data-wallet-display-root className="contents">
    <div data-wallet-live data-testid="wallet-live-view" className="contents" suppressHydrationWarning>{children}</div>
    <div data-wallet-cached data-testid="wallet-cached-view" hidden className="contents" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: "" }} />
    {!hydrated && <><div hidden data-wallet-template>
      <div className="flex items-center gap-2 relative">
      <button type="button" hidden disabled data-wallet-network-switch className={`${walletPillBaseClass.replace("disabled:opacity-60", "")} border-red-500 bg-red-500 font-semibold text-white hover:bg-red-600`} />
      <button type="button" data-wallet-connected-button data-open-class={walletConnectedPillClass(true)} data-closed-class={walletConnectedPillClass(false)}
        className={walletConnectedPillClass(false)} aria-label={t("menu")} aria-expanded="false"><span className="text-[15px] min-[1025px]:font-semibold" /></button>
      </div>
      <dialog className="wallet-panel m-0 max-h-none max-w-none items-stretch justify-end bg-transparent p-0 open:flex backdrop:bg-black/30" aria-labelledby={`${id}-cached-title`}>
        <WalletPanelFrame titleId={`${id}-cached-title`} networkName="" actionsDisabled testId={false}>
          {publicEnv.NEXT_PUBLIC_FORK_FAUCET_ENABLED === "1" && <div className="mt-4 rounded-2xl border border-gold-cg/20 bg-gold-cg/5 p-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-input)]">{balancesT("faucetTitle")}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)] dark:text-white">{balancesT("faucetDescription")}</p>
            </div><button type="button" disabled className="shrink-0 rounded-full border border-gold-cg bg-gold-cg px-3 py-1.5 text-xs font-semibold text-black">{balancesT("fund")}</button></div>
          </div>}
          <div data-wallet-rows className="mt-4 space-y-2" />
          <LiquidityProviderPanel expanded testIds={false} onExpandedChange={() => undefined} liquidity={{ isLoading: false, error: undefined, isRefreshing: false, refetch: () => undefined }}
            cachedDisplay={{ positionCount: 0, paxgAmount: "0", cygldAmount: "0" }} formatValue={() => ""} />
          <div data-wallet-recovery-root />
        </WalletPanelFrame>
      </dialog>
    </div>
    <div hidden data-wallet-row-template="other"><WalletBalanceRow tokenId="eth" tokenName="" tokenSymbol="" amountText="" valueText="" testIds={false} /></div>
    <div hidden data-wallet-row-template="cygld"><WalletBalanceRow tokenId="cygld" tokenName="" tokenSymbol="" amountText="" valueText="" testIds={false} /></div>
    <div hidden data-wallet-recovery-template="status"><WalletRecoveryPresentation display={{ notConfigured: true, corePaused: false, rows: [] }} /></div>
    <div hidden data-wallet-recovery-template="section"><WalletRecoveryPresentation display={{ notConfigured: false, corePaused: true,
      rows: [{ shareId: "", assetLabel: "", balance: "", payout: "", fundOffer: "", zeroPayout: true }] }} /></div>
    <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: script }} /></>}
  </div>;
}
