import { protocolAddresses, tokens } from "../fixtures/protocol-configuration";
import { expect, test, type Page } from "./fixtures/app-test";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Address } from "viem";
import { HELPERS_MARKET_ABI } from "../../app/contracts/generated/helpersMarket";
import { installMarket, marketTradeFixture } from "./fixtures/market-quotes";
import { coreIntentRequest, tradeFixture } from "./fixtures/trade-core";
import { intentFixture } from "./fixtures/quote-intent";
import { context } from "./fixtures/token-quotes";

const owner = "0x0000000000000000000000000000000000000011" as Address;
const actualBeneficiary = "0x0000000000000000000000000000000000000022" as Address;
const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337), hash = `0x${"ab".repeat(32)}`;

async function wallet(page: Page, rejected = false, pauseSignature = false) {
  await page.addInitScript(({ owner, hash, chain, rejected, pauseSignature }) => {
    const requests: { method: string; params?: unknown[] }[] = [];
    const provider = { isMetaMask: true, selectedAddress: owner, request: async (request: { method: string; params?: unknown[] }) => {
      requests.push(request);
      if (["eth_accounts", "eth_requestAccounts"].includes(request.method)) return [owner];
      if (request.method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
      if (request.method === "eth_chainId") return `0x${chain.toString(16)}`;
      if (request.method === "net_version") return String(chain);
      if (request.method === "eth_signTypedData_v4") {
        if (rejected) throw Object.assign(new Error("Rejected by user"), { code: 4001 });
        if (pauseSignature) await new Promise<void>(resolve => Object.assign(window, { __resumeMarketSignature: resolve }));
        return `0x${"01".repeat(64)}1b`;
      }
      if (request.method === "eth_sendTransaction") return hash;
      throw new Error(`Synthetic wallet rejects ${request.method}`);
    }, on: () => {}, removeListener: () => {} };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    Object.assign(window, { __marketWalletRequests: requests });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "MetaMask", rdns: "io.metamask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner, hash, chain, rejected, pauseSignature });
}

async function selectPaxg(page: Page) {
  await page.locator('main button[aria-haspopup="dialog"]').first().click();
  await page.getByPlaceholder("Search currency...").fill("PAXG");
  await page.locator("#dropdown-from").getByRole("button").filter({ has: page.getByText("PAXG", { exact: true }) }).click();
}

test("one trading form acquires a fee-aware baseline before any amount or wallet", async ({ page }) => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const observed = await installMarket(page, () => pending);
  await page.goto("/en"); await selectPaxg(page);
  await expect(page.getByRole("button", { name: "Liquidity swap", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Issue / Redeem", exact: true })).toHaveCount(0);
  await expect.poll(() => observed.models.length).toBeGreaterThan(0);
  expect(observed.requests).toEqual([]);
  expect(observed.models[0].amount).toBe("0");
  expect(observed.models.every(request => !("recipient" in request) && !("orderedAssets" in request))).toBe(true);
  await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  await expect.poll(() => observed.requests.length).toBeGreaterThan(0);
  await page.locator("#sell-amount").fill("2");
  await expect(page.locator("#buy-amount")).toHaveText("1.998");
  expect(observed.coreObservations.intents).toEqual([]);
  finish();
  await expect(page.locator("#buy-amount")).not.toHaveText(/^(?:0(?:[.,]0+)?|\.\.\.)?$/);
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.getByTestId("swap-minimum-output")).toContainText("CYGLD");
  await page.screenshot({ path: "out/audit/uniswap-v4-unified-trade.png", fullPage: true });
});

test("one token screen supports input-driven market purchases and sales with protected outputs", async ({ page }) => {
  const observed = await installMarket(page);
  await page.goto("/en"); await selectPaxg(page);
  await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await expect(page.locator("#buy-amount")).not.toHaveText(/^(?:0(?:[.,]0+)?|\.\.\.)?$/);
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.getByTestId("swap-minimum-output")).toContainText("CYGLD");
  await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await page.locator("#sell-amount").click(); await page.locator("#sell-amount").fill("1");
  await expect.poll(() => observed.requests.some(request => request.side === "sell" && request.mode === "exact-in")).toBe(true);
  await expect(page.getByTestId("swap-minimum-output")).toContainText("PAXG");
  expect(observed.requests.every(request => request.mode === "exact-in")).toBe(true);
  expect(observed.requests.every(request => !request.native && !("adapter" in request) && !("orderedAssets" in request))).toBe(true);
  expect(observed.coreObservations.intents).toEqual([]);
});

test("a Core provider error cannot erase the Backend-selected market plan", async ({ page }) => {
  await installMarket(page);
  await page.route("**/api/quotes/trade/stream", async route => {
    const checked = marketTradeFixture(route.request().postDataJSON());
    await route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "qualified", value: checked },
      { type: "provider-error", strategy: "core", code: "ISSUANCE_CAP_EXCEEDED", error: "Core cap reached" },
      { type: "complete", value: checked },
    ].map(event => JSON.stringify(event)).join("\n") + "\n" });
  });
  await page.goto("/en"); await selectPaxg(page); await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).not.toHaveText(/^(?:0(?:[.,]0+)?|\.\.\.)?$/);
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await expect(page.getByText("Core cap reached", { exact: true })).toHaveCount(0);
});

