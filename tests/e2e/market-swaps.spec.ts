import { protocolAddresses } from "../fixtures/protocol-configuration";
import { expect, test, type Page } from "./fixtures/app-test";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Address } from "viem";
import { HELPERS_MARKET_ABI } from "../../app/contracts/generated/helpersMarket";
import { installMarket, marketFixture } from "./fixtures/market-quotes";
import { context } from "./fixtures/token-quotes";

const owner = "0x0000000000000000000000000000000000000011" as Address;
const actualBeneficiary = "0x0000000000000000000000000000000000000022" as Address;
const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337), hash = `0x${"ab".repeat(32)}`;

async function wallet(page: Page, rejected = false) {
  await page.addInitScript(({ owner, hash, chain, rejected }) => {
    const requests: { method: string; params?: unknown[] }[] = [];
    const provider = { isMetaMask: true, selectedAddress: owner, request: async (request: { method: string; params?: unknown[] }) => {
      requests.push(request);
      if (["eth_accounts", "eth_requestAccounts"].includes(request.method)) return [owner];
      if (request.method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
      if (request.method === "eth_chainId") return `0x${chain.toString(16)}`;
      if (request.method === "net_version") return String(chain);
      if (request.method === "eth_signTypedData_v4") {
        if (rejected) throw Object.assign(new Error("Rejected by user"), { code: 4001 });
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
  }, { owner, hash, chain, rejected });
}

test("market activation acquires a fee-aware baseline before any amount or wallet", async ({ page }) => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const observed = await installMarket(page, () => pending);
  await page.goto("/en");
  await page.getByRole("button", { name: "Liquidity swap", exact: true }).click();
  await expect.poll(() => observed.models.length).toBeGreaterThan(0);
  expect(observed.requests).toEqual([]);
  expect(observed.models.every(request => !("amount" in request) && !("recipient" in request))).toBe(true);
  await page.getByLabel("Amount (PAXG)").fill("1");
  await expect(page.getByTestId("market-quote-display")).toContainText("~ 0.999 CYGLD");
  await expect.poll(() => observed.requests.length).toBe(1);
  await page.getByLabel("Amount (PAXG)").fill("2");
  await expect(page.getByTestId("market-quote-display")).toContainText("~ 1.998 CYGLD");
  // Initial head/fork observations can finish after the first model paints.
  // They refresh the same amount-independent family rather than creating an
  // amount-specific baseline or using a previous whole trade as its seed.
  expect(new Set(observed.models.map(request => JSON.stringify(request))).size).toBe(1);
  expect(observed.coreObservations.intents).toEqual([]);
  finish();
  await expect(page.getByTestId("market-quote-details")).toContainText("Application fee (0.1%)");
  await expect(page.getByTestId("market-quote-details")).toContainText("Uniswap V4");
  await page.screenshot({ path: "out/audit/uniswap-v4-market.png", fullPage: true });
});

test("four market modes remain distinct from Core issuance and preserve CYGLD-only fee bounds", async ({ page }) => {
  const observed = await installMarket(page);
  await page.goto("/en"); await page.getByRole("button", { name: "Liquidity swap", exact: true }).click();
  await page.getByLabel("Amount (PAXG)").fill("1");
  await expect(page.getByTestId("market-quote-display")).toContainText("0.999 CYGLD");
  await expect(page.getByTestId("market-quote-details")).toContainText("Minimum received");
  await page.getByRole("button", { name: "Set output", exact: true }).click();
  await expect(page.getByLabel("Amount (CYGLD)")).toHaveValue("1");
  await expect(page.getByTestId("market-quote-details")).toContainText("Maximum paid");
  await page.getByRole("button", { name: "Sell CYGLD", exact: true }).click();
  await expect(page.getByLabel("Amount (PAXG)")).toHaveValue("1");
  await expect.poll(() => observed.requests.some(request => request.side === "sell" && request.mode === "exact-out")).toBe(true);
  await page.getByRole("button", { name: "Set input", exact: true }).click();
  await expect(page.getByLabel("Amount (CYGLD)")).toHaveValue("1");
  await expect.poll(() => observed.requests.some(request => request.side === "sell" && request.mode === "exact-in")).toBe(true);
  expect(observed.coreObservations.intents).toEqual([]);
  expect(observed.requests.every(request => request.counterToken.toLowerCase() === "0x45804880de22913dafe09f4980848ece6ecbaf78")).toBe(true);
});

test("switching back to Core never reuses a market quote as issuance", async ({ page }) => {
  const observed = await installMarket(page);
  await page.goto("/en"); await page.getByRole("button", { name: "Liquidity swap", exact: true }).click();
  await page.getByLabel("Amount (PAXG)").fill("1"); await expect(page.getByTestId("market-quote-details")).toBeVisible();
  await page.getByRole("button", { name: "Issue / Redeem", exact: true }).click();
  await expect(page.getByTestId("market-swap-panel")).toHaveCount(0);
  await expect(page.locator("#swapsection")).toBeVisible();
  expect(observed.coreObservations.intents).toEqual([]);
});

test("verification invalidation replaces an optimistic market quote with its lower checked economics", async ({ page }) => {
  await installMarket(page);
  await page.route("**/api/quotes/market/stream", async route => {
    const checked = marketFixture(route.request().postDataJSON());
    const optimistic = { ...checked, qualification: "sdk", netOutput: String(BigInt(checked.netOutput) + 10n ** 16n) };
    await route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "qualified", value: optimistic }, { type: "invalidated" },
      { type: "complete", value: { ...checked, qualification: "sdk-and-quoter" } },
    ].map(event => JSON.stringify(event)).join("\n") + "\n" });
  });
  await page.goto("/en"); await page.getByRole("button", { name: "Liquidity swap", exact: true }).click();
  await page.getByLabel("Amount (PAXG)").fill("1");
  await expect(page.getByTestId("market-quote-details")).toBeVisible();
  await expect(page.getByTestId("market-quote-display")).toContainText("0.999 CYGLD");
  await expect(page.getByTestId("market-quote-display")).not.toContainText("1.009 CYGLD");
});

