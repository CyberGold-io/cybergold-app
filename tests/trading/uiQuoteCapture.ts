import type { Locator, Page } from "@playwright/test";
import { zeroAddress } from "viem";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import { configuredToken, type Scenario } from "./scenarios.ts";
import { requireInvariant } from "./regression.ts";
import { displayedAmount, selectedTolerance, type UiAmount, type UiQuoteSnapshot } from "./uiEconomics.ts";

type Descriptor = Pick<UiAmount, "type" | "token" | "decimals"> & { symbol: string };
type RawCapture = { input: string[]; output: string[]; tolerance: string; bound: string; mode: string };
type CaptureWindow = Window & { __cybergoldUiEconomics?: RawCapture; __cybergoldReadUiEconomics?: () => RawCapture };

export function quoteAssets(scenario: Scenario, config: ProtocolConfiguration, basket: readonly string[]) {
  const describe = (symbol: string): Descriptor[] => {
    const tokens = symbol === "BASKET" ? basket.map(address => config.tokens.find(token => token.type === "erc20"
      && token.address.toLowerCase() === address.toLowerCase())!) : [configuredToken(config, symbol)];
    return tokens.map(token => ({ type: token.type === "native" ? "native" : "erc20",
      token: token.type === "native" ? zeroAddress : token.address, decimals: token.decimals, symbol: token.symbol }));
  };
  return { input: describe(scenario.side === "buy" ? scenario.asset : "CYGLD"),
    output: describe(scenario.side === "buy" ? "CYGLD" : scenario.asset),
    inputBasket: scenario.side === "buy" && scenario.asset === "BASKET",
    outputBasket: scenario.side === "sell" && scenario.asset === "BASKET" };
}

export function parseUiQuoteCapture(raw: RawCapture, assets: ReturnType<typeof quoteAssets>, inputMode: UiQuoteSnapshot["inputMode"]): UiQuoteSnapshot {
  requireInvariant(raw.mode === inputMode, "ui-captured-mode-mismatch");
  const convert = (values: string[], descriptors: Descriptor[], quoted: boolean) => {
    requireInvariant(values.length === descriptors.length, "ui-captured-asset-vector-mismatch");
    return values.map((value, index) => {
      const { type, token, decimals } = descriptors[index];
      const descriptor = { type, token, decimals };
      const amount = displayedAmount(value, descriptor.decimals, quoted);
      requireInvariant(BigInt(amount.amount) > 0n, "ui-captured-amount-not-positive");
      return { ...descriptor, ...amount };
    });
  };
  const side = inputMode === "exact-in" ? "output" : "input";
  const descriptors = assets[side];
  const terms = raw.bound.split(/\s+\+\s+/).map(value => value.trim());
  const bound = descriptors.map(descriptor => {
    const term = terms.find(value => value.endsWith(` ${descriptor.symbol}`));
    requireInvariant(term, "ui-execution-bound-not-visible");
    return term.slice(0, -(descriptor.symbol.length + 1));
  });
  requireInvariant(terms.length === descriptors.length, "ui-execution-bound-vector-mismatch");
  return { inputMode, toleranceBps: selectedTolerance(raw.tolerance),
    input: convert(raw.input, assets.input, inputMode === "exact-out"),
    output: convert(raw.output, assets.output, inputMode === "exact-in"),
    executionBound: { side, amounts: convert(bound, descriptors, false) } };
}

/** Read both amount sides in one browser event, immediately before React freezes the selected quote. */
export async function armUiQuoteCapture(button: Locator, assets: ReturnType<typeof quoteAssets>) {
  await button.evaluate((element, descriptors) => {
    const read = (): RawCapture => {
      const amounts = (side: "sell" | "buy", basket: boolean, tokens: { symbol: string }[]) => tokens.map(token => {
        if (!basket) return (document.getElementById(`${side}-amount`) as HTMLInputElement | null)?.value ?? "";
        const box = document.getElementById(`${side}-basket-composition`);
        const control = [...box?.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button[aria-label]") ?? []]
          .find(node => [`${side === "sell" ? "Sell" : "Buy"} amount (${token.symbol})`,
            `Edit ${side} amount (${token.symbol})`].includes(node.getAttribute("aria-label") ?? ""));
        return control instanceof HTMLInputElement ? control.value : control?.textContent?.trim() ?? "";
      });
      const edited = document.getElementById("sell-amount") as HTMLInputElement | null;
      const sellBasketEdited = [...document.querySelectorAll("#sell-basket-composition input")].length > 0;
      const mode = sellBasketEdited || (edited && !edited.readOnly) ? "exact-in" : "exact-out";
      return { input: amounts("sell", descriptors.inputBasket, descriptors.input),
        output: amounts("buy", descriptors.outputBasket, descriptors.output),
        // The range reflects committed state; the text input may hold an
        // invalid or uncommitted draft while a previously accepted quote is usable.
        tolerance: (document.querySelector('[data-testid="execution-tolerance-control"] input[type="range"]') as HTMLInputElement | null)?.value ?? "",
        bound: document.querySelector(`[data-testid="swap-${mode === "exact-in" ? "minimum-output" : "maximum-input"}"] > span:last-child`)?.textContent?.trim() ?? "",
        mode };
    };
    (window as CaptureWindow).__cybergoldReadUiEconomics = read;
    delete (window as CaptureWindow).__cybergoldUiEconomics;
    element.addEventListener("click", () => { (window as CaptureWindow).__cybergoldUiEconomics = read(); }, { capture: true, once: true });
  }, assets);
}

/** Read-only qualification of the same DOM reader, without signing or clicking. */
export async function currentUiQuote(page: Page, assets: ReturnType<typeof quoteAssets>, inputMode: UiQuoteSnapshot["inputMode"]) {
  const raw = await page.evaluate(() => (window as CaptureWindow).__cybergoldReadUiEconomics?.());
  requireInvariant(raw, "ui-quote-reader-not-installed");
  return parseUiQuoteCapture(raw, assets, inputMode);
}

export async function capturedUiQuote(page: Page, assets: ReturnType<typeof quoteAssets>, inputMode: UiQuoteSnapshot["inputMode"]) {
  const raw = await page.evaluate(() => (window as CaptureWindow).__cybergoldUiEconomics);
  requireInvariant(raw, "ui-click-quote-not-observed");
  return parseUiQuoteCapture(raw, assets, inputMode);
}
