import { protocolAddresses } from "../../fixtures/protocol-configuration";
import { routeWalletBalances } from "../../e2e/fixtures/wallet-balances";
import { expect, test, type Page } from "../../e2e/fixtures/app-test";
import { decodeFunctionData, maxUint256 } from "viem";
import { erc20Abi } from "../../../app/contracts/erc20";
import { HELPERS_DIAMOND_ABI } from "../../../app/contracts/generated/helpersDiamond";
import { choose, context, install } from "../../e2e/fixtures/token-quotes";
import { selectBasket } from "../../e2e/fixtures/swap-selection";
import { installUiSwapObservation, uiSwapObservation } from "../../trading/uiSwapObservation";

const owner = "0x0000000000000000000000000000000000000011";
const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const permit2 = "0x00000000000000000000000000000000000000b3";
const hash = `0x${"ab".repeat(32)}` as const, approvalHash = `0x${"cd".repeat(32)}`;
const id = "opaque-bundle-reference-not-a-transaction-hash";
const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
type Mode = "supported" | "unsupported" | "ready" | "unavailable" | "other-chain";
type ProviderKind = "metamask" | "ordinary";
type PermitMode = "none" | "standard" | "rejected" | "unavailable" | "mixed" | "partial-unavailable";
const paxg = "0x45804880de22913dafe09f4980848ece6ecbaf78";
const xaut = "0x68749665ff8d2d112fa859aa293f07a622782f38";
type Calls = { atomicRequired: boolean; chainId: string; from: string;
  calls: { to: string; data: `0x${string}`; value?: string }[] };

