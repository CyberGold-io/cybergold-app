import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "@playwright/test";
import { coreIntentRequest, ScenarioUnavailableError, splitAmount, tradeScenarios } from "../../tests/trading/scenarios.ts";
import { failureResult, matchesBasketIntent, resultFor, uint, validateBasket, validateTrade } from "../../tests/trading/regression.ts";
import type { BasketPreview } from "./basketPreview.ts";
import { QuotePreviewError } from "./quoteErrors.ts";
import { diagnosticReferences } from "./diagnosticReferences.ts";
import { fetchQuoteStream } from "./quoteStream.ts";
import { observeBrowserQuotes } from "../../tests/trading/browserQuotes.ts";
import { protocolConfigurationFixture } from "../../tests/fixtures/protocol-configuration.ts";
import { installQuoteObservation } from "../../tests/trading/quoteObservation.ts";

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

test("a submitted confirmation timeout stays unavailable with its transaction hash and quote references", () => {
  const transactionHash = `0x${"a".repeat(64)}`;
  const requestId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e";
  const result = failureResult({ ...resultFor(tradeScenarios[0], "execution"), transactionHash, refs: { requestId } },
    new ScenarioUnavailableError("submitted-unconfirmed"));
  assert.equal(result.status, "unavailable"); assert.equal(result.code, "submitted-unconfirmed");
  assert.equal(result.transactionHash, transactionHash); assert.deepEqual(result.refs, { requestId });
});

test("browser launch failure is unavailable without exposing the launch error", async (t) => {
  t.mock.method(chromium, "launch", async () => { throw new Error("private-browser-provider-token"); });
  let failure: unknown;
  try { await observeBrowserQuotes("http://app.test", protocolConfigurationFixture, {} as never); }
  catch (error) { failure = error; }
  const result = failureResult(resultFor(tradeScenarios[0], "browser"), failure);
  assert.equal(result.status, "unavailable"); assert.equal(result.code, "browser-unavailable");
  assert.doesNotMatch(JSON.stringify(result), /private-browser-provider-token/);
});

test("browser page setup failure is unavailable and closes the owned browser", async (t) => {
  let closed = false;
  t.mock.method(chromium, "launch", async () => ({ newPage: async () => { throw new Error("private-browser-provider-token"); },
    close: async () => { closed = true; } } as unknown as Browser));
  await assert.rejects(observeBrowserQuotes("http://app.test", protocolConfigurationFixture, {} as never),
    error => error instanceof ScenarioUnavailableError && error.code === "browser-unavailable");
  assert.equal(closed, true);
});

test("browser observer captures the emitted terminal before App cancellation without making another request", { timeout: 2_000 }, async () => {
  const requestId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e";
  const terminal = { type: "complete", value: { strategy: "core", quotedOutput: "10" }, requestId };
  let calls = 0, cancelled = 0;
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: "progress", strategy: "core" }) + "\n"));
      setTimeout(() => controller.enqueue(encoder.encode(JSON.stringify(terminal) + "\n")), 10);
    },
    cancel() { cancelled += 1; },
  }), { headers: { "X-CyberGold-Request-Id": requestId } });
  const scope = { location: { href: "https://app.test/en" }, fetch: async (_input: unknown, init?: RequestInit) => {
    calls += 1; assert.equal(init?.body, JSON.stringify({ mode: "exact-out", amount: "10" })); return response;
  } } as unknown as NonNullable<Parameters<typeof installQuoteObservation>[0]>;
  installQuoteObservation(scope);
  const value = await fetchQuoteStream("/api/quotes/trade/stream", { mode: "exact-out", amount: "10" },
    new AbortController().signal, () => {}, scope.fetch);
  assert.deepEqual(value, terminal.value);
  assert.equal(calls, 1); assert.equal(cancelled, 1);
  assert.deepEqual(scope.__cybergoldTradeObservations?.[0]?.terminal, terminal);
  assert.equal(scope.__cybergoldTradeObservations?.[0]?.requestId, requestId);
  assert.deepEqual(scope.__cybergoldTradeObservations?.[0]?.request, { mode: "exact-out", amount: "10" });
});

test("a quote runner startup failure retains all36 stable unavailable scenario rows", () => {
  const output = mkdtempSync(join(tmpdir(), "cybergold-trade-regression-"));
  const env = { ...process.env }; delete env.APP_BASE_URL;
  try {
    const child = spawnSync(process.execPath, ["scripts/run-trade-regression.mjs", "--target", "mainnet", "--mode", "quotes", "--output-dir", output],
      { cwd: new URL("../../", import.meta.url), env, stdio: "ignore" });
    assert.equal(child.status, 1);
    const report = JSON.parse(readFileSync(join(output, "report.json"), "utf8"));
    assert.equal(report.runnerCode, "app-origin-unavailable");
    assert.equal(report.scenarios.length, 36);
    assert.equal(new Set(report.scenarios.map((row: { id: string }) => row.id)).size, 36);
    assert.equal(report.scenarios.filter((row: { layer: string }) => row.layer === "api").length, 20);
    assert.equal(report.scenarios.filter((row: { layer: string }) => row.layer === "browser").length, 16);
    assert.ok(report.scenarios.every((row: { status: string; code: string }) => row.status === "unavailable" && row.code === "app-origin-unavailable"));
  } finally { rmSync(output, { recursive: true, force: true }); }
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
