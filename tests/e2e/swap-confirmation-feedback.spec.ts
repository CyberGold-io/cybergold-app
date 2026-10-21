import { protocolAddresses } from "../fixtures/protocol-configuration";
import { routeWalletBalances } from "./fixtures/wallet-balances";
import { selectBasket } from "./fixtures/swap-selection";
import { expect, test, type Page } from "./fixtures/app-test";
import { install } from "./fixtures/basket-quotes";
import { installUiSwapObservation, uiSwapObservation } from "../trading/uiSwapObservation";

const owner = "0x0000000000000000000000000000000000000011";
const hash = `0x${"ab".repeat(32)}`;
const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);

function walletSnapshot(cygldBalance = "2000000000000000000") {
  return {
    context: { chainId: chain, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, observedAt: new Date().toISOString() },
    holder: owner, native: { status: "success", value: "1000000000000000000" },
    tokens: [{ id: "cygld", address: protocolAddresses.core,
      balance: { status: "success", value: cygldBalance } }],
  };
}

async function readyRedeem(page: Page) {
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await selectBasket(page, "buy");
  const amount = page.getByRole("textbox", { name: "You Sell CYGLD", exact: true });
  await amount.click();
  await amount.fill("1");
  const submit = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(submit).toBeEnabled();
  return { amount, submit };
}