async function setup(page: Page, mode: Mode, outcome: "success" | "reverted" | "outage" | "rejected" = "success",
  preapproved = false, providerKind: ProviderKind = "metamask", permitMode: PermitMode = "none", basketAssets = [paxg]) {
  await page.addInitScript(({ owner, hash, approvalHash, chain, mode, outcome, id, providerKind, permitMode }) => {
    const requests: string[] = [], bundles: unknown[] = [], transactions: { data: string }[] = [], signatures: unknown[] = [];
    const sdkGroups: string[][] = [];
    let statusUnavailable = outcome === "outage";
    const provider = { isMetaMask: providerKind === "metamask", selectedAddress: owner,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        requests.push(method);
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [owner];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts",
          caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        if (method === "wallet_getCapabilities") {
          if (mode === "unavailable") throw { code: 4200, message: "Method unsupported" };
          return { [`0x${(mode === "other-chain" ? chain + 1 : chain).toString(16)}`]: {
            atomic: { status: mode === "other-chain" ? "supported" : mode },
          } };
        }
        if (method === "eth_signTypedData_v4") {
          signatures.push(JSON.parse(String(params![1])));
          if (permitMode === "rejected") throw { code: 4001, message: "Signature rejected" };
          if (permitMode === "partial-unavailable" && signatures.length === 2) throw { code: 4200, message: "Later typed data unavailable" };
          if (permitMode === "unavailable") throw { code: 4200, message: "Typed data unavailable" };
          return `0x${"01".repeat(64)}1b`;
        }
        if (method === "wallet_sendCalls") {
          bundles.push(params![0]);
          if (outcome === "rejected") throw { code: 4001, message: "Rejected" };
          return { id };
        }
        if (method === "wallet_getCallsStatus") {
          if (statusUnavailable) throw { code: -32603, message: "Status unavailable" };
          return { version: "2.0.0", chainId: `0x${chain.toString(16)}`, atomic: true,
            status: outcome === "reverted" ? 500 : 200, receipts: [{ transactionHash: hash,
              blockNumber: "0x64", gasUsed: "0x60000", status: outcome === "reverted" ? "0x0" : "0x1", logs: [] }] };
        }
        if (method === "eth_sendTransaction") {
          const tx = params![0] as { data: string }; transactions.push(tx);
          if (outcome === "rejected" && !tx.data.startsWith("0x095ea7b3")) throw { code: 4001, message: "Transaction rejected" };
          return tx.data.startsWith("0x095ea7b3") ? approvalHash : hash;
        }
        throw new Error(`Synthetic wallet rejects ${method}`);
      }, on: () => {}, removeListener: () => {},
    };
    // Observe the installed SDK wrapper itself, without replacing its handler.
    // The SDK captures its extension Proxy before publishing window.mmsdk.
    const NativeProxy = Proxy;
    window.Proxy = new NativeProxy(NativeProxy, { construct(target, [subject, handler]) {
      const wrapped = new NativeProxy(subject, handler);
      if (subject !== provider || !String(Reflect.get(wrapped, "request")).includes("Overwriting request method")) return wrapped;
      return new NativeProxy(wrapped, { get(sdkProvider, property) {
        const value = Reflect.get(sdkProvider, property);
        if (property !== "request") return value;
        return (request: { method: string; params?: { method: string }[] }) => {
          if (request.method === "metamask_batch") sdkGroups.push(request.params!.map(rpc => rpc.method));
          return value.call(sdkProvider, request);
        };
      } });
    } });
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    Object.assign(window, { __walletBatchTest: { requests, bundles, transactions, signatures, sdkGroups, restoreStatus: () => { statusUnavailable = false; } } });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788",
        name: providerKind === "metamask" ? "MetaMask" : "Synthetic ordinary wallet",
        rdns: providerKind === "metamask" ? "io.metamask" : "io.synthetic.ordinary",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner, hash, approvalHash, chain, mode, outcome, id, providerKind, permitMode });
  await install(page, "", undefined, false, basketAssets, () => context, () => "PAX Gold", false,
    basketAssets.map(address => address === paxg ? "PAXG" : address === xaut ? "XAUt" : "WETH"));
  await page.route("**/api/diagnostics", route => route.fulfill({ status: 202, json: { accepted: true } }));
  await routeWalletBalances(page, route => route.fulfill({ json: {
    context, holder: owner, native: { status: "success", value: String(100n * 10n ** 18n) }, tokens: [
      { id: "weth", address: weth, balance: { status: "success", value: String(100n * 10n ** 18n) } },
      { id: "paxg", address: paxg, balance: { status: "success", value: String(100n * 10n ** 18n) } },
      { id: "xaut", address: xaut, balance: { status: "success", value: String(100n * 10n ** 18n) } },
      { id: "cygld", address: protocolAddresses.core, balance: { status: "success", value: String(100n * 10n ** 18n) } },
    ],
  } }));
  await page.route("**/api/governance/helpers-facts*", route => route.fulfill({ json: {
    context, helpers: protocolAddresses.helpers, configuration: {
      helperFeePpm: { status: "success", value: "0" }, permit2: { status: "success", value: permit2 },
      wrappedNative: { status: "success", value: weth }, owner: { status: "success", value: owner },
      approvedAdapters: { status: "success", value: [protocolAddresses.adapter] },
      basketPermitIssuanceExactIn: { status: "success", value: permitMode !== "none" },
      basketPermitIssuanceExactOut: { status: "success", value: permitMode !== "none" },
      paused: { status: "success", value: false }, tokenPermitIssuance: { status: "success", value: permitMode !== "none" },
    }, adapter: { address: protocolAddresses.adapter, codePresent: { status: "success", value: true } },
  } }));
  await page.route("**/api/account/permit2", route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: { context, mode: request.mode, permit2,
      result: request.mode === "allowances" ? { allowances: request.tokens.map((token: string) => ({ token,
        value: preapproved ? String(maxUint256) : "0" })) } : request.mode === "nonce" ? { nonce: "0" } : { code: "0x01" } } });
  });
  await page.route("**/api/account/token-permit*", route => {
    const token = new URL(route.request().url()).searchParams.get("token")!;
    return route.fulfill({ json: { context, token: { chainId: chain, address: token }, owner,
      spender: protocolAddresses.helpers,
      nonce: { status: "success", value: "0" }, allowance: { status: "success", value: preapproved ? String(maxUint256) : "0" },
      authorization: permitMode === "none" || permitMode === "mixed" && token.toLowerCase() === weth ? { kind: "none", confidence: "observed" } : { kind: "erc2612", confidence: "qualified",
        domain: { name: "Synthetic token", version: "2", chainId: chain, verifyingContract: token } },
    } });
  });
  await page.route("**/api/account/core-permit*", route => route.fulfill({ json: { nonce: "0", spender: protocolAddresses.helpers, domain: { name: "CyberGold", verifyingContract: protocolAddresses.core } } }));
  await page.route("**/api/transaction/token-approval-gas", route => route.fulfill({ json: { gas: "50000" } }));
  await page.route("**/api/transaction/permit2-approval-gas", route => route.fulfill({ json: { gas: "50000" } }));
  await page.route("**/api/transaction/helpers-execution", route => route.fulfill({ json: { context, helpers: protocolAddresses.helpers, gas: "360000" } }));
  await page.route("**/api/transaction/wait/receipt*", route => {
    const txHash = new URL(route.request().url()).searchParams.get("hash");
    return route.fulfill({ json: { receipt: { transactionHash: txHash, transactionIndex: "0x0", blockHash: context.blockHash,
      blockNumber: "0x64", from: owner, to: protocolAddresses.helpers, cumulativeGasUsed: "0x60000",
      gasUsed: "0x60000", effectiveGasPrice: "0x1", contractAddress: null, logs: [],
      logsBloom: `0x${"00".repeat(256)}`, status: "0x1", type: "0x2" } } });
  });
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await page.getByRole("switch").uncheck();
  const observed = () => page.evaluate(() => (window as unknown as { __walletBatchTest: {
    sdkGroups: string[][]; requests: string[]; bundles: Calls[]; transactions: { data: `0x${string}` }[]; signatures: { message: { value: string; spender: string }; domain: { version: string } }[];
  } }).__walletBatchTest);
  await expect.poll(async () => (await observed()).requests.includes("wallet_getCapabilities")).toBe(true);
  // Let the capability query publish before an immediate synthetic click.
  await page.waitForTimeout(100);
  return observed;
}

