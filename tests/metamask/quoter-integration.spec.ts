import { chromium, errors, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { decodeFunctionData, formatUnits, zeroAddress, type Address, type Hex } from "viem";
import { expect, test } from "./testWithMetaMask";
import { addLocalNetwork, connectWallet, notification, requestConnection, switchLocalNetwork, walletRequestButton } from "./wallet-ui";
import { getMainInput, getSwapButton, selectToken, showAllSellTokens } from "./token-flows/helpers";
import type { EconomicQuote, PreparedTransaction } from "../../app/utils/economicQuotes";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration";
import { exactInputPlan, type ExactInputPlan } from "../../app/utils/universalExactInput";
import { HELPERS_EXECUTION_ABI } from "../../app/contracts/cybergold-helpers/execution";
import { fetchTransactionReceipt } from "../../app/utils/transactionReceipt";
import { tradeReceipt } from "../../app/utils/tradeReceipt";
import { fetchWalletBalances } from "../../app/utils/walletBalanceSnapshot";
import { formatMeaningfulDecimalString } from "../../app/utils/formatting";
import { originFetch, readJson, RegressionAssertionError, requireInvariant, type ScenarioResult } from "../trading/regression";
import { type Scenario } from "../trading/scenarios";
import { armUiQuoteCapture, capturedUiQuote, displayedUiAmount, quoteAssets } from "../trading/uiQuoteCapture";
import { observeUiReceipt } from "../trading/uiReceipt";
import { assertWalletEconomics, positiveDisplayedAmount, walletAmounts, walletEvidence } from "../trading/uiEconomics";
import { ownedReceiptGas } from "../trading/uiGas";
import { installSelectionCapture, selectionCaptures } from "../trading/providerEvidence";
import { installUiSwapObservation, uiSwapObservation } from "../trading/uiSwapObservation";
import { cleanupOwnedWalletRequest } from "../trading/walletRequestLifecycle";
import { uiWalletRequestSettled } from "../trading/uiTransactionRecovery";
import { safeRunnerError } from "../trading/runnerDiagnostics";

type ObservedQuote = EconomicQuote & { observation: { source: "stored" | "search"; refresh: boolean } };
type PreparationPayload = { quote: EconomicQuote; sender: Address; recipient: Address; slippageBps?: number };
type Preparation = { request: PreparationPayload; value: PreparedTransaction; responseEndAt: number };
type WalletSubmissionStep = "approval" | "signature" | "transaction";
type TimelineRow = { operation: string; walletStep: WalletSubmissionStep; attemptId?: string; at: number };
type TimelineWindow = Window & { __quoterIntegrationTimeline?: TimelineRow[] };

/** Stable semantic comparison; compiled bytes/signatures never enter the report. */
function digest(value: unknown): string {
  const canonical = (item: unknown): unknown => typeof item === "bigint" ? String(item)
    : typeof item === "string" && item.startsWith("0x") ? item.toLowerCase()
      : Array.isArray(item) ? item.map(canonical) : item && typeof item === "object"
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function economicTuple(value: ObservedQuote) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "observation"));
}

function observeHttp(page: Page) {
  const economic: ObservedQuote[] = [], preparations: Preparation[] = [];
  const pending = new Set<Promise<void>>();
  const counts = { economic: 0, preparation: 0 };
  const failures: { path: string; status: number; code?: string }[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/economic-quotes") counts.economic++;
    if (path === "/api/tx-preparations") counts.preparation++;
  });
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (!["/api/economic-quotes", "/api/tx-preparations"].includes(path)) return;
    const task = (async () => {
      const value = await response.json();
      if (!response.ok()) {
        failures.push({ path, status: response.status(), ...(typeof value.code === "string" ? { code: value.code } : {}) });
        return;
      }
      await response.finished();
      if (path === "/api/economic-quotes") economic.push(value);
      else {
        const timing = response.request().timing();
        preparations.push({ request: response.request().postDataJSON(), value,
          responseEndAt: timing.startTime + timing.responseEnd });
      }
    })().catch(() => { /* A missing observation remains a failed readiness assertion. */ });
    pending.add(task); void task.finally(() => pending.delete(task));
  });
  return { economic, preparations, counts, failures, async settled() { await Promise.allSettled([...pending]); } };
}

