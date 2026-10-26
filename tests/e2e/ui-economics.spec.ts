import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, zeroHash, type Address, type Hex } from "viem";
import { expect, test } from "./fixtures/app-test";
import { install as installTokens } from "./fixtures/token-quotes";
import { getMainInput, getSwapButton, openFeeDetails, selectToken, showAllSellTokens } from "../metamask/token-flows/helpers";
import { armUiQuoteCapture, capturedUiQuote, quoteAssets } from "../trading/uiQuoteCapture";
import { uiReceiptResult } from "../trading/uiReceipt";
import { confirmedTransactionText } from "../trading/uiDiagnostics";
import { tradeScenarios } from "../trading/scenarios";
import { protocolConfigurationFixture as config } from "../fixtures/protocol-configuration";
import { exactInputPlan } from "../../app/utils/universalExactInput";
import { universalFixture } from "./fixtures/universal-exact-input";
import type { UniversalExactInputRequest } from "../../app/utils/universalExactInput";
import { HELPERS_EXECUTION_ABI } from "../../app/contracts/cybergold-helpers/execution";
import { installQuoteObservation, quoteObservations } from "../trading/quoteObservation";
import { waitForUiSwapReady } from "../trading/uiQuotePreparation";

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

test("actual App click captures refreshed displayed amounts and committed tolerance before receipt comparison", async ({ page }) => {
  const observed=await installTokens(page); await installReadOnlyWallet(page); await page.goto("/en");
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
  await button.click(); // The fixture wallet rejects writes; no real wallet or chain is used.
  const quote = await capturedUiQuote(page, assets, "exact-in");
  expect(quote.toleranceBps).toBe(25); expect(quote.input[0].amount).toBe("2000000"); expect(quote.output[0].amount).toBe("2000000000000000000");
  const wire=universalFixture(observed.rawIntents.at(-1) as UniversalExactInputRequest);
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