for (const mode of ["supported", "unsupported", "ready", "unavailable", "other-chain"] as const) {
  test(`token purchase uses wallet batching only for supported ${mode} account/network`, async ({ page }) => {
    const observed = await setup(page, mode);
    await choose(page, "WETH"); await page.locator("#sell-amount").fill("1");
    await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Swap currencies", exact: true }).click();
    await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
    const state = await observed();
    expect(state.requests.filter(method => method === "eth_signTypedData_v4")).toHaveLength(1);
    if (mode === "supported") {
      expect(state.bundles).toHaveLength(1); expect(state.transactions).toHaveLength(0);
      const bundle = state.bundles[0];
      expect(bundle.atomicRequired).toBe(true); expect(bundle.chainId).toBe(`0x${chain.toString(16)}`);
      expect(bundle.calls.map(call => call.to.toLowerCase())).toEqual([weth, protocolAddresses.helpers!.toLowerCase()]);
      const approval = decodeFunctionData({ abi: erc20Abi, data: bundle.calls[0].data });
      expect(approval.args).toEqual([permit2, maxUint256]);
      const swap = decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: bundle.calls[1].data });
      expect(swap.functionName).toBe("issueFromTokenExactOutWithPermit2");
      expect(swap.args![0]).toMatchObject({ maximumInputAmount: 10n ** 18n, netCygldOut: 10n ** 18n });
    } else {
      expect(state.bundles).toHaveLength(0); expect(state.transactions).toHaveLength(2);
    }
  });
}

