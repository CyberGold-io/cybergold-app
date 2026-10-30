import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, zeroHash, type Address, type Hex } from "viem";
import { expect, test } from "./fixtures/app-test";
import { context, install as installTokens } from "./fixtures/token-quotes";
import { universalFixture } from "./fixtures/universal-exact-input";
import { getMainInput, getSwapButton, openFeeDetails, selectToken, showAllSellTokens } from "../metamask/token-flows/helpers";
import { armUiQuoteCapture, capturedUiQuote, displayedUiAmount, quoteAssets } from "../trading/uiQuoteCapture";
import { uiReceiptResult } from "../trading/uiReceipt";
import { confirmedTransactionText } from "../trading/uiDiagnostics";
import { tradeScenarios } from "../trading/scenarios";
import { protocolConfigurationFixture as config, tokenAddresses } from "../fixtures/protocol-configuration";
import { exactInputPlan } from "../../app/utils/universalExactInput";
import type { PreparedTransaction } from "../../app/utils/economicQuotes";
import { HELPERS_EXECUTION_ABI } from "../../app/contracts/cybergold-helpers/execution";
import { installQuoteObservation, quoteObservations } from "../trading/quoteObservation";
import { refreshUiQuote, waitForUiSwapReady } from "../trading/uiQuotePreparation";
import { QuotePreviewError } from "../../app/utils/quoteErrors";
import { diagnosticReferences } from "../../app/utils/diagnosticReferences";

