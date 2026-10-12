import type { Page, Route } from "@playwright/test";
import type { QuoteIntent, QuoteIntentEvent, QuoteIntentRequest } from "../../../app/utils/quoteIntent";
import type { TradeQuote, TradeQuoteEvent, TradeQuoteRequest } from "../../../app/utils/tradeQuote";
import { protocolAddresses, tokenAddresses } from "../../fixtures/protocol-configuration";

/** Synthetic Backend-owned Core request construction for retained browser scenarios. */
export function coreIntentRequest(value: TradeQuoteRequest | QuoteIntentRequest,
  assets: readonly string[] = [tokenAddresses.PAXG]): QuoteIntentRequest {
  if ("orderedAssets" in value) return value;
  const buy = value.side === "buy", exactIn = value.mode === "exact-in";
  const token = value.native ? `0x${"0".repeat(40)}` : value.counterToken;
  const amount = BigInt(value.amount), targets: QuoteIntentRequest["targets"] = [];
  if ((buy && exactIn) || (!buy && !exactIn)) {
    const members = assets.length, unit = members ? amount / BigInt(members) : 0n;
    for (let index = 0; index < members; index++) {
      const asset = assets[index], allocation = index === members - 1 ? amount - unit * BigInt(index) : unit;
      if (buy && asset.toLowerCase() === value.counterToken.toLowerCase()) continue;
      if (allocation > 0n) targets.push({ inputAsset: buy ? value.counterToken : asset,
        outputAsset: buy ? asset : value.counterToken, amount: String(allocation) });
    }
  }
  return { mode: `${buy ? "issue" : "redeem"}-${value.mode}`, token, quoteToken: value.counterToken,
    native: value.native, amount: value.amount, slippageBps: value.slippageBps ?? 100,
    adapter: protocolAddresses.adapter, deadline: value.deadline, orderedAssets: [...assets], targets };
}

export function tradeFixture(value: QuoteIntent, request: QuoteIntentRequest): Extract<TradeQuote, { strategy: "core" }> {
  const side = request.mode.startsWith("issue") ? "buy" as const : "sell" as const;
  const mode = request.mode.endsWith("exact-in") ? "exact-in" as const : "exact-out" as const;
  const counter = request.native ? `0x${"0".repeat(40)}` : request.token;
  const quotedInput = side === "buy" ? value.expectedInputAmount ?? value.maximumInputAmount : value.executionAmount;
  const quotedOutput = side === "buy" ? value.executionAmount
    : value.expectedOutputAmount ?? (mode === "exact-in" ? value.displayAmount : "minimumAmountOut" in value.preview ? value.preview.minimumAmountOut : "0");
  return { strategy: "core", side, mode, tokenIn: side === "buy" ? counter : protocolAddresses.core,
    tokenOut: side === "buy" ? protocolAddresses.core : counter, quotedInput, quotedOutput,
    inputMaximum: side === "buy" ? value.maximumInputAmount : value.executionAmount,
    outputMinimum: side === "buy" ? value.executionAmount : "minimumAmountOut" in value.preview ? value.preview.minimumAmountOut : "0",
    context: value.context, providerRequest: request, providerQuote: value,
    evaluation: { core: "complete", market: "unsupported" }, metrics: { totalMs: 0, targetReads: 0 } };
}

export function tradeIntentEvent(frame: QuoteIntentEvent, request: QuoteIntentRequest): TradeQuoteEvent {
  if (frame.type === "complete" || frame.type === "qualified") return { type: frame.type, value: tradeFixture(frame.value, request) };
  if (frame.type === "model") return { type: "model", value: { namespace: "trade", intent: {
    side: request.mode.startsWith("issue") ? "buy" : "sell", mode: request.mode.endsWith("exact-in") ? "exact-in" : "exact-out",
    counterToken: request.quoteToken, native: request.native, amount: request.amount, slippageBps: request.slippageBps },
    models: [{ strategy: "core", value: frame.value }] } };
  if (frame.type === "progress") return { type: "progress", strategy: "core", value: frame };
  if (frame.type === "invalidated") return { type: "invalidated", strategy: "core" };
  if (frame.type === "estimate") return { type: "estimate", strategy: "core", amount: frame.amount };
  return frame;
}

export function tradeIntentBody(body: string, request: QuoteIntentRequest): string {
  return body.split("\n").filter(Boolean).map(line => {
    const frame = JSON.parse(line);
    // Fixtures may already use the current tagged transport.
    return JSON.stringify((frame.value?.strategy || frame.value?.namespace === "trade" || frame.strategy)
      ? frame : tradeIntentEvent(frame, request));
  }).join("\n") + "\n";
}

/** Adapt legacy Core-only fixture handlers while the product uses the unified API. */
export function coreIntentRoute(route: Route, assets?: readonly string[]): Route {
  const incoming = route.request();
  if (!new URL(incoming.url()).pathname.endsWith("/quotes/trade/stream")) return route;
  const request = coreIntentRequest(incoming.postDataJSON(), assets);
  const requestView = new Proxy(incoming, { get(target, key) {
    if (key === "postDataJSON") return () => request;
    if (key === "postData") return () => JSON.stringify(request);
    if (key === "url") return () => target.url().replace("/quotes/trade/stream", "/quotes/intent/stream");
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return new Proxy(route, { get(target, key) {
    if (key === "request") return () => requestView;
    if (key === "fulfill") return async (options: Parameters<Route["fulfill"]>[0]) => {
      const body = typeof options?.body === "string" ? tradeIntentBody(options.body, request) : options?.body;
      await target.fulfill({ ...options, body });
    };
    if (key === "continue") return (options: Parameters<Route["continue"]>[0]) =>
      target.continue({ ...options, postData: JSON.stringify(request) });
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export async function routeCoreIntent(page: Page, handler: (route: Route) => Promise<void>, assets?: readonly string[]) {
  await page.route("**/api/quotes/trade/stream", route => handler(coreIntentRoute(route, assets)));
}