for (const exactOut of [false, true]) {
  test(`basket purchase batches its first-use approval: ${exactOut ? "exact-out" : "exact-in"}`, async ({ page }) => {
    const observed = await setup(page, "supported"); await selectBasket(page);
    const amount = exactOut ? page.getByRole("textbox", { name: "You Buy CYGLD", exact: true })
      : page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
    await amount.click(); await amount.fill("1");
    const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
    await expect(swap).toBeEnabled(); await swap.click();
    await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
    const state = await observed(); expect(state.bundles).toHaveLength(1); expect(state.transactions).toHaveLength(0);
    const decoded = decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: state.bundles[0].calls.at(-1)!.data });
    expect(decoded.functionName).toBe(exactOut ? "issueFromBasketExactOutWithPermit2" : "issueFromBasketExactInWithPermit2");
  });
}

test("a token exact-output purchase preserves its target and input limit in the batch", async ({ page }) => {
  const observed = await setup(page, "supported"); await choose(page, "WETH");
  await page.locator("#buy-amount").click(); await page.locator("#buy-amount").fill("2");
  await expect(page.locator("#sell-amount")).toHaveValue("2");
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.getByTestId("swap-maximum-input")).toContainText("2.02 WETH");
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click();
  await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
  const state = await observed();
  const decoded = decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: state.bundles[0].calls.at(-1)!.data });
  expect(decoded.functionName).toBe("issueFromTokenExactOutWithPermit2");
  // The fixture's 2 WETH expected input has a 1% execution ceiling.
  expect(decoded.args![0]).toMatchObject({ netCygldOut: 2n * 10n ** 18n, maximumInputAmount: 2_020_000_000_000_000_000n });
});

test("preapproved atomic spending retains one execution call without unnecessary approvals", async ({ page }) => {
  const observed = await setup(page, "supported", "success", true); await choose(page, "WETH");
  await page.locator("#sell-amount").fill("1");
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click();
  await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
  expect((await observed()).bundles).toHaveLength(1); expect((await observed()).bundles[0].calls).toHaveLength(1);
  expect((await observed()).transactions).toHaveLength(0);
});

for (const receiptOutcome of ["confirmed", "unavailable"] as const) {
  test(`Permit2 signature overlaps the pending approval receipt; ${receiptOutcome} receipt controls swap submission`, async ({ page }) => {
    const observed = await setup(page, "unsupported", "success", false, "ordinary");
    let approvalReceiptRequested = false;
    let releaseReceipt!: () => void;
    const pendingReceipt = new Promise<void>(resolve => { releaseReceipt = resolve; });
    await page.route("**/api/transaction/wait/receipt*", async route => {
      const txHash = new URL(route.request().url()).searchParams.get("hash");
      if (txHash !== approvalHash) {
        await route.fallback();
        return;
      }
      approvalReceiptRequested = true;
      await pendingReceipt;
      await route.fulfill(receiptOutcome === "unavailable"
        ? { status: 503, json: { error: "Approval receipt observation unavailable" } }
        : { json: { receipt: { transactionHash: approvalHash, transactionIndex: "0x0", blockHash: context.blockHash,
          blockNumber: "0x64", from: owner, to: "0x45804880de22913dafe09f4980848ece6ecbaf78", cumulativeGasUsed: "0xc350", gasUsed: "0xc350",
          effectiveGasPrice: "0x1", contractAddress: null, logs: [], logsBloom: `0x${"00".repeat(256)}`,
          status: "0x1", type: "0x2" } } });
    });
    try {
      await selectBasket(page);
      await page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true }).fill("1");
      const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
      await expect(swap).toBeEnabled();
      await swap.click();
      await expect.poll(() => approvalReceiptRequested).toBe(true);
      await expect.poll(async () => (await observed()).requests.filter(method => method === "eth_signTypedData_v4").length).toBe(1);
      // Allow the synthetic signature to resolve while the receipt stays held.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const pending = await observed();
      expect(pending.transactions).toHaveLength(1);
      expect(decodeFunctionData({ abi: erc20Abi, data: pending.transactions[0].data }).functionName).toBe("approve");
      expect(pending.bundles).toHaveLength(0);

      releaseReceipt();
      if (receiptOutcome === "confirmed") {
        await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
        const state = await observed();
        expect(state.transactions).toHaveLength(2);
        expect(decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: state.transactions[1].data }).functionName)
          .toBe("issueFromBasketExactInWithPermit2");
      } else {
        await expect(page.getByText("Transaction failed", { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true })).toHaveValue("1");
        expect((await observed()).transactions).toHaveLength(1);
      }
      expect((await observed()).requests.filter(method => method === "eth_signTypedData_v4")).toHaveLength(1);
    } finally {
      releaseReceipt();
    }
  });
}