async function installSigningWallet(page: Page) {
  await page.route("**/api/account/token-permit*", route => route.fulfill({ json: {
    spender: protocolAddresses.helpers, allowance: { status: "success", value: "0" },nonce:{status:"success",value:"0"},
    authorization:{kind:"erc2612",confidence:"qualified",domain:{name:"CyberGold",version:"1",chainId:chain,verifyingContract:protocolAddresses.core}},
  } }));
  await page.addInitScript(({ owner, hash, chain }) => {
    const requests: string[] = [];
    const provider = { isMetaMask: true, selectedAddress: owner,
      request: async ({ method }: { method: string }) => {
        requests.push(method);
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [owner];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        if (method === "eth_signTypedData_v4") return `0x${"01".repeat(64)}1b`;
        if (method === "eth_sendTransaction") return hash;
        throw new Error(`Synthetic wallet rejects ${method}`);
      }, on: () => {}, removeListener: () => {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    Object.defineProperty(window, "__swapConfirmationWalletRequests", { value: requests });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "MetaMask", rdns: "io.metamask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner, hash, chain });
}

for (const nextStatus of ["success", "reverted"] as const) {
  test(`a submitted swap keeps its hash after a receipt outage and rechecks ${nextStatus} without resubmission`, async ({ page }) => {
    await install(page);
    await installSigningWallet(page);
    await page.addInitScript(installUiSwapObservation as () => void);
    let receiptAvailable = false;
    let receiptReads = 0;
    await page.route("**/api/account/core-permit*", route => route.fulfill({ json: {
      nonce: "0", spender: protocolAddresses.helpers, domain: { name: "CyberGold", verifyingContract: protocolAddresses.core },
    } }));
    await page.route("**/api/transaction/wait/head", route => route.fulfill({ json: {
      chainId: chain, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`,
      blockTimestamp: String(Math.floor(Date.now() / 1000)), observedAt: new Date().toISOString(),
    } }));
    await page.route("**/api/transaction/wait/transaction*", route => route.fulfill({ json: {
      transaction: { hash, from: owner, to: protocolAddresses.helpers,
        nonce: "0x0", gas: "0x5208", value: "0x0", input: "0x", type: "0x2",
        blockHash: `0x${"a".repeat(64)}`, blockNumber: "0x64", transactionIndex: "0x0" },
    } }));
    await routeWalletBalances(page, route => route.fulfill({ json: {
      context: { chainId: chain, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, observedAt: new Date().toISOString() },
      holder: owner, native: { status: "success", value: "1000000000000000000" },
      tokens: [{ id: "cygld", address: protocolAddresses.core,
        balance: { status: "success", value: "2000000000000000000" } }],
    } }));
    await page.route("**/api/transaction/wait/receipt*", async route => {
      receiptReads++;
      expect(new URL(route.request().url()).searchParams.get("hash")).toBe(hash);
      await route.fulfill(receiptAvailable ? { json: { chainId: chain, observedAt: new Date().toISOString(),
        receipt: { transactionHash: hash, transactionIndex: "0x0", blockHash: `0x${"a".repeat(64)}`, blockNumber: "0x64",
          from: owner, to: protocolAddresses.helpers, cumulativeGasUsed: "0x5208", gasUsed: "0x5208",
          effectiveGasPrice: "0x1", contractAddress: null, logs: [], logsBloom: `0x${"00".repeat(256)}`,
          status: nextStatus === "success" ? "0x1" : "0x0", type: "0x2" },
      } } : { status: 503, json: { error: "Synthetic receipt outage" } });
    });
    await page.goto("/en");
    await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
    await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await selectBasket(page, "buy");
    const amount = page.getByRole("textbox", { name: "You Sell CYGLD", exact: true });
    await amount.click();
    await amount.fill("1");
    const submit = page.getByRole("button", { name: "Swap currencies", exact: true });
    await expect(submit).toBeEnabled();
    await submit.click();
    const notice = page.getByRole("status").filter({ hasText: hash });
    await expect(notice).toContainText("Transaction submitted; confirmation unavailable", { timeout: 15_000 });
    await expect(notice).toContainText(hash);
    const pending = await uiSwapObservation(page);
    expect(pending).toMatchObject({ outcome: "unconfirmed", transactionHash: hash });
    expect(pending?.attemptId).toBeTruthy();
    await expect(amount).toHaveValue("");
    if (nextStatus === "success") await page.screenshot({ path: "out/audit/followups-submitted-transaction.png", fullPage: true });
    const readsBefore = receiptReads;
    receiptAvailable = true;
    await notice.getByRole("button", { name: "Check confirmation", exact: true }).click();
    await expect(notice).toContainText(nextStatus === "success" ? "Transaction confirmed" : "Transaction reverted");
    if (nextStatus === "success") {
      await expect.poll(() => uiSwapObservation(page, pending!.attemptId)).toMatchObject({
        attemptId: pending!.attemptId, outcome: "succeeded", transactionHash: pending!.transactionHash,
      });
    }
    expect(receiptReads).toBeGreaterThan(readsBefore);
    const writes = await page.evaluate(() => (window as unknown as { __swapConfirmationWalletRequests: string[] }).__swapConfirmationWalletRequests);
    expect(writes.filter(method => method === "eth_sendTransaction")).toHaveLength(1);
    expect(writes.filter(method => method === "eth_signTypedData_v4")).toHaveLength(1);
  });
}

for (const outcome of ["insufficient", "unavailable", "outage", "ready"] as const) {
  test(`Swap checks a fresh spending balance before wallet prompts: ${outcome}`, async ({ page }) => {
    await install(page);
    await installSigningWallet(page);
    let checkStarted = false;
    let balanceReads = 0;
    let preflightReads = 0;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await routeWalletBalances(page, async route => {
      balanceReads++;
      if (new URL(route.request().url()).searchParams.get("purpose") === "swap-preflight") preflightReads++;
      if (!checkStarted) {
        await route.fulfill({ json: walletSnapshot() });
        return;
      }
      if (outcome === "ready") await pending;
      if (outcome === "outage") {
        await route.fulfill({ status: 503, json: { error: "Synthetic balance outage" } });
      } else if (outcome === "unavailable") {
        await route.fulfill({ json: { ...walletSnapshot(), tokens: [{ id: "cygld",
          address: protocolAddresses.core,
          balance: { status: "failure", error: "Synthetic token read unavailable" } }] } });
      } else {
        const value = walletSnapshot(outcome === "insufficient" ? "500000000000000000" : undefined);
        // A failed unrelated asset read must not block the spending asset.
        await route.fulfill({ json: { ...value, tokens: [...value.tokens, {
          id: "usdc", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          balance: { status: "failure", error: "Unrelated token unavailable" },
        }] } });
      }
    });
    await page.route("**/api/account/core-permit*", route => route.fulfill({ json: { nonce: "0", spender: protocolAddresses.helpers, domain: { name: "CyberGold", verifyingContract: protocolAddresses.core } } }));
    await page.route("**/api/transaction/wait/receipt*", route => route.fulfill({ json: { receipt: {
      transactionHash: hash, transactionIndex: "0x0", blockHash: `0x${"a".repeat(64)}`, blockNumber: "0x64",
      from: owner, to: protocolAddresses.helpers, cumulativeGasUsed: "0x5208", gasUsed: "0x5208",
      effectiveGasPrice: "0x1", contractAddress: null, logs: [], logsBloom: `0x${"00".repeat(256)}`, status: "0x1", type: "0x2",
    } } }));
    const { amount, submit } = await readyRedeem(page);
    const before = balanceReads;
    checkStarted = true;
    await submit.click();
    await expect.poll(() => balanceReads).toBeGreaterThan(before);
    expect(preflightReads).toBe(1);
    const requests = () => page.evaluate(() =>
      (window as unknown as { __swapConfirmationWalletRequests: string[] }).__swapConfirmationWalletRequests);
    if (outcome === "ready") {
      expect((await requests()).filter(method => method.startsWith("eth_sign") || method === "eth_sendTransaction")).toEqual([]);
      release();
      await expect.poll(async () => (await requests()).filter(method => method === "eth_sendTransaction").length).toBe(1);
      await expect(page.getByText("Transaction confirmed", { exact: true })).toBeVisible();
      expect((await requests()).filter(method => method === "eth_signTypedData_v4")).toHaveLength(1);
    } else {
      const message = outcome === "insufficient"
        ? "Your current CYGLD balance is lower than the sell amount. Reduce the amount before swapping."
        : outcome === "unavailable"
          ? "The current CYGLD balance is unavailable. Refresh balances or try again before swapping."
          : "Wallet balances could not be refreshed. Try again before swapping.";
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      await expect(amount).toHaveValue("1");
      expect((await requests()).filter(method => method.startsWith("eth_sign") || method === "eth_sendTransaction")).toEqual([]);
    }
  });
}

for (const mode of ["exact-in"] as const) {
  test(`Swap checks fresh basket spending balances: ${mode}`, async ({ page }) => {
    await install(page);
    await installSigningWallet(page);
    let checkStarted = false;
    await routeWalletBalances(page, route => {
      const value = walletSnapshot();
      return route.fulfill({ json: { ...value, tokens: [...value.tokens, {
        id: "paxg", address: "0x45804880de22913dafe09f4980848ece6ecbaf78",
        balance: { status: "success", value: checkStarted ? "500000000000000000" : "2000000000000000000" },
      }] } });
    });
    await page.goto("/en");
    await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
    await selectBasket(page);
    const amount = mode === "exact-in"
      ? page.locator('input[inputmode="decimal"]:not(#execution-tolerance):visible').first()
      : page.getByLabel("You Buy CYGLD", { exact: true });
    await amount.click();
    await amount.fill("1");
    const submit = page.getByRole("button", { name: "Swap currencies", exact: true });
    await expect(submit).toBeEnabled();
    checkStarted = true;
    await submit.click();
    await expect(page.getByText("Your current PAXG balance is lower than the sell amount. Reduce the amount before swapping.", { exact: true })).toBeVisible();
    await expect(amount).toHaveValue("1");
    const requests = await page.evaluate(() =>
      (window as unknown as { __swapConfirmationWalletRequests: string[] }).__swapConfirmationWalletRequests);
    expect(requests.filter(method => method.startsWith("eth_sign") || method === "eth_sendTransaction")).toEqual([]);
  });
}