test("market quotes survive a replacement head, then cancel obsolete input without publishing its late answer", async ({ page }) => {
  let head = { ...context }, release!: () => void;
  let waiting = new Promise<void>(resolve => { release = resolve; });
  const observed = await installMarket(page, () => waiting);
  const aborted: string[] = [];
  page.on("requestfailed", request => {
    if (new URL(request.url()).pathname === "/api/quotes/market/stream")
      aborted.push(request.postDataJSON().amount);
  });
  await page.route("**/api/transaction/wait/head", route => route.fulfill({
    json: { ...head, blockTimestamp: String(Math.floor(Date.now() / 1000)) },
  }));
  const initialFacts = page.waitForResponse(response => new URL(response.url()).pathname === "/api/protocol/facts");
  await page.goto("/en"); await initialFacts;
  await page.getByRole("button", { name: "Liquidity swap", exact: true }).click();
  const input = page.getByLabel("Amount (PAXG)");
  await input.fill("1");
  await expect.poll(() => observed.requests.length).toBe(1);
  await expect(page.getByTestId("market-quote-display")).toContainText("~ 0.999 CYGLD");
  await page.clock.install();
  const replacement = page.waitForResponse(response => new URL(response.url()).pathname === "/api/transaction/wait/head");
  head = { ...head, blockHash: `0x${"d".repeat(64)}` }; // Same height, replacement state identity.
  await page.clock.runFor(12_500);
  await replacement; await page.clock.runFor(250);
  expect(observed.requests).toHaveLength(1);
  expect(aborted).toEqual([]);
  release();
  await expect(page.getByTestId("market-quote-details")).toBeVisible();
  waiting = new Promise<void>(resolve => { release = resolve; });
  head = { ...head, blockHash: `0x${"e".repeat(64)}` };
  await page.clock.runFor(12_500);
  await expect.poll(() => observed.requests.length).toBe(2);
  expect(observed.requests.at(-1)?.retainedPlan?.amount).toBe("1000000000000000000");
  await input.fill("2"); await page.clock.runFor(200);
  await expect.poll(() => observed.requests.length).toBe(3);
  await expect.poll(() => aborted).toContain("1000000000000000000");
  expect(observed.requests.at(-1)?.amount).toBe("2000000000000000000");
  expect(observed.requests.at(-1)?.retainedPlan).toBeUndefined();
  release();
  await expect(page.getByTestId("market-quote-display")).toContainText("1.998 CYGLD");
  await expect(page.getByTestId("market-quote-display")).not.toContainText("0.999 CYGLD");
  expect(observed.requests.every(request => BigInt(request.amount) > 0n)).toBe(true);
  waiting = new Promise<void>(resolve => { release = resolve; });
  head = { ...head, blockHash: `0x${"f".repeat(64)}` };
  await page.clock.runFor(12_500);
  await expect.poll(() => observed.requests.length).toBe(4);
  await input.fill("");
  // The browser clock is paused: clearing cancels before the debounce expires.
  await expect.poll(() => aborted).toContain("2000000000000000000");
  release();
  await expect(page.getByTestId("market-quote-display")).toContainText("—");
  expect(observed.requests).toHaveLength(4);
  expect(observed.coreObservations.intents).toEqual([]);
});

