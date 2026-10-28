import { expect, test, type Page } from "./fixtures/app-test";
import { choose, context, install } from "./fixtures/token-quotes";
import { routeWalletBalances } from "./fixtures/wallet-balances";

const owner = "0x0000000000000000000000000000000000000011";
const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const balance = 123456789012345678901n;
const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; unavailable?: boolean; pending?: Promise<void> };

async function setup(page: Page, options: {
  nativeBalance?: bigint;
  head?: () => typeof context;
  fees?: () => Fees;
  quoteCompletion?: () => Promise<void>;
} = {}) {
  await page.addInitScript(({ owner, chain }) => {
    const requests: string[] = [];
    const provider = { isMetaMask: false, selectedAddress: owner,
      request: async ({ method }: { method: string }) => {
        requests.push(method);
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [owner];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts",
          caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        throw new Error(`Synthetic read-only wallet rejects ${method}`);
      }, on: () => {}, removeListener: () => {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    Object.defineProperty(window, "__ethMaxWalletRequests", { value: requests });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "Synthetic ordinary wallet",
        rdns: "io.synthetic.ordinary", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner, chain });
  const currentHead = options.head ?? (() => context);
  const observed = await install(page, "", options.quoteCompletion, false, undefined, currentHead);
  const nativeBalance = options.nativeBalance ?? balance;
  let feeReads = 0, feeResponses = 0;
  await routeWalletBalances(page, route => route.fulfill({ json: {
    context: currentHead(), holder: owner, native: { status: "success", value: String(nativeBalance) },
    tokens: [{ id: "weth", address: weth, balance: { status: "success", value: String(balance) } }],
  } }));
  await page.route("**/api/account/native-balance*", route => route.fulfill({ json: {
    context: currentHead(), holder: owner, balance: String(nativeBalance),
  } }));
  await page.route("**/api/transaction/fees", async route => {
    feeReads++;
    const fees = options.fees?.() ?? { maxFeePerGas: 2000000007n, maxPriorityFeePerGas: 1000000003n };
    const feeContext = currentHead();
    await fees.pending;
    await route.fulfill(fees.unavailable ? { status: 503, json: { error: "Fee fixture unavailable" } } : { json: {
      context: feeContext, maxFeePerGas: String(fees.maxFeePerGas), maxPriorityFeePerGas: String(fees.maxPriorityFeePerGas),
    } });
    feeResponses++;
  });
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu", exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "Show only tokens available in wallet" }).uncheck();
  return { ...observed, feeReads: () => feeReads, feeResponses: () => feeResponses };
}

const maximum = (page: Page) => page.getByRole("button", { name: "Use maximum sell amount", exact: true });
const sell = (page: Page) => page.locator("#sell-amount");

test("ETH MAX reserves the inclusive fee cap once and quotes the exact wei remainder", async ({ page }) => {
  const observed = await setup(page);
  await choose(page, "ETH");
  await maximum(page).click();
  // 415,000 gas × 2,000,000,007 wei is already inclusive of the priority fee.
  // The three-decimal display must not become the amount sent to the Backend.
  await expect(sell(page)).toHaveValue("123.455");
  await expect.poll(() => observed.intents.at(-1)?.amount).toBe("123455959012342773901");
  expect(observed.intents.at(-1)).toMatchObject({ mode: "issue-exact-in", native: true });
  expect(observed.intents.at(-1)?.amount).not.toBe("123455000000000000000");
});

test("ETH MAX uses refreshed fees while the previous gas presentation is retained", async ({ page }) => {
  let head = { ...context };
  let finish!: () => void;
  let completion = Promise.resolve();
  const observed = await setup(page, {
    head: () => head,
    quoteCompletion: () => completion,
    fees: () => ({ maxFeePerGas: head.blockHash === context.blockHash ? 1000000000n : 3000000011n,
      maxPriorityFeePerGas: 700000001n }),
  });
  try {
    await choose(page, "ETH");
    await sell(page).fill("1");
    await expect(page.getByRole("status", { name: "You Buy CYGLD", exact: true })).toHaveText("1");
    await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "confirmed");
    await expect(page.getByRole("button",{name:"Swap currencies",exact:true})).toBeEnabled();
    await expect(page.locator("#buy-amount")).not.toHaveAttribute("aria-busy", "true");
    await page.getByRole("button", { name: /Total fee/ }).click();
    const gas = page.getByText("Transaction fee (gas):", { exact: true }).locator("..");
    const gasValue = gas.locator("span").last();
    const pendingColor = await page.evaluate(() => {
      const sample = document.createElement("span");
      sample.style.color = "var(--text-input-disabled)";
      document.body.append(sample);
      const color = getComputedStyle(sample).color;
      sample.remove();
      return color;
    });
    await expect(gas).toContainText("~ 0.000415 ETH");
    const previousPresentation = await gasValue.innerText();
    const initialFeeReads = observed.feeReads();
    const initialIntents = observed.intents.length;
    completion = new Promise<void>(resolve => { finish = resolve; });
    await sell(page).fill("2");
    await expect.poll(() => observed.intents.length).toBeGreaterThan(initialIntents);
    await expect(gasValue).toHaveText(previousPresentation);
    await expect(gasValue).toHaveCSS("color", pendingColor);
    await page.clock.install();
    head = { ...head, blockHash: `0x${"b".repeat(64)}` };
    await expect.poll(async () => { await page.clock.runFor(1000); return observed.feeReads(); }).toBe(initialFeeReads + 1);
    await expect(gasValue).toHaveText(previousPresentation);
    await expect(gasValue).toHaveCSS("color", pendingColor);

    await maximum(page).click();
    await expect(sell(page)).toHaveValue("123.455");
    await expect.poll(() => observed.intents.at(-1)?.amount).toBe("123455544012341113901");
    finish();
    await expect(gas).toContainText("~ 0.00125 ETH");
  } finally {
    finish?.();
  }
});

test("ERC20 MAX still quotes the full exact token balance", async ({ page }) => {
  const observed = await setup(page);
  await choose(page, "WETH");
  await maximum(page).click();
  await expect(sell(page)).toHaveValue("123.456");
  await expect.poll(() => observed.intents.at(-1)?.amount).toBe(String(balance));
  expect(observed.intents.at(-1)).toMatchObject({ mode: "issue-exact-in", native: false });
});

test("ETH MAX clamps a balance below the gas budget to zero", async ({ page }) => {
  const observed = await setup(page, { nativeBalance: 1000n });
  await choose(page, "ETH");
  await maximum(page).click();
  await expect(sell(page)).toHaveValue("0");
  await expect(page.getByRole("button", { name: "Enter valid amounts", exact: true })).toBeDisabled();
  expect(observed.intents).toEqual([]);
});

test("manual ETH amounts stay unchanged when a fresh gas cap arrives", async ({ page }) => {
  let head = { ...context };
  const observed = await setup(page, { head: () => head,
    fees: () => ({ maxFeePerGas: head.blockHash === context.blockHash ? 1000000000n : 3000000000n,
      maxPriorityFeePerGas: 1000000000n }) });
  await choose(page, "ETH");
  await sell(page).fill("0.123456789012345678");
  await expect.poll(() => observed.intents.at(-1)?.amount).toBe("123456789012345678");
  await page.getByRole("button", { name: /Total fee/ }).click();
  const gas = page.getByText("Transaction fee (gas):", { exact: true }).locator("..");
  await expect(gas).toContainText("~ 0.000415 ETH");
  const initialFeeReads = observed.feeReads();
  await page.clock.install();
  head = { ...head, blockHash: `0x${"b".repeat(64)}` };
  await expect.poll(async () => { await page.clock.runFor(1000); return observed.feeReads(); }).toBe(initialFeeReads + 1);
  await expect(gas).toContainText("~ 0.00125 ETH");
  await expect(sell(page)).toHaveValue("0.123456789012345678");
  expect(observed.intents.at(-1)?.amount).toBe("123456789012345678");
});

test("a delayed ETH MAX fee read cannot overwrite a later manual edit", async ({ page }) => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const observed = await setup(page, { fees: () => ({ maxFeePerGas: 2000000007n,
    maxPriorityFeePerGas: 1000000003n, pending }) });
  try {
    await choose(page, "ETH");
    await expect.poll(observed.feeReads).toBeGreaterThan(0);
    await maximum(page).click();
    await sell(page).fill("0.2");
    finish();
    await expect.poll(() => observed.intents.at(-1)?.amount).toBe("200000000000000000");
    await expect(sell(page)).toHaveValue("0.2");
    await page.getByRole("button", { name: /Total fee/ }).click();
    await expect(page.getByText("Transaction fee (gas):", { exact: true }).locator("..")).toContainText("~ 0.00083 ETH");
    await expect(sell(page)).toHaveValue("0.2");
    expect(observed.intents.every(intent => intent.amount === "200000000000000000")).toBe(true);
  } finally {
    finish();
  }
});

