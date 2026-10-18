import { errors, type Page } from "@playwright/test";
import { expect, test } from "./testWithMetaMask";
import { addLocalNetwork, connectWallet, notification, walletRequestButton, requestConnection, switchLocalNetwork } from "./wallet-ui";
import { ensureBasketInputEditable, getMainInput, getSwapButton, openFeeDetails, readWalletBalances, selectToken, showAllSellTokens } from "./token-flows/helpers";
import { readFile, writeFile, rename } from "node:fs/promises";
import { type Address, type Hex } from "viem";
import { tradeScenarios, configuredToken, basketFacts, ScenarioUnavailableError } from "../trading/scenarios";
import { checkpointExecutionStage, failureResult, originFetch, readJson, requireInvariant, resultFor, type ExecutionStage, type ScenarioResult, type UiObservationPhase } from "../trading/regression";
import { observeUiReceipt } from "../trading/uiReceipt";
import { assertCapturedTradeInput } from "../trading/planAssertions";
import { armUiQuoteCapture, capturedUiQuote, quoteAssets } from "../trading/uiQuoteCapture";
import { assertWalletEconomics, positiveDisplayedAmount, walletAmounts, walletEvidence } from "../trading/uiEconomics";
import { expectWalletBalanceDisplay } from "../trading/uiWalletDisplay";
import { observeUiGas, ownedReceiptGas } from "../trading/uiGas";
import { fetchWalletBalances, type WalletBalancesSnapshot } from "../../app/utils/walletBalanceSnapshot";
import { fundSandboxWallet } from "../trading/sandboxFunding";
import { fetchTransactionReceipt } from "../../app/utils/transactionReceipt";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration";
import type { ProtocolFacts } from "../../app/utils/protocolFacts";
import { buildMatrix, readValuation, matrixTemplates, matrixCounts, assertMatrixIntent, type MatrixScenario } from "../trading/matrix";
import { installSelectionCapture, selectionCaptures, captureSelection, captureBasketSelection, executeAlternate, notAttemptedAlternate, providerSummaries, observedProviderEvidence, observedBasketProviderEvidence, executionCoverage, transactionDisposition, type SelectionCapture } from "../trading/providerEvidence";
import { installQuoteObservation, quoteObservations } from "../trading/quoteObservation";
import { safeDiagnosticReferences } from "../../app/utils/diagnosticReferences";
import { installUiSwapObservation, uiSwapObservation } from "../trading/uiSwapObservation";
import { confirmedTransactionText, createUiQuoteDiagnostics, isUiCompletionDeadlineError, uiCompletionAssertion, uiObservationFailure, uiPreparationAssertion, uiSwapTerminalFailure } from "../trading/uiDiagnostics";
import { enrichResultQuality } from "../trading/quoteQuality";
import { safeWalletClickError, type UiConfirmationDiagnostic } from "../trading/runnerDiagnostics";
import { readWalletUiState } from "../trading/walletUiState";
import { privateSandboxPhase, privateSandboxScenarios, privateSandboxSelection, sandboxIsolation, scenarioIsolation, type SandboxIsolation } from "../trading/privateSandbox";
import { cleanupOwnedWalletRequest, closeOwnedWalletContext, isWalletRequestCleanupError, walletRequestContextClosedError } from "../trading/walletRequestLifecycle";
import { hasUiReceiptOutcome, observeUiReceiptUntilDeadline, recoverUiTransaction, uiWalletRequestSettled } from "../trading/uiTransactionRecovery";

async function approveUntilMined(page: Page, submitted: () => boolean, observe: () => Promise<void> = async () => {},
  nativeProgress?: (event: { selection?: Pick<UiConfirmationDiagnostic, "notificationSelection" | "notificationViewCount">;
    click?: "attempted" | "completed"; error?: unknown; view?: Page }) => void) {
  const record = (event: Parameters<NonNullable<typeof nativeProgress>>[0]) => {
    try { nativeProgress?.(event); } catch { /* Optional evidence cannot change a native action. */ }
  };
  const success = confirmedTransactionText(page);
  const failure = page.getByText(/^Transaction failed$/i);
  await uiCompletionAssertion(() => expect.poll(async () => {
    await observe();
    if (await failure.isVisible()) throw new Error((await page.locator("[data-sonner-toast]").allTextContents()).join(" | "));
    if (await success.isVisible()) return true;
    // A temporary confirmation read failure exposes the product's existing
    // receipt-only recovery. Exercise it within this same completion window;
    // never click Swap again or create another wallet request.
    const recheck = page.getByRole("button", { name: /^Check confirmation$/i });
    if (await recheck.isVisible() && await recheck.isEnabled()) {
      await recheck.click({ timeout: 1000 }).catch(error => {
        if (!(error instanceof errors.TimeoutError)) throw error;
      });
      return false;
    }
    const step = await (await getSwapButton(page)).innerText();
    if (!/^MetaMask \d+ of \d+:/.test(step)) return false;
    const popup = await notification(page, selection => record({ selection }), walletRequestButton);
    if (popup) {
      // Selection and click use the same native request control.
      const confirm = walletRequestButton(popup);
      // A native request can navigate or close between polls. Let one click
      // check visibility/enabled state atomically, then re-read the App result.
      try {
        record({ click: "attempted" });
        await confirm.click({ timeout: 1000 });
        record({ click: "completed" });
      } catch (error) {
        record({ error, view: popup });
        if (!(error instanceof errors.TimeoutError) && !popup.isClosed()) throw error;
      }
    }
    return false;
  }, { timeout: 90000, intervals: [250, 500, 1000] }).toBe(true), submitted);
}

