"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { FaBasketShopping } from "react-icons/fa6";
import { useIsDarkMode } from "../hooks/useIsDarkMode";
import { useTokenPickerPresentation } from "../context/tokenPickerPresentationContext";
import type { TokenType } from "../types";
import { resolveTokenImagePath } from "../utils/tokenImages";
import { isAddress, getAddress, type Address } from "viem";
import type { erc20Token } from "../config/tokens";
import type { TokenMetadata } from "../utils/importedTokens";
import { parseTokenPickerSnapshot, readTokenPickerSnapshot, tokenPickerOpenStorageKey, tokenPickerSnapshotKey,
  writeTokenPickerSnapshot, type TokenPickerRow, type TokenPickerSnapshot } from "../utils/tokenPickerSnapshot";

type TokenPickerModalProps = {
  side: "sell" | "buy";
  open: boolean;
  onClose: () => void;
  tokens: TokenType[];
  selectedId?: string;
  onSelect: (id: string) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onImport?: (address: Address, signal: AbortSignal) => Promise<{ token: erc20Token | undefined; observation: TokenMetadata }>;
  walletOnly?: boolean;
  isLoading?: boolean;
};
const subscribeHydration = () => () => undefined;
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

/** Rebuild only this component's trusted template with saved primitive labels. */
function bootstrapTokenPicker(rootId: string, side: string, openKey: string,
  snapshotKey: typeof tokenPickerSnapshotKey, parse: typeof parseTokenPickerSnapshot, imagePath: typeof resolveTokenImagePath) {
  try {
    const root = document.getElementById(rootId);
    const key = snapshotKey(location.pathname, side);
    const snapshot = parse(JSON.parse(sessionStorage.getItem(key) ?? "null"));
    const preference = JSON.parse(sessionStorage.getItem(openKey) ?? "null");
    if (!root || !snapshot || preference?.path !== location.pathname || preference.side !== side) return;
    const cached = root.querySelector<HTMLElement>("[data-token-picker-cached]")!;
    const template = root.querySelector<HTMLElement>("[data-token-picker-template]")!;
    cached.replaceChildren(template.firstElementChild!.cloneNode(true));
    const search = cached.querySelector<HTMLInputElement>("[data-token-picker-search]")!;
    search.value = snapshot.query;
    const list = cached.querySelector<HTMLElement>("[data-token-picker-list]")!;
    const rowTemplate = list.querySelector<HTMLButtonElement>("[data-token-picker-option]")!;
    rowTemplate.remove();
    const status = cached.querySelector<HTMLElement>("[data-token-picker-status]")!;
    for (const row of snapshot.rows) {
      const option = rowTemplate.cloneNode(true) as HTMLButtonElement;
      option.dataset.tokenPickerOption = row.id;
      option.dataset.tokenPickerMatch = `${row.name} ${row.symbol} ${row.id} ${row.address}`.toLowerCase();
      option.setAttribute("aria-pressed", String(row.id === snapshot.selectedId));
      option.classList.toggle("border-gold-cg/45", row.id === snapshot.selectedId);
      option.querySelector<HTMLElement>("[data-token-picker-name]")!.textContent = row.name;
      option.querySelector<HTMLElement>("[data-token-picker-name]")!.title = row.name;
      option.querySelector<HTMLElement>("[data-token-picker-detail]")!.textContent = row.detail || row.symbol;
      const image = option.querySelector<HTMLImageElement>("[data-token-picker-image]")!;
      image.removeAttribute("srcset");
      image.src = imagePath(row.id, document.documentElement.classList.contains("dark")); image.alt = row.symbol;
      image.hidden = row.basket;
      image.classList.toggle("scale-80", row.id === "eth");
      option.querySelector<HTMLElement>("[data-token-picker-basket]")!.hidden = !row.basket;
      option.hidden = snapshot.query.trim() !== "" && !option.dataset.tokenPickerMatch.includes(snapshot.query.trim().toLowerCase());
      list.append(option);
    }
    status.hidden = [...list.querySelectorAll<HTMLElement>("[data-token-picker-option]")].some(option => !option.hidden);
    root.querySelector<HTMLElement>("[data-token-picker-live]")!.hidden = true;
    cached.hidden = false;
    list.scrollTop = snapshot.scrollTop;
    list.dataset.tokenPickerScroll = String(snapshot.scrollTop);
    // Delegation also handles a trusted copy inside the initial trade island.
    const browser = window as unknown as { __tokenPickerNativeEvents?: boolean };
    if (browser.__tokenPickerNativeEvents) return;
    browser.__tokenPickerNativeEvents = true;
    const save = (host: HTMLElement, update: Partial<TokenPickerSnapshot>) => {
      const pickerSide = host.dataset.tokenPickerSide!;
      const pickerKey = snapshotKey(location.pathname, pickerSide);
      const current = parse(JSON.parse(sessionStorage.getItem(pickerKey) ?? "null"));
      if (!current) return;
      const next = { ...current, ...update };
      try { sessionStorage.setItem(pickerKey, JSON.stringify(next)); } catch { /* optional preference */ }
      return next;
    };
    const close = (host: HTMLElement) => {
      save(host, { query: "", scrollTop: 0 });
      host.querySelector<HTMLElement>("[data-token-picker-cached]")!.hidden = true;
      try { sessionStorage.setItem(openKey, JSON.stringify({ path: location.pathname })); } catch { /* optional preference */ }
      window.dispatchEvent(new CustomEvent("token-picker-presentation", { detail: { side: host.dataset.tokenPickerSide, open: false } }));
    };
    document.addEventListener("input", event => {
      const input = event.target as HTMLInputElement;
      const host = input.closest<HTMLElement>("[data-token-picker-display-root]");
      if (!host || !input.matches("[data-token-picker-cached] [data-token-picker-search]")) return;
      save(host, { query: input.value, scrollTop: 0 });
      const query = input.value.trim().toLowerCase();
      const options = [...host.querySelectorAll<HTMLElement>("[data-token-picker-cached] [data-token-picker-option]")];
      options.forEach(option => { option.hidden = query !== "" && !option.dataset.tokenPickerMatch?.includes(query); });
      host.querySelector<HTMLElement>("[data-token-picker-cached] [data-token-picker-status]")!.hidden = options.some(option => !option.hidden);
      window.dispatchEvent(new CustomEvent("token-picker-query", { detail: { side: host.dataset.tokenPickerSide, query: input.value } }));
    });
    document.addEventListener("scroll", event => {
      const list = event.target as HTMLElement;
      const host = list.closest<HTMLElement>("[data-token-picker-display-root]");
      if (host && list.matches("[data-token-picker-cached] [data-token-picker-list]")) {
        list.dataset.tokenPickerScroll = String(list.scrollTop);
        save(host, { scrollTop: list.scrollTop });
      }
    }, true);
    document.addEventListener("mousedown", event => {
      for (const host of document.querySelectorAll<HTMLElement>("[data-token-picker-display-root]")) {
        const island = host.querySelector<HTMLElement>("[data-token-picker-cached]");
        if (island && !island.hidden && island.querySelector("[role=dialog]")?.getClientRects().length && !host.contains(event.target as Node)) close(host);
      }
    });
    document.addEventListener("click", event => {
      const option = (event.target as HTMLElement).closest<HTMLElement>("[data-token-picker-cached] [data-token-picker-option]");
      const host = option?.closest<HTMLElement>("[data-token-picker-display-root]");
      if (host && option) { save(host, { pendingId: option.dataset.tokenPickerOption }); close(host); }
    });
    document.addEventListener("keydown", event => {
      const host = (event.target as HTMLElement).closest<HTMLElement>("[data-token-picker-display-root]");
      if (!host || !(event.target as HTMLElement).closest("[data-token-picker-cached]")) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(host); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const options = [...host.querySelectorAll<HTMLButtonElement>("[data-token-picker-cached] [data-token-picker-option]")].filter(option => !option.hidden);
        if (!options.length) return;
        event.preventDefault();
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        options[index < 0 ? event.key === "ArrowDown" ? 0 : options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
      }
    });
  } catch { /* A missing display snapshot leaves the ordinary live picker. */ }
}

