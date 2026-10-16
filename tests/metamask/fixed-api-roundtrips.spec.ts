import { errors, type Page } from "@playwright/test";
import { expect, test } from "./testWithMetaMask";
import { addLocalNetwork, connectWallet, notification, requestConnection, switchLocalNetwork } from "./wallet-ui";
import { ensureBasketInputEditable, getMainInput, getSwapButton, openFeeDetails, parseAmount, readWalletBalances, selectToken, showAllSellTokens } from "./token-flows/helpers";
import { writeFile, rename } from "node:fs/promises";
import { type Address, type Hex } from "viem";
import { tradeScenarios, configuredToken, basketFacts } from "../trading/scenarios";
import { checkpointExecutionStage, failureResult, originFetch, readJson, requireInvariant, resultFor, type ExecutionStage, type ScenarioResult, type UiObservationPhase } from "../trading/regression";
import { observeUiReceipt } from "../trading/uiReceipt";
import { armUiQuoteCapture, capturedUiQuote, quoteAssets } from "../trading/uiQuoteCapture";
import { assertWalletEconomics, walletAmounts, walletEvidence } from "../trading/uiEconomics";
import { observeUiGas, ownedReceiptGas } from "../trading/uiGas";
import { fetchWalletBalances, type WalletBalancesSnapshot } from "../../app/utils/walletBalanceSnapshot";
import { fundSandboxWallet } from "../trading/sandboxFunding";
import { fetchTransactionReceipt } from "../../app/utils/transactionReceipt";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration";
import type { ProtocolFacts } from "../../app/utils/protocolFacts";
import { safeDiagnosticReferences } from "../../app/utils/diagnosticReferences";
import { confirmedTransactionText, createUiQuoteDiagnostics, uiCompletionAssertion, uiObservationFailure, uiPreparationAssertion } from "../trading/uiDiagnostics";

async function approveUntilMined(page: Page, submitted: () => boolean) {
  const success = confirmedTransactionText(page);
  const failure = page.getByText(/^Transaction failed$/i);
  let openedStep = "";
  await uiCompletionAssertion(() => expect.poll(async () => {
    if (await failure.isVisible()) throw new Error((await page.locator("[data-sonner-toast]").allTextContents()).join(" | "));
    if (await success.isVisible()) return true;
    const step = await (await getSwapButton(page)).innerText();
    if (!/^MetaMask \d+ of \d+:/.test(step)) return false;
    let popup = page.context().pages().find(candidate => candidate.url().includes("notification.html"));
    if (step !== openedStep || !popup) {
      popup = await notification(page);
      openedStep = step;
    }
    if (popup) {
      // Current extension controls for transaction and typed-signature requests.
      const confirm = popup.getByTestId("confirm-footer-button").or(popup.getByTestId("confirm-btn"));
      // A native request can navigate or close between polls. Let one click
      // check visibility/enabled state atomically, then re-read the App result.
      try {
        await confirm.click({ timeout: 1000 });
      } catch (error) {
        if (!(error instanceof errors.TimeoutError) && !popup.isClosed()) throw error;
      }
    }
    return false;
  }, { timeout: 90000, intervals: [250, 500, 1000] }).toBe(true), submitted);
}

async function balancesAfter(page: Page, ids: string[], accept: (value: Record<string, number>) => boolean) {
  let balances: Record<string, number> = {};
  await expect.poll(async () => {
    balances = await readWalletBalances(page, ids);
    return accept(balances);
  }, { timeout: 30000, intervals: [250, 500, 1000] }).toBe(true);
  return balances;
}

