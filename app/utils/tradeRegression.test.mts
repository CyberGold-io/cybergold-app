import assert from "node:assert/strict";
import test from "node:test";
import { coreIntentRequest, splitAmount, tradeScenarios } from "../../tests/trading/scenarios.ts";
import { failureResult, matchesBasketIntent, resultFor, uint, validateBasket, validateTrade } from "../../tests/trading/regression.ts";
import type { BasketPreview } from "./basketPreview.ts";
import { QuotePreviewError } from "./quoteErrors.ts";
import { diagnosticReferences } from "./diagnosticReferences.ts";
import { fetchQuoteStream } from "./quoteStream.ts";

test("inventory includes every Core asset/direction/mode and four independent market modes", () => {
  assert.equal(tradeScenarios.length, 20);
  assert.equal(new Set(tradeScenarios.map(scenario => scenario.id)).size, 20);
  for (const asset of ["PAXG", "USDC", "ETH", "BASKET"]) for (const side of ["buy", "sell"]) for (const mode of ["exact-in", "exact-out"])
    assert.equal(tradeScenarios.filter(scenario => scenario.requestedStrategy === "core" && scenario.asset === asset && scenario.side === side && scenario.inputMode === mode).length, 1);
  assert.equal(tradeScenarios.filter(scenario => scenario.requestedStrategy === "market").length, 4);
});

test("an initialized case is explicitly unexercised until an observation or failure replaces it", () => {
  const result = resultFor(tradeScenarios[0], "execution");
  assert.equal(result.status, "unavailable"); assert.equal(result.code, "not-exercised");
  assert.equal(failureResult({ ...result, code: "execution-not-completed" }, new QuotePreviewError("rpc-timeout", "rpc-timeout")).code, "rpc-timeout");
});

test("Core provider seed preserves direct leg and full integer remainder beyond Number precision", () => {
  const a = `0x${"a".repeat(40)}`, b = `0x${"b".repeat(40)}`, amount = 2n ** 100n + 17n;
  const [first, second] = splitAmount(amount, [300_000n, 700_000n]);
  assert.equal(first + second, amount); assert.equal(first, amount * 3n / 10n);
  const request = { side: "sell", mode: "exact-out", counterToken: a, native: false, amount: String(amount), recipient: a, deadline: "1900000000" } as const;
  const intent = coreIntentRequest(request, b, [a, b], [300_000n, 700_000n]);
  assert.equal(intent.targets.reduce((sum, target) => sum + BigInt(target.amount), 0n), amount);
  assert.deepEqual(intent.targets[0], { inputAsset: a, outputAsset: a, amount: String(first) });
  const issue = coreIntentRequest({ ...request, side: "buy", mode: "exact-in" }, b, [a, b], [300_000n, 700_000n]);
  assert.deepEqual(issue.targets, [{ inputAsset: a, outputAsset: b, amount: String(second) }]);
});

test("quote readiness enforces integer input ceilings and exact-output minima", () => {
  const quote = { mode: "exact-in", side: "buy", quotedInput: "100", quotedOutput: "10", inputMaximum: "100", outputMinimum: "9" } as const;
  validateTrade(quote, { mode: "exact-in", side: "buy", amount: "100" });
  assert.throws(() => validateTrade({ ...quote, inputMaximum: "101" }, { mode: "exact-in", side: "buy", amount: "100" }), /input-budget-exceeded/);
  assert.throws(() => validateTrade({ ...quote, mode: "exact-out" }, { mode: "exact-out", side: "buy", amount: "10" }), /output-target-not-protected/);
  assert.throws(() => uint("1.2", "amount"), /invalid-amount/);
  assert.throws(() => uint(String(2n ** 256n), "amount"), /invalid-amount/);
});