for (const rejected of [false, true]) test(`native market permit ${rejected ? "rejection stops without another prompt" : "and swap use one transaction and show actual receipt economics"}`, async ({ page }) => {
  const observed = await installMarket(page); await wallet(page, rejected);
  const helpers = protocolAddresses.helpers! as Address;
  const simulated: { operation: string; args: [{ amount: string; routedInput: string; feeCygld: string }, { mode: number; nativePermit: { value: string } }] }[] = [];
  await page.route("**/api/account/token-permit*", route => {
    const token = new URL(route.request().url()).searchParams.get("token")!;
    return route.fulfill({ json: { spender: helpers, allowance: { status: "success", value: "0" }, nonce: { status: "success", value: "7" },
      authorization: { kind: "erc2612", confidence: "qualified", domain: { name: "Input Token", version: "1", chainId: chain, verifyingContract: token } } } });
  });
  await page.route("**/api/governance/helpers-facts*", route => {
    return route.fulfill({ json: { configuration: { permit2: { status: "success", value: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
      marketSwapExactInput: { status: "success", value: true }, marketSwapExactOutput: { status: "success", value: true } } } });
  });
  await page.route("**/api/transaction/helpers-execution", route => { simulated.push(route.request().postDataJSON()); return route.fulfill({ json: { helpers: protocolAddresses.helpers, gas: "250000" } }); });
  await page.route("**/api/transaction/wait/transaction*", route => route.fulfill({ json: { transaction: { hash, from: owner, to: helpers,
    nonce: "0x0", gas: "0x493e0", value: "0x0", input: "0x", type: "0x2", blockHash: `0x${"a".repeat(64)}`, blockNumber: "0x64", transactionIndex: "0x0" } } }));
  await page.route("**/api/transaction/wait/receipt*", async route => {
    const quote = marketFixture(observed.requests.at(-1)!);
    const topics = encodeEventTopics({ abi: HELPERS_MARKET_ABI, eventName: "MarketSwapExecuted", args: { payer: owner, recipient: owner, counterToken: quote.params.counterToken as Address } });
    const data = encodeAbiParameters(parseAbiParameters("uint8,bool,uint256,uint256,uint256,uint256,uint256,address"),
      [1, true, BigInt(quote.routedAmountIn), BigInt(quote.netOutput), BigInt(quote.refundDust), 0n, BigInt(quote.fee.amount), actualBeneficiary]);
    await route.fulfill({ json: { receipt: { transactionHash: hash, transactionIndex: "0x0", blockHash: `0x${"a".repeat(64)}`, blockNumber: "0x64",
      from: owner, to: helpers, cumulativeGasUsed: "0x493e0", gasUsed: "0x493e0", effectiveGasPrice: "0x1", contractAddress: null,
      logs: [{ address: helpers, topics, data, blockHash: `0x${"a".repeat(64)}`, blockNumber: "0x64", transactionHash: hash, transactionIndex: "0x0", logIndex: "0x0", removed: false }],
      logsBloom: `0x${"00".repeat(256)}`, status: "0x1", type: "0x2" } } });
  });
  await page.goto("/en"); await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await page.getByRole("button", { name: "Liquidity swap", exact: true }).click();
  await page.getByRole("button", { name: "Sell CYGLD", exact: true }).click();
  await page.getByLabel("Amount (CYGLD)").fill("1");
  await expect(page.getByTestId("market-quote-details")).toBeVisible();
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  if (rejected) { await expect(page.getByTestId("market-swap-panel").getByRole("alert")).toContainText("Swap cancelled in wallet."); expect(simulated).toEqual([]); }
  else {
    await expect(page.getByTestId("market-swap-receipt")).toContainText("Swap confirmed");
    await expect(page.getByTestId("market-swap-receipt")).toContainText(actualBeneficiary);
    expect(simulated[0].operation).toBe("swapExactInput");
    expect(simulated[0].args[1].nativePermit.value).toBe("1000000000000000000");
    expect(simulated[0].args[1].mode).toBe(1);
    expect(simulated[0].args[0].routedInput).toBe(observed.requests.at(-1) && marketFixture(observed.requests.at(-1)!).params.routedInput);
  }
  const methods = await page.evaluate(() => (window as unknown as { __marketWalletRequests: { method: string }[] }).__marketWalletRequests.map(request => request.method));
  expect(methods.filter(method => method === "eth_signTypedData_v4")).toHaveLength(1);
  expect(methods.filter(method => method === "eth_sendTransaction")).toHaveLength(rejected ? 0 : 1);
});