// Run with the disposable local protocol/backend fixture described in the E2E
// guide. MetaMask signs only against the fixture's independently owned Anvil.
// Responses are real fixed API reads, not intercepted product/receipt fixtures.
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
  let setupComplete = false;
  let setupRefs = {};
  const scenarios = tradeScenarios.filter(scenario => scenario.requestedStrategy === "core");
  const results: ScenarioResult[] = scenarios.map(scenario => ({ ...resultFor(scenario, "execution"), id: `ui-${scenario.id}`, requestedStrategy: "auto" }));
  const fixtures: ScenarioResult[] = [];
  const activeResult = () => activeScenarioIndex !== undefined ? results[activeScenarioIndex]
    : activeFixtureIndex !== undefined ? fixtures[activeFixtureIndex] : undefined;
  async function persist() {
    if (!process.env.TRADE_REGRESSION_UI_OUTPUT) return;
    const path = process.env.TRADE_REGRESSION_UI_OUTPUT;
    await writeFile(path + ".tmp", JSON.stringify({ schema: "cybergold.trade-regression.v1", scenarios: results, fixtures }, null, 2) + "\n");
    await rename(path + ".tmp", path);
  }
  async function checkpoint(stage: ExecutionStage) {
    const current = activeResult();
    await checkpointExecutionStage(current ? [current] : results, stage, persist);
  }
  await persist();
  try {
  await checkpoint("setup-config");
  const config = await readJson<ProtocolConfiguration>(fetcher, "/api/protocol/config");
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
      if (event?.operation === "swap" && event.outcome === "started") activeSwapAttempt = event.attemptId;
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

  async function prepare(sell: string, buy: string, amount: string, side: "sell" | "buy" = "sell") {
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
        await uiPreparationAssertion("ui-quoted-amount-not-ready", () => expect.poll(async () => parseAmount(await amount.innerText()), { timeout: 60000 }).toBeGreaterThan(0));
      }
    } else {
      await uiPreparationAssertion("ui-quoted-amount-not-ready", () => expect.poll(async () => Number(await getMainInput(page, quotedSide).inputValue()), { timeout: 60000 }).toBeGreaterThan(0));
    }
    // The existing accordion contains the committed tolerance and exact
    // min/max labels. Expose them without editing the chosen trade intent.
    await checkpoint("ui-prepare-details");
    await openFeeDetails(page);
    await checkpoint("ui-prepare-swap");
    await uiPreparationAssertion("ui-swap-not-enabled", async () => expect(await getSwapButton(page)).toBeEnabled({ timeout: 60000 }));
  }
  async function submit(assets: ReturnType<typeof quoteAssets>, mode: "exact-in" | "exact-out") {
    const button = await getSwapButton(page);
    await armUiQuoteCapture(button, assets);
    gasObservation.begin();
    observationPhase = "ui-submit"; await checkpoint(observationPhase);
    await button.click();
    // A failed observation must not leave an already-open wallet request
    // unhandled. Complete the one existing submission before reporting it.
    let quote, captureError;
    try { quote = await capturedUiQuote(page, assets, mode); activeResult()!.uiQuote = quote; }
    catch (error) { captureError = error; }
    observationPhase = "ui-confirmation"; await checkpoint(observationPhase);
    await approveUntilMined(page, () => Boolean(helpersHash));
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
    return () => assertWalletEconomics(result.wallet!, (result.receipt!.netPaid as string[]).map(BigInt), (result.receipt!.netReceived as string[]).map(BigInt));
  }

  await prepare("ETH", "CYGLD", "0.25", "buy");
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
  const bootstrap = { ...scenarios.find(scenario => scenario.id === "core-issue-paxg-exact-out")!,
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
    const receipt = await fetchTransactionReceipt(helpersHash!, undefined, fetcher);
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
    observationPhase = "ui-balance-postchecks"; await checkpoint(observationPhase); validateWallet();
  } catch (error) { fixtures[0] = { ...uiObservationFailure(fixtures[0], error, observationPhase), ...(helpersHash ? { transactionHash: helpersHash } : {}) }; }
  fixtures[0].durationMs = Math.round(performance.now() - bootstrapStarted); await persist();
  activeFixtureIndex = undefined; activeQuoteDiagnostics = undefined; activeSwapAttempt = undefined;

  for (const [index, scenario] of scenarios.entries()) await test.step(`UI ${scenario.id}`, async () => {
    const started = performance.now(); helpersHash = undefined; activeSwapAttempt = undefined;
    activeScenarioIndex = index;
    try { activeQuoteDiagnostics = createUiQuoteDiagnostics(scenario, config); } catch { /* Optional evidence cannot change preparation. */ }
    try {
      observationPhase = "ui-prepare"; await checkpoint(observationPhase);
      const side = scenario.inputMode === "exact-in" ? "sell" : "buy";
      await prepare(scenario.side === "buy" ? scenario.asset : "CYGLD", scenario.side === "buy" ? "CYGLD" : scenario.asset, scenario.displayAmount, side);
      observationPhase = "ui-facts"; await checkpoint(observationPhase);
      const basket = scenario.asset === "BASKET" ? basketFacts(await readJson<ProtocolFacts>(fetcher, "/api/protocol/facts")).assets : [];
      const basketTokens = basket.map(address => config.tokens.find(token => token.type === "erc20" && token.address.toLowerCase() === address.toLowerCase())!);
      const ids = scenario.asset === "BASKET" ? basketTokens.map(token => token.id) : [configuredToken(config, scenario.asset).id];
      observationPhase = "ui-balances"; await checkpoint(observationPhase);
      const before = await readWalletBalances(page, [...ids, "cygld"]);
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
      const receipt = await fetchTransactionReceipt(helpersHash!, undefined, fetcher);
      requireInvariant(receipt, "receipt-unavailable");
      observationPhase = "ui-transaction-read"; await checkpoint(observationPhase);
      const observed = await readJson<{ transaction: { input: Hex; to: string; from: string } | null }>(fetcher, `/api/transaction/wait/transaction?hash=${helpersHash}`);
      requireInvariant(observed.transaction?.to.toLowerCase() === config.contracts.helpers!.toLowerCase() && observed.transaction?.from.toLowerCase() === owner.toLowerCase(), "transaction-party-mismatch");
      observationPhase = "ui-receipt-assertions"; await checkpoint(observationPhase);
      const measuredReceipt = observeUiReceipt(scenario, config, owner, observed.transaction!.input, receipt, userAmount, basketAmounts, uiQuote, results[index]);
      const validateWallet = await walletPostcheck(walletBefore, results[index]);
      observationPhase = "ui-receipt-assertions"; await checkpoint(observationPhase); measuredReceipt.validate();
      observationPhase = "ui-balance-postchecks"; await checkpoint(observationPhase); validateWallet();
      observationPhase = "ui-balance-postchecks"; await checkpoint(observationPhase);
      await balancesAfter(page, [...ids, "cygld"], after => scenario.side === "buy"
        ? after.cygld > before.cygld && ids.some(id => after[id] < before[id])
        // Native gas can exceed a small ETH delivery. Its received trade
        // amount is already proved by the gas-adjusted integer wallet check.
        : after.cygld < before.cygld && (scenario.asset === "ETH" || ids.some(id => after[id] > before[id])));
    } catch (error) { results[index] = { ...uiObservationFailure(results[index], error, observationPhase), ...(helpersHash ? { transactionHash: helpersHash } : {}) }; }
    activeScenarioIndex = undefined; activeQuoteDiagnostics = undefined; activeSwapAttempt = undefined;
    results[index].durationMs = Math.round(performance.now() - started); await persist();
  });
  expect(genericRequests).toEqual([]);
  expect(successfulReads.has("/api/account/wallet-balances")).toBe(true);
  console.log(JSON.stringify({ genericAppRpcRequests: genericRequests.length, successfulFixedApiPaths: [...successfulReads].sort() }));
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