test("ETH MAX preserves the entered amount when the gas fee read fails", async ({ page }) => {
  const observed = await setup(page, { fees: () => ({ maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, unavailable: true }) });
  await choose(page, "ETH");
  await sell(page).fill("0.1");
  await expect.poll(() => observed.intents.at(-1)?.amount).toBe("100000000000000000");
  await expect.poll(observed.feeResponses).toBeGreaterThanOrEqual(2);
  // Initial ETH can start a canceled development mount read as well as the
  // active query. Wait for that query's failure before asking MAX to retry it.
  await expect(page.getByTestId("swap-fees")).toHaveAttribute("aria-busy", "false");
  const initialFeeResponses = observed.feeResponses();
  let failedResponses = 0;
  const finalFailedRead = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/transaction/fees" && response.status() === 503 && ++failedResponses === 2);
  await maximum(page).click();
  // MAX must finish the ordinary query's retry before preservation is checked.
  await (await finalFailedRead).finished();
  await expect.poll(observed.feeResponses).toBe(initialFeeResponses + 2);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(sell(page)).toHaveValue("0.1");
  expect(observed.intents.every(intent => intent.amount === "100000000000000000")).toBe(true);
});

test("accepting Swap prevents a pending ETH MAX fee read from changing the accepted amount", async ({ page }) => {
  let finishFee!: () => void, finishBalance!: () => void;
  const pendingFee = new Promise<void>(resolve => { finishFee = resolve; });
  const pendingBalance = new Promise<void>(resolve => { finishBalance = resolve; });
  const observed = await setup(page, { fees: () => ({ maxFeePerGas: 2000000007n,
    maxPriorityFeePerGas: 1000000003n, pending: pendingFee }) });
  let preflightStarted = false;
  await page.route("**/api/account/wallet-balances*", async route => {
    if (new URL(route.request().url()).searchParams.get("purpose") !== "swap-preflight") {
      await route.fallback();
      return;
    }
    preflightStarted = true;
    await pendingBalance;
    // Stop before any wallet interaction, including after a failed assertion.
    await route.fulfill({ status: 503, json: { error: "Synthetic held preflight unavailable" } }).catch(() => {});
  });
  const walletRequests = () => page.evaluate(() =>
    (window as unknown as { __ethMaxWalletRequests: string[] }).__ethMaxWalletRequests);
  try {
    await choose(page, "ETH");
    await sell(page).fill("1");
    await expect.poll(() => observed.intents.at(-1)?.amount).toBe("1000000000000000000");
    const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
    await expect(swap).toBeEnabled();
    await expect.poll(observed.feeReads).toBeGreaterThan(0);
    await maximum(page).click();
    await expect(sell(page)).toHaveValue("1");
    await swap.click();
    await expect.poll(() => preflightStarted).toBe(true);

    const completedFeeRead = page.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/transaction/fees" && response.status() === 200);
    finishFee();
    await (await completedFeeRead).finished();
    await expect.poll(observed.feeResponses).toBeGreaterThan(0);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(sell(page)).toHaveValue("1");
    expect(observed.intents.every(intent => intent.amount === "1000000000000000000")).toBe(true);
    expect((await walletRequests()).filter(method => method.startsWith("eth_sign") || method === "eth_sendTransaction")).toEqual([]);

    finishBalance();
    await expect(page.getByText("Wallet balances could not be refreshed. Try again before swapping.", { exact: true })).toBeVisible();
    await expect(sell(page)).toHaveValue("1");
    expect((await walletRequests()).filter(method => method.startsWith("eth_sign") || method === "eth_sendTransaction")).toEqual([]);
  } finally {
    finishFee();
    finishBalance();
  }
});
