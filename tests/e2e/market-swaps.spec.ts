import { protocolAddresses, tokens } from "../fixtures/protocol-configuration";
import { expect, test, type Page } from "./fixtures/app-test";
import { encodeAbiParameters, encodeEventTopics, type Address } from "viem";
import { HELPERS_TRADE_EXACT_INPUT_ABI } from "../../app/contracts/generated/helpersTradeExactInput";
import { installMarket, marketUniversalFixture } from "./fixtures/market-quotes";
import { universalFixture } from "./fixtures/universal-exact-input";
import { choose, context } from "./fixtures/token-quotes";

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

test("one trading form acquires a fee-aware baseline before an amount or wallet", async ({ page }) => {
  let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; });
  const observed = await installMarket(page, () => pending);
  await page.goto("/en"); await selectPaxg(page);
  await expect(page.getByRole("button", { name: "Liquidity swap", exact: true })).toHaveCount(0);
  await expect.poll(() => observed.models.length).toBeGreaterThan(0); expect(observed.requests).toEqual([]);
  expect(observed.models[0].amount).toBe("0");
  await page.locator("#sell-amount").fill("1"); await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await expect.poll(() => observed.requests.length).toBeGreaterThan(0);
  await page.locator("#sell-amount").fill("2"); await expect(page.locator("#buy-amount")).toHaveText("1.998");
  finish(); await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "confirmed");
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.getByTestId("swap-minimum-output")).toContainText("CYGLD");
});

test("input-driven market purchases and sales carry exact gross inputs and protected outputs", async ({ page }) => {
  const observed = await installMarket(page);
  await page.goto("/en"); await selectPaxg(page); await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.getByTestId("swap-minimum-output")).toContainText("CYGLD");
  await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await page.locator("#sell-amount").fill("1"); await expect.poll(() => observed.requests.some(request => request.intent === 1)).toBe(true);
  await expect(page.getByTestId("swap-minimum-output")).toContainText("PAXG");
  expect(observed.requests.every(request => request.inputs.length === 1 && request.inputs[0].amount === "1000000000000000000")).toBe(true);
  expect(observed.requests.every(request => !("adapter" in request) && !("orderedAssets" in request))).toBe(true);
  expect(observed.quotes.every(quote => quote.operation === "executeExactInput")).toBe(true);
});

test("the Backend-selected universal plan supplies the complete market economics", async ({ page }) => {
  await installMarket(page);
  await page.route("**/api/economic-quotes", route => route.fulfill({ json: marketUniversalFixture(route.request().postDataJSON()) }));
  await page.goto("/en"); await selectPaxg(page); await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "confirmed");
  await expect(page.getByTestId("trade-mechanism")).toHaveCount(0);
});

test("a later canonical quote replaces the whole selected plan on a new input", async ({ page }) => {
  await installMarket(page);
  await page.route("**/api/economic-quotes", route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: BigInt(request.inputs[0].amount) === 10n ** 18n ? marketUniversalFixture(request)
      : universalFixture(request, { routeFamily: "mixed", quotedOutput: "3000000000000000000" }) });
  });
  await page.goto("/en"); await selectPaxg(page); await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await page.locator("#sell-amount").fill("2"); await expect(page.locator("#buy-amount")).toHaveText("3");
});

test("input edits cancel an obsolete universal answer", async ({ page }) => {
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  const observed = await installMarket(page, () => waiting); const aborted: string[] = [];
  page.on("requestfailed", request => { if (new URL(request.url()).pathname === "/api/economic-quotes") aborted.push(request.postDataJSON().inputs[0].amount); });
  await page.goto("/en"); await selectPaxg(page); await page.locator("#sell-amount").fill("1");
  await expect.poll(() => observed.requests.length).toBe(1);
  await page.locator("#sell-amount").fill("2"); await expect.poll(() => observed.requests.length).toBe(2);
  await expect.poll(() => aborted).toContain("1000000000000000000");
  expect(observed.requests.at(-1)?.inputs[0].amount).toBe("2000000000000000000");
  release(); await expect(page.locator("#buy-amount")).toHaveText("1.998");
});