test("installed MetaMask SDK queues approval then swap after Permit2 signing while the approval receipt is held", async ({ page }) => {
  // Only wallet responses and Backend observations are synthetic. The App
  // initializes the installed SDK and calls its genuine metamask_batch handler.
  const observed = await setup(page, "unsupported");
  let approvalReceiptRequested = false;
  let releaseReceipt!: () => void;
  const pendingReceipt = new Promise<void>(resolve => { releaseReceipt = resolve; });
  await page.route("**/api/transaction/wait/receipt*", async route => {
    const txHash = new URL(route.request().url()).searchParams.get("hash");
    if (txHash !== approvalHash) {
      await route.fallback();
      return;
    }
    approvalReceiptRequested = true;
    await pendingReceipt;
    await route.fulfill({ json: { receipt: { transactionHash: approvalHash, transactionIndex: "0x0", blockHash: context.blockHash,
      blockNumber: "0x64", from: owner, to: "0x45804880de22913dafe09f4980848ece6ecbaf78", cumulativeGasUsed: "0xc350", gasUsed: "0xc350",
      effectiveGasPrice: "0x1", contractAddress: null, logs: [], logsBloom: `0x${"00".repeat(256)}`,
      status: "0x1", type: "0x2" } } });
  });
  try {
    await selectBasket(page);
    await page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true }).fill("1");
    const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
    await expect(swap).toBeEnabled();
    await swap.click();
    await expect.poll(async () => (await observed()).transactions.length).toBe(2);
    await expect.poll(() => approvalReceiptRequested).toBe(true);
    const pending = await observed();
    expect(pending.requests.filter(method => ["eth_signTypedData_v4", "eth_sendTransaction"].includes(method)))
      .toEqual(["eth_signTypedData_v4", "eth_sendTransaction", "eth_sendTransaction"]);
    expect(decodeFunctionData({ abi: erc20Abi, data: pending.transactions[0].data }).functionName).toBe("approve");
    expect(decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: pending.transactions[1].data }).functionName)
      .toBe("issueFromBasketExactInWithPermit2");
    expect(pending.bundles).toHaveLength(0);
    expect(pending.sdkGroups).toEqual([["eth_signTypedData_v4"], ["eth_sendTransaction", "eth_sendTransaction"]]);
    await expect(page.getByText("Transaction confirmed", { exact: true })).toHaveCount(0);
    releaseReceipt();
    await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
    expect((await observed()).transactions).toHaveLength(2);
    expect((await observed()).requests.filter(method => method === "eth_signTypedData_v4")).toHaveLength(1);
  } finally {
    releaseReceipt();
  }
});

