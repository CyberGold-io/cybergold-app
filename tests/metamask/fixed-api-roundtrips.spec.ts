import { errors, type Page } from "@playwright/test";
import { expect, test } from "./testWithMetaMask";
import { addLocalNetwork, connectWallet, notification, requestConnection, switchLocalNetwork } from "./wallet-ui";
import { getMainInput, getSwapButton, parseAmount, readWalletBalances, selectToken, showAllSellTokens } from "./token-flows/helpers";
import { writeFile, rename } from "node:fs/promises";
import { parseUnits, type Address, type Hex } from "viem";
import { tradeScenarios, configuredToken, basketFacts } from "../trading/scenarios";
import { failureResult, originFetch, readJson, requireInvariant, resultFor, type ScenarioResult } from "../trading/regression";
import { uiReceiptResult } from "../trading/uiReceipt";
import { fundSandboxWallet } from "../trading/sandboxFunding";
import { fetchTransactionReceipt } from "../../app/utils/transactionReceipt";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration";
import type { ProtocolFacts } from "../../app/utils/protocolFacts";
import { safeDiagnosticReferences } from "../../app/utils/diagnosticReferences";

async function approveUntilMined(page: Page) {
  const success = page.getByText(/The transaction was mined successfully/i);
  const failure = page.getByText(/^Transaction failed$/i);
  let openedStep = "";
  await expect.poll(async () => {
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
  }, { timeout: 90000, intervals: [250, 500, 1000] }).toBe(true);
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
  const config = await readJson<ProtocolConfiguration>(fetcher, "/api/protocol/config");
  let helpersHash: Hex | undefined;
  let activeSwapAttempt: string | undefined;
  let activeScenarioIndex: number | undefined;
  const scenarios = tradeScenarios.filter(scenario => scenario.requestedStrategy === "core");
  const results: ScenarioResult[] = scenarios.map(scenario => ({ ...resultFor(scenario, "execution"), id: `ui-${scenario.id}`, requestedStrategy: "auto" }));
  async function persist() {
    if (!process.env.TRADE_REGRESSION_UI_OUTPUT) return;
    const path = process.env.TRADE_REGRESSION_UI_OUTPUT;
    await writeFile(path + ".tmp", JSON.stringify({ schema: "cybergold.trade-regression.v1", scenarios: results }, null, 2) + "\n");
    await rename(path + ".tmp", path);
  }
  await persist();
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/rpc") genericRequests.push(request.url());
    if (new URL(request.url()).pathname === "/api/diagnostics") {
      const event = request.postDataJSON();
      if (event?.operation === "swap" && event.outcome === "started") activeSwapAttempt = event.attemptId;
      if (activeScenarioIndex !== undefined && event?.operation === "swap" && event.attemptId === activeSwapAttempt)
        results[activeScenarioIndex].refs = { ...results[activeScenarioIndex].refs, ...safeDiagnosticReferences(event) };
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
  await page.goto("/en");
  await addLocalNetwork(page, { chainId, rpcUrl }, "CyberGold Disposable Wallet Fork");
  await switchLocalNetwork(page, chainId);
  await requestConnection(page);
  await connectWallet(page);
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible({ timeout: 20000 });
  const accounts = await page.evaluate(() => (window as unknown as { ethereum: { request: (input: unknown) => Promise<string[]> } }).ethereum.request({ method: "eth_accounts" }));
  const owner = accounts[0] as Address;
  await fundSandboxWallet(owner, fetcher);

  async function prepare(sell: string, buy: string, amount: string, side: "sell" | "buy" = "sell") {
    await page.goto("/en");
    await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible({ timeout: 20000 });
    await showAllSellTokens(page);
    await selectToken(page, "sell", sell);
    await selectToken(page, "buy", buy);
    const editedToken = side === "sell" ? sell : buy;
    const input = editedToken === "BASKET" ? page.locator(`#${side}-basket-composition input`).first() : getMainInput(page, side);
    await input.click();
    await input.fill(amount);
    const quotedSide = side === "sell" ? "buy" : "sell";
    const quotedToken = quotedSide === "buy" ? buy : sell;
    if (quotedToken === "BASKET") {
      const amounts = page.locator(`#${quotedSide}-basket-composition`).getByRole("button");
      // The funded fixture contains PAXG and XAUt. Quoted basket amounts are
      // buttons, while the editable token side retains its ordinary input.
      await expect(amounts).toHaveCount(2);
      for (const amount of await amounts.all()) {
        await expect.poll(async () => parseAmount(await amount.innerText()), { timeout: 60000 }).toBeGreaterThan(0);
      }
    } else {
      await expect.poll(async () => Number(await getMainInput(page, quotedSide).inputValue()), { timeout: 60000 }).toBeGreaterThan(0);
    }
    await expect(await getSwapButton(page)).toBeEnabled({ timeout: 60000 });
  }
  async function submit() {
    await (await getSwapButton(page)).click();
    await approveUntilMined(page);
  }

  await prepare("ETH", "CYGLD", "0.1");
  const beforeRejected = await readWalletBalances(page, ["cygld"]);
  await (await getSwapButton(page)).click();
  // Product preparation precedes the actual wallet request. Open the native
  // request view when the App reports that request, rather than an empty view.
  await expect(await getSwapButton(page)).toHaveText(/^MetaMask \d+ of \d+:/, { timeout: 60000 });
  const rejected = await notification(page);
  await rejected.getByTestId("confirm-footer-cancel-button").click();
  await expect(page.getByText(/^Transaction failed$/i)).toBeVisible({ timeout: 20000 });
  expect((await readWalletBalances(page, ["cygld"])).cygld).toBe(beforeRejected.cygld);

  for (const [index, scenario] of scenarios.entries()) await test.step(`UI ${scenario.id}`, async () => {
    const started = performance.now(); helpersHash = undefined;
    try {
      const side = scenario.inputMode === "exact-in" ? "sell" : "buy";
      await prepare(scenario.side === "buy" ? scenario.asset : "CYGLD", scenario.side === "buy" ? "CYGLD" : scenario.asset, scenario.displayAmount, side);
      const facts = await readJson<ProtocolFacts>(fetcher, "/api/protocol/facts");
      const basket = scenario.asset === "BASKET" ? basketFacts(facts).assets : [];
      const basketTokens = basket.map(address => config.tokens.find(token => token.type === "erc20" && token.address.toLowerCase() === address.toLowerCase())!);
      const ids = scenario.asset === "BASKET" ? basketTokens.map(token => token.id) : [configuredToken(config, scenario.asset).id];
      const before = await readWalletBalances(page, [...ids, "cygld"]);
      const basketEdited = scenario.asset === "BASKET" && ((scenario.side === "buy") === (scenario.inputMode === "exact-in"));
      const amounts = basketEdited ? await page.locator(`#${side}-basket-composition input`).all() : [];
      const basketAmounts = await Promise.all(amounts.map(async (input, index) => parseUnits(await input.inputValue(), basketTokens[index].decimals)));
      const userToken = configuredToken(config, (scenario.side === "buy") !== (scenario.inputMode === "exact-in") ? "CYGLD" : scenario.asset === "BASKET" ? basketTokens[0].symbol : scenario.asset);
      const userAmount = parseUnits(scenario.displayAmount, userToken.decimals);
      helpersHash = undefined; activeSwapAttempt = undefined; activeScenarioIndex = index;
      await submit();
      await expect.poll(() => helpersHash, { timeout: 15000 }).toBeTruthy();
      const receipt = await fetchTransactionReceipt(helpersHash!, undefined, fetcher);
      requireInvariant(receipt, "receipt-unavailable");
      const observed = await readJson<{ transaction: { input: Hex; to: string; from: string } | null }>(fetcher, `/api/transaction/wait/transaction?hash=${helpersHash}`);
      requireInvariant(observed.transaction?.to.toLowerCase() === config.contracts.helpers!.toLowerCase() && observed.transaction?.from.toLowerCase() === owner.toLowerCase(), "transaction-party-mismatch");
      results[index] = { ...uiReceiptResult(scenario, config, owner, observed.transaction!.input, receipt, userAmount, basketAmounts), refs: results[index].refs };
      await balancesAfter(page, [...ids, "cygld"], after => scenario.side === "buy"
        ? after.cygld > before.cygld && ids.some(id => after[id] < before[id])
        : after.cygld < before.cygld && ids.some(id => after[id] > before[id]));
    } catch (error) { results[index] = { ...failureResult(results[index], error), ...(helpersHash ? { transactionHash: helpersHash } : {}) }; }
    activeScenarioIndex = undefined;
    results[index].durationMs = Math.round(performance.now() - started); await persist();
  });
  expect(genericRequests).toEqual([]);
  expect(successfulReads.has("/api/account/wallet-balances")).toBe(true);
  console.log(JSON.stringify({ genericAppRpcRequests: genericRequests.length, successfulFixedApiPaths: [...successfulReads].sort() }));
  expect(results.filter(result => result.status !== "pass").map(result => ({ id: result.id, status: result.status, code: result.code }))).toEqual([]);
});
