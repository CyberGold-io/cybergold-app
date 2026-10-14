import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect as playwrightExpect, type Browser } from "@playwright/test";
import { coreIntentRequest, ScenarioUnavailableError, splitAmount, tradeScenarios } from "../../tests/trading/scenarios.ts";
import { failureResult, matchesBasketIntent, resultFor, tokenRequest, uint, validateBasket, validateTrade } from "../../tests/trading/regression.ts";
import type { BasketPreview } from "./basketPreview.ts";
import { QuotePreviewError, quoteResponseError } from "./quoteErrors.ts";
import { diagnosticReferences, quoteDiagnostics, retainQuoteDiagnostics, safeQuoteDiagnostics } from "./diagnosticReferences.ts";
import { createQuoteDiagnostics, type ClientDiagnostic } from "./clientDiagnostics.ts";
import { fetchQuoteStream } from "./quoteStream.ts";
import { observeBrowserQuotes } from "../../tests/trading/browserQuotes.ts";
import { protocolConfigurationFixture } from "../../tests/fixtures/protocol-configuration.ts";
import { installQuoteObservation } from "../../tests/trading/quoteObservation.ts";
import { createUiQuoteDiagnostics, uiCompletionAssertion, uiObservationFailure, uiPreparationAssertion } from "../../tests/trading/uiDiagnostics.ts";
import { readWalletSetupDiagnostic, safeRunnerError, walletFixtureOutput, walletOnboardingStep, observeWalletOnboarding } from "../../tests/trading/runnerDiagnostics.ts";

