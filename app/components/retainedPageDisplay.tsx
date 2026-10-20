"use client";

import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { publicEnv } from "../config/publicEnvironment";
import { useCurrency } from "../context/currencyContext";
import { readStoredTradeDisplayScope, tradeDisplayScopeKey } from "../utils/tradeDisplaySnapshot";
import { capturePassivePageSnapshot, parsePassivePageSnapshot, restorePassivePageSnapshot } from "../utils/passivePageSnapshot";

function bootstrapRetainedPage(rootId: string, storageKey: string, chainId: number, locale: string, privatePage: boolean,
  parse: typeof parsePassivePageSnapshot, restore: typeof restorePassivePageSnapshot, capture: typeof capturePassivePageSnapshot,
  readScope: typeof readStoredTradeDisplayScope, scopeKey: typeof tradeDisplayScopeKey) {
  try {
    const root = document.getElementById(rootId);
    const live = root?.querySelector<HTMLElement>("[data-page-live]");
    const cached = root?.querySelector<HTMLElement>("[data-page-cached]");
    const snapshot = parse(JSON.parse(sessionStorage.getItem(storageKey) ?? "null"));
    if (!root || !live || !cached || !snapshot || snapshot.scope !== scopeKey(readScope(chainId, locale, localStorage))) return;
    if (privatePage) {
      const wallet = JSON.parse(sessionStorage.getItem(`cybergold:wallet-presentation:v1:${chainId}:${locale}`) ?? "null");
      if (!wallet?.address || wallet.address.toLowerCase() !== snapshot.account?.toLowerCase()) return;
    }
    restore(cached, snapshot, rootId);
    // Passive action controls never execute or queue a click while live authority restores.
    cached.addEventListener("click", event => {
      if ((event.target as Element).closest("button")) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    cached.addEventListener("submit", event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    live.dataset.pageHydrating = "";
    cached.hidden = false;
    root.dataset.pageRestored = "true";
    const saveNativeEdits = () => {
      try { sessionStorage.setItem(storageKey, JSON.stringify(capture(cached, snapshot.scope, snapshot.account, parse))); } catch { /* Native edits stay usable. */ }
    };
    for (const event of ["input", "change", "toggle"]) cached.addEventListener(event, saveNativeEdits, true);
    requestAnimationFrame(() => { if (!cached.hidden) window.scrollTo({ top: snapshot.scrollY, behavior: "instant" }); });
  } catch { /* Optional display storage cannot prevent the ordinary live page. */ }
}

function transferPageDrafts(cached: HTMLElement, live: HTMLElement) {
  const controls = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")];
  for (const old of cached.querySelectorAll<HTMLDetailsElement>("details[data-page-detail-key]")) {
    const matches = [...live.querySelectorAll<HTMLDetailsElement>("details[data-page-detail-key]")].filter(next => next.dataset.pageDetailKey === old.dataset.pageDetailKey);
    if (matches.length === 1) matches[0].open = old.open;
  }
  const source = controls(cached);
  const target = controls(live);
  for (const old of source) {
    if (old instanceof HTMLInputElement && (old.readOnly || old.disabled || ["hidden", "button", "submit", "file"].includes(old.type))) continue;
    const unique = (candidates: typeof target) => candidates.length === 1 ? candidates[0] : undefined;
    const originalId = old.dataset.pageOriginalId ?? old.id;
    const key = old.dataset.pageDraftKey;
    const next = (key ? unique(target.filter(node => node.dataset.pageDraftKey === key)) : undefined)
      ?? (originalId ? unique(target.filter(node => node.id === originalId)) : undefined)
      ?? (old.getAttribute("aria-label") ? unique(target.filter(node => node.getAttribute("aria-label") === old.getAttribute("aria-label"))) : undefined)
      ?? (old.name ? unique(target.filter(node => node.name === old.name)) : undefined);
    if (!next || next.tagName !== old.tagName || (next instanceof HTMLInputElement && (next.readOnly || next.disabled || next.type !== (old as HTMLInputElement).type))) continue;
    const focused = document.activeElement === old;
    if (old instanceof HTMLInputElement && ["checkbox", "radio"].includes(old.type) && next instanceof HTMLInputElement) {
      if (next.checked !== old.checked) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(next, old.checked);
        next.dispatchEvent(new Event("click", { bubbles: true }));
      }
    } else if (old.value !== next.value) {
      const prototype = next instanceof HTMLInputElement ? HTMLInputElement.prototype : next instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(next, old.value);
      next.dispatchEvent(new Event(next instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    }
    if (focused) {
      next.focus({ preventScroll: true });
      if ((old instanceof HTMLInputElement || old instanceof HTMLTextAreaElement)
        && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) && old.selectionStart !== null) {
        next.setSelectionRange(old.selectionStart, old.selectionEnd);
      }
    }
  }
}

/** Presentation restoration is separate from all query caches and action eligibility. */
export function RetainedPageDisplay({ page, ready, discard: requestedDiscard = false, account = null, privatePage = false, children }: {
  page: string;
  ready: boolean;
  discard?: boolean;
  account?: string | null;
  privatePage?: boolean;
  children: ReactNode;
}) {
  const id = `retained-page-${useId()}`;
  const walletRestoredDisconnected = useSyncExternalStore(listener => {
    document.addEventListener("wallet-display-finished", listener, true);
    return () => document.removeEventListener("wallet-display-finished", listener, true);
  }, () => document.querySelector<HTMLElement>("[data-wallet-display-root]")?.dataset.walletRestoration === "disconnected", () => false);
  const discard = requestedDiscard || (privatePage && walletRestoredDisconnected);
  const locale = useLocale();
  const { selectedCurrency, selectedGoldUnit, selectedPriceDisplayMode } = useCurrency();
  const chainId = Number(publicEnv.NEXT_PUBLIC_CHAIN_ID);
  const storageKey = `cg:page-display:v1:${chainId}:${locale}:${page}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const script = `(${bootstrapRetainedPage.toString()})(${[
    JSON.stringify(id), JSON.stringify(storageKey), chainId, JSON.stringify(locale), privatePage,
    `(${parsePassivePageSnapshot.toString()})`, `(${restorePassivePageSnapshot.toString()})`, `(${capturePassivePageSnapshot.toString()})`,
    `(${readStoredTradeDisplayScope.toString()})`, `(${tradeDisplayScopeKey.toString()})`,
  ].join(",")});`;

  useLayoutEffect(() => {
    const root = rootRef.current;
    const live = root?.querySelector<HTMLElement>("[data-page-live]");
    const cached = root?.querySelector<HTMLElement>("[data-page-cached]");
    if (!root || !live || !cached) return;
    let savedAccount: string | null | undefined;
    try { savedAccount = parsePassivePageSnapshot(JSON.parse(sessionStorage.getItem(storageKey) ?? "null"))?.account; } catch { /* optional */ }
    const changedAccount = privatePage && account !== null && savedAccount !== undefined && account.toLowerCase() !== savedAccount?.toLowerCase();
    if (!ready && !discard && !changedAccount) return;
    const restoreDrafts = ready && !discard && !changedAccount && !cached.hidden;
    let handoffFrame = 0;
    let disposed = false;
    const handoff = () => {
      if (disposed) return;
      // The hidden live page keeps its layout, so charts can render while the
      // last completed canvas remains on screen. No execution depends on this.
      if (restoreDrafts && (live.querySelector("[data-page-display-pending=\"true\"]")
        || live.querySelectorAll("[data-page-chart-slot]").length > live.querySelectorAll(".echarts-for-react[data-page-chart-ready]").length)) {
        handoffFrame = requestAnimationFrame(handoff);
        return;
      }
      delete live.dataset.pageHydrating;
      if (restoreDrafts) transferPageDrafts(cached, live);
      cached.hidden = true;
      cached.replaceChildren();
      schedule();
    };
    if (discard || changedAccount) {
      try { sessionStorage.removeItem(storageKey); } catch { /* optional */ }
    }
    const save = () => {
      if (!ready || discard || !live.isConnected || live.hasAttribute("data-page-hydrating")) return;
      try {
        const snapshot = capturePassivePageSnapshot(live, tradeDisplayScopeKey(readStoredTradeDisplayScope(chainId, locale, localStorage)), account);
        sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
      } catch { /* Live data and controls remain independent of display storage. */ }
    };
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(save); };
    const observer = new MutationObserver(schedule);
    observer.observe(live, { childList: true, characterData: true, attributes: true, subtree: true });
    live.addEventListener("input", schedule);
    live.addEventListener("change", schedule);
    live.addEventListener("toggle", schedule, true);
    window.addEventListener("pagehide", save);
    window.addEventListener("beforeunload", save);
    handoff();
    const settledCharts = window.setTimeout(save, 800);
    return () => {
      disposed = true;
      cancelAnimationFrame(handoffFrame);
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(settledCharts);
      live.removeEventListener("input", schedule);
      live.removeEventListener("change", schedule);
      live.removeEventListener("toggle", schedule, true);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", save);
    };
  }, [ready, discard, privatePage, account, chainId, locale, storageKey, selectedCurrency, selectedGoldUnit, selectedPriceDisplayMode]);

  return (
    <div ref={rootRef} id={id} data-retained-page={page} className="contents">
      <style>{`[data-page-live][data-page-hydrating] { display: block; position: absolute; visibility: hidden; pointer-events: none; width: 100%; left: 0; top: 0; }`}</style>
      <div data-page-live className="contents" suppressHydrationWarning>{children}</div>
      <div data-page-cached data-testid="retained-page-cached" hidden className="contents [&[hidden]]:hidden" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: "" }} />
      <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: script }} />
    </div>
  );
}