export function TokenPickerModal({ open, side, ...props }: TokenPickerModalProps) {
  const rootId = `token-picker-${useId()}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const hydrated = useSyncExternalStore(subscribeHydration, hydratedSnapshot, serverSnapshot);
  const { isRestored } = useTokenPickerPresentation();
  const t = useTranslations("Home");
  const { isLoading, onSelect } = props;
  useLayoutEffect(() => {
    const root = rootRef.current!;
    const cached = root.querySelector<HTMLElement>("[data-token-picker-cached]")!;
    if (!isRestored || (open && isLoading && !cached.hidden)) return;
    const focused = cached.contains(document.activeElement) ? document.activeElement : undefined;
    const list = root.querySelector<HTMLElement>("[data-token-picker-live] [data-token-picker-list]");
    const savedList = cached.querySelector<HTMLElement>("[data-token-picker-list]");
    cached.hidden = true;
    root.querySelector<HTMLElement>("[data-token-picker-live]")!.hidden = false;
    if (list && savedList) list.scrollTop = savedList.scrollTop;
    if (focused instanceof HTMLInputElement) {
      const input = root.querySelector<HTMLInputElement>("[data-token-picker-live] [data-token-picker-search]");
      if (input && !root.closest("[hidden]")) { input.focus({ preventScroll: true }); input.setSelectionRange(focused.selectionStart, focused.selectionEnd); }
    }
    cached.replaceChildren();
  }, [isRestored, open, isLoading]);
  useEffect(() => {
    const applyPending = () => {
      const snapshot = readTokenPickerSnapshot(side);
      if (!snapshot?.pendingId || isLoading) return;
      const id = snapshot.pendingId; delete snapshot.pendingId;
      writeTokenPickerSnapshot(side, snapshot);
      onSelect(id);
    };
    applyPending();
    window.addEventListener("token-picker-presentation", applyPending);
    return () => window.removeEventListener("token-picker-presentation", applyPending);
  }, [side, isLoading, onSelect]);
  const script = `(${bootstrapTokenPicker.toString()})(${JSON.stringify(rootId)},${JSON.stringify(side)},${JSON.stringify(tokenPickerOpenStorageKey)},(${tokenPickerSnapshotKey.toString()}),(${parseTokenPickerSnapshot.toString()}),(${resolveTokenImagePath.toString()}));`;
  return <div ref={rootRef} id={rootId} className="contents" data-token-picker-display-root data-token-picker-side={side}>
    <div data-token-picker-live className="contents [&[hidden]]:hidden" suppressHydrationWarning>{open && <TokenPickerModalContent side={side} {...props} />}</div>
    <div data-token-picker-cached hidden className="contents [&[hidden]]:hidden" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: "" }} />
    {!hydrated && <><div data-token-picker-template hidden><TokenPickerSurface query="" rows={[{ id: "eth", name: "", symbol: "", detail: "", address: "", basket: false }]}
      label={t("chooseCurrency")} searchLabel={t("searchCurrency")} status={t("noTokensFound")} /></div>
      <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: script }} /></>}
  </div>;
}

function pickerRow(token: TokenType): TokenPickerRow {
  return { id: token.id, name: token.name, symbol: token.symbol, address: token.type === "erc20" ? token.address : "", basket: token.type === "basket",
    detail: token.type === "basket" && token.components?.length
      ? token.components.map(component => `${(Number(component.targetWeight) * 100 / 1_000_000).toFixed(0)}% ${component.token.symbol}`).join(" + ") : token.symbol };
}
function TokenPickerModalContent({ side, onClose, tokens, selectedId, onSelect, triggerRef, onImport,
  walletOnly = false, isLoading = false }: Omit<TokenPickerModalProps, "open">) {
  const [query, setQuery] = useState(() => readTokenPickerSnapshot(side)?.query ?? "");
  const [imported, setImported] = useState<{ token: erc20Token | undefined; observation: TokenMetadata }>();
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState(false);
  const isDarkMode = useIsDarkMode();
  const t = useTranslations("Home");
  const modalRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldShowSearch = tokens.length > 1 || Boolean(onImport);
  const rows = useMemo(() => tokens.map(pickerRow), [tokens]);
  const importAddress = isAddress(query.trim(), { strict: false }) ? getAddress(query.trim()) : undefined;
  const alreadyListed = importAddress && tokens.some(token => token.type === "erc20" && token.address.toLowerCase() === importAddress.toLowerCase());
  useEffect(() => {
    if (!onImport || !importAddress || alreadyListed) return;
    const controller = new AbortController(); setImportLoading(true); setImportError(false);
    onImport(importAddress, controller.signal).then(value => { if (!controller.signal.aborted) setImported(value); })
      .catch(() => { if (!controller.signal.aborted) setImportError(true); })
      .finally(() => { if (!controller.signal.aborted) setImportLoading(false); });
    return () => controller.abort();
  }, [onImport, importAddress, alreadyListed]);
  useLayoutEffect(() => {
    const saved = readTokenPickerSnapshot(side);
    if (listRef.current) listRef.current.scrollTop = saved?.scrollTop ?? 0;
  }, [side]);
  useEffect(() => {
    const restore = (event: Event) => {
      const detail = (event as CustomEvent<{ side: string; query: string }>).detail;
      if (detail.side === side) setQuery(detail.query);
    };
    window.addEventListener("token-picker-query", restore);
    return () => window.removeEventListener("token-picker-query", restore);
  }, [side]);
  useLayoutEffect(() => {
    const previous = readTokenPickerSnapshot(side);
    writeTokenPickerSnapshot(side, { query, selectedId, rows: isLoading && previous ? previous.rows : rows, scrollTop: listRef.current?.scrollTop ?? previous?.scrollTop ?? 0,
      ...(previous?.pendingId ? { pendingId: previous.pendingId } : {}) });
  }, [side, query, selectedId, rows, isLoading]);
  useEffect(() => {
    const modal = modalRef.current; const trigger = triggerRef.current;
    const focus = searchRef.current ?? modal?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? modal?.querySelector<HTMLButtonElement>("button") ?? modal;
    if (!modal?.closest("[hidden]")) focus?.focus({ preventScroll: true });
    return () => { if (modal?.contains(document.activeElement) || document.activeElement === document.body) trigger?.focus({ preventScroll: true }); };
  }, [triggerRef, shouldShowSearch]);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest<HTMLElement>("[data-token-picker-display-root]")?.dataset.tokenPickerSide === side && target.closest("[data-token-picker-cached]")) return;
      if (modalRef.current && !modalRef.current.contains(target) && !triggerRef.current?.contains(target)) onClose();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [onClose, triggerRef, side]);
  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const matches = rows.filter(row => !shouldShowSearch || !lower || `${row.name} ${row.symbol} ${row.id} ${row.address}`.toLowerCase().includes(lower));
    if (imported?.token && imported.token.address.toLowerCase() === importAddress?.toLowerCase() && !matches.some(row => row.id === imported.token!.id)
      && (!walletOnly || (imported.observation.balance?.status === "success" && BigInt(imported.observation.balance.value) > 0n))) matches.push(pickerRow(imported.token));
    return matches;
  }, [query, rows, shouldShowSearch, imported, importAddress, walletOnly]);
  const status = isLoading ? "..." : t(importLoading ? "importTokenLoading" : importError ? "importTokenUnavailable" : imported && !imported.token ? "importTokenPrecisionUnavailable"
    : walletOnly && imported?.observation.balance?.status === "failure" ? "importTokenBalanceUnavailable" : "noTokensFound");
  return <TokenPickerSurface id="dropdown-from" query={query} rows={filtered} selectedId={selectedId} isDarkMode={isDarkMode} showSearch={shouldShowSearch}
    modalRef={modalRef} searchRef={searchRef} listRef={listRef} label={t("chooseCurrency")} searchLabel={t("searchCurrency")} status={status} isLoading={isLoading}
    onQuery={value => { setQuery(value); setImported(undefined); setImportError(false); setImportLoading(false); }} onSelect={onSelect}
    onScroll={() => { const saved = readTokenPickerSnapshot(side); if (saved) writeTokenPickerSnapshot(side, { ...saved, scrollTop: listRef.current?.scrollTop ?? 0 }); }}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); triggerRef.current?.focus({ preventScroll: true }); onClose(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const options = [...modalRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []]; if (!options.length) return;
        event.preventDefault(); const index = options.indexOf(document.activeElement as HTMLButtonElement);
        options[index < 0 ? event.key === "ArrowDown" ? 0 : options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
      }
    }} />;
}

type TokenPickerSurfaceProps = { id?: string; query: string; rows: TokenPickerRow[]; selectedId?: string; label: string; searchLabel: string; status: string;
  isDarkMode?: boolean; showSearch?: boolean; isLoading?: boolean; modalRef?: RefObject<HTMLDivElement | null>; searchRef?: RefObject<HTMLInputElement | null>; listRef?: RefObject<HTMLDivElement | null>;
  onQuery?: (query: string) => void; onSelect?: (id: string) => void; onScroll?: () => void; onKeyDown?: React.KeyboardEventHandler<HTMLDivElement> };
function TokenPickerSurface({ id, query, rows, selectedId, label, searchLabel, status, isDarkMode = false, showSearch = true, isLoading = false,
  modalRef, searchRef, listRef, onQuery, onSelect, onScroll, onKeyDown }: TokenPickerSurfaceProps) {
  return <div id={id} ref={modalRef} role="dialog" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}
    className="absolute right-0 z-[80] mt-2 w-80 max-w-[calc(100vw-4.5rem)] sm:max-w-none rounded-2xl border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] p-3 shadow-2xl">
    {showSearch && <div className="p-2 sm:p-5"><input ref={searchRef} data-token-picker-search value={query} onChange={event => onQuery?.(event.target.value)}
      aria-label={searchLabel} placeholder={searchLabel} className="w-full px-4 py-2 bg-[var(--background)] text-[var(--text-input)] placeholder:text-[var(--text-muted)] border border-[var(--swap-container-border)] rounded-xl text-base focus:outline-none focus:ring-1 focus:ring-gold-cg" /></div>}
    <div className="px-3 pb-4"><div ref={listRef} data-token-picker-list onScroll={onScroll} className="max-h-[min(20rem,50dvh)] overflow-y-auto">
      <div data-token-picker-status role="status" hidden={rows.length > 0} aria-busy={isLoading} className="px-4 py-6 text-sm text-[var(--text-muted)]">{status}</div>
      {rows.map(row => <button key={row.id} type="button" data-token-picker-option={row.id} aria-pressed={row.id === selectedId} onClick={() => onSelect?.(row.id)}
        className={`w-full text-left flex [&[hidden]]:hidden items-center justify-between border border-transparent p-3 rounded-xl transition-colors hover:bg-[rgba(223,185,65,0.1)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${row.id === selectedId ? "border-gold-cg/45 bg-transparent" : ""}`}>
        <div className="flex min-w-0 items-center gap-3"><span data-token-picker-basket hidden={!row.basket}><FaBasketShopping className="text-gold-cg text-2xl" /></span>
          <Image data-token-picker-image hidden={row.basket} src={resolveTokenImagePath(row.id, isDarkMode)} alt={row.symbol} width={28} height={28}
            className={`h-[28px] w-[28px] shrink-0 rounded-full object-contain${row.id === "eth" ? " scale-80" : ""}`} />
          <div className="min-w-0 break-words"><div className="font-semibold text-[var(--text-input)]"><div data-token-picker-name className="truncate" title={row.name}>{row.name}</div></div>
            <div data-token-picker-detail className="text-sm text-[var(--text-muted)]">{row.detail || row.symbol}</div></div></div>
      </button>)}
    </div></div>
  </div>;
}