// Run with the disposable local protocol/backend fixture described in the E2E
// guide. MetaMask signs only against the fixture's independently owned Anvil.
// Responses are real fixed API reads, not intercepted product/receipt fixtures.
test.skip(Boolean(process.env.TRADE_REGRESSION_DIAGNOSTIC_SCENARIO), "Explicit diagnostic replay uses the independent single-case entry");
test("funded MetaMask token and basket roundtrips use fixed Python APIs", async ({ page }) => {
  // The native Linux case reached its final basket step after nine minutes.
  // Keep per-operation deadlines, with room for the final redemption.
  test.setTimeout(3_600_000);
  page.setDefaultTimeout(15000);
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID);
  const rpcUrl = process.env.NEXT_PUBLIC_WALLET_RPC_URL!;
  const genericRequests: string[] = [];
  const successfulReads = new Set<string>();
  const fetcher = originFetch(process.env.PLAYWRIGHT_BASE_URL!);
  let helpersHash: Hex | undefined;
  let activeSwapAttempt: string | undefined;
  let activeScenarioIndex: number | undefined;
  let activeFixtureIndex: number | undefined;
  let activeQuoteDiagnostics: ReturnType<typeof createUiQuoteDiagnostics> | undefined;
  let observationPhase: UiObservationPhase = "ui-prepare";
  let activeConfirmationDeadline: number | undefined;
  let setupComplete = false;
  let setupRefs = {};
  let config: ProtocolConfiguration;
  let valuation: Awaited<ReturnType<typeof readValuation>> | undefined;
  const privatePhase = privateSandboxPhase(process.env.TRADE_REGRESSION_PRIVATE_PHASE);
  const scenarios = privateSandboxScenarios(matrixTemplates() as MatrixScenario[], privatePhase, process.env.TRADE_REGRESSION_PRIVATE_SCENARIO);
  const isolation: SandboxIsolation | undefined = process.env.TRADE_REGRESSION_PRIVATE_ISOLATION
    ? sandboxIsolation(JSON.parse(await readFile(process.env.TRADE_REGRESSION_PRIVATE_ISOLATION, "utf8"))) : undefined;
  if (privatePhase && privatePhase !== 'prepare' && !isolation) throw new Error('private-sandbox-reset-evidence-unavailable');
  await page.addInitScript(installSelectionCapture as () => void);
  await page.addInitScript(installQuoteObservation as () => void);
  await page.addInitScript(installUiSwapObservation as () => void);
  let clickedSelection: SelectionCapture | undefined;
  const results: ScenarioResult[] = scenarios.map(scenario => ({ ...resultFor(scenario, "execution"), id: `ui-${scenario.id}`, requestedStrategy: "auto", executionAttempted: false, transactionDisposition: "not-submitted" }));
  const fixtures: ScenarioResult[] = [];
  const activeResult = () => activeScenarioIndex !== undefined ? results[activeScenarioIndex]
    : activeFixtureIndex !== undefined ? fixtures[activeFixtureIndex] : undefined;
  async function persist() {
    if (!process.env.TRADE_REGRESSION_UI_OUTPUT) return;
    if (config) for (const row of [...results, ...fixtures]) enrichResultQuality(row, valuation, config);
    const path = process.env.TRADE_REGRESSION_UI_OUTPUT;
    await writeFile(path + ".tmp", JSON.stringify({ schema: "cybergold.trade-regression.v1", suite: privatePhase ? 'independent' : 'sequential',
      ...(isolation ? { isolation } : {}), matrix: matrixCounts, coverage: executionCoverage(results), valuation, scenarios: results, fixtures }, null, 2) + "\n");
    await rename(path + ".tmp", path);
  }
  async function checkpoint(stage: ExecutionStage) {
    const current = activeResult();
    await checkpointExecutionStage(current ? [current] : results, stage, persist);
  }
  await persist();
  try {
  await checkpoint("setup-config");
  config = await readJson<ProtocolConfiguration>(fetcher, "/api/protocol/config");
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    const current = activeResult();
    if (path === "/api/rpc") genericRequests.push(request.url());
    if (current && !activeSwapAttempt && path.startsWith("/api/quotes/")) {
      try {
        if (activeQuoteDiagnostics?.request(path, request.postDataJSON(), request.headers()["x-cybergold-attempt-id"]))
          Object.assign(current, activeQuoteDiagnostics.snapshot());
      } catch { /* Optional diagnostics never alter an ordinary quote request. */ }
    }
    if (path === "/api/diagnostics") {
      const event = request.postDataJSON();
      if (!setupComplete && ["quote", "swap"].includes(event?.operation)) setupRefs = { ...setupRefs, ...safeDiagnosticReferences(event) };
      if (current && !activeSwapAttempt && activeQuoteDiagnostics?.diagnostic(event))
        Object.assign(current, activeQuoteDiagnostics.snapshot());
      if (!activeSwapAttempt && event?.operation === "swap" && event.outcome === "started") activeSwapAttempt = event.attemptId;
      if (current && event?.operation === "swap" && event.attemptId === activeSwapAttempt)
        current.refs = { ...current.refs, ...safeDiagnosticReferences(event) };
      if (event?.operation === "swap" && ["submitted", "succeeded"].includes(event.outcome)
        && event.attemptId === activeSwapAttempt && /^0x[0-9a-f]{64}$/i.test(event.transactionHash ?? "")) helpersHash = event.transactionHash;
    }
  });
  page.on("response", async response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/") && response.status() === 200) successfulReads.add(path);
    if (path.startsWith("/api/quotes/") && response.status() >= 400) {
      console.log("Quote API error:", path, response.status());
    }
  });
  await checkpoint("setup-navigation");
  await page.goto("/en");
  await checkpoint("setup-network-add");
  await addLocalNetwork(page, { chainId, rpcUrl }, "CyberGold Disposable Wallet Fork");
  await checkpoint("setup-network-switch");
  await switchLocalNetwork(page, chainId);
  await checkpoint("setup-connect-request");
  await requestConnection(page);
  await checkpoint("setup-connect-confirm");
  await connectWallet(page);
  await checkpoint("setup-wallet-ready");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible({ timeout: 20000 });
  await checkpoint("setup-accounts");
  const accounts = await page.evaluate(() => (window as unknown as { ethereum: { request: (input: unknown) => Promise<string[]> } }).ethereum.request({ method: "eth_accounts" }));
  const owner = accounts[0] as Address;
  await checkpoint("setup-funding");
  await fundSandboxWallet(owner, fetcher);
  const gasObservation = observeUiGas(page, owner);
  const manifest = process.env.TRADE_REGRESSION_MATRIX && privatePhase !== 'prepare' ? JSON.parse(await readFile(process.env.TRADE_REGRESSION_MATRIX, "utf8")) : undefined;
  valuation = manifest?.valuation ?? await readValuation(config, await readJson<ProtocolFacts>(fetcher, "/api/protocol/facts"), fetcher);
  scenarios.splice(0, scenarios.length, ...privateSandboxScenarios(manifest?.scenarios ?? buildMatrix(config, valuation!), privatePhase, process.env.TRADE_REGRESSION_PRIVATE_SCENARIO));
  results.splice(0, results.length, ...scenarios.map(scenario => ({ ...resultFor(scenario, "execution"), id: `ui-${scenario.id}`, requestedStrategy: "auto" as const, executionAttempted: false, transactionDisposition: "not-submitted" as const,
    ...(isolation && privatePhase !== 'prepare' ? { isolation: scenarioIsolation(isolation, privatePhase === 'alternate' ? 'alternate' : 'winner') } : {}) })));

  async function prepare(sell: string, buy: string, amount: string, side: "sell" | "buy" = "sell", scenario?: MatrixScenario) {
    await checkpoint("ui-prepare-navigation");
    await page.goto("/en");
    await checkpoint("ui-prepare-wallet");
    await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible({ timeout: 20000 });
    await checkpoint("ui-prepare-tokens");
    await showAllSellTokens(page);
    await selectToken(page, "sell", sell);
    await selectToken(page, "buy", buy);
    const editedToken = side === "sell" ? sell : buy;
    await checkpoint("ui-prepare-amount");
    const input = editedToken === "BASKET" ? await ensureBasketInputEditable(page, side) : getMainInput(page, side);
    await input.click();
    await input.fill(amount);
    const quotedSide = side === "sell" ? "buy" : "sell";
    const quotedToken = quotedSide === "buy" ? buy : sell;
    await checkpoint("ui-prepare-quote");
    if (quotedToken === "BASKET") {
      const amounts = page.locator(`#${quotedSide}-basket-composition`).getByRole("button", { name: new RegExp(`^Edit ${quotedSide} amount \\(`) });
      // The funded fixture contains PAXG and XAUt. Quoted basket amounts are
      // buttons, while the editable token side retains its ordinary input.
      await expect(amounts).toHaveCount(2);
      for (const amount of await amounts.all()) {
        await uiPreparationAssertion("ui-quoted-amount-not-ready", () => expect.poll(async () => positiveDisplayedAmount(await amount.innerText(), 18), { timeout: 60000 }).toBe(true));
      }
    } else {
      const decimals = configuredToken(config, quotedToken).decimals;
      await uiPreparationAssertion("ui-quoted-amount-not-ready", () => expect.poll(async () => positiveDisplayedAmount(await getMainInput(page, quotedSide).inputValue(), decimals), { timeout: 60000 }).toBe(true));
    }
    // The existing accordion contains the committed tolerance and exact
    // min/max labels. Expose them without editing the chosen trade intent.
    await checkpoint("ui-prepare-details");
    await openFeeDetails(page);
    await checkpoint("ui-prepare-swap");
    await uiPreparationAssertion("ui-swap-not-enabled", async () => {
      if (!scenario) return expect(await getSwapButton(page)).toBeEnabled({ timeout: 60000 });
      await expect.poll(async () => {
        const matches = (await quoteObservations(page)).filter(row => scenario.asset === "BASKET"
          ? row.path === "/api/quotes/basket-preview" && row.request.mode === `${scenario.side === "buy" ? "issue" : "redeem"}-${scenario.inputMode}`
          : row.path === "/api/quotes/trade/stream" && row.request.side === scenario.side && row.request.mode === scenario.inputMode && row.request.amount === scenario.amountRaw);
        // Observe the original request's terminal within the existing readiness
        // window; do not launch a second provider search or delay product readiness.
        return Boolean(matches.at(-1)?.terminal) && await (await getSwapButton(page)).isEnabled();
      }, { timeout: 60000 }).toBe(true);
    });
  }
  async function releaseUiRequest(result: ScenarioResult) {
    if (helpersHash) result.transactionHash = helpersHash;
    let observed: Awaited<ReturnType<typeof uiSwapObservation>>;
    let contextClosed = false;
    const settled = async () => {
      if (result.transactionHash) return true;
      try { observed = await uiSwapObservation(page, activeSwapAttempt) ?? observed; } catch { /* Retain the last original-attempt observation during context disposal. */ }
      return uiWalletRequestSettled(observed, activeSwapAttempt);
    };
    try {
      const released = await cleanupOwnedWalletRequest(page, settled, value => {
        if (result.uiConfirmation) Object.assign(result.uiConfirmation, value, { requestStage: result.executionStage });
      });
      contextClosed = released.cleanup === "context-closed";
    } finally {
      const remaining = Math.max(0, Math.floor((activeConfirmationDeadline ?? 0) - performance.now()));
      if (!hasUiReceiptOutcome(result)) await recoverUiTransaction(result, activeSwapAttempt, observed, fetcher,
        remaining > 0 ? AbortSignal.timeout(remaining) : AbortSignal.abort());
      if (result.transactionHash) helpersHash = result.transactionHash as Hex;
    }
    // The owning browser resource ended. Let its ordinary teardown error
    // leave the per-case catcher; remaining inventory stays unexercised.
    if (contextClosed) throw walletRequestContextClosedError();
  }
  async function finishUiRequest(result: ScenarioResult, error: unknown) {
    await releaseUiRequest(result);
    if (result.transactionHash && activeConfirmationDeadline !== undefined
      && !await observeUiReceiptUntilDeadline(result, activeConfirmationDeadline, fetcher)) {
      result.transactionDisposition = "unknown";
      if (result.uiConfirmation) result.uiConfirmation.deadlineExpired = true;
      await closeOwnedWalletContext(page, error, value => {
        if (result.uiConfirmation) Object.assign(result.uiConfirmation, value, { requestStage: result.executionStage });
      });
    }
  }
  async function submit(assets: ReturnType<typeof quoteAssets>, mode: "exact-in" | "exact-out") {
    const button = await getSwapButton(page);
    await armUiQuoteCapture(button, assets);
    gasObservation.begin();
    observationPhase = "ui-submit"; await checkpoint(observationPhase);
    const submittedResult = activeResult();
    if (submittedResult) submittedResult.executionAttempted = true;
    const confirmationStarted = performance.now();
    // If the click itself fails after dispatch, this original flow still owns
    // the configured confirmation budget; it never receives a later restart.
    activeConfirmationDeadline = confirmationStarted + 90_000;
    const confirmation: UiConfirmationDiagnostic = { elapsedMs: 0, clickAttempts: 0, clickCompleted: 0 };
    const currentResult = submittedResult;
    if (currentResult) currentResult.uiConfirmation = confirmation;
    try { await button.click(); } catch (error) {
      // A native request can open before Playwright reports a click failure.
      // Release this owned flow even when optional attempt capture never ran.
      try { if (currentResult) await finishUiRequest(currentResult, error); }
      finally { confirmation.elapsedMs = Math.max(0, Math.round(performance.now() - confirmationStarted)); }
      throw error;
    }
    // Retain instrumentation errors, but settle the existing wallet flow first.
    let quote, captureError;
    try {
      clickedSelection = (await selectionCaptures(page)).at(-1);
      activeSwapAttempt = clickedSelection?.attemptId ?? activeSwapAttempt;
      if (activeScenarioIndex !== undefined) {
        requireInvariant(clickedSelection, "selection-not-observed");
        assertMatrixIntent(scenarios[activeScenarioIndex], clickedSelection, config);
        if (clickedSelection.quote) Object.assign(results[activeScenarioIndex], captureSelection(clickedSelection).primary);
        else Object.assign(results[activeScenarioIndex], captureBasketSelection(clickedSelection));
      }
      quote = await capturedUiQuote(page, assets, mode); activeResult()!.uiQuote = quote;
    } catch (error) { captureError = error; }
    observationPhase = "ui-confirmation"; await checkpoint(observationPhase);
    // Normal completion starts its existing 90 s poll here, after click/capture.
    // Later hash/receipt recovery consumes this same window, not a fresh one.
    activeConfirmationDeadline = performance.now() + 90_000;
    let observing = true, readingUi = false;
    try { await approveUntilMined(page, () => Boolean(helpersHash), async () => {
      let terminalFailure: ReturnType<typeof uiSwapTerminalFailure>;
      try {
        const observed = await uiSwapObservation(page, activeSwapAttempt);
        if (observed) {
          activeSwapAttempt = observed.attemptId;
          confirmation.elapsedMs = Math.max(0, Math.round(performance.now() - confirmationStarted));
          if (observed.stage) confirmation.appStage = observed.stage;
          if (observed.outcome) confirmation.appOutcome = observed.outcome;
          if (observed.walletStep) confirmation.walletStep = observed.walletStep;
          if (observed.transactionHash) helpersHash = observed.transactionHash;
          if (activeResult()) activeResult()!.refs = { ...activeResult()!.refs, attemptId: observed.attemptId };
          // A mined receipt and the UI confirmation are separate assertions.
          // Preserve observed settlement even if the toast/card check later fails.
          if (observed.outcome === "succeeded" && observed.transactionHash && activeResult())
            activeResult()!.transactionDisposition = "confirmed";
          if (observed.transactionHash && currentResult && !hasUiReceiptOutcome(currentResult)) {
            const remaining = Math.max(0, Math.floor((activeConfirmationDeadline ?? 0) - performance.now()));
            await recoverUiTransaction(currentResult, activeSwapAttempt, observed, fetcher,
              remaining > 0 ? AbortSignal.timeout(remaining) : AbortSignal.abort());
          }
          terminalFailure = uiSwapTerminalFailure(observed);
        }
      } catch { /* Optional observation cannot interrupt the native flow. */ }
      // Preserve this bound terminal failure outside the optional read catch.
      // Its hash/outcome does not establish independent receipt economics.
      if (terminalFailure) throw terminalFailure;
    }, event => {
      confirmation.elapsedMs = Math.max(0, Math.round(performance.now() - confirmationStarted));
      if (event.selection) Object.assign(confirmation, event.selection);
      if (event.click === "attempted") confirmation.clickAttempts++;
      if (event.click === "completed") confirmation.clickCompleted++;
      if (event.error) Object.assign(confirmation, safeWalletClickError(event.error));
      if (event.view && !readingUi) {
        readingUi = true;
        void readWalletUiState(event.view).then(state => {
          if (observing && state) confirmation.uiState = state;
        }).catch(() => {}).finally(() => { readingUi = false; });
      }
    }); } catch (error) {
      // Finish this original native request before the next case can select
      // another prompt. A late hash is retained; Swap is never clicked again.
      const deadlineExpired = isUiCompletionDeadlineError(error);
      if (deadlineExpired) confirmation.deadlineExpired = true;
      if (currentResult) await finishUiRequest(currentResult, error);
      throw error;
    } finally {
      observing = false;
      confirmation.elapsedMs = Math.max(0, Math.round(performance.now() - confirmationStarted));
    }
    if (captureError) throw captureError;
    requireInvariant(quote, "ui-click-quote-not-observed");
    return quote;
  }
  async function walletPostcheck(before: WalletBalancesSnapshot, result: ScenarioResult) {
    observationPhase = "ui-balance-postchecks"; await checkpoint(observationPhase);
    const after = await fetchWalletBalances(owner, undefined, fetcher, "swap-preflight");
    const quote = result.uiQuote!;
    const observedGas = await readJson<unknown>(fetcher, `/api/transaction/wait/receipt?hash=${helpersHash}`);
    gasObservation.record(observedGas);
    const gas = await gasObservation.finish();
    if ([...quote.input, ...quote.output].some(value => value.type === "native"))
      requireInvariant(ownedReceiptGas(observedGas, owner), "receipt-gas-unavailable");
    result.wallet = walletEvidence(quote, walletAmounts(before, config, quote), walletAmounts(after, config, quote), gas.paid, gas.hashes);
    return async () => {
      assertWalletEconomics(result.wallet!, (result.receipt!.netPaid as string[]).map(BigInt), (result.receipt!.netReceived as string[]).map(BigInt));
      const ids = [...quote.input, ...quote.output].map(amount => config.tokens.find(token => amount.type === "native"
        ? token.type === "native" : token.type === "erc20" && token.address.toLowerCase() === amount.token.toLowerCase())!.id);
      await expectWalletBalanceDisplay(page, ids, after, config);
    };
  }

  if (!privatePhase || privatePhase === 'prepare') {
  // Exercise wallet cancellation with funded collateral. ETH route readiness
  // belongs to its matrix cases, rather than every scenario's shared setup.
  await prepare("PAXG", "CYGLD", "0.25", "buy");
  const beforeRejected = await readWalletBalances(page, ["cygld"]);
  await checkpoint("setup-rejection-submit");
  await (await getSwapButton(page)).click();
  // Product preparation precedes the actual wallet request. Open the native
  // request view when the App reports that request, rather than an empty view.
  await checkpoint("setup-rejection-wallet");
  await expect(await getSwapButton(page)).toHaveText(/^MetaMask \d+ of \d+:/, { timeout: 60000 });
  const rejected = await notification(page);
  await rejected.getByTestId("confirm-footer-cancel-button").or(rejected.locator('.page-container__footer [data-testid="page-container-footer-cancel"]')).click();
  await expect(page.getByText(/^Wallet request cancelled$/i)).toBeVisible({ timeout: 20000 });
  await checkpoint("setup-rejection-postcheck");
  expect((await readWalletBalances(page, ["cygld"])).cygld).toBe(beforeRejected.cygld);
  setupComplete = true;
  await checkpoint("setup-ready");

  // A real setup trade gives redemption cases inventory even when later issue
  // quotes are unavailable. It is separate evidence, never a matrix pass.
  const bootstrap = { ...tradeScenarios.find(scenario => scenario.id === "core-issue-paxg-exact-out")!,
    id: "fixture-cygld-bootstrap", displayAmount: "5" };
  fixtures.push({ ...resultFor(bootstrap, "execution"), requestedStrategy: "auto" });
  activeFixtureIndex = 0; helpersHash = undefined; activeSwapAttempt = undefined;
  try { activeQuoteDiagnostics = createUiQuoteDiagnostics(bootstrap, config); } catch { /* Optional evidence cannot change setup. */ }
  const bootstrapStarted = performance.now(); await persist();
  try {
    observationPhase = "ui-prepare"; await checkpoint(observationPhase);
    await prepare("PAXG", "CYGLD", bootstrap.displayAmount, "buy");
    observationPhase = "ui-balances"; await checkpoint(observationPhase);
    const walletBefore = await fetchWalletBalances(owner, undefined, fetcher, "swap-preflight");
    fixtures[0].code = "execution-not-completed"; await persist();
    const uiQuote = await submit(quoteAssets(bootstrap, config, []), bootstrap.inputMode);
    observationPhase = "ui-hash"; await checkpoint(observationPhase);
    await expect.poll(() => helpersHash, { timeout: 15000 }).toBeTruthy();
    observationPhase = "ui-receipt-read"; await checkpoint(observationPhase);
    const receiptRemaining = Math.max(0, Math.floor((activeConfirmationDeadline ?? 0) - performance.now()));
    const receipt = hasUiReceiptOutcome(fixtures[0]) || receiptRemaining > 0
      ? await fetchTransactionReceipt(helpersHash!, receiptRemaining > 0 ? AbortSignal.timeout(receiptRemaining) : undefined, fetcher) : undefined;
    requireInvariant(receipt, "receipt-unavailable");
    observationPhase = "ui-transaction-read"; await checkpoint(observationPhase);
    const observed = await readJson<{ transaction: { input: Hex; to: string; from: string } | null }>(fetcher, `/api/transaction/wait/transaction?hash=${helpersHash}`);
    requireInvariant(observed.transaction?.to.toLowerCase() === config.contracts.helpers!.toLowerCase()
      && observed.transaction?.from.toLowerCase() === owner.toLowerCase(), "transaction-party-mismatch");
    observationPhase = "ui-receipt-assertions"; await checkpoint(observationPhase);
    const measuredReceipt = observeUiReceipt(bootstrap, config, owner, observed.transaction!.input, receipt,
      BigInt(uiQuote.output[0].amount), [], uiQuote, fixtures[0]);
    const validateWallet = await walletPostcheck(walletBefore, fixtures[0]);
    observationPhase = "ui-receipt-assertions"; await checkpoint(observationPhase); measuredReceipt.validate();
    observationPhase = "ui-balance-postchecks"; await checkpoint(observationPhase); await validateWallet();
  } catch (error) {
    fixtures[0] = { ...uiObservationFailure(fixtures[0], error, observationPhase), ...(helpersHash ? { transactionHash: helpersHash } : {}) };
    fixtures[0].transactionDisposition = transactionDisposition(fixtures[0]);
    if (isWalletRequestCleanupError(error)) {
      fixtures[0].durationMs = Math.round(performance.now() - bootstrapStarted);
      await persist(); throw error;
    }
    if (fixtures[0].executionAttempted) try { await finishUiRequest(fixtures[0], error); }
    catch (failure) { fixtures[0].durationMs = Math.round(performance.now() - bootstrapStarted); await persist(); throw failure; }
  }
  fixtures[0].durationMs = Math.round(performance.now() - bootstrapStarted); await persist();
  activeFixtureIndex = undefined; activeQuoteDiagnostics = undefined; activeSwapAttempt = undefined;
  if (privatePhase === 'prepare') {
    // All compared cases use this post-funding/bootstrap state and these same
    // frozen sizing inputs. Only the host that owns the fork takes its snapshot.
    requireInvariant(fixtures[0].status === 'pass', 'private-sandbox-bootstrap-failed');
    valuation = await readValuation(config, await readJson<ProtocolFacts>(fetcher, '/api/protocol/facts'), fetcher);
    const prepared = { matrix: matrixCounts, valuation, scenarios: buildMatrix(config, valuation), walletAddress: owner };
    if (!process.env.TRADE_REGRESSION_MATRIX) throw new Error('private-sandbox-matrix-output-unavailable');
    await writeFile(process.env.TRADE_REGRESSION_MATRIX, JSON.stringify(prepared, null, 2) + '\n', { mode: 0o600 });
    results.splice(0);
    await persist();
    return;
  }
  } else {
    // Funding and CYGLD bootstrap are already in the owned snapshot. Repeating
    // either here would change the baseline before the measured scenario.
    setupComplete = true;
    await checkpoint('setup-ready');
  }

  if (privatePhase === 'alternate') {
    const scenario = scenarios[0];
    const selectionPath = process.env.TRADE_REGRESSION_PRIVATE_SELECTION;
    const selected: SelectionCapture | undefined = selectionPath ? JSON.parse(await readFile(selectionPath, 'utf8')) : undefined;
    const retainAlternate = async (alternate: NonNullable<ScenarioResult['alternateExecution']>) => {
      alternate.comparisonState = 'restored-baseline';
      if (isolation) alternate.isolation = scenarioIsolation(isolation, 'alternate');
      results[0] = { ...results[0], status: 'skipped', code: 'independent-alternate-only', alternateExecution: alternate };
      await persist();
    };
    const alternate = scenario.asset === 'BASKET' ? { ...notAttemptedAlternate(scenario), provider: 'market' as const, reason: 'unsupported' as const }
      : selected?.quote && selected.intent ? await executeAlternate(selected, scenario, selected.intent, page, owner, config, fetcher, undefined, undefined, 'restored-baseline', retainAlternate)
      : notAttemptedAlternate(scenario);
    await retainAlternate(alternate);
    expect(alternate.status).not.toBe('fail');
    return;
  }

  for (const [index, scenario] of scenarios.entries()) await test.step(`UI ${scenario.id}`, async () => {
    const started = performance.now(); helpersHash = undefined; activeSwapAttempt = undefined; clickedSelection = undefined;
    results[index].alternateExecution = notAttemptedAlternate(scenario);
    if (privatePhase) results[index].alternateExecution.comparisonState = 'restored-baseline';
    activeScenarioIndex = index;
    try { activeQuoteDiagnostics = createUiQuoteDiagnostics(scenario, config); } catch { /* Optional evidence cannot change preparation. */ }
    try {
      observationPhase = "ui-prepare"; await checkpoint(observationPhase);
      if (scenario.sizingError) throw new ScenarioUnavailableError(scenario.sizingError);
      const side = scenario.inputMode === "exact-in" ? "sell" : "buy";
      await prepare(scenario.side === "buy" ? scenario.asset : "CYGLD", scenario.side === "buy" ? "CYGLD" : scenario.asset, scenario.displayAmount, side, scenario);
      observationPhase = "ui-facts"; await checkpoint(observationPhase);
      const basket = scenario.asset === "BASKET" ? basketFacts(await readJson<ProtocolFacts>(fetcher, "/api/protocol/facts")).assets : [];
      const basketTokens = basket.map(address => config.tokens.find(token => token.type === "erc20" && token.address.toLowerCase() === address.toLowerCase())!);
      const ids = scenario.asset === "BASKET" ? basketTokens.map(token => token.id) : [configuredToken(config, scenario.asset).id];
      observationPhase = "ui-balances"; await checkpoint(observationPhase);
      await readWalletBalances(page, [...ids, "cygld"]);
      const walletBefore = await fetchWalletBalances(owner, undefined, fetcher, "swap-preflight");
      helpersHash = undefined;
      results[index].code = "execution-not-completed"; await persist();
      const uiQuote = await submit(quoteAssets(scenario, config, basket), scenario.inputMode);
      const entered = scenario.inputMode === "exact-in" ? uiQuote.input : uiQuote.output;
      const userAmount = BigInt(entered[0].amount);
      const basketAmounts = scenario.asset === "BASKET" ? entered.map(value => BigInt(value.amount)) : [];
      observationPhase = "ui-hash"; await checkpoint(observationPhase);
      await expect.poll(() => helpersHash, { timeout: 15000 }).toBeTruthy();
      observationPhase = "ui-receipt-read"; await checkpoint(observationPhase);
      const receiptRemaining = Math.max(0, Math.floor((activeConfirmationDeadline ?? 0) - performance.now()));
      const receipt = hasUiReceiptOutcome(results[index]) || receiptRemaining > 0
        ? await fetchTransactionReceipt(helpersHash!, receiptRemaining > 0 ? AbortSignal.timeout(receiptRemaining) : undefined, fetcher) : undefined;
      requireInvariant(receipt, "receipt-unavailable");
      observationPhase = "ui-transaction-read"; await checkpoint(observationPhase);
      const observed = await readJson<{ transaction: { input: Hex; to: string; from: string } | null }>(fetcher, `/api/transaction/wait/transaction?hash=${helpersHash}`);
      requireInvariant(observed.transaction?.to.toLowerCase() === config.contracts.helpers!.toLowerCase() && observed.transaction?.from.toLowerCase() === owner.toLowerCase(), "transaction-party-mismatch");
      observationPhase = "ui-receipt-assertions"; await checkpoint(observationPhase);
      const measuredReceipt = observeUiReceipt(scenario, config, owner, observed.transaction!.input, receipt, userAmount, basketAmounts, uiQuote, results[index]);
      const submittedSelection = clickedSelection as SelectionCapture | undefined;
      if (submittedSelection?.quote) await assertCapturedTradeInput(submittedSelection, observed.transaction!.input, owner);
      const receiptSelection = clickedSelection as SelectionCapture | undefined;
      if (receiptSelection?.quote) requireInvariant(results[index].actualStrategy === receiptSelection.quote.strategy, "captured-provider-mismatch");
      const validateWallet = await walletPostcheck(walletBefore, results[index]);
      observationPhase = "ui-receipt-assertions"; await checkpoint(observationPhase); measuredReceipt.validate();
      observationPhase = "ui-balance-postchecks"; await checkpoint(observationPhase); await validateWallet();
      results[index].transactionDisposition = "confirmed";
    } catch (error) {
      results[index] = { ...uiObservationFailure(results[index], error, observationPhase), ...(helpersHash ? { transactionHash: helpersHash } : {}) };
      results[index].transactionDisposition = transactionDisposition(results[index]);
      if (isWalletRequestCleanupError(error)) { results[index].durationMs = Math.round(performance.now() - started); await persist(); throw error; }
      // A display/receipt assertion may fail after native submission. Recover
      // its original receipt identity without changing the failed assertion.
      if (results[index].executionAttempted) try { await finishUiRequest(results[index], error); }
      catch (failure) { results[index].durationMs = Math.round(performance.now() - started); await persist(); throw failure; }
    }
    results[index].transactionDisposition = transactionDisposition(results[index]);
    // Winner latency ends before the separately measured alternate attempt.
    results[index].durationMs = Math.round(performance.now() - started);
    const selected = clickedSelection as SelectionCapture | undefined;
    let observations: Awaited<ReturnType<typeof quoteObservations>> = [];
    try { observations = await quoteObservations(page); } catch { /* Optional evidence cannot stop the remaining cases. */ }
    if (scenario.asset !== "BASKET" && !selected?.quote) {
      const request = observations.filter(row => row.path === "/api/quotes/trade/stream" && row.request.side === scenario.side && row.request.mode === scenario.inputMode && row.request.amount === scenario.amountRaw).at(-1);
      if (request) results[index].providers = providerSummaries(observedProviderEvidence(request));
    }
    if (selected?.quote && selected.intent) {
      const binding = captureSelection(selected).primary;
      // Receipt context and actual encoded bounds remain settlement evidence;
      // each provider summary separately retains its captured quotation context.
      const settlement = results[index].actualOperation ? { context: results[index].context, bounds: results[index].bounds } : {};
      const refs = { ...binding.refs, ...results[index].refs };
      Object.assign(results[index], binding, settlement, { refs });
      if (!privatePhase) results[index].alternateExecution = await executeAlternate(selected, scenario, selected.intent, page, owner, config, fetcher, undefined, results[index].transactionDisposition, 'sequential-state', async alternate => {
        results[index].alternateExecution = alternate;
        await persist();
      });
    } else if (scenario.asset === "BASKET") {
      results[index].providers = observedBasketProviderEvidence(observations, scenario, config.contracts.core ?? undefined);
      results[index].alternateExecution = { ...notAttemptedAlternate(scenario), provider: "market", reason: "unsupported" };
      if (privatePhase) results[index].alternateExecution.comparisonState = 'restored-baseline';
      results[index].selectedProvider = results[index].providers.core.availability === "qualified" ? "core" : undefined;
      if (selected) Object.assign(results[index], captureBasketSelection(selected));
    }
    if (privatePhase === 'winner' && process.env.TRADE_REGRESSION_PRIVATE_SELECTION) {
      // Unsigned retained quotes stay in the private fixture workspace. The
      // normal safe report projection is the only monitoring artifact.
      const captured = selected ?? privateSandboxSelection(observations, scenario, config);
      await writeFile(process.env.TRADE_REGRESSION_PRIVATE_SELECTION, JSON.stringify(captured ?? null) + '\n', { mode: 0o600 });
    }
    activeScenarioIndex = undefined; activeQuoteDiagnostics = undefined; activeSwapAttempt = undefined;
    await persist();
  });
  expect(genericRequests).toEqual([]);
  expect(successfulReads.has("/api/account/wallet-balances")).toBe(true);
  console.log(JSON.stringify({ genericAppRpcRequests: genericRequests.length, successfulFixedApiPaths: [...successfulReads].sort() }));
  expect(results.filter(result => result.alternateExecution?.status === "fail").map(result => result.id)).toEqual([]);
  expect(results.filter(result => result.status !== "pass").map(result => ({ id: result.id, status: result.status, code: result.code }))).toEqual([]);
  } catch (error) {
    if (!setupComplete) for (const [index, result] of results.entries()) results[index] = {
      ...failureResult({ ...result, refs: { ...result.refs, ...setupRefs } }, error),
      code: error instanceof errors.TimeoutError ? "ui-setup-timeout" : "ui-setup-failed",
    };
    await persist();
    throw error;
  }
});
