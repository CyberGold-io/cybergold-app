import { protocolAddresses } from "../fixtures/protocol-configuration";
import { expect, test, type Page, type Route } from "./fixtures/app-test";
import { getAddress, type Address } from "viem";
import type { RecoverySharePortfolio } from "../../app/utils/recoveryPortfolio";
import type { LiquidityPositionsSnapshot } from "../../app/utils/liquidityPositions";
import { tokens } from "../fixtures/protocol-configuration";
import { routeWalletBalances } from "./fixtures/wallet-balances";
import { openNavbarSettings } from "./fixtures/navbar-settings";

// These are public synthetic addresses, not funded wallets or signing keys.
const ALICE = "0x00000000000000000000000000000000000000a1";
const BOB = "0x00000000000000000000000000000000000000b2";
const ASSET = "0x0000000000000000000000000000000000000011";
const CORE = getAddress(protocolAddresses.core ?? "0x00000000000000000000000000000000000000c0");
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;
const SYNTHETIC_HASH = `0x${"ab".repeat(32)}`;
const SECOND_SYNTHETIC_HASH = `0x${"cd".repeat(32)}`;

const lpSnapshot: LiquidityPositionsSnapshot = {
  positions: [
    { tokenId: "1", paxgAmount: "0.4", cygldAmount: "4" },
    { tokenId: "2", paxgAmount: "0.6", cygldAmount: "6" },
  ],
  paxgAmount: "1", cygldAmount: "10", blockNumber: "26000000",
};

async function installLiquidityPrices(page: Page) {
  const context = { chainId: CHAIN_ID, blockNumber: "100", blockHash: SYNTHETIC_HASH,
    blockTimestamp: "100", observedAt: new Date().toISOString() };
  await routeWalletBalances(page, route => route.fulfill({ json: {
    context, holder: new URL(route.request().url()).searchParams.get("holder"),
    native: { status: "success", value: "3000000000000000000" },
    tokens: tokens.filter(token => token.type === "erc20").map(token => ({
      id: token.id, address: token.address,
      balance: { status: "success", value: String(10n ** BigInt(token.decimals)) },
    })),
  } }));
  // Deliberately different from gold spot: LP holdings must share the token
  // rows' authoritative pool price rather than substituting a gold quote.
  await page.route("**/api/pools/snapshot", route => {
    const identifier = route.request().postDataJSON();
    const sqrtPrice = (1n << 96n) * (identifier.fee === 500 ? 1n << 16n : identifier.fee === 3000 ? 4n : 1n);
    return route.fulfill({ json: {
      context, dex: "uniswap_v3", token0: identifier.tokenA, token1: identifier.tokenB,
      fee: identifier.fee, exists: true, poolAddress: ASSET,
      sqrtPriceX96Raw: String(sqrtPrice), activeLiquidityRaw: "1", tick: 0,
      token0BalanceRaw: "1", token1BalanceRaw: "1",
    } });
  });
  await page.route("**/api/gold", route => route.fulfill({ json: {
    price: 3110.34768, fetchedAt: new Date().toISOString(), stale: false,
  } }));
  await page.route("**/api/fx", route => route.fulfill({ json: {
    base: "USD", rates: { USD: 1, EUR: 0.9, CHF: 0.8, RUB: 90 },
    fetchedAt: new Date().toISOString(), stale: false,
  } }));
  await page.route("**/api/protocol/facts", route => route.fulfill({ json: {
    context: { chainId: CHAIN_ID, blockNumber: "100", blockHash: SYNTHETIC_HASH, blockTimestamp: "100", observedAt: new Date().toISOString() },
    reference: { status: "success", value: "1000000000000000000" },
    basket: {
      assets: { status: "success", value: [] }, targetsPpm: { status: "success", value: [] },
      goldRefGramsFp18: { status: "success", value: [] }, cygldPerUnitFp18: { status: "success", value: [] }, metadata: [],
    },
    fees: { issuancePpm: { status: "success", value: "0" }, helpersPpm: { status: "success", value: "0" } },
    pause: { status: "success", value: false },
  } }));
}
type RpcRequest = { id: number; method: string; params?: unknown[] };
type RpcResult = { result: unknown } | { error: { code: number; message: string } };
type RedemptionRequest = { holder: string; asset: string; shares: string; minRawOut: string };

function portfolio(balance = 20_000_000n): RecoverySharePortfolio {
  const pool = {
    asset: ASSET as Address, impaired: true, coreAttachedShares: "80000000",
    externalShares: "20000000", totalShares: "100000000", redeemableRaw: "0",
    cygldPerAssetRawFp18: "1000000000000000000000000000000", cygldSupplyCap: "1000000000000000000000000",
    referenceShares: "100000000", referenceValueCygld: "100000000000000000000", shareDecimals: 6,
    lifecycle: { asset: ASSET, lifecycle: 0, exitEntitlementRaw: "0" },
    custody: { lifecycle: 0, poolImpaired: true, redeemablePoolRaw: "0",
      coreAttachedShares: "80000000", externalShares: "20000000", exitEntitlementRaw: "0",
      liveBalanceAvailable: true, liveRawCustody: "25000000", activeAvailableRaw: "0",
      poolRawDeficit: "0", exitEntitlementDeficitRaw: "0" },
  };
  return {
    enabled: true, status: "ready", schemaVersion: "recovery-rpc-native-v1",
    chainId: String(CHAIN_ID), collection: CORE, snapshotBlock: "100",
    snapshotBlockHash: `0x${"01".repeat(32)}`, complete: true, nextOffset: null,
    totalAssets: "1", corePaused: false,
    fund: { configured: true, available: false, reason: "unavailable-or-inconsistent",
      problem: "Synthetic optional Fund outage", governance: null, governancePaused: null },
    pools: [pool], balances: balance === 0n ? [] : [{
      shareId: BigInt(ASSET).toString(), balanceRaw: balance.toString(), pool,
      payoutRaw: (balance / 4n).toString(), payoutProblem: null, fundOffer: null,
    }],
  };
}