for (const outcome of ["reverted", "outage", "rejected"] as const) {
  test(`batch ${outcome} keeps its original outcome without sending separate transactions`, async ({ page }) => {
    await page.addInitScript(installUiSwapObservation as () => void);
    const observed = await setup(page, "supported", outcome); await choose(page, "WETH");
    await page.locator("#sell-amount").fill("1");
    const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
    await expect(swap).toBeEnabled(); await swap.click();
    const notice = page.locator("main").getByRole("status");
    if (outcome === "rejected") {
      await expect(page.getByText("Wallet request cancelled", { exact: true })).toBeVisible();
      await expect(page.locator("#sell-amount")).toHaveValue("1");
    } else {
      await expect(notice).toContainText(outcome === "outage" ? "Transaction submitted; confirmation unavailable" : "Transaction reverted");
      await expect(page.locator("#sell-amount")).toHaveValue("");
      await expect(notice.getByRole("link", { name: "View transaction" })).toHaveCount(0);
      await expect(notice).not.toContainText(id);
      if (outcome === "outage") {
        const pending = await uiSwapObservation(page);
        // An atomic bundle has no transaction hash until its receipt is read.
        expect(pending).toMatchObject({ outcome: "unconfirmed" });
        expect(pending?.attemptId).toBeTruthy();
        expect(pending?.transactionHash).toBeUndefined();
        await page.evaluate(() => (window as unknown as { __walletBatchTest: { restoreStatus: () => void } }).__walletBatchTest.restoreStatus());
        await notice.getByRole("button", { name: "Check confirmation", exact: true }).click();
        await expect(notice).toContainText("Transaction confirmed");
        await expect(notice).toContainText(hash);
        await expect.poll(() => uiSwapObservation(page, pending!.attemptId)).toMatchObject({
          attemptId: pending!.attemptId, outcome: "succeeded", transactionHash: hash,
        });
      }
    }
    expect((await observed()).bundles).toHaveLength(1); expect((await observed()).transactions).toHaveLength(0);
  });
}


for (const exactOut of [false, true]) {
  test(`standard token permit needs one signature and one purchase transaction: ${exactOut ? "exact-out" : "exact-in"}`, async ({ page }) => {
    const observed = await setup(page, "unsupported", "success", false, "metamask", "standard");
    await page.locator('main button[aria-haspopup="dialog"]').first().click();
    await page.getByRole("dialog").getByRole("button", { name: "PAXG Paxos Gold PAXG", exact: true }).click();
    const amount = exactOut ? page.locator("#buy-amount") : page.locator("#sell-amount");
    await amount.click(); await amount.fill("1");
    const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
    await expect(swap).toBeEnabled(); await swap.click();
    await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
    const state = await observed();
    expect(state.signatures).toHaveLength(1); expect(state.transactions).toHaveLength(1); expect(state.bundles).toHaveLength(0);
    expect(state.sdkGroups).toEqual([["eth_signTypedData_v4"], ["eth_sendTransaction"]]);
    const decoded = decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: state.transactions[0].data });
    expect(decoded.functionName).toBe("issueFromTokenExactOutWithPermit");
    const ceiling = (decoded.args![0] as { maximumInputAmount: bigint }).maximumInputAmount;
    expect(BigInt(state.signatures[0].message.value)).toBe(ceiling);
    expect((decoded.args![2] as { value: bigint }).value).toBe(ceiling);
    expect(state.signatures[0].message.spender.toLowerCase()).toBe(protocolAddresses.helpers!.toLowerCase());
    expect(state.signatures[0].domain.version).toBe("2");
  });
}

test("rejected native permit keeps the form and requests no replacement approval", async ({ page }) => {
  const observed = await setup(page, "unsupported", "success", false, "metamask", "rejected");
  await choose(page, "WETH"); await page.locator("#sell-amount").fill("1");
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click();
  await expect(page.getByText("Wallet request cancelled", { exact: true })).toBeVisible();
  await expect(page.locator("#sell-amount")).toHaveValue("1");
  const state = await observed(); expect(state.signatures).toHaveLength(1); expect(state.transactions).toHaveLength(0); expect(state.bundles).toHaveLength(0);
});

test("wallet typed-data unavailability retains ordinary exact approval", async ({ page }) => {
  const observed = await setup(page, "unsupported", "success", false, "ordinary", "unavailable");
  await choose(page, "WETH"); await page.locator("#sell-amount").fill("1");
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click();
  await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
  const state = await observed(); expect(state.signatures).toHaveLength(1); expect(state.transactions).toHaveLength(2);
  expect(decodeFunctionData({ abi: erc20Abi, data: state.transactions[0].data }).args)
    .toEqual([protocolAddresses.helpers, 10n ** 18n]);
  expect(decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: state.transactions[1].data }).functionName).toBe("issueFromTokenExactOut");
});

