import { expect, test, type Page } from "./fixtures/app-test";
import type { PoolSnapshot } from "../../app/utils/poolSnapshot";
import type { WalletBalancesSnapshot } from "../../app/utils/walletBalanceSnapshot";
import { choose } from "./fixtures/token-quotes";
import { routeWalletBalances } from "./fixtures/wallet-balances";
import { tokenAddresses } from "../fixtures/protocol-configuration";
import { LIQUIDITY_POOL } from "../../app/config/liquidityPool";

const ALICE = "0x00000000000000000000000000000000000000a1";
const BOB = "0x00000000000000000000000000000000000000b2";
const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const chainHex = `0x${chain.toString(16)}`;
const success = (value: string) => ({ status: "success" as const, value });
function snapshot(holder: string, partial = false): WalletBalancesSnapshot { return {
  context: { chainId: chain, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, blockTimestamp: "1790800000", observedAt: "2026-10-01T00:00:00Z" },
  holder, native: success("3000000000000000000"), tokens: [
    { id: "cygld", address: ALICE, balance: success(holder.toLowerCase() === ALICE ? "2000000000000000000" : "7000000000000000000") },
    { id: "usdc", address: BOB, balance: partial ? { status: "failure", error: "contract-read-failed" } : success("0") },
    ...(["xaut", "paxg", "usdt", "weth"] as const).map(id => ({ id, address: ALICE, balance: success("0") })),
  ],
}; }

async function install(page: Page, mode: "ready" | "partial" | "outage", poolMode?: "ready" | "partial" | "outage") {
  await page.addInitScript(({ account, chainHex }) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>(); let accounts = [account];
    const provider = { isMetaMask: true, selectedAddress: account,
      request: async ({ method }: { method: string }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return accounts;
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: accounts }] }];
        if (method === "eth_chainId") return chainHex;
        if (method === "net_version") return String(BigInt(chainHex));
        if (method === "eth_getBalance") return "0x0";
        if (method === "wallet_watchAsset") return true;
        throw new Error(`Synthetic wallet rejects ${method}`);
      },
      on: (event: string, listener: (...args: unknown[]) => void) => { const set = listeners.get(event) ?? new Set(); set.add(listener); listeners.set(event, set); },
      removeListener: (event: string, listener: (...args: unknown[]) => void) => { listeners.get(event)?.delete(listener); },
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "MetaMask", rdns: "io.metamask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
    Object.defineProperty(window, "__switchBalanceTestAccount", { value: (account: string) => {
      accounts = [account]; provider.selectedAddress = account;
      listeners.get("accountsChanged")?.forEach(listener => listener(accounts));
    } });
  }, { account: ALICE, chainHex });
  const holders: string[] = [], calls: string[] = [], pools: number[] = [], genericRequests: string[] = [], nativeHolders: string[] = [], tokenRequests: string[] = [];
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:3000").origin;
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/api/protocol/config") { await route.fallback(); return; }
    if (url.pathname === "/api/account/wallet-balances") {
      expect(request.headers()["authorization"]).toBeUndefined();
      expect(url.searchParams.get("purpose")).toBe("display");
      const holder = url.searchParams.get("holder")!; holders.push(holder.toLowerCase());
      const value = snapshot(holder, mode === "partial");
      await route.fulfill(mode === "outage" ? { status: 503, json: { error: "Wallet balances are temporarily unavailable." } } : { json: value });
    } else if (url.pathname === "/api/account/token-balance") {
      tokenRequests.push(request.url());
      await route.fulfill({ status: 503, json: { error: "Individual token reads are not used by the wallet." } });
    } else if (url.pathname === "/api/account/native-balance") {
      expect(request.headers()["authorization"]).toBeUndefined();
      expect(url.searchParams.get("purpose")).toBe("display");
      const holder = url.searchParams.get("holder")!; nativeHolders.push(holder.toLowerCase());
      await route.fulfill({ json: { context: snapshot(holder).context, holder, balance: "9000000000000000000" } });
    } else if (url.pathname === "/api/account/ens-name") {
      await route.fulfill({ json: { context: snapshot(ALICE).context, holder: url.searchParams.get("holder"), name: "alice.eth" } });
    } else if (url.pathname === "/api/account/ens-avatar-record") {
      await route.fulfill({ json: { context: snapshot(ALICE).context, name: "alice.eth", avatarRecord: null } });
    } else if (url.pathname === "/api/pools/snapshot" && poolMode) {
      expect(request.headers()["authorization"]).toBeUndefined();
      const identifier = request.postDataJSON(); pools.push(identifier.fee);
      if (poolMode === "outage" || (poolMode === "partial" && identifier.fee === 500)) {
        await route.fulfill({ status: 503, json: { error: "Pool observations unavailable" } });
      } else {
        const Q96 = 2n ** 96n;
        const sqrt = identifier.fee === 100 ? Q96 : identifier.fee === 3000 ? Q96 / 2n : Q96 * 2n ** 16n;
        const payload: PoolSnapshot = {
          context: snapshot(ALICE).context, dex: "uniswap_v3", token0: identifier.tokenA, token1: identifier.tokenB,
          fee: identifier.fee, exists: true, poolAddress: ALICE, sqrtPriceX96Raw: sqrt.toString(),
          activeLiquidityRaw: "1", tick: 0, token0BalanceRaw: "1", token1BalanceRaw: "1",
        };
        await route.fulfill({ json: payload });
      }
    } else if (url.pathname === "/api/gold" && poolMode) {
      await route.fulfill({ json: { price: 3320, fetchedAt: "2026-10-01T00:00:00Z", stale: false } });
    } else if (url.pathname === "/api/rpc") {
      expect(url.pathname).not.toBe("/api/rpc");
      await route.continue();
    } else if (url.pathname.startsWith("/api/")) await route.fulfill({ status: 503, json: { error: "Unrelated fixture API unavailable" } });
    else if (url.origin !== origin) await route.abort();
    else await route.continue();
  });
  return { holders, calls, pools, genericRequests, nativeHolders, tokenRequests };
}