test("plain native Node imports the actual wallet setup before any browser callback", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
import assert from "node:assert/strict";
const { default: setup } = await import("./wallet-setup/metamask.setup.ts");
assert.equal(typeof setup.fn, "function");
`], { cwd: new URL("../../", import.meta.url), encoding: "utf8", env: {
    PATH: process.env.PATH,
    NODE_ENV: "test",
    SYNPRESS_WALLET_SEED_PHRASE: "public-fixture-placeholder",
    SYNPRESS_WALLET_PASSWORD: "public-fixture-password",
  } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.signal, null);
});

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

test("HTTP 200 no-route fails the expected positive quote and retains safe Backend linkage", async () => {
  const requestId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e", correlationId = "eb3e6932-a2af-4303-a09e-35831f864a1d";
  let error: unknown;
  try { await fetchQuoteStream("/api/quotes/trade/stream", {}, new AbortController().signal, () => {},
    (async () => new Response(JSON.stringify({ type: "error", code: "quote-no-route", requestId, correlationId, error: "private-provider-url" }) + "\n",
      { headers: { "X-CyberGold-Request-Id": requestId } })) as typeof fetch); }
  catch (cause) { error = cause; }
  assert.equal((error as QuotePreviewError).code, "quote-no-route");
  assert.equal(diagnosticReferences(error).requestId, requestId);
  const result = failureResult(resultFor(tradeScenarios[0], "api"), error);
  assert.equal(result.status, "fail"); assert.equal(result.refs?.correlationId, correlationId);
  assert.doesNotMatch(JSON.stringify(result), /private-provider-url/);
});

for (const transport of ["stream", "http"] as const) for (const known of [true, false])
  test(`${transport} quote failures retain bounded work diagnostics through the actual error, report and latest UI event (${known ? "known" : "fallback"} code)`, async () => {
    const attemptId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e", requestId = "eb3e6932-a2af-4303-a09e-35831f864a1d";
    const snapshot = { phase: "initial-search", elapsedMs: 15000.125, qualified: true, inversionIteration: 0,
      routeWave: { mode: "exact-out", subphase: "typed-reserve", elapsedMs: 14880.5, subphaseElapsedMs: 14800.25,
        legacyCandidates: 8, legacyCompleted: 8, typedEnumerated: 1024, typedCompleted: 1000, typedPending: 24,
        sdkRequests: 16, sdkWaiting: 2, sdkLockWaitMs: 22000.5, sdkExchangeMs: 4500.25 } };
    const payload = { type: "error", attemptId, requestId, code: known ? "quote-timeout" : "private-code",
      error: "private-provider-url signed-payload", quoteDiagnostics: { ...snapshot, privateData: "private-logical-payload",
        routeWave: { ...snapshot.routeWave, providerMessage: "private-upstream-message" } } };
    let error: unknown;
    if (transport === "stream") {
      try { await fetchQuoteStream("/api/quotes/trade/stream", {}, new AbortController().signal, () => {},
        (async () => new Response(JSON.stringify(payload) + "\n", { headers: { "X-CyberGold-Request-Id": requestId } })) as typeof fetch); }
      catch (cause) { error = cause; }
    } else error = await quoteResponseError(new Response(JSON.stringify(payload), { status: 504,
      headers: { "X-CyberGold-Request-Id": requestId } }));
    assert.ok(error instanceof QuotePreviewError);
    assert.equal(error.code, known || transport === "http" ? "quote-timeout" : "quote-unavailable");
    const scenario = tradeScenarios.find(row => row.id === "core-issue-usdc-exact-in")!;
    const result = failureResult(resultFor(scenario, "execution"), error);
    assert.equal(result.status, "fail");
    assert.deepEqual(result.quoteDiagnostics, snapshot);
    const events: ClientDiagnostic[] = [], quotes = createQuoteDiagnostics(event => events.push(event));
    quotes.observe({}, "loading", undefined, { attemptId }); quotes.observe({}, "failed", error);
    assert.equal(events.length, 1);
    const observer = createUiQuoteDiagnostics(scenario, protocolConfigurationFixture);
    observer.request("/api/quotes/trade/stream", tokenRequest(scenario, protocolConfigurationFixture, protocolConfigurationFixture.contracts.helpers!), attemptId);
    assert.equal(observer.diagnostic(events[0]), true);
    assert.deepEqual(observer.snapshot().quoteDiagnostics, snapshot);
    Object.assign(result, observer.snapshot());
    assert.doesNotMatch(JSON.stringify({ result, events, ui: observer.snapshot() }), /private-|signed-payload/);
    observer.request("/api/quotes/trade/stream", tokenRequest(scenario, protocolConfigurationFixture, protocolConfigurationFixture.contracts.helpers!), requestId);
    Object.assign(result, observer.snapshot());
    assert.equal(result.quoteDiagnostics, undefined);
    assert.equal(observer.snapshot().quoteDiagnostics, undefined);
    assert.equal(observer.diagnostic(events[0]), false);
  });

test("quote work projection omits malformed private fields independently and returns detached snapshots", () => {
  const payload = { phase: "initial-search", qualified: false, elapsedMs: 1e12, inversionIteration: 0.5,
    privateData: "private-calldata", routeWave: { mode: "exact-in", subphase: "composition", sdkRequests: 3.5,
      sdkWaiting: false, sdkExchangeMs: Infinity, typedPending: -1, typedCompleted: "2", providerMessage: "private-provider-url" } };
  const expected = { phase: "initial-search", qualified: false, elapsedMs: 1e12, inversionIteration: 0.5,
    routeWave: { mode: "exact-in", subphase: "composition", sdkRequests: 3.5 } };
  assert.deepEqual(safeQuoteDiagnostics(payload), expected);
  const error = new QuotePreviewError("quote-timeout", "private-error-message"); retainQuoteDiagnostics(error, payload);
  payload.routeWave.sdkRequests = 99;
  const first = quoteDiagnostics(error)!;
  assert.deepEqual(first, expected); first.routeWave!.sdkRequests = 100;
  assert.deepEqual(quoteDiagnostics(error), expected);
  assert.deepEqual(failureResult({ ...resultFor(tradeScenarios[0], "api"), quoteDiagnostics: payload as never }, new Error("private-failure")).quoteDiagnostics,
    { ...expected, routeWave: { ...expected.routeWave, sdkRequests: 99 } });
  for (const malformed of [undefined, null, true, "private-field", [], {}, { phase: "private-phase", qualified: 1,
    elapsedMs: true, inversionIteration: 1e12 + 1, routeWave: { mode: "private-mode", subphase: "private-phase", sdkWaiting: NaN } },
    Object.defineProperty({}, "phase", { get: () => { throw new Error("private-getter"); } })])
    assert.equal(safeQuoteDiagnostics(malformed), undefined);
  assert.equal(quoteDiagnostics(Object.defineProperty({}, "quoteDiagnostics", { get: () => { throw new Error("private-getter"); } })), undefined);
  assert.equal(failureResult({ ...resultFor(tradeScenarios[0], "api"), quoteDiagnostics: { privateData: "private-result" } as never }, new Error("private-failure")).quoteDiagnostics, undefined);
  assert.doesNotMatch(JSON.stringify(quoteDiagnostics(error)), /private-/);
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

test("a submitted confirmation timeout fails confirmation without inventing a revert", () => {
  const transactionHash = `0x${"a".repeat(64)}`;
  const requestId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e";
  const result = failureResult({ ...resultFor(tradeScenarios[0], "execution"), transactionHash, refs: { requestId } },
    new ScenarioUnavailableError("submitted-unconfirmed"));
  assert.equal(result.status, "fail"); assert.equal(result.code, "submitted-unconfirmed");
  assert.equal(result.transactionHash, transactionHash); assert.deepEqual(result.refs, { requestId });
  assert.equal(result.receipt, undefined);
});

test("attempted positive quote and execution paths fail on required dependency errors", () => {
  const requestId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e";
  for (const code of ["quote-timeout", "rpc-timeout", "rpc-unavailable", "quote-no-route", "quote-stream-interrupted"] as const) {
    const result = failureResult(resultFor(tradeScenarios[0], "api"), new QuotePreviewError(code, code, { requestId }));
    assert.equal(result.status, "fail"); assert.equal(result.code, code); assert.deepEqual(result.refs, { requestId });
  }
  for (const code of ["basket-assets-unavailable", "basket-weights-unavailable", "wallet-balance-unavailable", "allowance-unavailable", "wallet-authorization-timeout", "wallet-submission-timeout", "ui-results-unavailable"]) {
    const result = failureResult(resultFor(tradeScenarios[0], "execution"), new ScenarioUnavailableError(code));
    assert.equal(result.status, "fail"); assert.equal(result.code, code);
  }
  for (const name of ["TimeoutError", "AbortError"]) {
    const result = failureResult(resultFor(tradeScenarios[0], "execution"), Object.assign(new Error("private-provider-token"), { name }));
    assert.equal(result.status, "fail"); assert.equal(result.code, "service-unavailable");
    assert.doesNotMatch(JSON.stringify(result), /private-provider-token/);
  }
});

test("unavailable is reserved for runner prerequisites that prevented case execution", () => {
  for (const code of ["app-origin-unavailable", "fork-fixture-configuration-unavailable", "browser-unavailable", "wallet-setup-unavailable", "wallet-rpc-unavailable"]) {
    const result = failureResult(resultFor(tradeScenarios[0], "execution"), new ScenarioUnavailableError(code));
    assert.equal(result.status, "unavailable"); assert.equal(result.code, code);
  }
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

test("a served protocol-facts timeout fails required startup observations for all36 paths", () => {
  const output = mkdtempSync(join(tmpdir(), "cybergold-trade-regression-"));
  const requestId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e";
  const correlationId = "eb3e6932-a2af-4303-a09e-35831f864a1d";
  const fixture = join(output, "served-facts-timeout.mjs");
  writeFileSync(fixture, `globalThis.fetch = async url => new URL(url).pathname === '/en' ? new Response('') : Response.json({ code: 'rpc-timeout', requestId: '${requestId}', correlationId: '${correlationId}', error: 'private-provider-token' }, { status: 504, headers: { 'X-CyberGold-Request-Id': '${requestId}' } });`);
  try {
    const child = spawnSync(process.execPath, ["--import", fixture, "scripts/run-trade-regression.mjs", "--target", "mainnet", "--mode", "quotes", "--base-url", "http://app.test", "--output-dir", output],
      { cwd: new URL("../../", import.meta.url), stdio: "ignore" });
    assert.equal(child.status, 1);
    const report = JSON.parse(readFileSync(join(output, "report.json"), "utf8"));
    assert.equal(report.runnerOutcome, "fail"); assert.equal(report.runnerCode, "rpc-timeout");
    assert.equal(report.scenarios.length, 36);
    assert.ok(report.scenarios.every((row: { status: string; code: string; refs: unknown }) => row.status === "fail" && row.code === "rpc-timeout"));
    assert.deepEqual(report.scenarios[0].refs, { requestId, correlationId });
    assert.doesNotMatch(JSON.stringify(report), /private-provider-token/);
  } finally { rmSync(output, { recursive: true, force: true }); }
});

type SandboxRunnerFixture = {
  cacheExitCode?: number; testExitCode?: number; testSignal?: string; cacheCheckpoint?: unknown; cacheCheckpointText?: string;
  factsUnavailable?: boolean;
  spawnError?: { name: string; code?: string }; independent?: unknown; ui?: unknown;
  uiFixtureDiagnostic?: unknown; independentFixtureDiagnostic?: unknown; uiFixtureDiagnosticText?: string;
};

function runSandboxRunnerFixture(options: SandboxRunnerFixture) {
  const output = mkdtempSync(join(tmpdir(), "cybergold-trade-runner-diagnostics-"));
  const fixture = join(output, "owned-command-fixture.mjs");
  writeFileSync(fixture, `
import childProcess from "node:child_process";
import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
const options = ${JSON.stringify(options)};
const config = ${JSON.stringify(protocolConfigurationFixture)};
globalThis.fetch = async url => new URL(url).pathname === "/en" ? new Response("")
  : options.factsUnavailable && new URL(url).pathname === "/api/protocol/facts"
    ? Response.json({ code: "rpc-timeout" }, { status: 504 })
    : Response.json(new URL(url).pathname === "/api/protocol/config" ? config : {});
childProcess.spawn = (_executable, args, commandOptions) => {
  const child = new EventEmitter();
  child.kill = () => true;
  const cache = args[0] === "scripts/cache-metamask-wallet.mjs";
  const env = commandOptions.env;
  assert.equal(env.NEXT_PUBLIC_CHAIN_NAME, "CyberGold Sandbox");
  if (cache && options.cacheCheckpoint !== undefined)
    writeFileSync(env.TRADE_REGRESSION_WALLET_SETUP_OUTPUT, JSON.stringify(options.cacheCheckpoint));
  if (cache && options.cacheCheckpointText !== undefined)
    writeFileSync(env.TRADE_REGRESSION_WALLET_SETUP_OUTPUT, options.cacheCheckpointText);
  if (!cache && options.independent !== undefined)
    writeFileSync(env.TRADE_REGRESSION_OUTPUT, JSON.stringify(options.independent));
  if (!cache && options.ui !== undefined)
    writeFileSync(env.TRADE_REGRESSION_UI_OUTPUT, JSON.stringify(options.ui));
  if (!cache && options.uiFixtureDiagnostic !== undefined)
    writeFileSync(env.TRADE_REGRESSION_UI_FIXTURE_OUTPUT, JSON.stringify(options.uiFixtureDiagnostic));
  if (!cache && options.independentFixtureDiagnostic !== undefined)
    writeFileSync(env.TRADE_REGRESSION_INDEPENDENT_FIXTURE_OUTPUT, JSON.stringify(options.independentFixtureDiagnostic));
  if (!cache && options.uiFixtureDiagnosticText !== undefined)
    writeFileSync(env.TRADE_REGRESSION_UI_FIXTURE_OUTPUT, options.uiFixtureDiagnosticText);
  process.nextTick(() => {
    if (cache && options.spawnError)
      child.emit("error", Object.assign(new Error("private-error-message"), options.spawnError));
    else child.emit("exit", cache ? options.cacheExitCode ?? 0 : options.testSignal ? null : options.testExitCode ?? 0,
      cache ? null : options.testSignal ?? null);
  });
  return child;
};
syncBuiltinESMExports();
`);
  try {
    const child = spawnSync(process.execPath, ["--import", fixture, "scripts/run-trade-regression.mjs", "--target", "sandbox",
      "--mode", "sandbox-execution", "--base-url", "http://app.test", "--output-dir", output],
    { cwd: new URL("../../", import.meta.url), stdio: "ignore" });
    return { exitCode: child.status, report: JSON.parse(readFileSync(join(output, "report.json"), "utf8")) };
  } finally { rmSync(output, { recursive: true, force: true }); }
}

function sandboxSuiteReports() {
  return {
    independent: { schema: "cybergold.trade-regression.v1", scenarios: tradeScenarios.map(scenario => ({
      ...resultFor(scenario, "execution"), status: "pass", code: undefined })) },
    ui: { schema: "cybergold.trade-regression.v1", scenarios: tradeScenarios.filter(scenario => scenario.requestedStrategy === "core")
      .map(scenario => ({ ...resultFor(scenario, "execution"), id: `ui-${scenario.id}`, requestedStrategy: "auto", status: "pass", code: undefined })) },
  };
}

test("wallet cache failure fails the runner and leaves all36 cases unstarted with safe setup diagnostics", () => {
  const { exitCode, report } = runSandboxRunnerFixture({ cacheExitCode: 1, factsUnavailable: true,
    cacheCheckpoint: { stage: "wallet-onboarding", result: "fail", errorClass: "TimeoutError",
      onboarding: { step: "import-wallet", elapsedMs: 1200, message: "private-onboarding-error" },
      errorCode: "private-errno", error: "private-error-message", seedPhrase: "private-wallet-seed", rpcUrl: "https://private-rpc.invalid" } });
  assert.equal(exitCode, 1);
  assert.equal(report.runnerOutcome, "fail"); assert.equal(report.runnerCode, "wallet-setup-failed");
  assert.equal(report.runnerDiagnostics.stage, "wallet-cache"); assert.equal(report.runnerDiagnostics.exitCode, 1);
  assert.deepEqual(report.runnerDiagnostics.walletSetup, { stage: "wallet-onboarding", result: "fail", errorClass: "TimeoutError",
    onboarding: { step: "import-wallet", elapsedMs: 1200 } });
  assert.equal(report.scenarios.length, 36);
  assert.equal(new Set(report.scenarios.map((row: { id: string }) => row.id)).size, 36);
  assert.ok(report.scenarios.every((row: { status: string; code: string }) => row.status === "unavailable" && row.code === "wallet-setup-unavailable"));
  assert.doesNotMatch(JSON.stringify(report), /private-errno|private-error-message|private-wallet-seed|private-rpc|private-onboarding-error/);
});

test("native wallet setup import errors retain only their fixed code through runner projection", () => {
  const error = Object.assign(new Error("private-import-message"), {
    code: "ERR_MODULE_NOT_FOUND", path: "private-import-path", stack: "private-import-stack",
  });
  assert.deepEqual(safeRunnerError(error), { errorClass: "Error", errorCode: "ERR_MODULE_NOT_FOUND" });
  assert.deepEqual(safeRunnerError(Object.assign(new Error("private-import-message"), { code: "private-import-code" })),
    { errorClass: "Error" });
  const { exitCode, report } = runSandboxRunnerFixture({ cacheExitCode: 1,
    cacheCheckpoint: { stage: "setup-import", result: "fail", ...safeRunnerError(error),
      message: error.message, path: error.path, stack: error.stack, errorCodeSuffix: "private-import-code" } });
  assert.equal(exitCode, 1);
  assert.deepEqual(report.runnerDiagnostics.walletSetup,
    { stage: "setup-import", result: "fail", errorClass: "Error", errorCode: "ERR_MODULE_NOT_FOUND" });
  assert.equal(report.runnerCode, "wallet-setup-failed");
  assert.ok(report.scenarios.every((row: { status: string; code: string }) =>
    row.status === "unavailable" && row.code === "wallet-setup-unavailable"));
  assert.doesNotMatch(JSON.stringify(report), /private-import/);
});

test("a child spawn failure retains its safe system code and never exports an arbitrary error name", () => {
  const { exitCode, report } = runSandboxRunnerFixture({ spawnError: { name: "private-error-name", code: "ENOENT" } });
  assert.equal(exitCode, 1);
  assert.equal(report.runnerOutcome, "fail"); assert.equal(report.runnerCode, "wallet-setup-failed");
  assert.equal(report.runnerDiagnostics.stage, "wallet-cache");
  assert.equal(report.runnerDiagnostics.errorClass, "UnknownError"); assert.equal(report.runnerDiagnostics.errorCode, "ENOENT");
  assert.equal(report.scenarios.length, 36);
  assert.ok(report.scenarios.every((row: { status: string }) => row.status === "unavailable"));
  assert.doesNotMatch(JSON.stringify(report), /private-error-name|private-error-message/);
});

test("missing execution reports fail the runner without inventing attempted failures for all36 cases", () => {
  for (const command of [{ testExitCode: 1 }, { testSignal: "SIGTERM" }]) {
    const { exitCode, report } = runSandboxRunnerFixture(command);
    assert.equal(exitCode, 1);
    assert.equal(report.runnerOutcome, "fail"); assert.equal(report.runnerCode, "execution-results-unavailable");
    assert.equal(report.runnerDiagnostics.stage, "independent-report");
    assert.equal(report.runnerDiagnostics.exitCode, command.testExitCode);
    assert.equal(report.runnerDiagnostics.signal, command.testSignal);
    assert.equal(report.runnerDiagnostics.errorClass, "Error"); assert.equal(report.runnerDiagnostics.errorCode, "ENOENT");
    assert.equal(report.scenarios.length, 36);
    assert.equal(report.scenarios.filter((row: { status: string }) => row.status === "fail").length, 0);
    assert.ok(report.scenarios.filter((row: { id: string }) => !row.id.startsWith("ui-"))
      .every((row: { status: string; code: string }) => row.status === "unavailable" && row.code === "execution-results-unavailable"));
    assert.ok(report.scenarios.filter((row: { id: string }) => row.id.startsWith("ui-"))
      .every((row: { status: string; code: string }) => row.status === "unavailable" && row.code === "ui-results-unavailable"));
  }
});

test("a missing independent report preserves mined UI evidence and its other unstarted cases", () => {
  const transactionHash = `0x${"d".repeat(64)}`;
  const ui = { schema: "cybergold.trade-regression.v1", scenarios: tradeScenarios.filter(scenario => scenario.requestedStrategy === "core")
    .map((scenario, index) => ({ ...resultFor(scenario, "execution"), id: `ui-${scenario.id}`, requestedStrategy: "auto",
      ...(index === 0 ? { status: "pass", code: undefined, transactionHash, actualOperation: "issueFromTokenExactOut",
        receipt: { transactionHash, blockNumber: "26100001", netPaid: ["100"], netReceived: ["90"] } } : {}) })) };
  const { exitCode, report } = runSandboxRunnerFixture({ testExitCode: 1, ui });
  assert.equal(exitCode, 1);
  assert.equal(report.runnerOutcome, "fail"); assert.equal(report.runnerCode, "execution-results-unavailable");
  assert.equal(report.scenarios.length, 36);
  assert.equal(report.scenarios.filter((row: { status: string }) => row.status === "pass").length, 1);
  assert.equal(report.scenarios.filter((row: { status: string }) => row.status === "unavailable").length, 35);
  const mined = report.scenarios.find((row: { id: string }) => row.id === ui.scenarios[0].id);
  assert.equal(mined.transactionHash, transactionHash);
  assert.equal(mined.actualOperation, "issueFromTokenExactOut"); assert.deepEqual(mined.receipt, ui.scenarios[0].receipt);
});

test("UI fixture failure keeps safe setup cause while missing UI results preserve independent mined evidence", () => {
  const independent = sandboxSuiteReports().independent;
  const transactionHash = `0x${"e".repeat(64)}`;
  Object.assign(independent.scenarios[0], { transactionHash, actualOperation: "issueFromTokenExactOutWithPermit2",
    authorization: ["permit2"], receipt: { transactionHash, inputUsed: "100", amountOut: "90" } });
  const { exitCode, report } = runSandboxRunnerFixture({ independent, testExitCode: 1,
    uiFixtureDiagnostic: { stage: "wallet-onboarding", result: "fail", errorClass: "TimeoutError", errorCode: "EACCES",
      onboarding: { step: "completion-click", elapsedMs: 2400, dom: "private-wallet-DOM" },
      message: "private-wallet-error", password: "private-wallet-password", rpcUrl: "https://private-fixture-rpc.invalid" },
    independentFixtureDiagnostic: { stage: "browser-close", result: "pass" } });
  assert.equal(exitCode, 1);
  assert.equal(report.runnerOutcome, "fail"); assert.equal(report.runnerCode, "ui-results-unavailable");
  assert.equal(report.runnerDiagnostics.stage, "ui-report"); assert.equal(report.runnerDiagnostics.errorCode, "ENOENT");
  assert.deepEqual(report.runnerDiagnostics.walletTests, {
    ui: { stage: "wallet-onboarding", result: "fail", errorClass: "TimeoutError", errorCode: "EACCES",
      onboarding: { step: "completion-click", elapsedMs: 2400 } },
    independent: { stage: "browser-close", result: "pass" },
  });
  assert.equal(report.scenarios.filter((row: { status: string }) => row.status === "pass").length, 20);
  assert.equal(report.scenarios.filter((row: { status: string }) => row.status === "unavailable").length, 16);
  const mined = report.scenarios.find((row: { id: string }) => row.id === independent.scenarios[0].id);
  assert.equal(mined.transactionHash, transactionHash); assert.deepEqual(mined.authorization, ["permit2"]);
  assert.deepEqual(mined.receipt, { transactionHash, inputUsed: "100", amountOut: "90" });
  assert.doesNotMatch(JSON.stringify(report), /private-wallet-error|private-wallet-password|private-fixture-rpc|private-wallet-DOM/);
});

test("optional missing or invalid wallet setup diagnostics cannot reject successful execution reports", () => {
  for (const checkpoint of [{}, { cacheCheckpointText: "invalid optional json" },
    { cacheCheckpoint: { stage: "private-stage", result: "private-result", errorClass: "private-error-name", error: "private-error-message" } },
    { uiFixtureDiagnosticText: "invalid optional json", independentFixtureDiagnostic: { stage: "private-stage", result: "private-result" } }]) {
    const { exitCode, report } = runSandboxRunnerFixture({ ...sandboxSuiteReports(), ...checkpoint });
    assert.equal(exitCode, 0);
    assert.equal(report.runnerOutcome, "pass"); assert.equal(report.scenarios.length, 36);
    assert.ok(report.scenarios.every((row: { status: string }) => row.status === "pass"));
    assert.doesNotMatch(JSON.stringify(report), /private-stage|private-result|private-error-name|private-error-message/);
  }
});

test("fresh fixture diagnostics belong only to the two owned regression suites", () => {
  const environment = { TRADE_REGRESSION_UI_FIXTURE_OUTPUT: "/owned/ui.json", TRADE_REGRESSION_INDEPENDENT_FIXTURE_OUTPUT: "/owned/independent.json" };
  assert.equal(walletFixtureOutput("/tests/fixed-api-roundtrips.spec.ts", environment), "/owned/ui.json");
  assert.equal(walletFixtureOutput("/tests/regression-execution.spec.ts", environment), "/owned/independent.json");
  assert.equal(walletFixtureOutput("/tests/wallet-session.spec.ts", environment), undefined);
  assert.equal(walletFixtureOutput("/tests/other.spec.ts", environment), undefined);
});

test("the wallet page fixture lets the test persist its report before its own App navigation", () => {
  const output = mkdtempSync(join(tmpdir(), "cybergold-wallet-page-fixture-"));
  const fixture = join(output, "page-fixture.spec.ts"), config = join(output, "playwright.config.mjs");
  const initialReport = join(output, "initial-report.json");
  const walletFixture = fileURLToPath(new URL("../../tests/metamask/testWithMetaMask.ts", import.meta.url));
  writeFileSync(fixture, `
import { test as walletTest } from ${JSON.stringify(walletFixture)};
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const navigations: string[] = [];
const page = { goto: async (url: string) => {
  navigations.push(url);
  if (url !== "/en") throw new Error("implicit-fixture-navigation-failed");
} };
const test = walletTest.extend({ context: async ({}, use) => {
  await use({ newPage: async () => page } as never);
} });
test("initial report precedes the suite's navigation", async ({ page }) => {
  assert.deepEqual(navigations, []);
  writeFileSync(${JSON.stringify(initialReport)}, JSON.stringify({ initialized: true }));
  await page.goto("/en");
  assert.deepEqual(navigations, ["/en"]);
});
`);
  writeFileSync(config, `export default ${JSON.stringify({ testDir: output, testMatch: "page-fixture.spec.ts", workers: 1,
    timeout: 20_000, reporter: "dot", outputDir: join(output, "playwright-output") })};\n`);
  try {
    const child = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", config],
      { cwd: new URL("../../", import.meta.url), stdio: "ignore", env: { ...process.env,
        SYNPRESS_WALLET_SEED_PHRASE: "public-fixture-placeholder", SYNPRESS_WALLET_PASSWORD: "public-fixture-password",
        PLAYWRIGHT_BASE_URL: "http://fixture.invalid" } });
    assert.equal(child.status, 0);
    assert.deepEqual(JSON.parse(readFileSync(initialReport, "utf8")), { initialized: true });
  } finally { rmSync(output, { recursive: true, force: true }); }
});

function runFreshWalletFixture(options: { failAt?: "browser-launch" | "wallet-onboarding" | "fixture-focus" | "other-pages-close"; closeFailure?: boolean; unavailableOutput?: boolean;
  actualOnboarding?: "import-wallet" | "completion-click" | "complete" }) {
  const output = mkdtempSync(join(tmpdir(), "cybergold-fresh-wallet-fixture-"));
  const fixture = join(output, "fixed-api-roundtrips.spec.ts"), config = join(output, "playwright.config.mjs");
  const diagnostic = options.unavailableOutput ? join(output, "missing-directory", "fixture.json") : join(output, "fixture.json");
  const entered = join(output, "body-entered.json");
  const actionsFile = join(output, "actions.json");
  const walletFixture = fileURLToPath(new URL("../../tests/metamask/testWithMetaMask.ts", import.meta.url));
  const walletSetup = fileURLToPath(new URL("../../wallet-setup/metamask.setup.ts", import.meta.url));
  const playwright = fileURLToPath(new URL("../../node_modules/@playwright/test/index.mjs", import.meta.url));
  writeFileSync(fixture, `
import { test } from ${JSON.stringify(walletFixture)};
import setup from ${JSON.stringify(walletSetup)};
import { chromium } from ${JSON.stringify(playwright)};
import { MetaMask } from ${JSON.stringify(fileURLToPath(import.meta.resolve("@synthetixio/synpress-metamask/playwright")))};
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";
const options = ${JSON.stringify(options)};
const realpath = filesystem.realpath;
filesystem.realpath = async path => String(path).endsWith(".cache-synpress/metamask-chrome-13.13.1")
  ? "/public-fixture-extension" : realpath(path);
syncBuiltinESMExports();
const failure = () => Object.assign(new Error("private-wallet-fixture-message"), { name: "TimeoutError", code: "EACCES" });
const actions: string[] = [];
const home = "chrome-extension://fixture/home.html";
const otherPage = { url: () => "about:blank", close: async () => { throw failure(); } };
const extensionPage = { url: () => home, goto: async () => {}, bringToFront: async () => { if (options.failAt === "fixture-focus") throw failure(); }, close: async () => {},
  getByTestId: (id: string) => ({
    waitFor: async () => { if (id !== "account-menu-icon") actions.push(id === "onboarding-import-wallet" ? "import-button-wait" : "completion-hidden-wait"); },
    isVisible: async () => { actions.push("completion-check"); return true; },
    click: async () => { actions.push("completion-click"); if (options.actualOnboarding === "completion-click") throw failure(); },
  }), waitForLoadState: async () => { actions.push("load-state"); },
  waitForTimeout: async (milliseconds: number) => { actions.push("existing-wait:" + milliseconds); } };
chromium.launchPersistentContext = async () => {
  if (options.failAt === "browser-launch") throw failure();
  return { serviceWorkers: () => [{ url: () => "chrome-extension://fixture/service-worker.js" }],
    pages: () => options.failAt === "other-pages-close" ? [extensionPage, otherPage] : [extensionPage], newPage: async () => ({ goto: async () => {} }),
    close: async () => { if (options.closeFailure) throw Object.assign(new Error("private-close-message"), { name: "TypeError", code: "EROFS" }); } } as never;
};
if (options.actualOnboarding) MetaMask.prototype.importWallet = async () => {
  actions.push("import-wallet"); if (options.actualOnboarding === "import-wallet") throw failure();
};
else setup.fn = async () => { if (options.failAt === "wallet-onboarding") throw failure(); };
test.afterAll(() => { writeFileSync(${JSON.stringify(actionsFile)}, JSON.stringify(actions)); });
test("owned fresh wallet fixture reaches its test body", async ({ page }) => {
  writeFileSync(${JSON.stringify(entered)}, JSON.stringify({ entered: true }));
});
`);
  writeFileSync(config, `export default ${JSON.stringify({ testDir: output, testMatch: "fixed-api-roundtrips.spec.ts", workers: 1,
    timeout: 20_000, reporter: "dot", outputDir: join(output, "playwright-output") })};\n`);
  try {
    const child = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", config],
      { cwd: new URL("../../", import.meta.url), stdio: "ignore", env: { ...process.env,
        SYNPRESS_WALLET_SEED_PHRASE: "public-fixture-placeholder", SYNPRESS_WALLET_PASSWORD: "public-fixture-password",
        TRADE_REGRESSION_UI_FIXTURE_OUTPUT: diagnostic, PLAYWRIGHT_BASE_URL: "http://fixture.invalid" } });
    let checkpoint, bodyEntered = false;
    try { checkpoint = JSON.parse(readFileSync(diagnostic, "utf8")); } catch { /* Optional checkpoint can be absent. */ }
    try { bodyEntered = JSON.parse(readFileSync(entered, "utf8")).entered; } catch { /* A failed fixture has no test body. */ }
    let actions: string[] = [];
    try { actions = JSON.parse(readFileSync(actionsFile, "utf8")); } catch { /* A startup failure can precede hooks. */ }
    return { exitCode: child.status, checkpoint, bodyEntered, actions };
  } finally { rmSync(output, { recursive: true, force: true }); }
}

test("fresh wallet fixture failures retain the exact safe startup stage and preserve its first cause", () => {
  for (const failAt of ["browser-launch", "wallet-onboarding", "fixture-focus", "other-pages-close"] as const) {
    const result = runFreshWalletFixture({ failAt, closeFailure: true });
    assert.equal(result.exitCode, 1); assert.equal(result.bodyEntered, false);
    const { onboarding, ...base } = result.checkpoint;
    assert.deepEqual(base, { stage: failAt === "browser-launch" ? failAt : "wallet-onboarding", result: "fail", errorClass: "TimeoutError", errorCode: "EACCES" });
    if (failAt !== "browser-launch") {
      assert.equal(onboarding.step, failAt === "wallet-onboarding" ? "setup-callback" : failAt === "fixture-focus" ? "focus" : failAt);
      assert.ok(Number.isSafeInteger(onboarding.elapsedMs) && onboarding.elapsedMs >= 0);
    } else assert.equal(onboarding, undefined);
    assert.doesNotMatch(JSON.stringify(result.checkpoint), /private-wallet-fixture-message|private-close-message/);
  }
});

test("an unwritable optional diagnostic cannot reject an otherwise ready fresh wallet fixture", () => {
  const result = runFreshWalletFixture({ unavailableOutput: true });
  assert.equal(result.exitCode, 0); assert.equal(result.bodyEntered, true); assert.equal(result.checkpoint, undefined);
});

test("real onboarding failures identify the existing substep and preserve the first failure through closing", () => {
  for (const step of ["import-wallet", "completion-click"] as const) {
    const result = runFreshWalletFixture({ actualOnboarding: step, closeFailure: true });
    assert.equal(result.exitCode, 1); assert.equal(result.bodyEntered, false);
    assert.equal(result.checkpoint.stage, "wallet-onboarding"); assert.equal(result.checkpoint.result, "fail");
    assert.equal(result.checkpoint.errorClass, "TimeoutError"); assert.equal(result.checkpoint.errorCode, "EACCES");
    assert.equal(result.checkpoint.onboarding.step, step);
    assert.ok(Number.isSafeInteger(result.checkpoint.onboarding.elapsedMs) && result.checkpoint.onboarding.elapsedMs >= 0);
    assert.deepEqual(result.actions, step === "import-wallet" ? ["import-button-wait", "import-wallet"]
      : ["import-button-wait", "import-wallet", "completion-check", "completion-click"]);
    assert.doesNotMatch(JSON.stringify(result.checkpoint), /private-wallet-fixture-message|private-close-message|public-fixture-placeholder/);
  }
  const successful = runFreshWalletFixture({ actualOnboarding: "complete", unavailableOutput: true });
  assert.equal(successful.exitCode, 0); assert.equal(successful.bodyEntered, true);
  assert.deepEqual(successful.actions, ["import-button-wait", "import-wallet", "completion-check", "completion-click",
    "completion-hidden-wait", "load-state", "existing-wait:1000"]);
});

test("optional onboarding readers retain only fixed substeps and nonnegative integer elapsed time", async () => {
  const output = mkdtempSync(join(tmpdir(), "cybergold-onboarding-reader-")), path = join(output, "checkpoint.json");
  try {
    const base = { stage: "wallet-onboarding", result: "fail", errorClass: "Error" };
    writeFileSync(path, JSON.stringify({ ...base, onboarding: { step: "import-wallet", elapsedMs: 125,
      message: "private-seed", params: "private-request" } }));
    assert.deepEqual(await readWalletSetupDiagnostic(path), { ...base, onboarding: { step: "import-wallet", elapsedMs: 125 } });
    for (const onboarding of [{ step: "private-name", elapsedMs: 1 }, { step: "focus", elapsedMs: -1 },
      { step: "focus", elapsedMs: 1.5 }, { step: "focus", elapsedMs: "1" }, { step: "focus", elapsedMs: true }]) {
      writeFileSync(path, JSON.stringify({ ...base, onboarding }));
      assert.deepEqual(await readWalletSetupDiagnostic(path), base);
    }
    const context = {}, observation = observeWalletOnboarding(context);
    walletOnboardingStep(context, "import-wallet"); observation.stop();
    const frozen = observation.snapshot(); walletOnboardingStep(context, "complete");
    assert.deepEqual(observation.snapshot(), frozen);
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test("UI preparation references follow the latest matching quote attempt and reject stale or unrelated events", () => {
  const scenario = tradeScenarios.find(row => row.id === "core-redeem-usdc-exact-in")!;
  const request = tokenRequest(scenario, protocolConfigurationFixture, protocolConfigurationFixture.contracts.helpers!);
  const first = "e9eb96b2-8ecf-429d-9e08-244f43257e8e", latest = "eb3e6932-a2af-4303-a09e-35831f864a1d";
  const requestId = "32308717-eac6-4fbb-a685-b7a9a652c5f8";
  const observer = createUiQuoteDiagnostics(scenario, protocolConfigurationFixture);
  assert.equal(observer.request("/api/quotes/trade/stream", { ...request, amount: "0" }, first), false);
  assert.equal(observer.request("/api/quotes/trade/stream", request, first), true);
  assert.equal(observer.diagnostic({ operation: "quote", attemptId: first, requestId, outcome: "failed", errorClassification: "quote-timeout" }), true);
  assert.deepEqual(observer.snapshot(), { refs: { attemptId: first, requestId }, reason: "quote-timeout", quoteDiagnostics: undefined });
  assert.equal(observer.request("/api/quotes/trade/stream", request, latest), true);
  assert.deepEqual(observer.snapshot(), { refs: { attemptId: latest }, reason: undefined, quoteDiagnostics: undefined });
  assert.equal(observer.diagnostic({ operation: "quote", attemptId: first, requestId, outcome: "failed", errorClassification: "rpc-timeout" }), false);
  assert.equal(observer.diagnostic({ operation: "swap", attemptId: latest, requestId }), false);
  assert.equal(observer.diagnostic({ operation: "quote", attemptId: latest, requestId, outcome: "failed", errorClassification: "gho-private-token" }), true);
  assert.deepEqual(observer.snapshot(), { refs: { attemptId: latest, requestId }, reason: undefined, quoteDiagnostics: undefined });
  assert.doesNotMatch(JSON.stringify(observer.snapshot()), /gho-private-token/);
  assert.equal(createUiQuoteDiagnostics(scenario, protocolConfigurationFixture).diagnostic({ operation: "quote", attemptId: latest, requestId }), false);
});

test("an actual quoted-amount assertion remains fail with its precise preparation code and quote references", async () => {
  const scenario = tradeScenarios.find(row => row.id === "core-issue-usdc-exact-in")!;
  const observer = createUiQuoteDiagnostics(scenario, protocolConfigurationFixture);
  const attemptId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e", requestId = "eb3e6932-a2af-4303-a09e-35831f864a1d";
  observer.request("/api/quotes/trade/stream", tokenRequest(scenario, protocolConfigurationFixture, protocolConfigurationFixture.contracts.helpers!), attemptId);
  observer.diagnostic({ operation: "quote", attemptId, requestId, outcome: "failed", errorClassification: "quote-timeout" });
  let error: unknown;
  try { await uiPreparationAssertion("ui-quoted-amount-not-ready", () => playwrightExpect.poll(async () => 0, { timeout: 10 }).toBeGreaterThan(0)); }
  catch (cause) { error = cause; }
  const result = failureResult({ ...resultFor(scenario, "execution"), ...observer.snapshot() }, error);
  assert.equal(result.status, "fail"); assert.equal(result.code, "ui-quoted-amount-not-ready");
  assert.equal(result.reason, "quote-timeout"); assert.deepEqual(result.refs, { attemptId, requestId });
  const readFailure = new Error("private-read-token");
  await assert.rejects(uiPreparationAssertion("ui-quoted-amount-not-ready", () => playwrightExpect.poll(async () => { throw readFailure; }, { timeout: 10 }).toBeGreaterThan(0)), cause => cause === readFailure);
});

test("UI completion deadline retains submission uncertainty and never masks an observed revert", async () => {
  const assertion = () => playwrightExpect.poll(async () => false, { timeout: 10 }).toBe(true);
  const transactionHash = `0x${"a".repeat(64)}`;
  const result = { ...resultFor(tradeScenarios[0], "execution"), transactionHash };
  let error: unknown;
  try { await uiCompletionAssertion(assertion, () => true); } catch (cause) { error = cause; }
  const uncertain = failureResult(result, error);
  assert.equal(uncertain.status, "fail"); assert.equal(uncertain.code, "submitted-unconfirmed");
  assert.equal(uncertain.transactionHash, transactionHash);
  try { await uiCompletionAssertion(assertion, () => false); } catch (cause) { error = cause; }
  const unsubmitted = failureResult(resultFor(tradeScenarios[0], "execution"), error);
  assert.equal(unsubmitted.status, "fail"); assert.equal(unsubmitted.code, "ui-completion-not-observed");
  const observedRevert = new Error("private-revert-message");
  await assert.rejects(uiCompletionAssertion(() => playwrightExpect.poll(async () => { throw observedRevert; }, { timeout: 10 }).toBe(true), () => true), cause => cause === observedRevert);
});

test("generic UI observation failures retain only a constant phase and safe references", () => {
  const requestId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e", transactionHash = `0x${"a".repeat(64)}`;
  const result = { ...resultFor(tradeScenarios[0], "execution"), refs: { requestId }, transactionHash };
  const privateFailure = new Error("https://private-rpc.example/gho-private-token signed-calldata");
  for (const phase of ["ui-receipt-read", "ui-confirmation"] as const) {
    const failure = uiObservationFailure(result, privateFailure, phase);
    assert.equal(failure.status, "fail"); assert.equal(failure.code, "unexpected-error"); assert.equal(failure.reason, phase);
    assert.equal(failure.transactionHash, transactionHash); assert.deepEqual(failure.refs, { requestId });
    assert.doesNotMatch(JSON.stringify(failure), /private-rpc|gho-private-token|signed-calldata/);
  }
  assert.equal(uiObservationFailure({ ...result, reason: "quote-timeout" }, privateFailure, "ui-receipt-read").reason, "quote-timeout");
  const specific = uiObservationFailure(result, new QuotePreviewError("rpc-timeout", "rpc-timeout"), "ui-receipt-read");
  assert.equal(specific.code, "rpc-timeout"); assert.equal(specific.status, "fail"); assert.equal(specific.reason, undefined);
  const deadline = Object.assign(new Error("private-provider-token"), { name: "TimeoutError" });
  const timedOut = uiObservationFailure(result, deadline, "ui-prepare");
  assert.equal(timedOut.status, "fail"); assert.equal(timedOut.code, "service-unavailable"); assert.equal(timedOut.reason, "ui-prepare");
  assert.equal(uiObservationFailure({ ...result, reason: "quote-timeout" }, deadline, "ui-prepare").reason, "quote-timeout");
  assert.doesNotMatch(JSON.stringify(timedOut), /private-provider-token/);
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