const emptyTokenPermit={value:0n,deadline:0n,v:0,r:zeroHash,s:zeroHash};
const emptyPermit2={permit:{permitted:[],nonce:0n,deadline:0n},signature:"0x" as Hex};
const owner = "0x0000000000000000000000000000000000000001" as const, hash = `0x${"a".repeat(64)}` as Hex;
async function installReadOnlyWallet(page: Parameters<typeof installTokens>[0]) {
  await page.addInitScript(({ owner, chain }) => {
    const provider = { isMetaMask: true, selectedAddress: owner, on: () => {}, removeListener: () => {},
      request: async ({ method }: { method: string }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [owner];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        throw new Error("Read-only fixture wallet");
      } };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "MetaMask", rdns: "io.metamask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner, chain: config.chainId });
  await page.route("**/api/account/wallet-balances*", route => route.fulfill({ json: {
    holder: owner, context: { chainId: config.chainId, blockNumber: "100", blockHash: hash, observedAt: new Date().toISOString() },
    native: { status: "success", value: "100000000000000000000" }, tokens: config.tokens.filter(token => token.type === "erc20")
      .map(token => ({ id: token.id, address: token.address, balance: { status: "success", value: "100000000000000000000" } })),
  } }));
}
function event(name: "ExactInputExecuted", args: Record<string, unknown>) {
  const abi = HELPERS_EXECUTION_ABI.find(row => row.type === "event" && row.name === name)!;
  if (abi.type !== "event") throw new Error("Fixture event missing");
  const fields = abi.inputs.filter(row => !row.indexed);
  return { address: config.contracts.helpers! as Address, topics: encodeEventTopics({ abi: [abi], eventName: name, args: args as never }) as Hex[],
    data: encodeAbiParameters(fields, fields.map(row => args[row.name]) as never) };
}
function receipt(log: ReturnType<typeof event>) {
  return { transactionHash: hash, blockHash: hash, blockNumber: 100n, status: "success" as const, logs: [log] };
}

test("MetaMask matrix preparation accepts the real UI universal quote without opening a wallet request", async ({ page }) => {
  await page.addInitScript(installQuoteObservation as () => void);
  await installTokens(page); await installReadOnlyWallet(page); await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible(); await showAllSellTokens(page);
  await selectToken(page, "sell", "USDC"); await selectToken(page, "buy", "CYGLD");
  await getMainInput(page, "sell").fill("1");
  const scenario = { ...tradeScenarios.find(row => row.id === "core-issue-usdc-exact-in")!, amountRaw: "1000000" };
  await waitForUiSwapReady(page, config, scenario);
  expect((await quoteObservations(page)).some(row => row.path === "/api/economic-quotes" && row.terminal?.type === "complete")).toBe(true);
  expect((await quoteObservations(page)).some(row => row.path === "/api/quotes/trade/stream")).toBe(false);
  await expect(await getSwapButton(page)).toBeEnabled();
});

for (const refreshOutcome of ["changed", "unchanged", "failed"] as const) test(`execution preparation waits for explicit Refresh: ${refreshOutcome} economics`, async ({ page }) => {
  await page.addInitScript(installQuoteObservation as () => void);
  await installTokens(page); await installReadOnlyWallet(page);
  let release!: () => void, refreshRequests = 0, preparations = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  const requestId = "a69bb731-0938-4e83-a211-67dc22b3cde0";
  await page.route("**/api/economic-quotes", async route => {
    const request = route.request().postDataJSON();
    if (request.refresh) {
      refreshRequests++;
      await held;
      if (refreshOutcome === "failed") {
        await route.fulfill({ status: 503, headers: { "X-CyberGold-Request-Id": requestId },
          json: { code: "quote-timeout", error: "Timed out." } });
        return;
      }
    }
    await route.fulfill({ json: universalFixture(request, { quotedOutput: request.refresh && refreshOutcome === "changed" ? "2000000000000000000" : "1000000000000000000",
      context: request.refresh && refreshOutcome === "changed" ? { ...context, blockNumber: "101", blockHash: `0x${"b".repeat(64)}` } : context }) });
  });
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/tx-preparations") preparations++; });
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible(); await showAllSellTokens(page);
  await selectToken(page, "sell", "USDC"); await selectToken(page, "buy", "CYGLD");
  await getMainInput(page, "sell").fill("1");
  const scenario = { ...tradeScenarios.find(row => row.id === "core-issue-usdc-exact-in")!, amountRaw: "1000000" };
  await waitForUiSwapReady(page, config, scenario);
  await expect(getMainInput(page, "buy")).toHaveText("1");
  let completed = false;
  const refreshed = refreshUiQuote(page, config, scenario).then(() => ({ error: undefined }), error => ({ error }))
    .finally(() => { completed = true; });
  try {
    await expect.poll(() => refreshRequests).toBe(1);
    await expect(page.locator("[data-trade-refresh]")).toHaveAttribute("aria-busy", "true");
    // The retained quote remains visible and executable. Neither fact completes
    // the runner's explicit current-state selection while its response is held.
    await expect(getMainInput(page, "buy")).toHaveText("1");
    await expect(await getSwapButton(page)).toBeEnabled();
    expect(completed).toBe(false); expect(preparations).toBe(0);
    release();
    const result = await refreshed;
    if (refreshOutcome === "failed") {
      expect(result.error).toBeInstanceOf(QuotePreviewError);
      expect((result.error as QuotePreviewError).code).toBe("quote-timeout");
      expect(diagnosticReferences(result.error).requestId).toBe(requestId);
      await expect(page.getByRole("alert").filter({ hasText: "Refresh failed. Showing the previous quote." })).toBeVisible();
      await expect(getMainInput(page, "buy")).toHaveText("1");
      await expect(await getSwapButton(page)).toBeEnabled();
      expect(preparations).toBe(0);
    } else {
      expect(result.error).toBeUndefined();
      const expectedOutput = refreshOutcome === "changed" ? "2" : "1";
      // This immediate read catches a helper that returned before React
      // committed, rather than allowing a later assertion to hide that race.
      expect(await displayedUiAmount(getMainInput(page, "buy"))).toBe(expectedOutput);
      await openFeeDetails(page);
      expect(await page.getByTestId("swap-minimum-output").textContent()).toContain(`${refreshOutcome === "changed" ? "1.98" : "0.99"} CYGLD`);
      const button = await getSwapButton(page); await armUiQuoteCapture(button, quoteAssets(scenario, config, []));
      const preparation = page.waitForRequest(request => new URL(request.url()).pathname === "/api/tx-preparations");
      await button.click(); // The read-only wallet fixture rejects all chain writes.
      const payload = (await preparation).postDataJSON();
      expect(payload.quote.request).toEqual({ intent: 0, inputs: [{ currency: tokenAddresses.USDC.toLowerCase(), amount: "1000000" }],
        outputCurrency: config.contracts.core!.toLowerCase() });
      expect(payload.quote.context.blockNumber).toBe(refreshOutcome === "changed" ? "101" : context.blockNumber);
      expect(payload.quote.quotedOutput).toBe(refreshOutcome === "changed" ? "2000000000000000000" : "1000000000000000000");
      expect(payload.acceptedBounds.minimumOutput).toBe(refreshOutcome === "changed" ? "1980000000000000000" : "990000000000000000");
      expect(preparations).toBe(1);
    }
  } finally {
    release();
    await refreshed;
  }
});

test("actual App click captures refreshed displayed amounts and committed tolerance before receipt comparison", async ({ page }) => {
  await installTokens(page); await installReadOnlyWallet(page); await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible(); await showAllSellTokens(page);
  await selectToken(page, "sell", "USDC"); await selectToken(page, "buy", "CYGLD");
  await getMainInput(page, "sell").fill("1"); await expect(getMainInput(page, "buy")).toHaveText("1");
  await openFeeDetails(page);
  await page.locator("#execution-tolerance").fill("0.25");
  await expect(page.locator('[data-testid="execution-tolerance-control"] input[type="range"]')).toHaveValue("0.25");
  const scenario = tradeScenarios.find(row => row.id === "core-issue-usdc-exact-in")!, assets = quoteAssets(scenario, config, []);
  const button = await getSwapButton(page); await armUiQuoteCapture(button, assets);
  // The observer is armed before the quote changes, but must capture only the
  // displayed values at the real click, not this earlier ready preview.
  await getMainInput(page, "sell").fill("2"); await expect(getMainInput(page, "buy")).toHaveText("2");
  await expect(page.getByTestId("swap-minimum-output")).toContainText("1.995 CYGLD");
  await page.locator("#execution-tolerance").fill("invalid draft");
  const preparation = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tx-preparations');
  await button.click(); // The fixture wallet rejects writes; no real wallet or chain is used.
  const quote = await capturedUiQuote(page, assets, "exact-in");
  expect(quote.toleranceBps).toBe(25); expect(quote.input[0].amount).toBe("2000000"); expect(quote.output[0].amount).toBe("2000000000000000000");
  const wire = await (await preparation).json() as PreparedTransaction;
  const plan=exactInputPlan(wire.plan);
  const data=encodeFunctionData({abi:HELPERS_EXECUTION_ABI,functionName:"executeExactInput",args:[plan,{
    authorizations:plan.inputs.map(()=>({kind:0,permit:emptyTokenPermit})),permit2:emptyPermit2}]});
  const settlement=receipt(event("ExactInputExecuted",{payer:owner,recipient:owner,intent:0,result:{
    acquiredInputs:plan.inputs,recipientOutputs:[{kind:0,token:config.contracts.core,id:0n,amount:2000000000000000000n}],
    recoveryShares:[],stages:[],retainedInputs:[],coreProtocolFeeCygld:2000000000000000n,coreHelpersFeeCygld:0n,
    marketFeeCygld:0n,retainedCustodian:config.contracts.helpers,feeBeneficiaryAtSettlement:owner}}));
  const result=uiReceiptResult(scenario,config,owner,data,settlement,2000000n,[],quote);
  expect(result.status).toBe("pass");expect(result.receipt!.netPaid).toEqual(["2000000"]);
  const wrong=structuredClone(quote);wrong.output[0].amount="3000000000000000000";
  expect(()=>uiReceiptResult(scenario,config,owner,data,settlement,2000000n,[],wrong)).toThrow(/ui-calldata-output-tolerance-missed/);

});

test("confirmation observer accepts either visible existing Core card/toast despite duplicate hidden text", async ({ page }) => {
  await page.setContent('<p hidden>Transaction confirmed</p><section data-testid="trade-receipt" role="status"><p>Transaction confirmed</p></section><div data-sonner-toast><div>Transaction confirmed</div></div>');
  await expect(page.getByText(/^Transaction confirmed$/i)).toHaveCount(3);
  expect(await confirmedTransactionText(page).isVisible()).toBe(true);
  await page.setContent('<p hidden>Transaction confirmed</p>');
  expect(await confirmedTransactionText(page).isVisible()).toBe(false);
});