test("verification invalidation replaces only its selected family with checked economics", async ({ page }) => {
  await installMarket(page);
  await page.route("**/api/quotes/trade/stream", async route => {
    const checked = marketTradeFixture(route.request().postDataJSON());
    const optimistic = { ...checked, quotedOutput: String(BigInt(checked.quotedOutput) + 10n ** 16n),
      providerQuote: { ...checked.providerQuote, qualification: "sdk", netOutput: String(BigInt(checked.quotedOutput) + 10n ** 16n) } };
    await route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "qualified", value: optimistic }, { type: "invalidated", strategy: "market" },
      { type: "complete", value: { ...checked, providerQuote: { ...checked.providerQuote, qualification: "sdk-and-quoter" } } },
    ].map(event => JSON.stringify(event)).join("\n") + "\n" });
  });
  await page.goto("/en"); await selectPaxg(page); await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).not.toHaveText(/^(?:0(?:[.,]0+)?|\.\.\.)?$/);
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
});

test("replacement heads compete again, while input edits cancel an obsolete answer", async ({ page }) => {
  let head = { ...context }, release!: () => void;
  let waiting = new Promise<void>(resolve => { release = resolve; });
  const observed = await installMarket(page, () => waiting);
  const aborted: string[] = [];
  page.on("requestfailed", request => {
    if (new URL(request.url()).pathname === "/api/quotes/trade/stream") aborted.push(request.postDataJSON().amount);
  });
  await page.route("**/api/transaction/wait/head", route => route.fulfill({ json: { ...head, blockTimestamp: String(Math.floor(Date.now() / 1000)) } }));
  await page.goto("/en"); await selectPaxg(page); await page.locator("#sell-amount").fill("1");
  await expect.poll(() => observed.requests.length).toBe(1);
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await page.clock.install();
  head = { ...head, blockHash: `0x${"d".repeat(64)}` };
  await page.clock.runFor(12_500);
  expect(observed.requests).toHaveLength(1); expect(aborted).toEqual([]);
  release(); await expect(page.locator("#buy-amount")).not.toHaveText(/^(?:0(?:[.,]0+)?|\.\.\.)?$/);
  waiting = new Promise<void>(resolve => { release = resolve; });
  head = { ...head, blockHash: `0x${"e".repeat(64)}` };
  await page.clock.runFor(12_500); await expect.poll(() => observed.requests.length).toBe(2);
  expect(observed.requests.at(-1)?.retainedPlan).toBeUndefined();
  await page.locator("#sell-amount").fill("2"); await page.clock.runFor(200);
  await expect.poll(() => observed.requests.length).toBe(3);
  await expect.poll(() => aborted).toContain("1000000000000000000");
  expect(observed.requests.at(-1)?.amount).toBe("2000000000000000000");
  release(); await expect(page.locator("#buy-amount")).toHaveText("1.998");
  waiting = new Promise<void>(resolve => { release = resolve; });
  head = { ...head, blockHash: `0x${"f".repeat(64)}` };
  await page.clock.runFor(12_500); await expect.poll(() => observed.requests.length).toBe(4);
  await page.locator("#sell-amount").fill("");
  await expect.poll(() => aborted).toContain("2000000000000000000"); release();
  await expect(page.locator("#buy-amount")).toHaveText(/^0(?:[.,]0+)?$/);
  expect(observed.requests).toHaveLength(4);
});

