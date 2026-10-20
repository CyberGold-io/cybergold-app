import { modelFamily, type QuoteModelPacket } from "./quoteModels.ts";
import type { MarketQuoteModelPacket } from "./marketQuote.ts";
import type { TradeModelRequest, TradeQuoteModelPacket } from "./tradeQuote.ts";

const packets = new Map<string, QuoteModelPacket>();
const marketPackets = new Map<string, MarketQuoteModelPacket>();
type TradeBudgetRange = NonNullable<TradeQuoteModelPacket["budgetRange"]>;
const tradeBudgetRanges = new Map<string, TradeBudgetRange>();
export const tradeDisplayModelScope = (configuration: string, generation?: string | null) =>
  JSON.stringify([configuration, generation]);
const tradeFamily = (input: TradeModelRequest, scope: string) => JSON.stringify([
  scope, input.side, input.mode, input.counterToken.toLowerCase(), input.native ?? false, input.slippageBps ?? 100,
]);

/** Apply only the constant budget interval supplied by the Backend estimator. */
export function getTradeBudgetRange(input: TradeModelRequest, scope: string) {
  const range = tradeBudgetRanges.get(tradeFamily(input, scope));
  if (!range) return undefined;
  try {
    const amount = BigInt(input.amount);
    return amount >= BigInt(range.minimumBudget) &&
      (range.maximumBudget === undefined || amount <= BigInt(range.maximumBudget)) ? range : undefined;
  } catch { return undefined; }
}

/** A model packet replaces the Backend's whole family snapshot, including retirement. */
export function receiveTradeBudgetRange(packet: TradeQuoteModelPacket, scope: string) {
  const key = tradeFamily(packet.intent, scope);
  if (JSON.stringify(tradeBudgetRanges.get(key)) === JSON.stringify(packet.budgetRange)) return;
  tradeBudgetRanges.delete(key);
  if (packet.budgetRange) {
    const { minimumBudget, maximumBudget, quotedInput, quotedOutput } = packet.budgetRange;
    tradeBudgetRanges.set(key, { minimumBudget, maximumBudget, quotedInput, quotedOutput });
  }
  while (tradeBudgetRanges.size > 256) tradeBudgetRanges.delete(tradeBudgetRanges.keys().next().value!);
  listeners.forEach(listener => listener());
}
export type ProtocolModel = NonNullable<QuoteModelPacket["protocol"]>;
const protocols = new Map<string, ProtocolModel>();
const scopedKey = (scope: string, family: string) => JSON.stringify([scope, family]);
const listeners = new Set<() => void>();
export const subscribeQuoteModels = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const getQuoteModel = (key: string, scope = "") => packets.get(scopedKey(scope, key));
export const getMarketQuoteModel = (key: string, scope = "") => marketPackets.get(scopedKey(scope, key));
export const getProtocolModel = (scope = "") => protocols.get(scope);
export function receiveProtocolModel(model?: ProtocolModel | null, scope = "") {
  const protocol = protocols.get(scope);
  if (model === undefined || JSON.stringify(protocol) === JSON.stringify(model ?? undefined)) return;
  if (model) protocols.set(scope, model); else protocols.delete(scope);
  listeners.forEach(listener => listener());
}
export function receiveQuoteModel(packet: QuoteModelPacket, requestedFamily = modelFamily(packet.intent), scope = "") {
  const protocol = protocols.get(scope);
  // The owning request may omit an adapter resolved by the Backend. Preserve
  // its lookup family while retaining the concrete producer intent in the packet.
  const key = scopedKey(scope, requestedFamily);
  const changed = JSON.stringify(protocol) !== JSON.stringify(packet.protocol ?? undefined);
  if (!changed && JSON.stringify(packets.get(key)) === JSON.stringify(packet)) return;
  if (packet.protocol) protocols.set(scope, packet.protocol); else protocols.delete(scope);
  // A revision is local to its producer. Restarts/other workers may return a
  // lower counter; normal request association, not counter ordering, applies.
  packets.delete(key);
  packets.set(key, packet);
  while (packets.size > 256) packets.delete(packets.keys().next().value!);
  listeners.forEach(listener => listener());
}
/** Market packets cannot replace the Core protocol snapshot or model bank. */
export function receiveMarketQuoteModel(packet: MarketQuoteModelPacket, scope = "") {
  const key = scopedKey(scope, packet.family);
  if (JSON.stringify(marketPackets.get(key)) === JSON.stringify(packet)) return;
  marketPackets.delete(key);
  marketPackets.set(key, packet);
  while (marketPackets.size > 256) marketPackets.delete(marketPackets.keys().next().value!);
  listeners.forEach(listener => listener());
}
export function clearQuoteModels() {
  packets.clear();
  marketPackets.clear();
  tradeBudgetRanges.clear();
  protocols.clear();
  listeners.forEach(listener => listener());
}