async function installWalletAndNetwork(
  page: Page, recovery: (route: Route, holder: string) => Promise<void>,
  options: {
    rpc?: (request: RpcRequest) => Promise<RpcResult | undefined>;
    redemption?: (route: Route, request: RedemptionRequest) => Promise<void>;
    simulateSubmission?: boolean;
    delayWalletClient?: boolean;
    unrelatedInjectedAccount?: boolean;
  } = {}
) {
  const appOrigin = new URL(test.info().project.use.baseURL ?? "http://localhost:3000").origin;
  await page.clock.install();
  await page.addInitScript(({ initialAccount, chainHex, simulateSubmission, delayWalletClient, syntheticHash, secondSyntheticHash, unrelatedInjectedAccount }) => {
    type Listener = (...args: unknown[]) => void;
    const listeners = new Map<string, Set<Listener>>();
    let accounts = [initialAccount];
    let currentChain = chainHex;
    let connectionChainRead = false;
    let releaseWalletClient!: () => void;
    const walletClientReady = new Promise<void>((resolve) => { releaseWalletClient = resolve; });
    const requests: string[] = [];
    const provider = {
      isMetaMask: true, selectedAddress: initialAccount,
      request: async ({ method }: { method: string }) => {
        requests.push(method);
        if (method === "eth_accounts" || method === "eth_requestAccounts") return accounts;
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: accounts }] }];
        if (method === "eth_chainId") {
          // Let injected.connect discover the chain, then hold the subsequent
          // client/validation reads until the test releases them. Connection
          // and portfolio rendering can complete while wallet data is pending.
          if (delayWalletClient && connectionChainRead) await walletClientReady;
          connectionChainRead = true;
          return currentChain;
        }
        if (method === "net_version") return BigInt(currentChain).toString();
        if (method === "eth_getBalance") return "0x0";
        // This is an in-memory response only: no provider transport or signing
        // key exists. Every other signing/broadcast method remains rejected.
        if (method === "eth_sendTransaction" && simulateSubmission) return accounts[0] === initialAccount ? syntheticHash : secondSyntheticHash;
        throw new Error(`Synthetic wallet rejects ${method}`);
      },
      on: (event: string, listener: Listener) => {
        const existing = listeners.get(event) ?? new Set<Listener>();
        existing.add(listener); listeners.set(event, existing);
      },
      removeListener: (event: string, listener: Listener) => { listeners.get(event)?.delete(listener); },
    };
    const defaultInjectedProvider = unrelatedInjectedAccount ? {
      ...provider,
      selectedAddress: "0x00000000000000000000000000000000000000b2",
      request: async () => [],
    } : provider;
    Object.defineProperty(window, "ethereum", { value: defaultInjectedProvider, configurable: true });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: { provider, info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "MetaMask", rdns: "io.metamask",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } },
    }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
    Object.defineProperty(window, "__recoveryTestWalletRequests", { value: requests });
    Object.defineProperty(window, "__releaseRecoveryTestWalletClient", { value: releaseWalletClient });
    Object.defineProperty(window, "__switchRecoveryTestChain", { value: (chain: string, emit = true) => {
      currentChain = chain;
      if (emit) listeners.get("chainChanged")?.forEach((listener) => listener(chain));
    } });
    Object.defineProperty(window, "__switchRecoveryTestAccount", { value: (account: string, emit = true) => {
      accounts = [account]; provider.selectedAddress = account;
      if (emit) listeners.get("accountsChanged")?.forEach((listener) => listener(accounts));
    } });
  }, { initialAccount: ALICE, chainHex: CHAIN_HEX, simulateSubmission: options.simulateSubmission ?? false, delayWalletClient: options.delayWalletClient ?? false, syntheticHash: SYNTHETIC_HASH, secondSyntheticHash: SECOND_SYNTHETIC_HASH, unrelatedInjectedAccount: options.unrelatedInjectedAccount ?? false });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/protocol/config") { await route.fallback(); return; }
    if (url.pathname === "/api/recovery/shares") {
      await recovery(route, (url.searchParams.get("holder") ?? "").toLowerCase());
      return;
    }
    if (url.pathname === "/api/transaction/recovery-redemption") {
      expect(request.method()).toBe("POST");
      expect(request.headers()["authorization"]).toBeUndefined();
      if (options.redemption) await options.redemption(route, request.postDataJSON());
      else await route.fulfill({ status: 503, json: { error: "Synthetic redemption simulation unavailable" } });
      return;
    }
    if (url.pathname.startsWith("/api/transaction/wait/")) {
      expect(request.method()).toBe("GET");
      expect(request.headers()["authorization"]).toBeUndefined();
      const operation = url.pathname.split("/").at(-1);
      const hash = url.searchParams.get("hash");
      const observed: RpcRequest = operation === "head" ? { id: 1, method: "eth_blockNumber" } :
        operation === "receipt" ? { id: 1, method: "eth_getTransactionReceipt", params: [hash] } :
          operation === "transaction" ? { id: 1, method: "eth_getTransactionByHash", params: [hash] } :
            { id: 1, method: "eth_getBlockByNumber", params: [`0x${BigInt(url.searchParams.get("blockNumber")!).toString(16)}`, true] };
      const value = await options.rpc?.(observed) ?? { result: operation === "head" ? "0x64" : null };
      if ("error" in value) await route.fulfill({ status: 503, json: { error: "Synthetic wait observation unavailable" } });
      else await route.fulfill({ json: { chainId: CHAIN_ID, observedAt: "2026-10-02T00:00:00.000Z",
        [operation === "head" ? "blockNumber" : operation!]: operation === "head" ? BigInt(value.result as string).toString() : value.result } });
      return;
    }
    // Current clients use fixed observations, including replacement-aware waits.
    expect(url.pathname).not.toBe("/api/rpc");
    if (url.pathname.startsWith("/api/")) {
      await route.fulfill({ status: 503, json: { error: "Synthetic unrelated API unavailable" } });
      return;
    }
    if (url.origin !== appOrigin) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function openBalances(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Your wallet", exact: true });
  if (await dialog.isVisible()) return;
  await page.getByRole("button", { name: "Open wallet menu", exact: true }).click();
  await expect(dialog).toBeVisible();
}

