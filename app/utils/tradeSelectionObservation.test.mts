import test from "node:test";
import assert from "node:assert/strict";
import { coreTrade, marketTrade } from "../../tests/fixtures/trade-quote.mts";
import { observeTradeSelection, TRADE_SELECTION_EVENT, type TradeSelectionObservation } from "./tradeSelectionObservation.ts";

test("selection observation preserves each provider's actual captured plan without sharing mutable objects", () => {
  for (const quote of [coreTrade(), marketTrade()]) {
    const original = structuredClone(quote);
    let observed: TradeSelectionObservation | undefined;
    observeTradeSelection({ attemptId: "swap-attempt", quote }, value => {
      observed = value;
      value.quote!.quotedOutput = "1";
      value.quote!.context.blockNumber = "999";
    });
    assert.equal(observed?.attemptId, "swap-attempt");
    assert.equal(observed?.quote?.strategy, quote.strategy);
    assert.deepEqual(quote, original);
  }
});

test("basket observation binds the entire raw input vector at the click", () => {
  const basketRequest = { mode: "issue-exact-in" as const, maximumAmountsIn: ["100", "250"] };
  let observed: TradeSelectionObservation | undefined;
  observeTradeSelection({ attemptId: "basket-attempt", basketRequest }, value => { observed = value; });
  basketRequest.maximumAmountsIn[0] = "999";
  assert.deepEqual(observed?.basketRequest, { mode: "issue-exact-in", maximumAmountsIn: ["100", "250"] });
});

test("an unavailable observer cannot change submission behavior", () => {
  assert.doesNotThrow(() => observeTradeSelection({ attemptId: "attempt", quote: coreTrade() }, () => {
    throw new Error("Observer unavailable");
  }));
  assert.equal(TRADE_SELECTION_EVENT, "cybergold:trade-selection");
});