function installTimeline(scope: TimelineWindow = window) {
  scope.__quoterIntegrationTimeline = [];
  scope.addEventListener("cybergold:diagnostic", event => {
    const value = (event as CustomEvent).detail;
    if (value?.operation !== "wallet" || value.outcome !== "requested") return;
    // These are the requestNext producers' authorization/submission steps.
    // Passive account/chain observations do not establish wallet ordering.
    if (!["approval", "signature", "transaction"].includes(value.walletStep)) return;
    scope.__quoterIntegrationTimeline!.push({ operation: "wallet", walletStep: value.walletStep as WalletSubmissionStep,
      attemptId: value.attemptId, at: performance.timeOrigin + performance.now() });
  });
}

const nativeScenario: Scenario = { id: "quoter-two-browser-native", family: "issue-token", requestedStrategy: "core",
  side: "buy", asset: "ETH", inputMode: "exact-in", displayAmount: "0.01", amountRaw: "10000000000000000" };

test.skip(!process.env.TRADE_REGRESSION_SECOND_API_URL,
  "This combined native-wallet case uses the owned qualifier's second real API process.");

test("two browsers share economic quotes and preserve the selected plan through real MetaMask swaps", async ({ page }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(15_000);
  const baseURL = process.env.PLAYWRIGHT_BASE_URL!;
  const api2URL = process.env.TRADE_REGRESSION_SECOND_API_URL!;
  const fetcher = originFetch(baseURL);
  const report: { schema: string; result: "running" | "pass" | "fail"; stage: string;
    scope: string; receipts: ScenarioResult[]; [key: string]: unknown } = {
    schema: "cybergold.quoter-integration.v1", result: "running", stage: "configuration",
    scope: "two independent Chromium processes; actual economic/preparation APIs, MetaMask signing and owned-fork receipts",
    receipts: [], nativeWalletMode: "native input with real MetaMask transaction confirmation",
    otherWalletModes: "existing registered wallet profile and separately reported fixture coverage",
    api2Transport: "Only economic-quotes and tx-preparations use unchanged actual API2 responses; other requests retain normal App/API1 forwarding.",
  };
  async function persist(stage?: string) {
    if (stage) report.stage = stage;
    const output = process.env.TRADE_REGRESSION_QUOTER_INTEGRATION_OUTPUT;
    if (!output) return;
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output + ".tmp", JSON.stringify(report, null, 2) + "\n");
    await rename(output + ".tmp", output);
  }
  async function assertion(code: string, operation: () => Promise<unknown>) {
    try { await operation(); }
    catch (error) { report.failurePredicate = code; throw error; }
  }
  let secondBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const a = observeHttp(page);
  let b: ReturnType<typeof observeHttp> | undefined;
  try {
    await persist();
    const config = await readJson<ProtocolConfiguration>(fetcher, "/api/protocol/config");
    requireInvariant(config.chainId === 31338, "quoter-integration-owned-fork-chain-mismatch");
    await page.addInitScript(installSelectionCapture as () => void);
    await page.addInitScript(installUiSwapObservation as () => void);
    await page.addInitScript(installTimeline as () => void);
    await page.goto("/en");
    await persist("native-wallet-connection");
    await addLocalNetwork(page, { chainId: config.chainId, rpcUrl: process.env.NEXT_PUBLIC_WALLET_RPC_URL! }, "CyberGold Quoter Integration");
    await switchLocalNetwork(page, config.chainId);
    await requestConnection(page); await connectWallet(page);
    await assertion("quoter-integration-wallet-menu-not-visible", () => expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible());
    const accounts = await page.evaluate(() => (window as unknown as { ethereum: {
      request(input: unknown): Promise<string[]> } }).ethereum.request({ method: "eth_accounts" }));
    const owner = accounts[0] as Address;

    async function enterNativeIntent(target: Page) {
      await assertion("quoter-integration-native-intent-entry-failed", async () => {
        await showAllSellTokens(target);
        await selectToken(target, "sell", "ETH"); await selectToken(target, "buy", "CYGLD");
        await getMainInput(target, "sell").click(); await getMainInput(target, "sell").fill(nativeScenario.displayAmount);
        await expect.poll(async () => positiveDisplayedAmount(await displayedUiAmount(getMainInput(target, "buy")), 18),
          { timeout: 60_000 }).toBe(true);
      });
    }
    const matches = (value: ObservedQuote) => value.request.intent === 0 && value.request.inputs.length === 1
      && value.request.inputs[0].currency.toLowerCase() === zeroAddress
      && value.request.inputs[0].amount === nativeScenario.amountRaw
      && value.request.outputCurrency.toLowerCase() === config.contracts.core!.toLowerCase();
    await persist("browser-a-economic-search");
    await enterNativeIntent(page);
    await assertion("quoter-integration-first-economic-response-unavailable", () => expect.poll(() => a.economic.some(matches), { timeout: 60_000 }).toBe(true));
    let original = a.economic.filter(matches).at(-1)!;
    report.initialSource = original.observation.source;
    if (original.observation.source === "stored") {
      const before = a.economic.length;
      await page.locator("[data-trade-refresh]").click();
      await assertion("quoter-integration-browser-a-refresh-response-unavailable", () => expect.poll(() => a.economic.length, { timeout: 60_000 }).toBeGreaterThan(before));
      original = a.economic.filter(matches).at(-1)!;
      report.browserAExplicitRefreshForExistingObservation = true;
    }
    requireInvariant(original.observation.source === "search", "quoter-integration-first-search-not-observed");
    requireInvariant(a.counts.preparation === 0, "quoter-integration-browsing-prepared-transaction");
    const originalDisplay = formatMeaningfulDecimalString(formatUnits(BigInt(original.quotedOutput), 18), "en");
    await assertion("quoter-integration-browser-a-displays-fast-estimate-instead-of-quote", () => expect.poll(() => displayedUiAmount(getMainInput(page, "buy"))).toBe(originalDisplay));
    report.original = { context: original.context, quotedOutput: original.quotedOutput, selectedPlanSha256: digest(original.plan) };

    await persist("browser-b-shared-lookup");
    secondBrowser = await chromium.launch({ channel: "chromium", headless: true });
    const secondContext = await secondBrowser.newContext();
    const second = await secondContext.newPage();
    b = observeHttp(second);
    for (const path of ["/api/economic-quotes", "/api/tx-preparations"]) {
      await second.route(`**${path}`, async route => {
        const originalURL = new URL(route.request().url());
        const response = await route.fetch({ url: new URL(originalURL.pathname + originalURL.search, api2URL).href });
        await route.fulfill({ response });
      });
    }
    await second.goto(new URL("/en", baseURL).href); await enterNativeIntent(second);
    await assertion("quoter-integration-second-economic-response-unavailable", () => expect.poll(() => b!.economic.some(matches), { timeout: 60_000 }).toBe(true));
    const restored = b.economic.filter(matches).at(-1)!;
    requireInvariant(restored.observation.source === "stored", "quoter-integration-second-api-did-not-use-storage");
    requireInvariant(digest(economicTuple(restored)) === digest(economicTuple(original)), "quoter-integration-shared-economic-tuple-changed");
    await assertion("quoter-integration-browser-b-does-not-display-stored-output", () => expect.poll(() => displayedUiAmount(getMainInput(second, "buy"))).toBe(originalDisplay));
    requireInvariant(b.counts.preparation === 0, "quoter-integration-anonymous-browser-prepared-transaction");
    report.sharedLookup = { source: restored.observation.source, completeEconomicTupleIdentical: true, browserWalletConnected: false };

    async function submitSelected(label: string) {
      await persist(label + ":product-swap");
      const feeControl = page.getByRole("button", { name: /Total Fee/i });
      if (await feeControl.getAttribute("aria-expanded") !== "true") await feeControl.click();
      const button = await getSwapButton(page);
      await assertion("quoter-integration-product-swap-not-enabled", () => expect(button).toBeEnabled({ timeout: 60_000 }));
      const assets = quoteAssets(nativeScenario, config, []);
      await armUiQuoteCapture(button, assets);
      const walletBefore = await fetchWalletBalances(owner, undefined, fetcher, "swap-preflight");
      const preparedBefore = a.preparations.length;
      const previousAttempt = (await uiSwapObservation(page))?.attemptId;
      let attempt: string | undefined, hash: Hex | undefined;
      try {
        await button.click();
        await assertion("quoter-integration-product-attempt-unavailable", () => expect.poll(async () => {
          const observed = await uiSwapObservation(page);
          if (observed?.attemptId !== previousAttempt) attempt = observed?.attemptId;
          return Boolean(attempt);
        }).toBe(true));
        const selected = (await selectionCaptures(page)).findLast(row => row.attemptId === attempt)?.economicQuote;
        requireInvariant(selected, "quoter-integration-click-selection-unavailable");
        requireInvariant(digest(selected.plan) === digest(original.plan), "quoter-integration-product-replaced-original-plan");
        requireInvariant(digest(selected.context) === digest(original.context), "quoter-integration-product-replaced-original-context");
        await assertion("quoter-integration-native-wallet-completion-unavailable", () => expect.poll(async () => {
          const observed = await uiSwapObservation(page, attempt);
          if (observed?.transactionHash) hash = observed.transactionHash;
          if (observed?.outcome === "succeeded" && hash) return true;
          if (["failed", "reverted"].includes(observed?.outcome ?? "")) throw new RegressionAssertionError("quoter-integration-product-swap-failed");
          const recheck = page.getByRole("button", { name: /^Check confirmation$/i });
          if (await recheck.isVisible() && await recheck.isEnabled()) { await recheck.click({ timeout: 1000 }); return false; }
          if (!/^MetaMask \d+ of \d+:/.test(await button.innerText())) return false;
          const popup = await notification(page, undefined, walletRequestButton);
          try { await walletRequestButton(popup).click({ timeout: 1000 }); }
          catch (error) { if (!(error instanceof errors.TimeoutError) && !popup.isClosed()) throw error; }
          return false;
        }, { timeout: 90_000, intervals: [250, 500, 1000] }).toBe(true));
      } catch (error) {
        await cleanupOwnedWalletRequest(page, async () => uiWalletRequestSettled(await uiSwapObservation(page, attempt), attempt));
        throw error;
      }
      requireInvariant(hash, "quoter-integration-product-transaction-hash-unavailable");
      await a.settled();
      requireInvariant(a.preparations.length === preparedBefore + 1, "quoter-integration-product-preparation-count-mismatch");
      const prepared = a.preparations.at(-1)!;
      requireInvariant(digest(prepared.request.quote.plan) === digest(original.plan), "quoter-integration-preparation-replaced-original-plan");
      requireInvariant(digest(prepared.request.quote.context) === digest(original.context), "quoter-integration-preparation-replaced-original-context");
      const timeline = await page.evaluate(id => (window as TimelineWindow).__quoterIntegrationTimeline?.filter(row => row.attemptId === id) ?? [], attempt);
      requireInvariant(timeline.length > 0, "quoter-integration-wallet-authorization-observation-unavailable");
      requireInvariant(timeline.every(row => row.at >= prepared.responseEndAt), "quoter-integration-wallet-authorization-preceded-preparation");
      const uiQuote = await capturedUiQuote(page, assets, "exact-in");
      const minimum = BigInt(original.quotedOutput) * BigInt(10_000 - uiQuote.toleranceBps) / 10_000n;
      requireInvariant(BigInt(prepared.value.outputMinimum) === minimum, "quoter-integration-original-minimum-not-preserved");
      requireInvariant(digest(prepared.value.plan.inputs) === digest(original.inputs), "quoter-integration-prepared-funding-changed");
      requireInvariant(digest(prepared.value.deployment) === digest(original.deployment), "quoter-integration-prepared-deployment-changed");
      await persist(label + ":receipt-and-wallet");
      const receipt = await fetchTransactionReceipt(hash, AbortSignal.timeout(30_000), fetcher);
      requireInvariant(receipt, "quoter-integration-receipt-unavailable");
      const observed = await readJson<{ transaction: { input: Hex; from: string; to: string } | null }>(fetcher,
        `/api/transaction/wait/transaction?hash=${hash}`);
      requireInvariant(observed.transaction?.from.toLowerCase() === owner.toLowerCase(), "quoter-integration-transaction-payer-mismatch");
      requireInvariant(observed.transaction.to.toLowerCase() === prepared.value.deployment.helpers.toLowerCase(), "quoter-integration-transaction-helpers-mismatch");
      const decoded = decodeFunctionData({ abi: HELPERS_EXECUTION_ABI, data: observed.transaction.input });
      requireInvariant(decoded.functionName === "executeExactInput", "quoter-integration-transaction-operation-mismatch");
      requireInvariant(digest((decoded.args as unknown as [ExactInputPlan])[0]) === digest(exactInputPlan(prepared.value.plan)),
        "quoter-integration-mined-plan-differs-from-preparation");
      const measured = tradeReceipt(receipt.logs, prepared.value.deployment.helpers as Address, owner, "universal", zeroAddress);
      requireInvariant(measured, "quoter-integration-aggregate-event-unavailable");
      requireInvariant(measured.amountOut === BigInt(prepared.value.quotedOutput), "quoter-integration-exact-prepared-output-mismatch");
      requireInvariant(measured.protocolFeeCygld === BigInt(String(prepared.value.fees.coreProtocolFeeCygld)), "quoter-integration-prepared-core-protocol-fee-mismatch");
      requireInvariant(measured.helperFeeCygld === BigInt(String(prepared.value.fees.coreHelpersFeeCygld)), "quoter-integration-prepared-core-helpers-fee-mismatch");
      requireInvariant(measured.marketFeeCygld === BigInt(String(prepared.value.fees.marketFeeCygld)), "quoter-integration-prepared-market-fee-mismatch");
      const retained = (rows: readonly { branch: unknown; stage: unknown; currency: string; amount: unknown }[]) => rows.map(row => ({
        branch: String(row.branch), stage: String(row.stage), currency: row.currency.toLowerCase(), amount: String(row.amount) }));
      requireInvariant(digest(retained(measured.retainedInputs ?? [])) === digest(retained(prepared.value.estimatedRetainedInputCharges)),
        "quoter-integration-prepared-retention-mismatch");
      const result = observeUiReceipt(nativeScenario, config, owner, observed.transaction.input, receipt,
        BigInt(nativeScenario.amountRaw!), [], uiQuote).validate();
      result.id = label;
      const gasValue = await readJson<unknown>(fetcher, `/api/transaction/wait/receipt?hash=${hash}`);
      const gas = ownedReceiptGas(gasValue, owner);
      requireInvariant(gas, "quoter-integration-owned-receipt-gas-unavailable");
      const walletAfter = await fetchWalletBalances(owner, undefined, fetcher, "swap-preflight");
      result.wallet = walletEvidence(uiQuote, walletAmounts(walletBefore, config, uiQuote), walletAmounts(walletAfter, config, uiQuote), gas.paid, [gas.hash]);
      assertWalletEconomics(result.wallet, (result.receipt!.netPaid as string[]).map(BigInt), (result.receipt!.netReceived as string[]).map(BigInt));
      report.receipts.push(result);
      await assertion("quoter-integration-product-form-cleanup-incomplete", async () => {
        await expect(getMainInput(page, "sell")).toHaveValue("");
        await expect(getMainInput(page, "sell")).toBeEditable();
      });
      await persist();
      return prepared;
    }

    const aRequestCount = a.counts.economic;
    const bRequestCount = b.counts.economic;
    const first = await submitSelected("first-native-product-swap");
    await persist("browser-b-retains-history-after-real-swap");
    await assertion("quoter-integration-owned-state-did-not-change", () => expect.poll(async () => {
      const head = await second.evaluate(async () => (await fetch("/api/transaction/wait/head", { cache: "no-store" })).json());
      return head.blockHash;
    }).not.toBe(original.context.blockHash));
    await second.waitForTimeout(12_500);
    await second.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); });
    await second.waitForTimeout(500);
    requireInvariant(b.counts.economic === bRequestCount, "quoter-integration-head-time-focus-triggered-search");
    requireInvariant(a.counts.economic === aRequestCount, "quoter-integration-first-swap-triggered-search");
    requireInvariant(await displayedUiAmount(getMainInput(second, "buy")) === originalDisplay, "quoter-integration-historical-display-changed");
    await persist("browser-b-explicit-refresh");
    const beforeRefresh = b.economic.length;
    await second.locator("[data-trade-refresh]").click();
    await assertion("quoter-integration-browser-b-refresh-response-unavailable", () => expect.poll(() => b!.economic.length, { timeout: 60_000 }).toBeGreaterThan(beforeRefresh));
    const refreshed = b.economic.filter(matches).at(-1)!;
    requireInvariant(refreshed.observation.source === "search", "quoter-integration-explicit-refresh-did-not-search");
    requireInvariant(refreshed.observation.refresh, "quoter-integration-explicit-refresh-flag-missing");
    requireInvariant(refreshed.context.blockHash !== original.context.blockHash, "quoter-integration-refresh-did-not-observe-changed-state");
    report.refresh = { context: refreshed.context, source: refreshed.observation.source, quotedOutput: refreshed.quotedOutput };
    await persist("browser-a-restores-original-amount-from-cache");
    await getMainInput(page, "sell").fill(nativeScenario.displayAmount);
    await assertion("quoter-integration-browser-a-did-not-restore-original-display", () => expect.poll(() => displayedUiAmount(getMainInput(page, "buy"))).toBe(originalDisplay));
    requireInvariant(a.counts.economic === aRequestCount, "quoter-integration-return-to-original-amount-triggered-search");
    const secondPrepared = await submitSelected("historical-native-product-swap");
    requireInvariant(secondPrepared.value.context.blockHash !== original.context.blockHash,
      "quoter-integration-selected-preparation-did-not-observe-changed-state");
    requireInvariant(secondPrepared.value.outputMinimum === first.value.outputMinimum,
      "quoter-integration-second-preparation-lowered-original-minimum");
    requireInvariant(a.counts.economic === aRequestCount, "quoter-integration-unchanged-browser-a-triggered-search");
    requireInvariant(b.counts.preparation === 0, "quoter-integration-anonymous-browser-b-prepared-transaction");
    report.result = "pass";
    report.stableHistoricalViewAfterChangedHead = true;
    report.preparation = { selectedPlanSha256: digest(original.plan), originalContext: original.context,
      firstContext: first.value.context, changedStateContext: secondPrepared.value.context,
      originalMinimum: first.value.outputMinimum, funding: first.value.inputs, authorizationAfterPreparation: true };
    await persist("complete");
  } catch (error) {
    report.result = "fail";
    Object.assign(report, safeRunnerError(error));
    if (error instanceof RegressionAssertionError) report.failurePredicate = error.code;
    throw error;
  } finally {
    await a.settled(); await b?.settled();
    report.requests = { browserA: { ...a.counts }, browserB: b ? { ...b.counts } : undefined };
    report.httpFailures = [...a.failures, ...(b?.failures ?? [])];
    try { await secondBrowser?.close(); report.secondBrowserClosed = true; }
    catch (error) { report.result = "fail"; report.failurePredicate = "quoter-integration-second-browser-cleanup-failed"; throw error; }
    finally { await persist(); }
  }
});