for (const rejected of [false, true]) test(`native market permit ${rejected ? "rejection stops without another prompt" : "and swap use one transaction and show actual receipt economics"}`, async ({ page }) => {
  const observed = await installMarket(page); await wallet(page, rejected, !rejected);
  let head = { ...context };
  const headReads: string[] = [];
  await page.route("**/api/transaction/wait/head", route => {
    headReads.push(head.blockHash);
    return route.fulfill({ json: { ...head, blockTimestamp: String(Math.floor(Date.now() / 1000)) } });
  });
  if (!rejected) await page.route("**/api/quotes/trade/stream", async route => {
    const request = route.request().postDataJSON(); observed.requests.push(request);
    const coreRequest = coreIntentRequest(request);
    const value = head.blockHash === context.blockHash ? marketTradeFixture(request) : tradeFixture(intentFixture(coreRequest, "better", head), coreRequest);
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "complete", value }) + "\n" });
  });
  const helpers = protocolAddresses.helpers! as Address;
  await page.route("**/api/account/wallet-balances*", route => route.fulfill({ json: { holder: owner, context,
    native: { status: "success", value: "100000000000000000000" }, tokens: tokens.filter(token => token.type === "erc20").map(token => ({
      id: token.id, address: token.address, balance: { status: "success", value: "100000000000000000000" } })) } }));
  const simulated: { operation: string; args: [{ amount: string; routedInput: string; feeCygld: string }, { mode: number; nativePermit: { value: string } }] }[] = [];
  await page.route("**/api/account/token-permit*", route => {
    const token = new URL(route.request().url()).searchParams.get("token")!;
    return route.fulfill({ json: { spender: helpers, allowance: { status: "success", value: "0" }, nonce: { status: "success", value: "7" },
      authorization: { kind: "erc2612", confidence: "qualified", domain: { name: "Input Token", version: "1", chainId: chain, verifyingContract: token } } } });
  });
  await page.route("**/api/governance/helpers-facts*", route => {
    return route.fulfill({ json: { helpers, context, adapter: { address: protocolAddresses.adapter, codePresent: { status: "success", value: true } }, configuration: { helperFeePpm: { status: "success", value: "0" }, wrappedNative: { status: "success", value: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" }, owner: { status: "success", value: owner }, paused: { status: "success", value: false }, approvedAdapters: { status: "success", value: [protocolAddresses.adapter] }, permit2: { status: "success", value: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
      marketSwapExactInput: { status: "success", value: true }, marketSwapExactOutput: { status: "success", value: true } } } });
  });
  await page.route("**/api/transaction/helpers-execution", route => { simulated.push(route.request().postDataJSON()); return route.fulfill({ json: { helpers: protocolAddresses.helpers, gas: "250000" } }); });
  await page.route("**/api/transaction/wait/transaction*", route => route.fulfill({ json: { transaction: { hash, from: owner, to: helpers,
    nonce: "0x0", gas: "0x493e0", value: "0x0", input: "0x", type: "0x2", blockHash: `0x${"a".repeat(64)}`, blockNumber: "0x64", transactionIndex: "0x0" } } }));
  await page.route("**/api/transaction/wait/receipt*", async route => {
    const quote = marketTradeFixture(observed.requests[0]).providerQuote;
    const topics = encodeEventTopics({ abi: HELPERS_MARKET_ABI, eventName: "MarketSwapExecuted", args: { payer: owner, recipient: owner, counterToken: quote.params.counterToken as Address } });
    const data = encodeAbiParameters(parseAbiParameters("uint8,bool,uint256,uint256,uint256,uint256,uint256,address"),
      [1, true, BigInt(quote.routedAmountIn), BigInt(quote.netOutput), BigInt(quote.refundDust), 0n, BigInt(quote.fee.amount), actualBeneficiary]);
    await route.fulfill({ json: { receipt: { transactionHash: hash, transactionIndex: "0x0", blockHash: `0x${"a".repeat(64)}`, blockNumber: "0x64",
      from: owner, to: helpers, cumulativeGasUsed: "0x493e0", gasUsed: "0x493e0", effectiveGasPrice: "0x1", contractAddress: null,
      logs: [{ address: helpers, topics, data, blockHash: `0x${"a".repeat(64)}`, blockNumber: "0x64", transactionHash: hash, transactionIndex: "0x0", logIndex: "0x0", removed: false }],
      logsBloom: `0x${"00".repeat(256)}`, status: "0x1", type: "0x2" } } });
  });
  await page.goto("/en"); await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await selectPaxg(page);
  await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await page.locator("#sell-amount").click(); await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).not.toHaveText(/^(?:0(?:[.,]0+)?|\.\.\.)?$/);
  if (!rejected) await page.clock.install();
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  const selected = marketTradeFixture(observed.requests.at(-1)!);
  await page.getByRole("button", { name: "Swap currencies", exact: true }).click();
  if (rejected) { await expect(page.getByText("Wallet request cancelled", { exact: true })).toContainText("Wallet request cancelled"); expect(simulated).toEqual([]); }
  else {
    await expect.poll(() => page.evaluate(() => (window as unknown as { __marketWalletRequests: { method: string }[] }).__marketWalletRequests.filter(value => value.method === "eth_signTypedData_v4").length)).toBe(1);
    expect(simulated).toEqual([]);
    const before = observed.requests.length;
    head = { ...head, blockHash: `0x${"e".repeat(64)}` };
    await page.clock.runFor(12_500);
    await expect.poll(() => headReads.includes(head.blockHash)).toBe(true);
    expect(observed.requests).toHaveLength(before);
    await expect(page.locator("#buy-amount")).not.toHaveText(/^(?:0(?:[.,]0+)?|\.\.\.)?$/);
    await expect(page.locator("#buy-amount")).toHaveText("0.999");
    await expect(page.locator("#sell-amount")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reverse swap direction" })).toBeDisabled();
    await page.evaluate(() => (window as unknown as { __resumeMarketSignature: () => void }).__resumeMarketSignature());
    await expect(page.getByTestId("trade-receipt")).toContainText("Swap confirmed");
    await expect(page.getByTestId("trade-receipt")).toContainText(actualBeneficiary);
    await expect(page.getByTestId("trade-receipt")).toContainText("Front-end fee");
    await expect(page.getByTestId("trade-receipt")).not.toContainText("Helpers fee");
    expect(simulated[0].operation).toBe("swapExactInput");
    expect(simulated[0].args[1].nativePermit.value).toBe("1000000000000000000");
    expect(simulated[0].args[1].mode).toBe(1);
    expect(simulated[0].args[0].routedInput).toBe(selected.providerQuote.params.routedInput);
  }
  const methods = await page.evaluate(() => (window as unknown as { __marketWalletRequests: { method: string }[] }).__marketWalletRequests.map(request => request.method));
  expect(methods.filter(method => method === "eth_signTypedData_v4")).toHaveLength(1);
  expect(methods.filter(method => method === "eth_sendTransaction")).toHaveLength(rejected ? 0 : 1);
});