for (const mode of ["unsupported", "supported"] as const) for (const exactOut of [false, true]) {
  test(`all-native basket groups signatures and retains ${mode} transaction transport: ${exactOut ? "exact-out" : "exact-in"}`, async ({ page }) => {
    const observed = await setup(page, mode, "success", false, "metamask", "standard", [paxg, xaut]);
    await selectBasket(page);
    const amount = exactOut ? page.getByRole("textbox", { name: "You Buy CYGLD", exact: true })
      : page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true });
    await amount.click(); await amount.fill("1");
    const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
    await expect(swap).toBeEnabled(); await swap.click();
    await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
    const state = await observed(); expect(state.signatures).toHaveLength(2);
    expect(state.sdkGroups).toEqual(mode === "supported" ? [["eth_signTypedData_v4", "eth_signTypedData_v4"]]
      : [["eth_signTypedData_v4", "eth_signTypedData_v4"], ["eth_sendTransaction"]]);
    const data = mode === "supported" ? state.bundles[0].calls[0].data : state.transactions[0].data;
    const decoded = decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data });
    expect(decoded.functionName).toBe(exactOut ? "issueFromBasketExactOutWithMixedPermits" : "issueFromBasketExactInWithMixedPermits");
    const inputs = decoded.args![1] as readonly { token: string; authorization: number; maximumInputAmount: bigint; permit: { value: bigint } }[];
    expect(inputs.map(input => input.token.toLowerCase())).toEqual([paxg, xaut]);
    expect(inputs.map(input => input.authorization)).toEqual([1, 1]);
    expect(inputs.map(input => input.permit.value)).toEqual(inputs.map(input => input.maximumInputAmount));
    expect(inputs.map(input => input.permit.value)).toEqual(state.signatures.map(sig => BigInt(sig.message.value)));
    expect((decoded.args![2] as { permit: { permitted: readonly unknown[] } }).permit.permitted).toEqual([]);
  });
}

test("mixed native and unsupported basket groups two token permits plus one compact exact Permit2 permission", async ({ page }) => {
  const observed = await setup(page, "unsupported", "success", false, "metamask", "mixed", [paxg, xaut, weth]);
  await selectBasket(page); await page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true }).fill("1");
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click(); await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
  const state = await observed();
  expect(state.sdkGroups).toEqual([["eth_signTypedData_v4", "eth_signTypedData_v4", "eth_signTypedData_v4"], ["eth_sendTransaction", "eth_sendTransaction"]]);
  expect(decodeFunctionData({ abi: erc20Abi, data: state.transactions[0].data }).args).toEqual([permit2, maxUint256]);
  const decoded = decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: state.transactions[1].data });
  expect(decoded.functionName).toBe("issueFromBasketExactInWithMixedPermits");
  const inputs = decoded.args![1] as readonly { token: string; authorization: number; maximumInputAmount: bigint }[];
  expect(inputs.map(input => input.authorization)).toEqual([1, 1, 2]);
  const subset = (decoded.args![2] as { permit: { permitted: readonly { token: string; amount: bigint }[] } }).permit.permitted;
  expect(subset).toHaveLength(1); expect(subset[0].token.toLowerCase()).toBe(weth); expect(subset[0].amount).toBe(inputs[2].maximumInputAmount);
});

test("a later SDK native signature format error stops without alternate approvals or execution", async ({ page }) => {
  const observed = await setup(page, "unsupported", "success", false, "metamask", "partial-unavailable", [paxg, xaut]);
  await selectBasket(page); await page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true }).fill("1");
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click(); await expect(page.getByText("Transaction failed", { exact: true })).toBeVisible();
  const state = await observed(); expect(state.signatures).toHaveLength(2); expect(state.transactions).toEqual([]); expect(state.bundles).toEqual([]);
  expect(state.sdkGroups).toEqual([["eth_signTypedData_v4", "eth_signTypedData_v4"]]);
});

