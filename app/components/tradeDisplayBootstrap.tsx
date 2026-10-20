"use client";

import { useId, type ReactNode, type FocusEvent, type ChangeEvent } from "react";
import Image from "next/image";
import { resolveTokenImagePath } from "../utils/tokenImages";
import { readSwapFeePreferences, type SwapFeePreferences } from "../utils/swapFeePreferences";
import {
  parseTradeDisplaySnapshot,
  readStoredTradeDisplayScope,
  tradeDisplayIntentKey,
  tradeDisplayScopeKey,
  tradeDisplaySnapshotStorageKey,
  type TradeBasketDisplayRow,
} from "../utils/tradeDisplaySnapshot";

/** Shared trusted row markup for the live form and the pre-paint presentation. */
export function TradeBasketPresentationRow({ row, isDarkMode, inputRef, onFocus, onChange, inputClassName, disabled = false, busy = false }: {
  row: TradeBasketDisplayRow;
  isDarkMode: boolean;
  inputRef?: (element: HTMLInputElement | null) => void;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  inputClassName?: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return <div data-trade-basket-row={row.tokenId} className="grid grid-cols-[minmax(0,104px)_minmax(0,1fr)] items-center gap-2 p-2 text-xs sm:grid-cols-[104px_minmax(132px,170px)_minmax(0,1fr)]">
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center overflow-hidden">
        <Image src={resolveTokenImagePath(row.tokenId, isDarkMode)} data-trade-basket-image alt={row.symbol} width={22} height={22} className="h-full w-full object-contain" />
      </div>
      <span data-trade-basket-field="symbol" className="whitespace-nowrap text-text-input">{row.symbol}</span>
      <span data-trade-basket-field="weight" className="whitespace-nowrap text-text-muted">{row.weight}</span>
    </div>
    <div className="min-w-0">
      <input hidden={row.side !== "sell"} data-trade-basket-input data-trade-spend-input={row.side === "sell" && row.driver ? "" : undefined}
        className={inputClassName ?? "block min-w-0 w-full rounded-md border border-swap-container-border bg-background-swap p-2 text-start text-sm tabular-nums editable-caret transition-colors focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring text-text-input focus:border-gold-cg/45 focus:ring-0"}
        type="text" inputMode="decimal" aria-label={row.label} value={row.amount} ref={inputRef} onFocus={onFocus} onChange={onChange} disabled={disabled} readOnly={!onChange} />
      <output hidden={row.side !== "buy"} data-trade-estimate data-trade-basket-output aria-label={row.label} aria-describedby="receive-amount-description"
        aria-busy={busy || undefined}
        className="block min-w-0 w-full break-words p-2 text-start text-sm tabular-nums select-text cursor-default text-text-input">{row.amount}</output>
    </div>
    <div data-trade-estimate={row.side === "buy" ? true : undefined} data-trade-basket-field="equivalent" className="hidden min-w-0 truncate text-right text-text-input text-xs tabular-nums sm:block" title={row.equivalent}>{row.equivalent}</div>
  </div>;
}

/** Runs while parsing the page, before the default server form can be painted. */
function bootstrapTradeDisplay(
  rootId: string,
  storageKey: string,
  chainId: number,
  locale: string,
  parseSnapshot: typeof parseTradeDisplaySnapshot,
  intentKeyOf: typeof tradeDisplayIntentKey,
  scopeKeyOf: typeof tradeDisplayScopeKey,
  readScope: typeof readStoredTradeDisplayScope,
  tokenImagePath: typeof resolveTokenImagePath,
  readFeePreferences: typeof readSwapFeePreferences,
) {
  const wireFeePreferences = (presentation: HTMLElement) => {
    const feePreferences = readFeePreferences(window.sessionStorage);
    const feeDetails = presentation.querySelector<HTMLDetailsElement>("[data-trade-fees]");
    const persistFeePreferences = (change: SwapFeePreferences) => {
      Object.assign(feePreferences, change);
      try {
        window.sessionStorage.setItem("cg:swap-fee-preferences:v1", JSON.stringify(feePreferences));
      } catch { /* Native controls remain usable without storage. */ }
      window.dispatchEvent(new CustomEvent("trade-display-fees", { detail: feePreferences }));
    };
    if (feeDetails) {
      feeDetails.open = feePreferences.detailsOpen ?? false;
      const summary = feeDetails.querySelector("summary");
      summary?.setAttribute("aria-expanded", String(feeDetails.open));
      feeDetails.addEventListener("toggle", () => {
        summary?.setAttribute("aria-expanded", String(feeDetails.open));
        persistFeePreferences({ detailsOpen: feeDetails.open });
      });
    }
    const toleranceInputs = presentation.querySelectorAll<HTMLInputElement>("[data-trade-tolerance]");
    for (const tolerance of toleranceInputs) {
      if (feePreferences.slippageBps !== undefined) tolerance.value = String(feePreferences.slippageBps / 100);
      tolerance.addEventListener("input", () => {
        const percent = Number(tolerance.value.replace(",", "."));
        if (!tolerance.value.trim() || !Number.isFinite(percent) || percent < 0 || percent > 1) return;
        const slippageBps = Math.round(percent * 100);
        for (const other of toleranceInputs) {
          if (other !== tolerance) other.value = String(slippageBps / 100);
        }
        persistFeePreferences({ slippageBps });
      });
    }
  };
  try {
    const root = document.getElementById(rootId);
    const live = root?.querySelector<HTMLElement>("[data-trade-live]");
    const cached = root?.querySelector<HTMLElement>("[data-trade-cached]");
    if (!live || !cached) return;
    // No live wallet balance exists in SSR. Restore its native MAX state
    // before React hydrates, including when the initial DOM lost the attribute.
    for (const button of live.querySelectorAll<HTMLButtonElement>("button[data-trade-max]")) button.disabled = true;

    let parsedDraft: Parameters<typeof intentKeyOf>[0] | undefined;
    let parsedSnapshot: ReturnType<typeof parseSnapshot>;
    try {
      parsedDraft = JSON.parse(window.sessionStorage.getItem("cg:swap-form-state:v1") ?? "null");
      parsedSnapshot = parseSnapshot(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null"));
    } catch { /* Preferences remain usable without a stored trade display. */ }
    const draft = parsedDraft;
    const snapshot = parsedSnapshot;
    if (!draft || !snapshot || snapshot.intentKey !== intentKeyOf(draft)
      || snapshot.scopeKey !== scopeKeyOf(readScope(chainId, locale, window.localStorage))) {
      wireFeePreferences(live);
      return;
    }

    // The template is this page's trusted SSR markup, never serialized HTML.
    const presentation = live.cloneNode(true) as HTMLElement;
    presentation.removeAttribute("data-trade-live");
    const evaluationPanel = presentation.querySelector<HTMLElement>("[data-trade-evaluation]");
    if (evaluationPanel) evaluationPanel.dataset.tradeEvaluation = snapshot.values.evaluationStatus ??
      (snapshot.values.quoteComplete === "true" ? "confirmed" : "pending");
    // Retain the prior version's one useful spending value during a local
    // upgrade; the old maximum/refund rows no longer exist in the template.
    if (!snapshot.values.purchaseSpendingValue && snapshot.values.purchaseEstimatedSpend) {
      snapshot.values.purchaseSpendingValue = snapshot.values.purchaseEstimatedSpend;
      snapshot.values.purchaseSpendingLimited = "true";
    }
    const ids = new Map<string, string>();
    for (const node of [presentation, ...presentation.querySelectorAll<HTMLElement>("*")]) {
      if (node.id) {
        const id = `${rootId}-cached-${node.id}`;
        ids.set(node.id, id);
        node.id = id;
      }
      node.removeAttribute("data-testid");
    }
    for (const node of presentation.querySelectorAll<HTMLElement>("*")) {
      for (const attribute of ["for", "aria-labelledby", "aria-describedby", "aria-controls"]) {
        const value = node.getAttribute(attribute);
        if (value) node.setAttribute(attribute, value.split(" ").map(id => ids.get(id) ?? id).join(" "));
      }
    }
    for (const node of presentation.querySelectorAll<HTMLElement>("[data-trade-display]")) {
      const value = snapshot.values[node.dataset.tradeDisplay ?? ""];
      if (value === undefined) continue;
      if (node instanceof HTMLInputElement) node.value = value;
      else node.textContent = value;
      if (node.dataset.tradeDisplay === "sellBalance" || node.dataset.tradeDisplay === "buyBalance") {
        node.hidden = !value;
        const label = snapshot.values[`${node.dataset.tradeDisplay}Label`] ?? value;
        if (value) {
          node.title = label;
          node.setAttribute("aria-label", label);
        } else {
          node.removeAttribute("title");
          node.removeAttribute("aria-label");
        }
      }
    }
    const showSpending = snapshot.values.sellIsBasket !== "true";
    for (const node of presentation.querySelectorAll<HTMLElement>("[data-trade-spending]")) {
      node.hidden = !showSpending;
      const limited = snapshot.values.purchaseSpendingLimited === "true";
      const value = node.querySelector<HTMLElement>("[data-trade-spending-value]");
      const tooltip = node.querySelector<HTMLElement>("[data-trade-spending-tooltip]");
      if (value) {
        value.dataset.limited = String(limited);
        if (limited) {
          value.tabIndex = 0;
          if (tooltip?.id) value.setAttribute("aria-describedby", tooltip.id);
        } else {
          value.removeAttribute("tabindex");
          value.removeAttribute("aria-describedby");
        }
      }
      if (tooltip) tooltip.hidden = !limited;
    }
    for (const side of ["sell", "buy"]) {
      const basket = snapshot.values[`${side}IsBasket`] === "true";
      for (const node of presentation.querySelectorAll<HTMLElement>(`[data-trade-single="${side}"]`)) node.hidden = basket;
      for (const node of presentation.querySelectorAll<HTMLElement>(`[data-trade-basket="${side}"]`)) node.hidden = !basket;
      if (side === "sell" && basket) presentation.querySelector('[data-trade-display="sellAmount"]')?.removeAttribute("data-trade-spend-input");
      const rows = presentation.querySelector<HTMLElement>(`[data-trade-basket-rows="${side}"]`);
      const template = presentation.querySelector<HTMLElement>("[data-trade-basket-template]")?.firstElementChild;
      if (rows && template) {
        rows.replaceChildren();
        for (const row of snapshot.basketRows?.filter(row => row.side === side) ?? []) {
          const node = template.cloneNode(true) as HTMLElement;
          node.dataset.tradeBasketRow = row.tokenId;
          for (const field of ["symbol", "weight", "equivalent"] as const) {
            const label = node.querySelector<HTMLElement>(`[data-trade-basket-field="${field}"]`)!;
            label.textContent = row[field];
            if (field === "equivalent") {
              label.title = row.equivalent;
              if (side === "buy") label.dataset.tradeEstimate = "";
              else label.removeAttribute("data-trade-estimate");
            }
          }
          const image = node.querySelector<HTMLImageElement>("[data-trade-basket-image]")!;
          image.removeAttribute("srcset");
          image.src = tokenImagePath(row.tokenId, document.documentElement.classList.contains("dark"));
          image.alt = row.symbol;
          const input = node.querySelector<HTMLInputElement>("[data-trade-basket-input]")!;
          input.value = row.amount;
          input.hidden = side !== "sell";
          input.readOnly = false;
          input.setAttribute("aria-label", row.label);
          input.dataset.tradeBasketAddress = row.address;
          if (side === "sell" && row.driver) input.dataset.tradeSpendInput = "";
          else input.removeAttribute("data-trade-spend-input");
          const output = node.querySelector<HTMLOutputElement>("[data-trade-basket-output]")!;
          output.textContent = row.amount;
          output.hidden = side !== "buy";
          output.setAttribute("aria-label", row.label);
          output.setAttribute("aria-describedby", ids.get("receive-amount-description") ?? "receive-amount-description");
          rows.append(node);
        }
      }
    }
    for (const output of presentation.querySelectorAll<HTMLElement>('[data-trade-basket-output], [data-trade-display="buyAmount"]')) {
      if (evaluationPanel?.dataset.tradeEvaluation === "pending") output.setAttribute("aria-busy", "true");
      else output.removeAttribute("aria-busy");
    }
    const walletVisible = snapshot.values.walletVisible === "true";
    for (const node of presentation.querySelectorAll<HTMLElement>("[data-trade-wallet]")) node.hidden = !walletVisible;
    // The presentation has no transaction handlers. Keep its last appearance
    // while preventing activation, without disabled CSS dimming its controls.
    for (const button of presentation.querySelectorAll<HTMLButtonElement>("[data-trade-wallet] button, button[data-trade-max], [data-trade-action]")) {
      // MAX has no disabled styling. Preserve its native SSR state during
      // restoration instead of enabling a control that has no live balance.
      if (!button.hasAttribute("data-trade-max")) button.disabled = false;
      button.setAttribute("aria-disabled", "true");
      button.addEventListener("click", event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    }
    const walletFilter = presentation.querySelector<HTMLElement>("[data-trade-wallet-filter]");
    if (walletFilter) {
      const checked = snapshot.values.walletFilter === "true";
      walletFilter.setAttribute("aria-checked", String(checked));
      walletFilter.setAttribute("data-state", checked ? "checked" : "unchecked");
      walletFilter.querySelector("[data-state]")?.setAttribute("data-state", checked ? "checked" : "unchecked");
    }
    for (const image of presentation.querySelectorAll<HTMLImageElement>("[data-trade-asset-image]")) {
      const side = image.dataset.tradeAssetImage;
      const tokenId = snapshot.values[`${side}TokenId`];
      if (!tokenId) continue;
      if (snapshot.values[`${side}IsBasket`] === "true") {
        const basketIcon = presentation.querySelector("[data-trade-basket-icon-template]")?.firstElementChild;
        if (basketIcon) image.replaceWith(basketIcon.cloneNode(true));
        continue;
      }
      image.removeAttribute("srcset");
      image.src = tokenImagePath(tokenId, document.documentElement.classList.contains("dark"));
      image.alt = snapshot.values[`${side}Symbol`] ?? tokenId.toUpperCase();
    }

    wireFeePreferences(presentation);

    // Native typing works before React loads. Save each edit into the same
    // draft React restores, so hydration cannot replace what the user entered.
    const inputs = snapshot.values.sellIsBasket === "true"
      ? presentation.querySelectorAll<HTMLInputElement>('[data-trade-basket="sell"] [data-trade-basket-input]')
      : presentation.querySelectorAll<HTMLInputElement>('[data-trade-display="sellAmount"]');
    for (const input of inputs) input.addEventListener("input", () => {
      const field = snapshot.values.sellIsBasket === "true" ? "driverAmountStr" : "sellAmount";
      draft[field] = input.value;
      if (field === "driverAmountStr" && input.dataset.tradeBasketAddress) {
        draft.driverToken = input.dataset.tradeBasketAddress as typeof draft.driverToken;
        for (const row of snapshot.basketRows ?? []) {
          if (row.side === "sell") {
            row.driver = row.address === draft.driverToken;
            row.amount = row.driver ? input.value : "";
          } else row.amount = "...";
          row.equivalent = snapshot.values.pendingEquivalent ?? "...";
        }
        for (const other of inputs) {
          if (other !== input) other.value = "";
          if (other === input) other.dataset.tradeSpendInput = "";
          else other.removeAttribute("data-trade-spend-input");
        }
      }
      snapshot.intentKey = intentKeyOf(draft);
      snapshot.values.sellAmount = input.value;
      snapshot.values.buyAmount = "...";
      snapshot.values.quoteComplete = "false";
      snapshot.values.evaluationStatus = /^(?:0*[.,]?0*)?$/.test(input.value.trim()) ? "empty" : "pending";
      if (evaluationPanel) evaluationPanel.dataset.tradeEvaluation = snapshot.values.evaluationStatus;
      for (const output of presentation.querySelectorAll<HTMLElement>('[data-trade-basket-output], [data-trade-display="buyAmount"]')) {
        if (snapshot.values.evaluationStatus === "pending") output.setAttribute("aria-busy", "true");
        else output.removeAttribute("aria-busy");
      }
      snapshot.values.purchaseSpendingValue = /^(?:0*[.,]?0*)?$/.test(input.value.trim()) ? `0 ${snapshot.values.sellSymbol ?? ""}`.trim() : "…";
      snapshot.values.purchaseSpendingEquivalent = /^(?:0*[.,]?0*)?$/.test(input.value.trim())
        ? snapshot.values.spendingZeroEquivalent ?? "…" : "…";
      snapshot.values.purchaseSpendingLimited = "false";
      for (const node of presentation.querySelectorAll<HTMLElement>("[data-trade-spending]")) {
        const value = node.querySelector<HTMLElement>("[data-trade-spending-value]");
        if (value) {
          value.textContent = snapshot.values.purchaseSpendingValue;
          value.dataset.limited = "false";
          value.removeAttribute("tabindex");
          value.removeAttribute("aria-describedby");
        }
        const tooltip = node.querySelector<HTMLElement>("[data-trade-spending-tooltip]");
        if (tooltip) tooltip.hidden = true;
        const equivalent = node.querySelector<HTMLElement>('[data-trade-display="purchaseSpendingEquivalent"]');
        if (equivalent) equivalent.textContent = snapshot.values.purchaseSpendingEquivalent;
      }
      snapshot.values.sellEquivalent = snapshot.values.pendingEquivalent ?? "...";
      snapshot.values.buyEquivalent = snapshot.values.pendingEquivalent ?? "...";
      for (const key of ["feeTotal", "feeProtocolValue", "feeHelpersValue", "feeApplicationValue", "feeNetworkValue", "feeMinimumOutput"]) {
        snapshot.values[key] = "...";
      }
      for (const key of ["feeProtocol", "feeHelpers", "feeApplication"]) {
        snapshot.values[`${key}Label`] = snapshot.values[`${key}PlainLabel`] ?? "";
      }
      for (const node of presentation.querySelectorAll<HTMLElement>("[data-trade-display]")) {
        const key = node.dataset.tradeDisplay;
        if (key && (["buyAmount", "sellEquivalent", "buyEquivalent"].includes(key) || key.startsWith("fee"))) {
          node.textContent = snapshot.values[key];
        }
      }
      try {
        window.sessionStorage.setItem("cg:swap-form-state:v1", JSON.stringify(draft));
        window.sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
      } catch { /* Keep native editing usable when storage is unavailable. */ }
      window.dispatchEvent(new CustomEvent("trade-display-input", { detail: { field, value: input.value, driverToken: draft.driverToken } }));
    });

    cached.replaceChildren(presentation);
    live.hidden = true;
    cached.hidden = false;
    for (const list of cached.querySelectorAll<HTMLElement>("[data-token-picker-list][data-token-picker-scroll]")) {
      list.scrollTop = Number(list.dataset.tokenPickerScroll) || 0;
    }
  } catch { /* Optional storage must never interrupt the live form. */ }
}

/** Hand presentation back once React has restored this tab's draft and values. */
export function finishTradeDisplayBootstrap() {
  let finished = true;
  for (const root of document.querySelectorAll<HTMLElement>("[data-trade-display-root]")) {
    const live = root.querySelector<HTMLElement>("[data-trade-live]");
    const cached = root.querySelector<HTMLElement>("[data-trade-cached]");
    const focused = cached?.contains(document.activeElement) && document.activeElement instanceof HTMLElement
      && (document.activeElement instanceof HTMLInputElement || document.activeElement.matches("[data-trade-fees] > summary"))
      ? document.activeElement : undefined;
    const pickerSide = focused?.closest<HTMLElement>("[data-token-picker-side]")?.dataset.tokenPickerSide;
    const basketRow = focused?.closest<HTMLElement>("[data-trade-basket-row]")?.dataset.tradeBasketRow;
    const input = focused?.matches("[data-token-picker-search]") && pickerSide
      ? live?.querySelector<HTMLInputElement>(`[data-token-picker-side="${pickerSide}"] [data-token-picker-live] [data-token-picker-search]`)
      : focused?.matches("[data-trade-basket-input]") && basketRow
        ? [...live?.querySelectorAll<HTMLElement>('[data-trade-basket-rows="sell"] [data-trade-basket-row]') ?? []]
          .find(row => row.dataset.tradeBasketRow === basketRow)?.querySelector<HTMLInputElement>("[data-trade-basket-input]")
      : focused?.matches("[data-trade-tolerance]")
      ? live?.querySelector<HTMLInputElement>(`[data-trade-tolerance="${focused.dataset.tradeTolerance}"]`)
      : focused?.matches("[data-trade-fees] > summary")
        ? live?.querySelector<HTMLElement>("[data-trade-fees] > summary")
        : live?.querySelector<HTMLInputElement>("[data-trade-spend-input]");
    // A restored control can remain ahead of its live counterpart. Keep native
    // editing until that control can take over without discarding focus or input.
    if (focused && (!input || input.closest<HTMLElement>("[data-token-picker-live]")?.hidden)) {
      finished = false;
      continue;
    }
    if (live) live.hidden = false;
    if (focused && input) {
      input.dataset.tradeHandoffFocus = "";
      input.focus({ preventScroll: true });
      delete input.dataset.tradeHandoffFocus;
      if (input instanceof HTMLInputElement && focused instanceof HTMLInputElement && input.type !== "range") {
        input.setSelectionRange(focused.selectionStart, focused.selectionEnd);
      }
    }
    if (cached) {
      cached.hidden = true;
      cached.replaceChildren();
    }
  }
  return finished;
}

export function subscribeTradeDisplayInput(onInput: (field: "sellAmount" | "driverAmountStr", value: string, driverToken?: `0x${string}`) => void) {
  const handler = (event: Event) => {
    const { field, value, driverToken } = (event as CustomEvent<{ field: "sellAmount" | "driverAmountStr"; value: string; driverToken?: `0x${string}` }>).detail;
    onInput(field, value, driverToken);
  };
  window.addEventListener("trade-display-input", handler);
  return () => window.removeEventListener("trade-display-input", handler);
}

export function subscribeTradeDisplayFees(onChange: (preferences: SwapFeePreferences) => void) {
  const handler = (event: Event) => onChange((event as CustomEvent<SwapFeePreferences>).detail);
  window.addEventListener("trade-display-fees", handler);
  return () => window.removeEventListener("trade-display-fees", handler);
}

export function TradeDisplayBootstrap({ chainId, locale, children }: {
  chainId: number;
  locale: string;
  children: ReactNode;
}) {
  const rootId = `trade-display-${useId()}`;
  const script = `(${bootstrapTradeDisplay.toString()})(${[
    JSON.stringify(rootId),
    JSON.stringify(tradeDisplaySnapshotStorageKey(chainId, locale)),
    JSON.stringify(chainId),
    JSON.stringify(locale),
    `(${parseTradeDisplaySnapshot.toString()})`,
    `(${tradeDisplayIntentKey.toString()})`,
    `(${tradeDisplayScopeKey.toString()})`,
    `(${readStoredTradeDisplayScope.toString()})`,
    `(${resolveTokenImagePath.toString()})`,
    `(${readSwapFeePreferences.toString()})`,
  ].join(",")});`;

  return (
    <div id={rootId} data-trade-display-root className="contents">
      <div data-trade-live data-testid="trade-live-view" className="flex flex-1 flex-col" suppressHydrationWarning>
        {children}
      </div>
      <div
        data-trade-cached
        data-testid="trade-cached-view"
        hidden
        className="flex flex-1 flex-col"
        suppressHydrationWarning
        // React leaves this empty DOM island to the synchronous bootstrap.
        dangerouslySetInnerHTML={{ __html: "" }}
      />
      <script
        type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: script }}
      />
    </div>
  );
}