async function selectSwapToken(page: Page, side: "sell" | "buy", symbol: string, name: string) {
  await page.locator("main button[aria-haspopup='dialog']").nth(side === "sell" ? 0 : 1).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("textbox").fill(symbol);
  await picker.getByRole("button", { name: `${symbol} ${name} ${symbol}`, exact: true }).click();
}

test("swap fields follow selected tokens and direction, retain zero and MAX, and hide balances after disconnect", async ({ page }) => {
  await install(page, "ready");
  const current = snapshot(ALICE);
  current.native = success("3123456789000000000");
  await routeWalletBalances(page, route => route.fulfill({ json: current }));
  await page.goto("/en");
  const sellBalance = page.getByTestId("sell-wallet-balance");
  const buyBalance = page.getByTestId("buy-wallet-balance");
  await expect(sellBalance).toHaveCount(0);
  await expect(buyBalance).toHaveText("2 CYGLD");
  await selectSwapToken(page, "sell", "ETH", "Ether");
  await expect(sellBalance).toHaveText("3.12346 ETH");
  await expect(sellBalance).toHaveAttribute("title", "Balance: 3.123456789 ETH");
  await expect(page.getByRole("button", { name: "Use maximum sell amount", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await expect(sellBalance).toHaveText("2 CYGLD");
  await expect(buyBalance).toHaveText("3.12346 ETH");
  await selectSwapToken(page, "buy", "USDC", "USDC");
  await expect(buyBalance).toHaveText("0 USDC");
  await expect(buyBalance).toHaveAccessibleName("Balance: 0 USDC");
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await expect(sellBalance).toHaveText("0 USDC");
  await expect(buyBalance).toHaveText("2 CYGLD");
  await page.getByRole("button", { name: "Open wallet menu", exact: true }).click();
  await page.getByTestId("wallet-balance-modal").getByRole("button", { name: "Disconnect wallet", exact: true }).click();
  await expect(sellBalance).toHaveCount(0);
  await expect(buyBalance).toHaveCount(0);
});

for (const mode of ["partial", "outage"] as const) {
  test(`swap fields keep unreadable balances unknown: ${mode}`, async ({ page }) => {
    await install(page, mode);
    await page.goto("/en");
    await page.getByRole("switch", { name: "Show only tokens available in wallet" }).uncheck();
    await selectSwapToken(page, "sell", "USDC", "USDC");
    await expect(page.getByTestId("sell-wallet-balance")).toHaveText("... USDC");
    await expect(page.getByTestId("sell-wallet-balance")).toHaveAttribute("title", "Balance: Unavailable USDC");
    await expect(page.getByTestId("buy-wallet-balance")).toHaveText(mode === "outage" ? "... CYGLD" : "2 CYGLD");
  });
}

for (const width of [320, 1280]) {
  test(`French swap balances keep exact amounts accessible and fit the lower right at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await install(page, "ready");
    const current = snapshot(ALICE);
    current.native = success("13981234567890000");
    current.tokens = current.tokens.map(row => row.id === "cygld"
      ? { ...row, balance: success("113448123456789000000") } : row);
    await routeWalletBalances(page, route => route.fulfill({ json: current }));
    await page.goto("/fr");
    await expect(page.getByTestId("buy-wallet-balance")).toHaveText("113,448 CYGLD");
    await selectSwapToken(page, "sell", "ETH", "Ether");
    const sell = page.getByTestId("sell-wallet-balance");
    const buy = page.getByTestId("buy-wallet-balance");
    await expect(sell).toHaveText("0,01398 ETH");
    await expect(sell).toHaveAttribute("title", "Solde : 0,01398123456789 ETH");
    await expect(buy).toHaveText("113,448 CYGLD");
    await expect(buy).toHaveAccessibleName("Solde : 113,448123456789 CYGLD");
    const pickers = page.locator("main button[aria-haspopup='dialog']");
    for (const [index, balance] of [sell, buy].entries()) {
      await expect(balance).toBeVisible();
      const amountBox = await pickers.nth(index).boundingBox();
      const rect = await balance.boundingBox();
      expect(rect!.y).toBeGreaterThanOrEqual(amountBox!.y + amountBox!.height);
      expect(rect!.x).toBeGreaterThan(amountBox!.x - amountBox!.width);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
      expect(await balance.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const screenshot = await page.screenshot({ path: `out/audit/swap-wallet-balances/${width}-fr-synthetic.png`, fullPage: true });
    await test.info().attach("synthetic-wallet-balances-fr", { body: screenshot, contentType: "image/png" });
  });
}

for (const mode of ["ready", "partial", "outage"] as const) {
  test(`wallet balances use the fixed API: ${mode}`, async ({ page }) => {
    const observed = await install(page, mode);
    await page.goto("/en");
    await page.getByRole("button", { name: "Open wallet menu" }).click();
    await expect(page.getByTestId("wallet-balance-modal")).toBeVisible();
    await expect(page.getByTestId("wallet-balance-total")).toHaveCount(0);
    await expect(page.getByText("Total balance", { exact: true })).toHaveCount(0);
    if (mode === "outage") {
      await expect(page.getByText("Wallet balances unavailable", { exact: true })).toBeVisible();
      await expect(page.getByTestId("wallet-balance-amount-cygld")).toHaveText("... CYGLD");
      await expect(page.getByTestId("wallet-balance-value-cygld")).toHaveText("...");
    } else {
      await expect(page.getByTestId("wallet-balance-amount-cygld")).toHaveText("2.000 CYGLD");
      await expect(page.getByTestId("wallet-balance-amount-eth")).toHaveText("3.000 ETH");
      if (mode === "partial") await expect(page.getByTestId("wallet-balance-amount-usdc")).toHaveText("... USDC");
      else await expect(page.getByTestId("wallet-balance-amount-usdc")).toHaveText("0.000 USDC");
      await page.evaluate(account => (window as unknown as { __switchBalanceTestAccount: (account: string) => void }).__switchBalanceTestAccount(account), BOB);
      await expect(page.getByTestId("wallet-balance-amount-cygld")).toHaveText("7.000 CYGLD");
      await expect(page.getByTestId("buy-wallet-balance")).toHaveText("7 CYGLD");
      expect(observed.holders).toContain(BOB);
    }
    expect(observed.holders).toContain(ALICE);
    for (const id of ["eth", "cygld", "xaut", "paxg", "usdt", "usdc", "weth"]) {
      await expect(page.getByTestId(`wallet-balance-row-${id}`)).toBeVisible();
    }
    // Product and library reads share fixed APIs; no generic RPC fallback.
    expect(observed.genericRequests).toEqual([]);
    expect(observed.tokenRequests).toEqual([]);
    expect(observed.calls.filter(data => data.includes("70a08231"))).toEqual([]);
  });
}

test("catalog pool identities price wallet assets without singleton balances and keep legacy requests unchanged", async ({ page }) => {
  const observed = await install(page, "ready", "outage");
  const current = snapshot(ALICE);
  current.tokens.find(token => token.id === "paxg")!.balance = success("1000000000000000000");
  await routeWalletBalances(page, route => route.fulfill({ json: current }));
  const context = { ...current.context, observedAt: "2026-10-01T00:00:00Z" };
  const currency = (address: string, decimals: number) => ({ address, decimals, chainId: chain });
  const entries = [
    { id: `0x${"a".repeat(64)}`, protocol: "v4", token0: currency(tokenAddresses.CYGLD, 18),
      token1: currency(tokenAddresses.USDC, 6), feePips: 100, tickSpacing: 1 },
    { id: `0x${"b".repeat(64)}`, protocol: "v4", token0: currency(tokenAddresses.CYGLD, 18),
      token1: currency(tokenAddresses.PAXG, 18), feePips: 100, tickSpacing: 1 },
    { id: `0x${"c".repeat(64)}`, protocol: "v4", token0: currency(tokenAddresses.CYGLD, 18),
      token1: currency(tokenAddresses.PAXG, 18), feePips: 100, tickSpacing: 10 },
  ].map(pool => ({ ...pool, poolManager: LIQUIDITY_POOL.poolManager, hooks: LIQUIDITY_POOL.hooks }));
  await page.route("**/api/pools/catalog", route => route.fulfill({ json: { context, entries, catalogMonth: "2026-10" } }));
  const acquired: { poolId: string; poolManager: string; tickSpacing: number; hooks: string }[] = [];
  await page.route("**/api/pools/snapshot", async route => {
    const request = route.request().postDataJSON();
    if (request.protocol === undefined) {
      expect(Object.keys(request).sort()).toEqual(["fee", "tokenA", "tokenB"]);
      return route.fallback();
    }
    acquired.push(request);
    const pool = entries.find(entry => entry.id === request.poolId)!;
    return route.fulfill({ json: { context, protocol: "v4", dex: "uniswap_v4", id: pool.id,
      poolId: pool.id, poolManager: pool.poolManager, pool, token0: pool.token0.address, token1: pool.token1.address,
      fee: 100, exists: true, activeLiquidityRaw: String(2n ** 100n), lpFee: 100, protocolFee: 0,
      marginalPrice: pool.token1.address === tokenAddresses.USDC
        ? { numerator: "2000000", denominator: "1000000000000000000" }
        : { numerator: "1", denominator: "1000" }, ticks: [], bitmapWords: [] } });
  });
  await page.goto("/en");
  await page.getByRole("button", { name: "Open wallet menu" }).click();
  await expect(page.getByTestId("wallet-balance-value-paxg")).toHaveText("~ $2 000.00");
  await expect.poll(() => [...new Set(acquired.map(request => request.poolId))].sort())
    .toEqual(entries.map(pool => pool.id).sort());
  for (const pool of entries) expect(acquired).toContainEqual(expect.objectContaining({ poolId: pool.id,
    poolManager: pool.poolManager, tickSpacing: pool.tickSpacing, hooks: pool.hooks }));
  expect([...new Set(observed.pools)].sort((a, b) => a - b)).toEqual([100, 500, 3000, 10000]);
  expect(observed.genericRequests).toEqual([]);
});

test("a pending catalog does not block existing V3 wallet valuations", async ({ page }) => {
  await install(page, "ready", "ready");
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/pools/catalog", async route => {
    await pending;
    return route.fulfill({ json: { context: snapshot(ALICE).context, entries: [], catalogMonth: "2026-10" } });
  });
  try {
    await page.goto("/en");
    await page.getByRole("button", { name: "Open wallet menu" }).click();
    await expect(page.getByTestId("wallet-balance-value-eth")).toContainText("698.49");
  } finally { release(); }
});

for (const mode of ["ready", "partial", "outage"] as const) {
  test(`wallet valuations use authoritative pool observations: ${mode}`, async ({ page }) => {
    const observed = await install(page, "ready", mode);
    await page.goto("/en");
    await page.getByRole("button", { name: "Open wallet menu" }).click();
    await expect(page.getByTestId("wallet-balance-amount-eth")).toHaveText("3.000 ETH");
    const row = page.getByTestId("wallet-balance-row-eth");
    if (mode === "ready") await expect(row).toContainText("698.49");
    else {
      await expect(page.getByTestId("wallet-balance-value-eth")).toHaveText("...");
      await expect(page.getByTestId("wallet-balance-value-eth")).toHaveAttribute("title", "Price unavailable");
    }
    await expect(page.getByTestId("wallet-balance-amount-usdc")).toHaveText("0.000 USDC");
    // Development Strict Mode cancels and remounts initial queries. Check the
    // requested product pairs, not the number of startup attempts; native query
    // sharing/cancellation is qualified by poolSnapshot.test.mts.
    expect([...new Set(observed.pools)].sort((a, b) => a - b)).toEqual([100, 500, 3000, 10000]);
    expect(observed.calls.filter(data => data.includes("3850c7bd"))).toEqual([]);
  });
}

test("the address opens only the wallet panel, without a navbar balance or extra menu button", async ({ page }) => {
  const observed = await install(page, "ready");
  await page.goto("/en");
  const navbar = page.locator("nav");
  const address = navbar.getByRole("button", { name: "Open wallet menu", exact: true });
  await expect(address).toHaveText(/^0x0000\.\.\.00a1$/i);
  await expect(navbar.getByText("9 ETH", { exact: true })).toHaveCount(0);
  await expect(navbar.locator("button").filter({ hasText: /^\.\.\.$/ })).toHaveCount(0);
  await address.click();
  await expect(page.getByRole("dialog", { name: "Your wallet", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByTestId("wallet-balance-amount-eth")).toHaveText("3.000 ETH");
  expect(observed.genericRequests).toEqual([]);
});

for (const mode of ["ready", "outage"] as const) {
  test(`the wallet-filtered token picker shows initial balance loading and settles: ${mode}`, async ({ page }) => {
    await install(page, mode);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/account/wallet-balances*", async route => {
      await pending;
      await route.fallback();
    });
    const sellPicker = page.locator("main button[aria-haspopup='dialog']").first();
    const buyPicker = page.locator("main button[aria-haspopup='dialog']").nth(1);
    const walletFilter = page.getByRole("switch", { name: "Show only tokens available in wallet" });
    try {
      await page.goto("/en");
      await expect(walletFilter).toBeChecked();
      await expect(sellPicker).toBeDisabled();
      await expect(sellPicker).toHaveAttribute("aria-busy", "true");
      await expect(sellPicker.locator("svg.animate-spin")).toBeVisible();
      await expect(buyPicker.locator("svg.animate-spin")).toHaveCount(0);

      await walletFilter.click();
      await expect(sellPicker).toBeEnabled();
      await expect(sellPicker.locator("svg.animate-spin")).toHaveCount(0);
      await expect(sellPicker).not.toHaveAttribute("aria-busy", "true");
      await walletFilter.click();
      await expect(sellPicker).toHaveAttribute("aria-busy", "true");
    } finally {
      release();
    }
    await expect(sellPicker.locator("svg.animate-spin")).toHaveCount(0);
    await expect(sellPicker).not.toHaveAttribute("aria-busy", "true");
    if (mode === "ready") await expect(sellPicker).toBeEnabled();
    else await expect(sellPicker).toBeDisabled();
  });
}

test("refreshing cached wallet balances keeps the token picker available without initial loading", async ({ page }) => {
  await install(page, "ready");
  await page.goto("/en");
  await page.getByRole("button", { name: "Open wallet menu" }).click();
  await expect(page.getByTestId("wallet-balance-amount-eth")).toHaveText("3.000 ETH");
  const refresh = page.getByRole("button", { name: /^(Refresh balances|Refreshing\.\.\.)$/ });
  await expect(refresh).toBeEnabled();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/account/wallet-balances*", async route => {
    await pending;
    await route.fallback();
  });
  const sellPicker = page.locator("main button[aria-haspopup='dialog']").first();
  try {
    const requested = page.waitForRequest("**/api/account/wallet-balances*");
    await refresh.click();
    await requested;
    await expect(refresh).toBeDisabled();
    await expect(sellPicker).toBeEnabled();
    await expect(sellPicker.locator("svg.animate-spin")).toHaveCount(0);
    await expect(sellPicker).not.toHaveAttribute("aria-busy", "true");
  } finally {
    release();
  }
  await expect(refresh).toBeEnabled();
});

test("manual balance-dialog refresh updates the wallet filter and MAX without reconnecting", async ({ page }) => {
  await install(page, "ready");
  let current = snapshot(ALICE);
  await routeWalletBalances(page, route => route.fulfill({ json: current }));
  await page.goto("/en");
  await expect(page.getByRole("switch", { name: "Show only tokens available in wallet" })).toBeChecked();
  await page.getByRole("button", { name: "Open wallet menu" }).click();
  const refresh = page.getByRole("button", { name: "Refresh balances", exact: true });
  await expect(refresh).toBeEnabled();
  current = { ...current, tokens: [...current.tokens.filter(row => row.id !== "weth"),
    { id: "weth", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", balance: success("5000000000000000000") }] };
  const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/account/wallet-balances");
  await refresh.click();
  await response;
  await expect(refresh).toBeEnabled();
  await page.getByRole("button", { name: "Close balances", exact: true }).click();
  await page.locator("main button[aria-haspopup='dialog']").first().click();
  await page.getByRole("button", { name: "WETH Wrapped Ether WETH", exact: true }).click();
  await page.getByRole("button", { name: "Use maximum sell amount", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "You Sell WETH", exact: true })).toHaveValue("5");
});

test("swap and wallet panel share one aggregate snapshot, including one request per manual refresh", async ({ page }) => {
  const observed = await install(page, "ready");
  await page.goto("/en");
  await expect(page.getByRole("switch", { name: "Show only tokens available in wallet" })).toBeChecked();
  await expect.poll(() => observed.holders.length).toBeGreaterThan(0);
  // Strict Mode may remount during startup; only compare the settled shared
  // request count when opening the second consumer and refreshing it.
  const beforeOpen = observed.holders.length;
  await page.getByRole("button", { name: "Open wallet menu" }).click();
  await expect(page.getByTestId("wallet-balance-amount-cygld")).toHaveText("2.000 CYGLD");
  expect(observed.holders).toHaveLength(beforeOpen);
  const refresh = page.getByRole("button", { name: "Refresh balances", exact: true });
  await expect(refresh).toBeEnabled();
  const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/account/wallet-balances");
  await refresh.click();
  await response;
  await expect(refresh).toBeEnabled();
  expect(observed.holders).toHaveLength(beforeOpen + 1);
  expect(observed.tokenRequests).toEqual([]);
});

test("an unavailable balance read is visible and can recover through manual refresh", async ({ page }) => {
  await install(page, "outage");
  let unavailable = true;
  await routeWalletBalances(page, route => route.fulfill(unavailable
    ? { status: 503, json: { error: "Wallet balances are temporarily unavailable." } }
    : { json: snapshot(ALICE) }));
  await page.goto("/en");
  await expect(page.getByText("Some wallet balances are unavailable. Refresh balances to try again.", { exact: true })).toHaveCount(0);
  const warning = page.getByText("Wallet balances unavailable", { exact: true });
  await page.getByRole("button", { name: "Open wallet menu" }).click();
  await expect(page.getByText("Wallet balances unavailable", { exact: true })).toBeVisible();
  unavailable = false;
  await page.getByRole("button", { name: "Refresh balances", exact: true }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByTestId("wallet-balance-amount-eth")).toHaveText("3.000 ETH");
});

test("an unrelated pending pool does not delay a known wallet valuation", async ({ page }) => {
  const observed = await install(page, "ready", "ready");
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/pools/snapshot", async route => {
    if (route.request().postDataJSON().fee === 3000) await pending;
    await route.fallback();
  });
  try {
    await page.goto("/en");
    await page.getByRole("button", { name: "Open wallet menu" }).click();
    await expect(page.getByTestId("wallet-balance-row-eth")).toContainText("698.49");
    expect(observed.pools).not.toContain(3000);
  } finally {
    release();
  }
  await expect.poll(() => observed.pools.includes(3000)).toBe(true);
});

test("wallet opens while the aggregate and liquidity reads are pending, then displays the aggregate independently", async ({ page }) => {
  const observed = await install(page, "ready", "ready");
  const ids = ["eth", "cygld", "xaut", "paxg", "usdt", "usdc", "weth"];
  const releases: Record<string, () => void> = {};
  const pending = Object.fromEntries(["aggregate", "profile"].map(id => [id,
    new Promise<void>(resolve => { releases[id] = resolve; })]));
  await page.route("**/api/account/wallet-balances*", async route => {
    await pending.aggregate;
    await route.fallback();
  });
  await page.route(/\/api\/account\/(native-balance|ens-name|ens-avatar-record|liquidity-positions)(\?|$)/, async route => {
    await pending.profile;
    await route.fallback();
  });
  try {
    await page.goto("/en");
    await expect(page.getByTestId("buy-wallet-balance")).toHaveText("... CYGLD");
    await expect(page.getByTestId("buy-wallet-balance")).toHaveAttribute("title", "Balance: Loading... CYGLD");
    await page.getByRole("button", { name: "Open wallet menu" }).click();
    const panel = page.getByTestId("wallet-balance-modal");
    await expect(panel).toBeVisible({ timeout: 1_500 });
    for (const id of ids) {
      const symbol = id === "xaut" ? "XAUt" : id.toUpperCase();
      await expect(page.getByTestId(`wallet-balance-row-${id}`)).toBeVisible();
      await expect(page.getByTestId(`wallet-balance-amount-${id}`)).toHaveText(`... ${symbol}`);
      await expect(page.getByTestId(`wallet-balance-value-${id}`)).toHaveText("...");
    }
    await page.getByRole("button", { name: /Liquidity Positions/ }).click();
    await expect(page.getByText("Loading your pool positions…", { exact: true })).toBeVisible();
    releases.aggregate();
    await expect(page.getByTestId("buy-wallet-balance")).toHaveText("2 CYGLD");
    for (const id of ids) {
      const amount = id === "eth" ? "3.000" : id === "cygld" ? "2.000" : "0.000";
      const symbol = id === "xaut" ? "XAUt" : id.toUpperCase();
      await expect(page.getByTestId(`wallet-balance-amount-${id}`)).toHaveText(`${amount} ${symbol}`);
    }
    await expect(page.getByTestId("wallet-balance-value-usdc")).not.toHaveText("...");
    await expect(page.getByTestId("wallet-balance-value-eth")).toContainText("698.49");
    await expect(page.getByText("Loading your pool positions…", { exact: true })).toBeVisible();
    expect(observed.tokenRequests).toEqual([]);
    await page.screenshot({ path: "out/wallet-multicall-balances.png" });
    await page.getByRole("button", { name: "Close balances", exact: true }).click();
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: "Open wallet menu" }).click();
    await expect(panel).toBeVisible({ timeout: 1_500 });
  } finally {
    Object.values(releases).forEach(release => release());
  }
  await expect(page.getByTestId("wallet-balance-amount-cygld")).toHaveText("2.000 CYGLD");
});

for (const failure of ["http", "token"] as const) test(`a failed ${failure} refresh preserves the aggregate result semantics and an account change clears them`, async ({ page }) => {
  await install(page, "ready");
  let unavailable = false;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/account/wallet-balances*", async route => {
    const holder = new URL(route.request().url()).searchParams.get("holder")!;
    if (holder.toLowerCase() === BOB) await pending;
    if (unavailable && holder.toLowerCase() === ALICE) {
      const partial = snapshot(ALICE);
      await route.fulfill(failure === "http" ? { status: 503, json: { error: "Synthetic refresh outage" } }
        : { json: { ...partial, native: success("4000000000000000000"), tokens: partial.tokens.map(row => row.id === "cygld"
          ? { ...row, balance: { status: "failure", error: "contract-read-failed" } } : row) } });
    } else await route.fallback();
  });
  try {
    await page.goto("/en");
    await page.getByRole("button", { name: "Open wallet menu" }).click();
    await expect(page.getByTestId("wallet-balance-amount-cygld")).toHaveText("2.000 CYGLD");
    unavailable = true;
    await page.getByRole("button", { name: "Refresh balances", exact: true }).click();
    await expect(page.getByText("Wallet balances unavailable", { exact: true })).toBeVisible();
    await expect(page.getByTestId("wallet-balance-amount-cygld")).toHaveText(failure === "http" ? "2.000 CYGLD" : "... CYGLD");
    await expect(page.getByTestId("buy-wallet-balance")).toHaveText(failure === "http" ? "2 CYGLD" : "... CYGLD");
    await expect(page.getByTestId("wallet-balance-amount-eth")).toHaveText(failure === "http" ? "3.000 ETH" : "4.000 ETH");
    await page.evaluate(account => (window as unknown as { __switchBalanceTestAccount: (account: string) => void }).__switchBalanceTestAccount(account), BOB);
    await expect(page.getByTestId("wallet-balance-amount-cygld")).toHaveText("... CYGLD");
    await expect(page.getByTestId("buy-wallet-balance")).toHaveText("... CYGLD");
    await expect(page.getByTestId("wallet-balance-amount-eth")).toHaveText("... ETH");
  } finally { release(); }
  await expect(page.getByTestId("wallet-balance-amount-cygld")).toHaveText("7.000 CYGLD");
  await expect(page.getByTestId("buy-wallet-balance")).toHaveText("7 CYGLD");
});

test("the balance dialog fits a short mobile viewport and restores keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await install(page, "ready");
  await page.goto("/en");
  const trigger = page.getByRole("button", { name: "Open wallet menu" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Your wallet", exact: true });
  await expect(dialog).toBeVisible();
  const content = page.getByTestId("wallet-balance-modal");
  await expect.poll(async () => (await content.boundingBox())?.height ?? Infinity).toBe(420);
  await expect(page.getByTestId("wallet-balance-amount-usdc")).toHaveText("0.000 USDC");
  const first = content.getByRole("button").first();
  const last = content.getByRole("button").last();
  await expect(first).toBeEnabled();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await page.screenshot({ path: "out/audit/followups-mobile-wallet-dialog.png" });
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await content.getByRole("button", { name: /^Network: / }).click();
  const networks = page.getByRole("dialog", { name: "Switch Networks", exact: true });
  await expect(networks).toBeVisible();
  await expect(dialog).toBeVisible();
  await networks.getByRole("button", { name: "Close", exact: true }).click();
  await expect(networks).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("wallet assets display icons and retain import feedback after reopening", async ({ page }) => {
  await install(page, "ready");
  await page.goto("/en");
  const modal = page.getByTestId("wallet-balance-modal");
  await expect(modal).toBeHidden();
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  const initialScripts = await page.evaluate(() => performance.getEntriesByType("resource")
    .filter(entry => (entry as PerformanceResourceTiming).initiatorType === "script").map(entry => entry.name));
  await page.getByRole("button", { name: "Open wallet menu" }).click();
  await expect(modal).toBeVisible();
  await expect(page.getByTestId("wallet-balance-amount-cygld")).toHaveText("2.000 CYGLD");

  const row = page.getByTestId("wallet-balance-row-cygld");
  const icon = row.getByRole("img", { name: "CyberGold icon" });
  await icon.scrollIntoViewIfNeeded();
  await expect(icon).toBeVisible();
  await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const scriptsAfterOpening = await page.evaluate(() => performance.getEntriesByType("resource")
    .filter(entry => (entry as PerformanceResourceTiming).initiatorType === "script").map(entry => entry.name));
  await test.info().attach("wallet-assets-script-resources", {
    body: JSON.stringify({ initialScripts, scriptsAfterOpening }, null, 2),
    contentType: "application/json",
  });

  await row.getByRole("button", { name: "Import", exact: true }).click();
  await expect(row.getByRole("button", { name: "Imported", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close balances" }).click();
  await expect(modal).toBeHidden();
  await page.getByRole("button", { name: "Open wallet menu" }).click();
  await expect(modal).toBeVisible();
  await expect(page.getByTestId("wallet-balance-amount-cygld")).toHaveText("2.000 CYGLD");
  await expect(row.getByRole("button", { name: "Imported", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});

test("desktop wallet docks below the navbar, leaves swap usable, and has a single top disconnect action", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await install(page, "ready");
  await page.goto("/en");
  const trigger = page.getByRole("button", { name: "Open wallet menu", exact: true });
  const closedColors = await trigger.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, foreground: style.color };
  });
  await trigger.click();
  const panel = page.getByTestId("wallet-balance-modal");
  await expect(panel).toBeVisible();
  const mainNavbar = page.getByRole("navigation").filter({
    has: page.getByRole("link", { name: "CyberGold", exact: true }),
  });
  const close = mainNavbar.getByRole("button", { name: "Close balances", exact: true });
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await expect(close).toHaveText(/^0x0000\.\.\.00a1$/i);
  await expect.poll(() => close.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(closedColors.foreground);
  const openForeground = await close.evaluate(element => getComputedStyle(element).color);
  expect(openForeground).not.toBe(closedColors.foreground);
  await expect(panel.getByRole("button", { name: "Close balances", exact: true })).toHaveCount(0);
  const box = await panel.boundingBox();
  const navbar = await mainNavbar.boundingBox();
  const navbarBottom = navbar!.y + navbar!.height;
  expect(box).toMatchObject({ x: 840, y: navbarBottom, width: 440, height: 900 - navbarBottom });
  expect(navbar!.width).toBe(1280);
  await expect(page.getByRole("dialog", { name: "Your wallet", exact: true })).toHaveAttribute("aria-modal", "false");
  const mainBox = await page.locator("main").boundingBox();
  expect(mainBox!.x + mainBox!.width).toBe(box!.x);
  const swapBox = await page.locator("#swapsection").boundingBox();
  expect(swapBox!.x + swapBox!.width).toBeLessThanOrEqual(box!.x);

  await page.getByRole("switch", { name: "Show only tokens available in wallet" }).uncheck();
  await choose(page, "WETH");
  const sell = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
  await sell.fill("0.5");
  await expect(sell).toHaveValue("0.5");
  await expect(panel).toBeVisible();
  const eye = panel.getByRole("button", { name: "View full", exact: true });
  await expect(eye).toHaveText("");
  await eye.click();
  await expect(panel.getByText(new RegExp("^" + ALICE + "$", "i"))).toBeVisible();
  await panel.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(panel.getByText(new RegExp("^" + ALICE + "$", "i"))).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Copy address", exact: true })).toBeVisible();
  const refresh = panel.getByRole("button", { name: "Refresh balances", exact: true });
  await expect(refresh).toBeEnabled();
  await expect(refresh).toHaveText("");
  await expect(refresh).toHaveAttribute("title", "Refresh balances");
  await expect(panel.getByRole("button", { name: "Wallet options", exact: true })).toHaveCount(0);
  const disconnect = panel.getByRole("button", { name: "Disconnect wallet", exact: true });
  await expect(disconnect).toHaveCount(1);
  await expect(disconnect).toHaveText("");
  await expect(disconnect).toHaveAttribute("title", "Disconnect wallet");
  const network = panel.getByRole("button", { name: /^Network: / });
  await expect(network).toHaveText("");
  await expect(network).toHaveAttribute("title", (await network.getAttribute("aria-label"))!);
  const actionBoxes = await Promise.all([network, refresh, disconnect].map(button => button.boundingBox()));
  for (const actionBox of actionBoxes) {
    expect(actionBox).toMatchObject({ y: actionBoxes[0]!.y, width: 40, height: 40 });
  }
  expect(actionBoxes[0]!.x + actionBoxes[0]!.width).toBeLessThan(actionBoxes[1]!.x);
  expect(actionBoxes[1]!.x + actionBoxes[1]!.width).toBeLessThan(actionBoxes[2]!.x);
  expect(actionBoxes[2]!.x + actionBoxes[2]!.width).toBe(box!.x + box!.width - 24);
  const heading = await panel.getByRole("heading", { name: "Your wallet", exact: true }).boundingBox();
  expect(heading!.x + heading!.width).toBeLessThan(actionBoxes[0]!.x);
  expect(heading!.y + heading!.height / 2).toBe(actionBoxes[0]!.y + actionBoxes[0]!.height / 2);
  const actionColors = await Promise.all([network, refresh].map(button => button.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, foreground: style.color, border: style.borderColor };
  })));
  expect(actionColors[0]).toEqual(actionColors[1]);
  expect((await disconnect.boundingBox())!.y).toBeLessThan((await panel.getByTestId("wallet-balance-row-cygld").boundingBox())!.y);
  const last = panel.locator("button:not([disabled]):visible, a[href]:visible").last();
  await last.focus();
  await page.keyboard.press("Tab");
  await expect.poll(() => page.locator("main").evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: "out/audit/streamline-feedback/wallet-panel-docked-desktop.png" });
  await close.click();
  await expect(panel).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveText(/^0x0000\.\.\.00a1$/i);
  await page.mouse.move(0, 100);
  await expect.poll(() => trigger.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(closedColors.background);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(panel).toBeVisible();
  await network.click();
  await expect(panel).toBeVisible();
  const networks = page.getByRole("dialog", { name: "Switch Networks", exact: true });
  await expect(networks).toBeVisible();
  await networks.getByRole("button", { name: "Close", exact: true }).click();
  await expect(networks).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await panel.getByRole("button", { name: "Disconnect wallet", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect Wallet", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connect Wallet", exact: true }).click();
  await page.getByRole("button", { name: /MetaMask/ }).click();
  await expect(trigger).toBeVisible();
  await expect(page.getByRole("switch")).toBeVisible();
});

test("an open wallet adapts between a desktop dock and mobile dialog", async ({ page }) => {
  await install(page, "ready");
  await page.setViewportSize({ width: 1025, height: 900 });
  await page.goto("/en");
  const trigger = page.getByRole("button", { name: "Open wallet menu", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Your wallet", exact: true });
  await expect(dialog).toHaveAttribute("aria-modal", "false");
  expect(await page.locator("main").evaluate(element => element.getBoundingClientRect().right)).toBe(585);
  await page.setViewportSize({ width: 390, height: 420 });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(await dialog.evaluate(element => element.matches(":modal"))).toBe(true);
  expect(await page.locator("main").evaluate(element => element.getBoundingClientRect().right)).toBe(390);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(dialog).toHaveAttribute("aria-modal", "false");
  expect(await dialog.evaluate(element => element.matches(":modal"))).toBe(false);
  await page.getByRole("button", { name: "Close balances", exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(await page.locator("main").evaluate(element => element.getBoundingClientRect().right)).toBe(1280);
});

test("language changes keep the wallet panel open and translate its contents", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await install(page, "ready");
  const documents: string[] = [];
  page.on("request", request => { if (request.resourceType() === "document") documents.push(request.url()); });
  await page.goto("/en");
  const panel = page.getByTestId("wallet-balance-modal");
  await page.getByRole("button", { name: "Open wallet menu", exact: true }).click();
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page).toHaveURL(/\/fr$/);
  await test.info().attach("locale-navigation-documents", { body: JSON.stringify(documents), contentType: "application/json" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Votre portefeuille", exact: true })).toBeVisible();
  await expect(page.locator("nav").getByRole("button", { name: "Fermer les soldes", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Langue", exact: true }).click();
  await page.getByRole("button", { name: "Deutsch", exact: true }).click();
  await expect(page).toHaveURL(/\/de$/);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Ihre Wallet", exact: true })).toBeVisible();
  await page.locator("nav").getByRole("button", { name: "Guthaben schließen", exact: true }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Sprache", exact: true }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Open wallet menu", exact: true }).click();
  await expect(panel).toBeVisible();
  await page.locator("nav").getByRole("button", { name: "Close balances", exact: true }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Open wallet menu", exact: true }).click();
  await expect(panel).toBeVisible();
  await page.reload();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Open wallet menu", exact: true })).toHaveAttribute("aria-expanded", "false");
});