for (const output of ["WETH", "ETH", "basket"] as const) for (const preapproved of [false, true]) test(`${output} redemption batches its exact permit only when allowance is insufficient: ${preapproved ? "warm" : "fresh"}`, async ({ page }) => {
  const observed = await setup(page, "unsupported", "success", preapproved, "metamask", "standard");
  if (output !== "basket") await choose(page, output);
  await page.getByRole("button", { name: "Reverse swap direction" }).click();
  if (output === "basket") await selectBasket(page, "buy");
  const amount = page.getByRole("textbox", { name: "You Sell CYGLD", exact: true });
  await amount.click(); await amount.fill("1");
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click(); await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
  const state = await observed();
  expect(state.sdkGroups).toEqual(preapproved ? [["eth_sendTransaction"]] : [["eth_signTypedData_v4"], ["eth_sendTransaction"]]);
  const decoded = decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: state.transactions[0].data });
  const base = output === "basket" ? "redeemToBasketExactIn" : output === "ETH" ? "redeemToNativeExactIn" : "redeemToTokenExactIn";
  expect(decoded.functionName).toBe(preapproved ? base : `${base}WithPermit`);
  if (!preapproved) expect(BigInt(state.signatures[0].message.value)).toBe((decoded.args![0] as { grossCygldIn: bigint }).grossCygldIn);
});

test("native ETH purchase has no typed signature group and one SDK transaction group", async ({ page }) => {
  const observed = await setup(page, "unsupported"); await choose(page, "ETH"); await page.locator("#sell-amount").fill("1");
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click(); await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
  const state = await observed(); expect(state.signatures).toEqual([]); expect(state.sdkGroups).toEqual([["eth_sendTransaction"]]);
  expect(decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: state.transactions[0].data }).functionName).toBe("issueFromNativeExactOut");
});

test("first SDK typed-format unavailability sends one replacement exact-approval transaction group", async ({ page }) => {
  const observed = await setup(page, "unsupported", "success", false, "metamask", "unavailable");
  await choose(page, "WETH"); await page.locator("#sell-amount").fill("1");
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click(); await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
  const state = await observed();
  expect(state.sdkGroups).toEqual([["eth_signTypedData_v4"], ["eth_sendTransaction", "eth_sendTransaction"]]);
  expect(state.signatures).toHaveLength(1); expect(state.transactions).toHaveLength(2);
  expect(decodeFunctionData({ abi: erc20Abi, data: state.transactions[0].data }).args).toEqual([protocolAddresses.helpers, 10n ** 18n]);
  expect(decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: state.transactions[1].data }).functionName).toBe("issueFromTokenExactOut");
});

test("a rejected SDK execution after setup approval preserves the form without replay or replacement", async ({ page }) => {
  const observed = await setup(page, "unsupported", "rejected");
  await choose(page, "WETH"); await page.locator("#sell-amount").fill("1");
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click(); await expect(page.getByText("Wallet request cancelled", { exact: true })).toBeVisible();
  await expect(page.locator("#sell-amount")).toHaveValue("1");
  const state = await observed();
  expect(state.sdkGroups).toEqual([["eth_signTypedData_v4"], ["eth_sendTransaction", "eth_sendTransaction"]]);
  expect(state.signatures).toHaveLength(1); expect(state.transactions).toHaveLength(2); expect(state.bundles).toEqual([]);
  expect(decodeFunctionData({ abi: erc20Abi, data: state.transactions[0].data }).args).toEqual([permit2, maxUint256]);
  expect(decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: state.transactions[1].data }).functionName).toBe("issueFromTokenExactOutWithPermit2");
});