for (const native of [false, true]) for (const rejected of native ? [false] : [false, true]) test(`${native ? "native ETH funds exact msg.value" : "ERC20 exact-input permit"}${rejected ? " rejection stops" : " settles one frozen universal plan"}`, async ({ page }) => {
  const observed = await installMarket(page); await wallet(page, rejected, !native && !rejected);
  const preparations: { quote: { request: unknown; plan: unknown }; sender: string; recipient: string; slippageBps: number }[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/tx-preparations') preparations.push(request.postDataJSON()); });
  const helpers = protocolAddresses.helpers as Address;
  let head = { ...context }; const permitReads: string[] = [], simulated: { operation:string; args:[{body:string;inputs:unknown[]},{authorizations:unknown[]}]; value:string }[] = [];
  await page.route("**/api/transaction/wait/head", route => route.fulfill({ json: { ...head, blockTimestamp: String(Math.floor(Date.now() / 1000)) } }));
  await page.route("**/api/account/wallet-balances*", route => route.fulfill({ json: { holder: owner, context,
    native: { status: "success", value: "100000000000000000000" }, tokens: tokens.filter(token => token.type === "erc20").map(token => ({
      id: token.id, address: token.address, balance: { status: "success", value: "100000000000000000000" } })) } }));
  await page.route("**/api/account/token-permit*", route => {
    const token = new URL(route.request().url()).searchParams.get("token")!; permitReads.push(token);
    return route.fulfill({ json: { spender: helpers, allowance: { status: "success", value: "0" }, nonce: { status: "success", value: "7" },
      authorization: { kind: "erc2612", confidence: "qualified", domain: { name: "Input Token", version: "1", chainId: chain, verifyingContract: token } } } });
  });
  await page.route("**/api/governance/helpers-facts*", route => route.fulfill({ json: { helpers, context,
    adapter: { address: protocolAddresses.adapter, codePresent: { status: "success", value: true } }, configuration: {
      helperFeePpm: { status: "success", value: "0" }, wrappedNative: { status: "success", value: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
      owner: { status: "success", value: owner }, paused: { status: "success", value: false }, approvedAdapters: { status: "success", value: [protocolAddresses.adapter] },
      permit2: { status: "success", value: "0x000000000022D473030F116dDEE9F6B43aC78BA3" }, universalExactInput: { status: "success", value: true } } } }));
  await page.route("**/api/transaction/helpers-execution", route => { simulated.push(route.request().postDataJSON()); return route.fulfill({ json: { helpers, gas: "250000" } }); });
  await page.route("**/api/transaction/wait/transaction*", route => route.fulfill({ json: { transaction: { hash, from: owner, to: helpers,
    nonce: "0x0", gas: "0x493e0", value: native ? "0xde0b6b3a7640000" : "0x0", input: "0x", type: "0x2", blockHash: context.blockHash, blockNumber: "0x64", transactionIndex: "0x0" } } }));
  await page.route("**/api/transaction/wait/receipt*", async route => {
    const quote = observed.quotes.at(-1)!;
    const retained = 1000000000000000n, output = BigInt(quote.quotedOutput) - retained;
    const event = HELPERS_TRADE_EXACT_INPUT_ABI.find(row => row.type === "event" && row.name === "ExactInputExecuted")!;
    const result = { acquiredInputs: quote.plan.inputs.map(row => ({ currency: row.currency, amount: BigInt(row.amount) })), stages: [],
      recipientOutputs: [{ kind: 0, token: quote.plan.outputCurrency, id: 0n, amount: output }], recoveryShares: [],
      retainedInputs: [{ branch: 0n, stage: 0n, currency: quote.plan.inputs[0].currency, amount: retained }],
      coreProtocolFeeCygld: 0n, coreHelpersFeeCygld: 0n, marketFeeCygld: BigInt(quote.fees.marketFeeCygld),
      retainedCustodian: helpers, feeBeneficiaryAtSettlement: actualBeneficiary };
    const topics = encodeEventTopics({ abi: HELPERS_TRADE_EXACT_INPUT_ABI, eventName: "ExactInputExecuted", args: { payer: owner, recipient: owner } });
    const data = encodeAbiParameters(event.inputs.filter(input => !input.indexed), [quote.plan.intent, result] as never);
    await route.fulfill({ json: { receipt: { transactionHash: hash, transactionIndex: "0x0", blockHash: context.blockHash, blockNumber: "0x64",
      from: owner, to: helpers, cumulativeGasUsed: "0x493e0", gasUsed: "0x493e0", effectiveGasPrice: "0x1", contractAddress: null,
      logs: [{ address: helpers, topics, data, blockHash: context.blockHash, blockNumber: "0x64", transactionHash: hash, transactionIndex: "0x0", logIndex: "0x0", removed: false }],
      logsBloom: `0x${"00".repeat(256)}`, status: "0x1", type: "0x2" } } });
  });
  await page.goto("/en"); await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  if (native) await choose(page, "ETH"); else { await selectPaxg(page); await page.getByRole("button", { name: "Reverse swap direction" }).click(); }
  await page.locator("#sell-amount").fill("1"); await expect.poll(() => observed.quotes.length).toBeGreaterThan(0);
  await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "confirmed");
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  const selected = observed.quotes.at(-1)!; const quoteCount = observed.requests.length;
  expect(preparations).toEqual([]);
  await page.getByRole("button", { name: "Swap currencies", exact: true }).click();
  await expect.poll(() => preparations.length).toBe(1);
  expect(preparations[0].sender.toLowerCase()).toBe(owner.toLowerCase());
  expect(preparations[0].recipient.toLowerCase()).toBe(owner.toLowerCase());
  expect(preparations[0].quote.request).not.toHaveProperty('deadline');
  expect(preparations[0].quote.plan).not.toHaveProperty('minimumOutput');
  if (rejected) { await expect(page.getByText("Wallet request cancelled", { exact: true })).toBeVisible(); expect(simulated).toEqual([]); }
  else {
    if (!native) {
      await expect.poll(() => page.evaluate(() => (window as unknown as {__marketWalletRequests:{method:string}[]}).__marketWalletRequests.filter(row => row.method === "eth_signTypedData_v4").length)).toBe(1);
      expect(simulated).toEqual([]); await page.clock.install(); head = { ...head, blockHash: `0x${"e".repeat(64)}` };
      await page.clock.runFor(12_500); expect(observed.requests).toHaveLength(quoteCount);
      expect(preparations).toHaveLength(1);
      await expect(page.locator("#sell-amount")).toBeDisabled();
      await page.evaluate(() => (window as unknown as {__resumeMarketSignature:()=>void}).__resumeMarketSignature());
    }
    await expect(page.getByTestId("trade-receipt")).toContainText("Transaction confirmed");
    await expect(page.getByTestId("trade-receipt")).toContainText(actualBeneficiary);
    await expect(page.getByTestId("exact-input-settlement")).toContainText("Retained protocol charge");
    await expect(page.getByTestId("trade-receipt")).not.toContainText("Input refunded");
    expect(simulated[0].operation).toBe("executeExactInput");
    expect(simulated[0].args[0].body).toBe(selected.plan.body);
    expect(simulated[0].args[0].inputs).toEqual(selected.plan.inputs);
    expect(simulated[0].value).toBe(native ? "1000000000000000000" : "0");
    if (!native) expect(simulated[0].args[1].authorizations[0]).toMatchObject({ kind: 1, permit: { value: "1000000000000000000" } });
  }
  const methods = await page.evaluate(() => (window as unknown as {__marketWalletRequests:{method:string}[]}).__marketWalletRequests.map(row => row.method)) as string[];
  expect(methods.filter(method => method === "eth_signTypedData_v4")).toHaveLength(native ? 0 : 1);
  expect(methods.filter(method => method === "eth_sendTransaction")).toHaveLength(rejected ? 0 : 1);
  if (native) expect(permitReads).toEqual([]);
});
