import assert from "node:assert/strict";
import test from "node:test";
import { clearQuoteModels, getTradeBudgetRange, receiveTradeBudgetRange, tradeDisplayModelScope } from "./quoteModelStore.ts";
import type { TradeModelRequest, TradeQuoteModelPacket } from "./tradeQuote.ts";

const request: TradeModelRequest = { side: "buy", mode: "exact-in", native: false,
  counterToken: "0x45804880De22913dAFE09f4980848ECE6EcbAf78", amount: "1000000000000000000", slippageBps: 100 };
const scope = tradeDisplayModelScope("configured-Core-Helpers", "fork-one");
const packet = (): TradeQuoteModelPacket => ({ namespace: "trade", intent: { ...request }, models: [], budgetRange: {
  minimumBudget: "31000000000000000", maximumBudget: request.amount,
  quotedInput: "30334978745396727", quotedOutput: "935674143736095695",
} });

test("a Backend interval immediately preserves capped spending and output at a smaller compatible budget", () => {
  clearQuoteModels();
  const value = packet();
  receiveTradeBudgetRange(value, scope);
  const result = getTradeBudgetRange({ ...request, amount: "500000000000000000" }, scope);
  assert.deepEqual(result, value.budgetRange);
  assert.equal(result?.quotedInput, "30334978745396727");
  assert.equal(result?.quotedOutput, "935674143736095695");
  value.budgetRange!.quotedOutput = "1";
  assert.equal(result?.quotedOutput, "935674143736095695", "the published display tuple is detached from its response");
});

test("the Backend funding interval is inclusive and does not extrapolate past either bound", () => {
  clearQuoteModels(); receiveTradeBudgetRange(packet(), scope);
  const read = (amount: string) => getTradeBudgetRange({ ...request, amount }, scope);
  assert.ok(read("31000000000000000"));
  assert.ok(read(request.amount));
  assert.equal(read("30999999999999999"), undefined, "expected spend alone cannot establish sufficient funding");
  assert.equal(read("1000000000000000001"), undefined);
});

test("a Backend capacity interval without an upper bound immediately covers larger budgets", () => {
  clearQuoteModels();
  const value = packet();
  delete value.budgetRange!.maximumBudget;
  receiveTradeBudgetRange(value, scope);
  for (const amount of ["500000000000000000", request.amount, "2000000000000000000"]) {
    const result = getTradeBudgetRange({ ...request, amount }, scope);
    assert.equal(result?.quotedInput, "30334978745396727");
    assert.equal(result?.quotedOutput, "935674143736095695");
    assert.equal(result?.maximumBudget, undefined);
  }
  assert.equal(getTradeBudgetRange({ ...request, amount: "30999999999999999" }, scope), undefined);
});

test("token, direction, native funding, tolerance, configuration and fork isolate indicative tuples", () => {
  clearQuoteModels(); receiveTradeBudgetRange(packet(), scope);
  for (const change of [{ side: "sell" as const }, { mode: "exact-out" as const }, { native: true },
    { slippageBps: 200 }, { counterToken: "0x68749665FF8D2d112Fa859AA293F07A622782F38" }]) {
    assert.equal(getTradeBudgetRange({ ...request, ...change }, scope), undefined);
  }
  assert.equal(getTradeBudgetRange(request, tradeDisplayModelScope("another-configuration", "fork-one")), undefined);
  assert.equal(getTradeBudgetRange(request, tradeDisplayModelScope("configured-Core-Helpers", "fork-two")), undefined);
  assert.ok(getTradeBudgetRange({ ...request, counterToken: request.counterToken.toLowerCase() }, scope));
});

test("fresh Backend snapshots replace or retire a prior hint without creating an executable quote", () => {
  clearQuoteModels(); receiveTradeBudgetRange(packet(), scope);
  const changed = packet();
  changed.budgetRange = { ...changed.budgetRange!, quotedInput: "20000000000000000", quotedOutput: "600000000000000000" };
  receiveTradeBudgetRange(changed, scope);
  assert.equal(getTradeBudgetRange(request, scope)?.quotedInput, "20000000000000000");
  assert.equal(getTradeBudgetRange(request, scope)?.quotedOutput, "600000000000000000");
  receiveTradeBudgetRange({ namespace: "trade", intent: request, models: [] }, scope);
  assert.equal(getTradeBudgetRange(request, scope), undefined);
  receiveTradeBudgetRange(packet(), scope); clearQuoteModels();
  assert.equal(getTradeBudgetRange(request, scope), undefined);
});

test("a full-spend sale has no smaller-budget plateau without a Backend-supplied interval", () => {
  clearQuoteModels();
  const sell = { ...request, side: "sell" as const, amount: "5000000000000000000" };
  receiveTradeBudgetRange({ namespace: "trade", intent: sell, models: [],
    estimate: { strategy: "market", amount: "161000000000000000" } }, scope);
  assert.equal(getTradeBudgetRange({ ...sell, amount: "2500000000000000000" }, scope), undefined);
});