async function connectSyntheticWallet(page: Page) {
  await openBalances(page);
  await expect(page.getByRole("heading", { name: "Your recovery shares" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Connect Wallet$/ })).toHaveCount(0);
}

function rehabilitatedPortfolio() {
  const result = portfolio();
  const pool = result.pools[0];
  pool.impaired = false;
  pool.coreAttachedShares = "0";
  pool.totalShares = pool.externalShares;
  pool.redeemableRaw = "5000000";
  pool.lifecycle.lifecycle = 1;
  Object.assign(pool.custody, { lifecycle: 1, poolImpaired: false, coreAttachedShares: "0", redeemablePoolRaw: "5000000", activeAvailableRaw: "20000000" });
  return result;
}

async function setPageHidden(page: Page, hidden: boolean) {
  // Headless Chromium keeps pages visible; dispatch the browser visibility
  // contract explicitly while the installed clock advances time without polling.
  await page.evaluate((hidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("recovery discovery stays on demand while visible and after returning from a hidden tab", async ({ page }) => {
  let requests = 0;
  let balance = 20_000_000n;
  await installWalletAndNetwork(page, async (route) => {
    requests++;
    await route.fulfill({ json: portfolio(balance) });
  });
  await page.goto("/en");
  await openBalances(page);
  await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
  const before = requests;
  await page.clock.fastForward(60_000);
  await page.clock.runFor(50);
  expect(requests).toBe(before);
  await setPageHidden(page, true);
  balance = 30_000_000n;
  await page.clock.fastForward(60_000);
  await setPageHidden(page, false);
  await page.clock.runFor(50);
  expect(requests).toBe(before);
  await page.getByRole("button", { name: "Refresh balances", exact: true }).click();
  await expect(page.getByText("30 recovery shares", { exact: true })).toBeVisible();
  expect(requests).toBe(before + 1);
});

test("manual recovery refresh can discover shares after an initially empty snapshot", async ({ page }) => {
  let requests = 0;
  let balance = 0n;
  await installWalletAndNetwork(page, async (route) => {
    requests++;
    await route.fulfill({ json: portfolio(balance) });
  });
  await page.goto("/en");
  await openBalances(page);
  await expect.poll(() => requests).toBeGreaterThan(0);
  const refresh = page.getByRole("button", { name: "Refresh balances", exact: true });
  await expect(refresh).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("heading", { name: "Your recovery shares" })).toHaveCount(0);
  const before = requests;
  balance = 20_000_000n;
  await refresh.click();
  await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
  expect(requests).toBe(before + 1);
});

test("an initial recovery discovery error can be retried through the refresh button", async ({ page }) => {
  let requests = 0;
  let unavailable = true;
  await installWalletAndNetwork(page, async (route) => {
    requests++;
    await route.fulfill(unavailable
      ? { status: 503, headers: { "Retry-After": "60" }, json: { error: "Synthetic recovery backoff" } }
      : { json: portfolio() });
  });
  await page.goto("/en");
  await openBalances(page);
  await expect(page.getByText(/Recovery-share balances could not be loaded/)).toBeVisible();
  const before = requests;
  unavailable = false;
  await page.getByRole("button", { name: "Refresh balances", exact: true }).click();
  await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
  expect(requests).toBe(before + 1);
});

test("visibility changes do not cancel or overlap an in-flight recovery read", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await installWalletAndNetwork(page, async (route) => {
    requests++;
    await pending;
    await route.fulfill({ json: portfolio() }).catch(() => undefined);
  });
  await page.goto("/en");
  await openBalances(page);
  await expect.poll(() => requests).toBeGreaterThan(0);
  const before = requests;
  await setPageHidden(page, true);
  await page.clock.fastForward(60_000);
  await setPageHidden(page, false);
  await page.clock.runFor(50);
  expect(requests).toBe(before);
  release();
  await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
  expect(requests).toBe(before);
});

test("settlement still refreshes recovery shares while the tab is hidden", async ({ page }) => {
  let releaseReceipt!: () => void;
  const receiptReady = new Promise<void>(resolve => { releaseReceipt = resolve; });
  let receiptStarted = false;
  let requests = 0;
  let balance = 20_000_000n;
  await installWalletAndNetwork(page, async (route) => {
    requests++;
    await route.fulfill({ json: portfolio(balance) });
  }, {
    simulateSubmission: true,
    redemption: async route => { await route.fulfill({ json: { core: CORE, rawOut: "5000000" } }); },
    rpc: async request => {
      if (request.method !== "eth_getTransactionReceipt") return;
      receiptStarted = true;
      await receiptReady;
      return { result: {
        transactionHash: SYNTHETIC_HASH, transactionIndex: "0x0", blockHash: `0x${"01".repeat(32)}`, blockNumber: "0x64",
        from: ALICE, to: CORE, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x1",
        contractAddress: null, logs: [], logsBloom: `0x${"00".repeat(256)}`, status: "0x1", type: "0x2",
      } };
    },
  });
  await page.goto("/en");
  await openBalances(page);
  await connectSyntheticWallet(page);
  await page.getByRole("button", { name: "Redeem recovery shares" }).click();
  await expect.poll(() => receiptStarted).toBe(true);
  const before = requests;
  await setPageHidden(page, true);
  await page.clock.fastForward(5_000);
  expect(requests).toBe(before);
  balance = 2_000_000n;
  releaseReceipt();
  await expect(page.getByText("2 recovery shares", { exact: true })).toBeVisible();
  expect(requests).toBe(before + 1);
  await expect(page.getByText("Recovery shares redeemed", { exact: true })).toBeVisible();
});

test("native recovery shares remain visible when the optional Fund is unavailable", async ({ page }) => {
  await installWalletAndNetwork(page, async (route) => { await route.fulfill({ json: portfolio() }); });
  await page.goto("/en");
  await openBalances(page);
  await expect(page.getByRole("heading", { name: "Your recovery shares" })).toBeVisible();
  await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
  await expect(page.getByText("5 underlying tokens", { exact: true })).toBeVisible();
  await expect(page.getByText(/Synthetic optional Fund outage/)).toHaveCount(0);
  await expect(page.getByText(/Core-attached shares/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Redeem recovery shares" })).toBeEnabled();
});

test("an unrelated injected wallet does not hide the active connector account on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installWalletAndNetwork(page, async (route, holder) => {
    expect(holder).toBe(ALICE.toLowerCase());
    await route.fulfill({ json: portfolio() });
  }, { unrelatedInjectedAccount: true });
  await page.goto("/en");
  await openBalances(page);
  await connectSyntheticWallet(page);
  await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
  await page.getByTestId("wallet-balance-modal").getByRole("button", { name: "Close balances", exact: true }).click();
  await page.getByRole("button", { name: "Open wallet menu", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect wallet", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Connect$/ })).toBeVisible();
});

test("recovery balances stay in the wallet dialog and closing it cannot discard a pending redemption", async ({ page }) => {
  let simulationStarted = false;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await installWalletAndNetwork(page, async route => { await route.fulfill({ json: portfolio() }); }, {
    redemption: async route => {
      simulationStarted = true;
      await pending;
      await route.fulfill({ status: 503, json: { error: "Synthetic transfer rejected" } });
    },
  });
  await page.goto("/en");
  await expect(page.getByRole("heading", { name: "Your recovery shares" })).toHaveCount(0);
  await openBalances(page);
  const claim = page.getByRole("button", { name: "Redeem recovery shares" });
  await expect(claim).toBeEnabled();
  await claim.click();
  await expect.poll(() => simulationStarted).toBe(true);
  await page.getByRole("button", { name: "Close balances", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your recovery shares" })).toHaveCount(0);
  await openBalances(page);
  await expect(claim).toBeDisabled();
  release();
  await expect(claim).toBeEnabled();
});

test("cached recovery and liquidity figures survive reload with disabled redemption presentation", async ({ page }) => {
  let paused = false, recoveryPending = false, liquidityPending = false, release!: () => void;
  let redemptionRequests = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await installWalletAndNetwork(page, async route => {
    if (paused) { recoveryPending = true; await waiting; }
    await route.fulfill({ json: portfolio() });
  }, { redemption: async route => {
    redemptionRequests++;
    await route.fulfill({ status: 503, json: { error: "Synthetic redemption must not start from a cached button" } });
  } });
  await installLiquidityPrices(page);
  await page.route("**/api/account/liquidity-positions?**", async route => {
    if (paused) { liquidityPending = true; await waiting; }
    await route.fulfill({ json: lpSnapshot });
  });
  await page.goto("/en");
  await openBalances(page);
  await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redeem recovery shares" })).toBeEnabled();
  const total = page.getByTestId("liquidity-collapsed-value");
  await expect(total).toContainText("4 725.29");
  const before = await total.innerText();
  await expect.poll(() => page.evaluate(({ chain, holder }) => {
    const prefix = `cybergold:wallet-display:v1:${chain}:${holder}:`;
    const recovery = JSON.parse(sessionStorage.getItem(`${prefix}recovery:en`) ?? "null");
    const liquidity = JSON.parse(sessionStorage.getItem(`${prefix}liquidity`) ?? "null");
    return recovery?.rows?.length === 1 && liquidity?.positionCount === 2;
  }, { chain: CHAIN_ID, holder: ALICE })).toBe(true);

  paused = true;
  try {
    await page.reload();
    await openBalances(page);
    await expect.poll(() => recoveryPending && liquidityPending).toBe(true);
    await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
    await expect(page.getByText("5 underlying tokens", { exact: true })).toBeVisible();
    const cachedClaim = page.getByRole("button", { name: "Redeem recovery shares" });
    await expect(cachedClaim).toBeDisabled();
    await cachedClaim.evaluate(button => (button as HTMLButtonElement).click());
    expect(redemptionRequests).toBe(0);
    const methods = await page.evaluate(() => (window as unknown as { __recoveryTestWalletRequests: string[] }).__recoveryTestWalletRequests);
    expect(methods.filter(method => /^(?:eth_send|eth_sign|personal_sign|wallet_send)/.test(method))).toEqual([]);
    await expect(total).toHaveText(before);
    await page.getByRole("button", { name: /Liquidity Positions/ }).click();
    await expect(page.getByTestId("liquidity-position-count")).toHaveText("2 positions");
    await expect(page.getByTestId("liquidity-fiat-value")).toHaveText(before);
    await expect(page.getByTestId("wallet-balance-modal").locator(".animate-spin")).toHaveCount(0);
    release();
    await expect(page.getByRole("button", { name: "Redeem recovery shares" })).toBeEnabled();
    await expect(total).toHaveText(before);
  } finally { release(); }
});

test("failed refresh retains the last complete shares and never flashes initial loading", async ({ page }) => {
  let fail = false;
  let requests = 0;
  await installWalletAndNetwork(page, async (route) => {
    requests++;
    await route.fulfill(fail ? { status: 503, json: { error: "Synthetic recovery RPC outage" } } : { json: portfolio() });
  });
  await page.goto("/en");
  await openBalances(page);
  await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
  fail = true;
  const before = requests;
  await page.getByRole("button", { name: "Refresh balances", exact: true }).click();
  await expect.poll(() => requests).toBeGreaterThan(before);
  await expect(page.getByText(/These are your last known recovery-share balances/)).toBeVisible();
  await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
  await expect(page.getByText("Loading recovery shares…", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Redeem recovery shares" })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh balances", exact: true }).click();
  await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
  await expect(page.getByText("Loading recovery shares…", { exact: true })).toHaveCount(0);
});

test("complete empty ownership and initial discovery failure are different UI states", async ({ page }) => {
  let unavailable = false;
  let requests = 0;
  await installWalletAndNetwork(page, async (route) => {
    requests++;
    await route.fulfill(unavailable ? { status: 503, json: { error: "Synthetic recovery RPC outage" } } : { json: portfolio(0n) });
  });
  await page.goto("/en");
  await openBalances(page);
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(page.getByText("Loading recovery shares…", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your recovery shares" })).toHaveCount(0);
  await expect(page.getByText(/Recovery-share balances could not be loaded/)).toHaveCount(0);
  unavailable = true;
  await page.reload();
  await openBalances(page);
  await expect(page.getByText(/Recovery-share balances could not be loaded/)).toBeVisible();
  await expect(page.getByText(/Refresh balances to try again/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your recovery shares" })).toHaveCount(0);
});

test("switching wallets during a delayed read cannot publish the old wallet's shares", async ({ page }) => {
  let releaseAlice!: () => void;
  const delayedAlice = new Promise<void>((resolve) => { releaseAlice = resolve; });
  let aliceRequests = 0;
  await installWalletAndNetwork(page, async (route, holder) => {
    if (holder === ALICE) {
      aliceRequests++;
      await delayedAlice;
      // The browser intentionally aborts this request when the holder changes.
      await route.fulfill({ json: portfolio(11_000_000n) }).catch(() => undefined);
    } else {
      expect(holder).toBe(BOB);
      await route.fulfill({ json: portfolio(2_000_000n) });
    }
  });
  await page.goto("/en");
  await openBalances(page);
  await expect.poll(() => aliceRequests).toBeGreaterThan(0);
  await page.evaluate((account) => {
    (window as unknown as { __switchRecoveryTestAccount: (value: string) => void }).__switchRecoveryTestAccount(account);
  }, BOB);
  await expect(page.getByText("2 recovery shares", { exact: true })).toBeVisible();
  releaseAlice();
  await page.clock.fastForward(1000);
  await expect(page.getByText("2 recovery shares", { exact: true })).toBeVisible();
  await expect(page.getByText("11 recovery shares", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Loading recovery shares…", { exact: true })).toHaveCount(0);
});

test("redemption awaits a pending wallet client after the account is connected", async ({ page }) => {
  let simulations = 0;
  await installWalletAndNetwork(page, async (route) => {
    await route.fulfill({ json: portfolio() });
  }, { delayWalletClient: true, redemption: async (route) => {
    simulations++;
    await route.fulfill({ status: 503, json: { error: "Synthetic token transfer rejection" } });
  } });
  await page.goto("/en");
  await openBalances(page);
  await connectSyntheticWallet(page);
  const redeem = page.getByRole("button", { name: "Redeem recovery shares" });
  await expect(redeem).toBeEnabled();
  await redeem.click();
  await expect(redeem).toBeDisabled();
  expect(simulations).toBe(0);
  await expect(page.getByText("Wallet client is unavailable.", { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { __releaseRecoveryTestWalletClient: () => void }).__releaseRecoveryTestWalletClient();
  });
  await expect.poll(() => simulations).toBeGreaterThan(0);
  await expect(page.getByText(/Recovery-share redemption failed/)).toBeVisible();
  await expect(redeem).toBeEnabled();
  const methods = await page.evaluate(() => (window as unknown as { __recoveryTestWalletRequests: string[] }).__recoveryTestWalletRequests);
  expect(methods).not.toContain("eth_sendTransaction");
});

for (const mode of ["impaired", "rehabilitated"] as const) {
  test(`${mode} redemption simulates current transfer and never submits after rejection`, async ({ page }) => {
    const simulations: RedemptionRequest[] = [];
    await installWalletAndNetwork(page, async (route) => {
      await route.fulfill({ json: mode === "impaired" ? portfolio() : rehabilitatedPortfolio() });
    }, { redemption: async (route, request) => {
      simulations.push(request);
      await route.fulfill({ status: 503, json: { error: "Synthetic token transfer rejection" } });
    } });
    await page.goto("/en");
  await openBalances(page);
    await connectSyntheticWallet(page);
    await page.getByRole("button", { name: "Redeem recovery shares" }).click();
    await expect.poll(() => simulations.length).toBeGreaterThan(0);
    expect(simulations[0]).toEqual({ asset: getAddress(ASSET), shares: "20000000",
      holder: getAddress(ALICE), minRawOut: "4950000" });
    await expect(page.getByText(/Recovery-share redemption failed/)).toBeVisible();
    await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
    const methods = await page.evaluate(() => (window as unknown as { __recoveryTestWalletRequests: string[] }).__recoveryTestWalletRequests);
    expect(methods).not.toContain("eth_sendTransaction");
    expect(methods).not.toContain("eth_sendRawTransaction");
  });
}

for (const change of ["account", "chain"] as const) {
  test(`a wallet ${change} change during recovery simulation prevents submission`, async ({ page }) => {
    let releaseSimulation!: () => void;
    const delayedSimulation = new Promise<void>((resolve) => { releaseSimulation = resolve; });
    let simulationStarted = false;
    await installWalletAndNetwork(page, async (route) => {
      await route.fulfill({ json: portfolio() });
    }, { simulateSubmission: true, redemption: async (route) => {
      simulationStarted = true;
      await delayedSimulation;
      await route.fulfill({ json: { core: CORE, rawOut: "5000000" } });
    } });
    await page.goto("/en");
  await openBalances(page);
    await connectSyntheticWallet(page);
    const redeem = page.getByRole("button", { name: "Redeem recovery shares" });
    await redeem.click();
    await expect.poll(() => simulationStarted).toBe(true);
    // The provider has switched before React receives its event. Submission
    // must re-read the live wallet rather than trust the rendered account.
    await page.evaluate(({ change, account, chain }) => {
      const wallet = window as unknown as {
        __switchRecoveryTestAccount: (value: string, emit: boolean) => void;
        __switchRecoveryTestChain: (value: string, emit: boolean) => void;
      };
      if (change === "account") wallet.__switchRecoveryTestAccount(account, false);
      else wallet.__switchRecoveryTestChain(chain, false);
    }, { change, account: BOB, chain: `0x${(CHAIN_ID + 1).toString(16)}` });
    releaseSimulation();
    await expect(page.getByText(/Recovery-share redemption failed/)).toBeVisible();
    if (change === "account") {
      // A polled selected-address mismatch correctly hides the old account's
      // controls. Return to its account before asserting ordinary retry readiness.
      await page.evaluate((account) => {
        (window as unknown as { __switchRecoveryTestAccount: (value: string) => void }).__switchRecoveryTestAccount(account);
      }, ALICE);
    }
    await expect(redeem).toBeEnabled();
    const methods = await page.evaluate(() => (window as unknown as { __recoveryTestWalletRequests: string[] }).__recoveryTestWalletRequests);
    expect(methods).not.toContain("eth_sendTransaction");
    expect(methods).not.toContain("eth_sendRawTransaction");
  });
}

for (const oldStatus of ["0x1", "0x0"]) {
test(`a delayed old-wallet ${oldStatus === "0x1" ? "success" : "revert"} cannot change the new wallet's pending recovery`, async ({ page }) => {
  let releaseAlice!: () => void;
  let releaseBob!: () => void;
  const delayedAlice = new Promise<void>((resolve) => { releaseAlice = resolve; });
  const delayedBob = new Promise<void>((resolve) => { releaseBob = resolve; });
  const receiptRequests: unknown[] = [];
  let aliceReads = 0;
  await installWalletAndNetwork(page, async (route, holder) => {
    if (holder === ALICE) aliceReads++;
    await route.fulfill({ json: portfolio(holder === ALICE ? 20_000_000n : 2_000_000n) });
  }, { simulateSubmission: true,
    redemption: async (route) => { await route.fulfill({ json: { core: CORE, rawOut: "5000000" } }); },
    rpc: async (request) => {
    if (request.method !== "eth_getTransactionReceipt") return;
    const hash = request.params?.[0];
    receiptRequests.push(hash);
    await (hash === SYNTHETIC_HASH ? delayedAlice : delayedBob);
    return { result: {
      transactionHash: hash, transactionIndex: "0x0", blockHash: `0x${"01".repeat(32)}`, blockNumber: "0x64",
      from: hash === SYNTHETIC_HASH ? ALICE : BOB, to: CORE, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x1",
      contractAddress: null, logs: [], logsBloom: `0x${"00".repeat(256)}`, status: hash === SYNTHETIC_HASH ? oldStatus : "0x1", type: "0x2",
    } };
  } });
  await page.goto("/en");
  await openBalances(page);
  await connectSyntheticWallet(page);
  await page.getByRole("button", { name: "Redeem recovery shares" }).click();
  await expect.poll(() => receiptRequests).toContain(SYNTHETIC_HASH);
  const switchTo = (account: string) => page.evaluate((account) => {
    (window as unknown as { __switchRecoveryTestAccount: (value: string) => void }).__switchRecoveryTestAccount(account);
  }, account);
  await switchTo(BOB);
  await expect(page.getByText("2 recovery shares", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redeem recovery shares" })).toBeEnabled();
  await switchTo(ALICE);
  await expect(page.getByText("20 recovery shares", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redeem recovery shares" })).toBeDisabled();
  await switchTo(BOB);
  await expect(page.getByText("2 recovery shares", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Redeem recovery shares" }).click();
  await expect.poll(() => receiptRequests).toContain(SECOND_SYNTHETIC_HASH);
  const before = aliceReads;
  releaseAlice();
  await page.clock.fastForward(1000);
  await expect(page.getByText("2 recovery shares", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redeem recovery shares" })).toBeDisabled();
  expect(aliceReads).toBe(before);
  await expect(page.getByText("Recovery shares redeemed", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Recovery-share transaction reverted", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Loading recovery shares…", { exact: true })).toHaveCount(0);
  releaseBob();
  await expect(page.getByText("Recovery shares redeemed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redeem recovery shares" })).toBeEnabled();
});
}

test("French swap stays quiet during initial recovery discovery; wallet refresh shares that initial read", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await installWalletAndNetwork(page, async route => {
    requests++;
    await pending;
    await route.fulfill({ json: portfolio(0n) });
  });
  await page.goto("/fr");
  await expect.poll(() => requests).toBeGreaterThan(0);
  const before = requests;
  await expect(page.getByText("Loading recovery shares…", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Actualiser les parts/ })).toHaveCount(0);
  await page.screenshot({ path: "out/audit/swap-french-quiet-recovery.png", fullPage: true });
  await page.getByRole("button", { name: "Ouvrir le menu du portefeuille", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Votre portefeuille", exact: true });
  await expect(dialog).toBeVisible();
  expect(requests).toBe(before);
  release();
  await expect(dialog.getByRole("button", { name: "Actualiser les soldes", exact: true })).toBeEnabled();
  expect(requests).toBe(before);
  await expect(dialog.getByRole("button", { name: /Loading/ })).toHaveCount(0);
  await expect(dialog.getByText(/Synthetic unrelated API unavailable/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Actualiser les soldes", exact: true }).click();
  await expect.poll(() => requests).toBe(before + 1);
});

test("liquidity loads with the wallet, aligns its collapsed total and reuses token prices", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 950 });
  let reads = 0;
  await installWalletAndNetwork(page, route => route.fulfill({ json: portfolio(0n) }));
  await installLiquidityPrices(page);
  await page.route("**/api/account/liquidity-positions?**", route => {
    reads++;
    return route.fulfill({ json: lpSnapshot });
  });
  await page.goto("/en");
  await openBalances(page);
  const trigger = page.getByRole("button", { name: /Liquidity Positions/ });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("liquidity-collapsed-value")).toContainText("4 725.29");
  await expect(page.getByTestId("wallet-balance-value-paxg")).toContainText("3 725.29");
  expect(reads).toBeGreaterThan(0);
  const initialReads = reads;
  const lpValue = await page.getByTestId("liquidity-collapsed-value").boundingBox();
  const tokenValue = await page.getByTestId("wallet-balance-value-paxg").boundingBox();
  expect(Math.abs(lpValue!.x + lpValue!.width - tokenValue!.x - tokenValue!.width)).toBeLessThanOrEqual(1);
  await page.getByTestId("wallet-balance-modal").screenshot({ path: "out/liquidity-positions-compact.png", animations: "disabled" });
  await trigger.click();
  await expect(page.getByTestId("liquidity-provider-panel")).toContainText("2 positions");
  await expect(page.getByTestId("liquidity-fiat-value")).toContainText("4 725.29");
  await expect(page.getByTestId("liquidity-gold-value")).toContainText("47.25 g");
  const settings = await openNavbarSettings(page, "currency");
  await settings.getByRole("button", { name: "EUR", exact: true }).click();
  await expect(page.getByTestId("liquidity-fiat-value")).toContainText("4 252.76");
  await openNavbarSettings(page, "goldUnit");
  await settings.getByRole("button", { name: "Imperial (ozt)", exact: true }).click();
  await expect(page.getByTestId("liquidity-gold-value")).toContainText("1.52 troy oz");
  await expect(page.getByTestId("liquidity-collapsed-value")).toContainText("1.52 troy oz");
  await expect(page.getByTestId("liquidity-provider-panel")).not.toContainText("gold reference");
  await expect(page.getByTestId("liquidity-provider-panel")).not.toContainText("excludes unclaimed fees");
  await expect(page.getByTestId("liquidity-fiat-value")).toContainText("4 252.76");
  await expect(page.getByRole("link", { name: "See my positions" })).toHaveAttribute("href", "https://app.uniswap.org/positions");
  const addUrl = new URL((await page.getByRole("link", { name: "Add liquidity" }).getAttribute("href"))!);
  expect(addUrl.pathname).toBe("/positions/add/ethereum/0x33fd4629a4e190b9a98a8a3758afb7a2639eb740088a04bd4d3016e3ac9d55a4");
  expect(addUrl.searchParams.get("protocolVersion")).toBe("v4");
  expect(addUrl.searchParams.has("priceRangeState")).toBe(false);
  expect(reads).toBe(initialReads);
  await page.getByRole("button", { name: "Refresh balances", exact: true }).click();
  await expect.poll(() => reads).toBe(initialReads + 1);
  await page.screenshot({ path: "out/liquidity-provider-populated.png", fullPage: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("liquidity-fiat-value")).not.toBeVisible();
  await expect(page.getByTestId("liquidity-collapsed-value")).toContainText("1.52 troy oz");
});

test("liquidity outage stays distinct from an empty wallet and can be retried", async ({ page }) => {
  let unavailable = true;
  await installWalletAndNetwork(page, route => route.fulfill({ json: portfolio(0n) }));
  await installLiquidityPrices(page);
  await page.route("**/api/account/liquidity-positions?**", route => route.fulfill(unavailable
    ? { status: 503, json: { error: "Synthetic LP service unavailable" } }
    : { json: { positions: [], paxgAmount: "0", cygldAmount: "0", blockNumber: "26000000" } }));
  await page.goto("/en");
  await openBalances(page);
  await page.getByRole("button", { name: /Liquidity Positions/ }).click();
  await expect(page.getByText("Your pool positions could not be loaded. Try again.")).toBeVisible();
  await expect(page.getByTestId("liquidity-fiat-value")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add liquidity" })).toBeVisible();
  unavailable = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("This wallet has no positions in the PAXG / CYGLD pool.")).toBeVisible();
  await expect(page.getByTestId("liquidity-fiat-value")).toContainText("0.00");
  await expect(page.getByTestId("liquidity-gold-value")).toContainText("0.00");
});

test("liquidity quantities switch to the new wallet without retaining the previous wallet total", async ({ page }) => {
  await installWalletAndNetwork(page, route => route.fulfill({ json: portfolio(0n) }));
  await installLiquidityPrices(page);
  const holders: string[] = [];
  await page.route("**/api/account/liquidity-positions?**", route => {
    const holder = new URL(route.request().url()).searchParams.get("holder")!.toLowerCase();
    holders.push(holder);
    return route.fulfill({ json: holder === ALICE ? lpSnapshot
      : { positions: [], paxgAmount: "0", cygldAmount: "0", blockNumber: "26000000" } });
  });
  await page.goto("/en");
  await openBalances(page);
  await page.getByRole("button", { name: /Liquidity Positions/ }).click();
  await expect(page.getByTestId("liquidity-fiat-value")).toContainText("4 725.29");
  await page.evaluate(account => {
    (window as unknown as { __switchRecoveryTestAccount: (value: string) => void }).__switchRecoveryTestAccount(account);
  }, BOB);
  await expect(page.getByText("This wallet has no positions in the PAXG / CYGLD pool.")).toBeVisible();
  await expect(page.getByTestId("liquidity-fiat-value")).toContainText("0.00");
  expect(holders).toContain(BOB);
});

test("liquidity panel fits a mobile wallet and keeps both Uniswap actions reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installWalletAndNetwork(page, route => route.fulfill({ json: portfolio(0n) }));
  await installLiquidityPrices(page);
  await page.route("**/api/account/liquidity-positions?**", route => route.fulfill({ json: lpSnapshot }));
  await page.goto("/en");
  await openBalances(page);
  await page.getByRole("button", { name: /Liquidity Positions/ }).click();
  await expect(page.getByTestId("liquidity-fiat-value")).toContainText("4 725.29");
  await expect(page.getByRole("link", { name: "Add liquidity" })).toBeVisible();
  const panel = page.getByTestId("liquidity-provider-panel");
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  if (CHAIN_ID !== 1) {
    await expect(panel).toContainText("Sandbox data may differ from Ethereum mainnet");
  }
  await page.screenshot({ path: "out/liquidity-positions-mobile-expanded.png", fullPage: true });
  await page.getByRole("button", { name: /Liquidity Positions/ }).click();
  await expect(page.getByTestId("liquidity-collapsed-value")).toContainText("4 725.29");
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "out/liquidity-positions-mobile-compact.png", fullPage: true, animations: "disabled" });
});