test("HTTP 200 stream error remains unavailable and retains safe Backend linkage", async () => {
  const requestId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e", correlationId = "eb3e6932-a2af-4303-a09e-35831f864a1d";
  let error: unknown;
  try { await fetchQuoteStream("/api/quotes/trade/stream", {}, new AbortController().signal, () => {},
    (async () => new Response(JSON.stringify({ type: "error", code: "quote-no-route", requestId, correlationId, error: "private-provider-url" }) + "\n",
      { headers: { "X-CyberGold-Request-Id": requestId } })) as typeof fetch); }
  catch (cause) { error = cause; }
  assert.equal((error as QuotePreviewError).code, "quote-no-route");
  assert.equal(diagnosticReferences(error).requestId, requestId);
  const result = failureResult(resultFor(tradeScenarios[0], "api"), error);
  assert.equal(result.status, "unavailable"); assert.equal(result.refs?.correlationId, correlationId);
  assert.doesNotMatch(JSON.stringify(result), /private-provider-url/);
});

test("regression reports never copy arbitrary provider error messages, even code-looking secrets", () => {
  for (const message of ["gho-private-token", "a-secret-bearer", "https://private@rpc.example", "0x1234signature"])
    assert.equal(failureResult(resultFor(tradeScenarios[0], "api"), new Error(message)).code, "unexpected-error");
});

test("wallet and receipt failures preserve quote linkage while adding failure references", () => {
  const requestId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e", correlationId = "eb3e6932-a2af-4303-a09e-35831f864a1d";
  const result = { ...resultFor(tradeScenarios[0], "execution"), refs: { requestId } };
  assert.deepEqual(failureResult(result, new Error("wallet failure")).refs, { requestId });
  assert.deepEqual(failureResult(result, new QuotePreviewError("rpc-timeout", "rpc-timeout", { correlationId })).refs,
    { requestId, correlationId });
});

test("browser basket matching rejects warm vectors and validates current asset bounds", () => {
  const assets = [`0x${"a".repeat(40)}`, `0x${"b".repeat(40)}`];
  const scenario = tradeScenarios.find(row => row.id === "core-issue-basket-exact-in")!;
  assert.equal(matchesBasketIntent({ mode: "issue-exact-in", maximumAmountsIn: ["0", "0"] }, scenario, "100", assets), false);
  assert.equal(matchesBasketIntent({ mode: "issue-exact-in", maximumAmountsIn: ["99", "100"] }, scenario, "100", assets), false);
  const request = { mode: "issue-exact-in", maximumAmountsIn: ["100", "200"] } as const;
  assert.equal(matchesBasketIntent(request, scenario, "100", assets), true);
  const preview = { mode: "issue-exact-in", result: { amountsInExact: ["100", "200"], orderedCoreAssets: assets,
    netCygldOut: "10", fees: { protocolFeeCygld: "0", helperFeeCygld: "0" } } } as BasketPreview;
  assert.equal(validateBasket(preview, { ...request, maximumAmountsIn: [...request.maximumAmountsIn] }, assets).outputMinimum, "10");
  assert.throws(() => validateBasket({ ...preview, result: { ...preview.result, netCygldOut: "0" } } as BasketPreview,
    { ...request, maximumAmountsIn: [...request.maximumAmountsIn] }, assets), /zero-executable-amount/);
  assert.throws(() => validateBasket(preview, { ...request, maximumAmountsIn: ["99", "200"] }, assets), /basket-budget-exceeded/);
  assert.throws(() => validateBasket(preview, { ...request, maximumAmountsIn: [...request.maximumAmountsIn] }, [...assets].reverse()), /basket-order-mismatch/);
  const redeem = tradeScenarios.find(row => row.id === "core-redeem-basket-exact-out")!;
  const minimumOutputs = assets.map(token => ({ kind: 0, token, id: "0", minimumAmount: "100" }));
  assert.equal(matchesBasketIntent({ mode: "redeem-exact-out", minimumOutputs }, redeem, "100", assets), true);
  assert.equal(matchesBasketIntent({ mode: "redeem-exact-out", minimumOutputs }, redeem, "99", assets), false);
});
