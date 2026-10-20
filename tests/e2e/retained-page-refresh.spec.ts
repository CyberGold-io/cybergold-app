import { expect, test, type Page } from "./fixtures/app-test";
import { install as installTradingFixture } from "./fixtures/token-quotes";

const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const summaryKey = `cg:page-display:v1:${chain}:en:dashboard`;
const now = Date.now();
const bucket = { bucketStartMs: now - 3_600_000, mintCygld: 20, redeemCygld: 3,
  netCygld: 17, supplyCygld: 123, transferredCygld: 45, transferTxCount: 4 };
const makeSummary = (supply = 123) => ({ enabled: true, chainHeadTimestampMs: now,
  protocolLogicUpdate: null, protocolParameterUpdate: null,
  metrics: { currentTotalSupplyCygld: supply, netIssuance24hCygld: 17, holderCount: 2,
    issuanceFeePercent: 0.1, redemptionFeePercent: 0.1, paused: false },
  basket: { cygldRefGrams: 2, assets: [{ address: "0x45804880de22913dafe09f4980848ece6ecbaf78", symbol: "PAXG",
    targetPercent: 100, actualPercent: 100, driftPercent: 0, decimals: 18, reserveBalance: 12,
    reserveBalanceRaw: "12000000000000000000", totalSupply: 100, totalSupplyRaw: "100000000000000000000",
    goldRefGrams: 31.1034768, cygldPerUnitFp18: "15551738400000000000", cygldPerToken: 15.5517384 }] },
  series: { "24H": [bucket], "7D": [bucket], "1M": [bucket] },
});

async function holdScripts(page: Page) {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let count = 0;
  await page.route("**/_next/static/**/*.js*", async route => {
    count++;
    await pending;
    try { await route.continue(); } catch { /* A closed page cancels outstanding asset requests. */ }
  });
  return { release, count: () => count };
}

async function dashboardFixture(page: Page) {
  const options = { supply: 123, fail: false, hold: false, requests: 0 };
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/protocol/config") return route.fallback();
    if (path === "/api/dashboard/onchain-summary") {
      options.requests++;
      if (options.hold) await pending;
      return route.fulfill(options.fail ? { status: 503, json: { error: "Dashboard read temporarily unavailable." } }
        : { json: makeSummary(options.supply) });
    }
    if (path === "/api/gold") return route.fulfill({ json: { price: 3110.34768, fetchedAt: new Date(now).toISOString(), stale: false } });
    return route.fulfill({ status: 503, json: { error: "Unrelated fixture data unavailable." } });
  });
  return { options, release };
}

for (const width of [1280, 390]) {
  test(`dashboard keeps observed values, chart images and selections before JavaScript at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await dashboardFixture(page);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/en/dashboard");
    await expect(page.getByText("123 CYGLD", { exact: true }).first()).toBeVisible();
    await expect(page.locator(".echarts-for-react[data-page-chart-ready]")).toHaveCount(3);
    await page.getByRole("heading", { name: /^Trading activity/ }).locator("../..").getByRole("button", { name: "1M", exact: true }).click();
    await page.getByRole("button", { name: /^PAXG/ }).click();
    await expect(page.getByText("Reserve balance", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), summaryKey)).not.toBeNull();
    await page.evaluate(() => document.fonts.ready);
    const cardAppearance = (node: HTMLElement) => {
      const bounds = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const primary = node.querySelector<HTMLElement>(".text-2xl");
      const primaryStyle = primary ? getComputedStyle(primary) : style;
      return { bounds: { x: bounds.x, y: bounds.y + window.scrollY, width: bounds.width, height: bounds.height },
        color: style.color, backgroundColor: style.backgroundColor, borderColor: style.borderColor,
        borderRadius: style.borderRadius, fontFamily: style.fontFamily, fontSize: style.fontSize,
        valueColor: primaryStyle.color, valueFontSize: primaryStyle.fontSize, valueFontWeight: primaryStyle.fontWeight };
    };
    const baselineCard = await page.getByText("123 CYGLD", { exact: true }).first().locator("../../..").evaluate(cardAppearance);
    const baselinePath = test.info().outputPath(`dashboard-${width}-baseline.png`);
    await page.screenshot({ path: baselinePath, fullPage: true });
    await test.info().attach(`Dashboard ${width}px before reload`, { path: baselinePath, contentType: "image/png" });
    fixture.options.hold = true;
    const scripts = await holdScripts(page);
    try {
      await page.reload({ waitUntil: "commit" });
      const cached = page.getByTestId("retained-page-cached");
      await expect(cached).toBeVisible();
      await expect.poll(scripts.count).toBeGreaterThan(0);
      await expect.poll(() => page.evaluate(() => performance.getEntriesByName("first-contentful-paint").length)).toBeGreaterThan(0);
      await expect(cached.getByText("123 CYGLD", { exact: true }).first()).toBeVisible();
      await expect(cached.locator("img[data-page-canvas]")).toHaveCount(3);
      await expect(cached.getByText("Reserve balance", { exact: true })).toBeVisible();
      const selected = cached.getByRole("heading", { name: /^Trading activity/ }).locator("../..").getByRole("button", { name: "1M", exact: true });
      await expect(selected).toHaveClass(/bg-gold-cg/);
      await page.evaluate(() => document.fonts.ready);
      const cachedCard = await cached.getByText("123 CYGLD", { exact: true }).first().locator("../../..").evaluate(cardAppearance);
      const { bounds: baselineBounds, ...baselineStyle } = baselineCard;
      const { bounds: cachedBounds, ...cachedStyle } = cachedCard;
      expect(cachedStyle).toEqual(baselineStyle);
      for (const dimension of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(cachedBounds[dimension] - baselineBounds[dimension]), `unchanged supply-card ${dimension}`).toBeLessThanOrEqual(1);
      }
      const cachedPath = test.info().outputPath(`dashboard-${width}-cached-first-paint.png`);
      await page.screenshot({ path: cachedPath, fullPage: true });
      await test.info().attach(`Dashboard ${width}px cached first paint with JavaScript paused`, { path: cachedPath, contentType: "image/png" });
      const reads = fixture.options.requests;
      await cached.getByRole("button", { name: "Refresh Data", exact: true }).filter({ visible: true }).click({ force: true });
      expect(fixture.options.requests).toBe(reads);
      scripts.release();
      await expect(cached).toBeHidden();
      await expect(page.getByText("123 CYGLD", { exact: true }).first()).toBeVisible();
      await expect(page.locator(".echarts-for-react[data-page-chart-ready]")).toHaveCount(3);
      fixture.options.supply = 124;
      fixture.release();
      await expect(page.getByText("124 CYGLD", { exact: true }).first()).toBeVisible();
      expect(errors).toEqual([]);
    } finally { scripts.release(); fixture.release(); }
  });
}

test("dashboard retains completed observations when a background refresh fails", async ({ page }) => {
  const fixture = await dashboardFixture(page);
  await page.goto("/en/dashboard");
  await expect(page.getByText("123 CYGLD", { exact: true }).first()).toBeVisible();
  fixture.options.fail = true;
  await page.getByRole("button", { name: "Refresh Data", exact: true }).filter({ visible: true }).click();
  await expect(page.getByText("Dashboard read temporarily unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByText("123 CYGLD", { exact: true }).first()).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(3);
  fixture.options.fail = false;
  fixture.options.supply = 125;
  await page.getByRole("button", { name: "Refresh Data", exact: true }).filter({ visible: true }).click();
  await expect(page.getByText("125 CYGLD", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Dashboard read temporarily unavailable.", { exact: true })).toHaveCount(0);
});

test("cached governance presentation cannot execute actions and leaves on a real account change", async ({ page }) => {
  const alice = "0x00000000000000000000000000000000000000a1";
  const bob = "0x00000000000000000000000000000000000000b2";
  await page.addInitScript(({ chain, alice, bob }) => {
    const scope = JSON.stringify([chain, "en", "USD", "metric", "fiat"]);
    sessionStorage.setItem(`cybergold:wallet-presentation:v1:${chain}:en`, JSON.stringify({ address: alice }));
    sessionStorage.setItem(`cg:page-display:v1:${chain}:en:governance-core`, JSON.stringify({
      scope, account: alice, scrollY: 0, tree: [{ tag: "section", attributes: { class: "p-4" }, children: [
        { tag: "h1", attributes: {}, children: ["Cached governance values"] },
        { tag: "button", attributes: { type: "button" }, children: ["Execute cached action"] },
        { tag: "input", attributes: { type: "text", value: "321", "data-page-draft-key": "unrelated-action:amount", "aria-label": "Cached amount" }, children: [] },
      ] }],
    }));
    const calls: string[] = [];
    const provider = { isMetaMask: true, selectedAddress: bob,
      request: async ({ method }: { method: string }) => {
        calls.push(method);
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [bob];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        throw new Error(`No synthetic transaction approval for ${method}`);
      }, on: () => {}, removeListener: () => {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    Object.assign(window, { __governanceRefreshCalls: calls });
  }, { chain, alice, bob });
  const success = <T,>(value: T) => ({ status: "success", value });
  const context = { chainId: chain, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, blockTimestamp: "1790800000", observedAt: "2026-10-01T00:00:00Z" };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/protocol/config") return route.fallback();
    if (path === "/api/governance/core-facts") return route.fulfill({ json: { context, core: alice, configuration: { safeWallet: success(bob) } } });
    if (path === "/api/governance/roles") return route.fulfill({ json: { context, surface: "core", address: alice, memberDisplayLimit: 50, roles: [] } });
    if (path === "/api/governance/safe-principal") return route.fulfill({ json: { context, address: bob, code: success("0x6000"), owners: success([alice]), threshold: success("1") } });
    return route.fulfill({ status: 503, json: { error: "Unrelated fixture data unavailable." } });
  });
  const scripts = await holdScripts(page);
  try {
    await page.goto("/en/governance/core", { waitUntil: "commit" });
    const cached = page.getByTestId("retained-page-cached");
    await expect(cached.getByRole("heading", { name: "Cached governance values" })).toBeVisible();
    await cached.getByRole("button", { name: "Execute cached action" }).click({ force: true });
    await cached.getByRole("textbox", { name: "Cached amount" }).fill("654");
    expect(await page.evaluate(() => (window as unknown as { __governanceRefreshCalls: string[] }).__governanceRefreshCalls)).toEqual([]);
    scripts.release();
    await expect(cached).toBeHidden();
    await expect(page.getByRole("heading", { name: "Core Diamond", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Cached amount" })).toHaveCount(0);
    const methods = await page.evaluate(() => (window as unknown as { __governanceRefreshCalls: string[] }).__governanceRefreshCalls);
    expect(methods.filter(method => /sendTransaction|signTypedData|personal_sign|eth_sign$/.test(method))).toEqual([]);
  } finally { scripts.release(); }
});


test("governance restores ordinary drafts and preserves edits made before hydration", async ({ page }) => {
  const owner = "0x00000000000000000000000000000000000000a1";
  const safe = "0x00000000000000000000000000000000000000b2";
  await installTradingFixture(page);
  await page.addInitScript(({ owner, chain }) => {
    const methods: string[] = [];
    const provider = { isMetaMask: true, selectedAddress: owner,
      request: async ({ method }: { method: string }) => {
        methods.push(method);
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [owner];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        if (method === "eth_getBalance") return "0x0";
        throw new Error(`Synthetic wallet rejects ${method}`);
      }, on: () => {}, removeListener: () => {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    Object.assign(window, { __governanceDraftMethods: methods });
  }, { owner, chain });
  const success = <T,>(value: T) => ({ status: "success", value });
  const context = { chainId: chain, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, blockTimestamp: "1790800000", observedAt: "2026-10-01T00:00:00Z" };
  let unavailableConfiguration = false;
  await page.route("**/api/governance/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/governance/core-facts") return route.fulfill({ json: { context, core: owner, configuration: {
      safeWallet: success(safe), treasury: unavailableConfiguration ? { status: "failure", error: "contract-read-failed" } : success(safe), basketConfigHash: success(`0x${"b".repeat(64)}`),
      issuanceFeePpm: success("1000"), redemptionFeePpm: success("1000"), maxFeePpm: success("10000"),
      maxTotalSupply: success("250000000000000000000"), totalSupply: success("100000000000000000000"),
    } } });
    if (path === "/api/governance/roles") return route.fulfill({ json: { context, surface: "core", address: owner, memberDisplayLimit: 50,
      roles: [{ id: "DEFAULT_ADMIN_ROLE", count: success("1"), members: [success(owner)] }, { id: "UPGRADER_ROLE", count: success("0"), members: [] }] } });
    if (path === "/api/governance/authority") return route.fulfill({ json: { context, surface: "core", address: owner, account: owner,
      safeWallet: success(safe), paused: success(false), accountCanPause: success(true), accountCanUnpause: success(false), safeCanUnpause: success(true) } });
    if (path === "/api/governance/safe-principal") return route.fulfill({ json: { context,
      address: new URL(route.request().url()).searchParams.get("address"), code: success("0x6000"), owners: success([owner]), threshold: success("1") } });
    if (path === "/api/governance/owner-aliases") return route.fulfill({ json: { aliases: [] } });
    return route.fallback();
  });
  await page.goto("/en/governance/core");
  const cap = page.locator('[data-page-draft-key="set-max-total-supply:max-supply"]');
  await expect(cap).toBeVisible();
  await cap.fill("444");
  await page.getByRole("button", { name: "Add asset", exact: true }).click();
  await expect(page.locator('[data-page-draft-key^="set-basket:"][data-page-draft-key$=":asset"]')).toHaveCount(2);
  const key = `cg:page-display:v1:${chain}:en:governance-core`;
  await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key)?.includes("444") ?? false, key)).toBe(true);
  const scripts = await holdScripts(page);
  try {
    await page.reload({ waitUntil: "commit" });
    const cached = page.getByTestId("retained-page-cached");
    const cachedCap = cached.locator('[data-page-draft-key="set-max-total-supply:max-supply"]');
    await expect(cachedCap).toHaveValue("444");
    await cachedCap.fill("555");
    const targetFields = cached.locator('[data-page-draft-key^="set-basket:"][data-page-draft-key$=":target"]');
    const goldFields = cached.locator('[data-page-draft-key^="set-basket:"][data-page-draft-key$=":gold-reference"]');
    await targetFields.first().fill("900000");
    await goldFields.first().fill("30");
    await expect(cached.locator('[data-page-draft-key^="set-basket:"][data-page-draft-key$=":asset"]')).toHaveCount(2);
    scripts.release();
    await expect(cached).toBeHidden();
    await expect(page.locator('[data-page-live] [data-page-draft-key="set-max-total-supply:max-supply"]')).toHaveValue("555");
    await expect(page.locator('[data-page-live] [data-page-draft-key^="set-basket:"][data-page-draft-key$=":asset"]')).toHaveCount(2);
    await expect(page.locator('[data-page-live] [data-page-draft-key^="set-basket:"][data-page-draft-key$=":target"]').first()).toHaveValue("900000");
    await expect(page.locator('[data-page-live] [data-page-draft-key^="set-basket:"][data-page-draft-key$=":gold-reference"]').first()).toHaveValue("30");
    const methods = await page.evaluate(() => (window as unknown as { __governanceDraftMethods: string[] }).__governanceDraftMethods);
    expect(methods.filter(method => /sendTransaction|signTypedData|personal_sign|eth_sign$/.test(method))).toEqual([]);
    // The Safe authority still resolves, while the independent Core controller
    // observation is unavailable. Its last text remains; submission stays live.
    unavailableConfiguration = true;
    await page.reload();
    await expect(cached).toBeHidden();
    await expect(page.getByText("250000000000000000000", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Current max total supply is unavailable on this deployment.", { exact: true })).toBeVisible();
    await expect(page.locator('[data-page-live] [data-page-draft-key="set-max-total-supply:max-supply"]')).toHaveValue("555");
    const capCard = page.locator('[data-page-live] [data-page-draft-key="set-max-total-supply:max-supply"]').locator("../../..");
    await expect(capCard.getByRole("button", { name: "Call directly", exact: true })).toBeDisabled();
    const finalMethods = await page.evaluate(() => (window as unknown as { __governanceDraftMethods: string[] }).__governanceDraftMethods);
    expect(finalMethods.filter(method => /sendTransaction|signTypedData|personal_sign|eth_sign$/.test(method))).toEqual([]);
  } finally { scripts.release(); }
});

test("a private cached page leaves when wallet restoration finishes without a provider", async ({ page }) => {
  const alice = "0x00000000000000000000000000000000000000a1";
  await page.addInitScript(({ chain, alice }) => {
    const scope = JSON.stringify([chain, "en", "USD", "metric", "fiat"]);
    sessionStorage.setItem(`cybergold:wallet-presentation:v1:${chain}:en`, JSON.stringify({
      scopeKey: scope, address: alice, label: "alice.eth", networkName: "Browser fixture", rows: [],
    }));
    sessionStorage.setItem(`cg:page-display:v1:${chain}:en:governance-core`, JSON.stringify({
      scope, account: alice, scrollY: 0, tree: [{ tag: "h1", attributes: {}, children: ["Last private governance screen"] }],
    }));
  }, { chain, alice });
  await page.route("**/api/**", async route => {
    if (new URL(route.request().url()).pathname === "/api/protocol/config") return route.fallback();
    return route.fulfill({ status: 503, json: { error: "Unrelated fixture data unavailable." } });
  });
  const scripts = await holdScripts(page);
  try {
    await page.goto("/en/governance/core", { waitUntil: "commit" });
    const cached = page.getByTestId("retained-page-cached");
    await expect(cached.getByRole("heading", { name: "Last private governance screen" })).toBeVisible();
    scripts.release();
    await expect(page.locator("[data-wallet-display-root]")).toHaveAttribute("data-wallet-restoration", "disconnected");
    await expect(cached).toBeHidden();
    await expect(page.getByText("Wallet not connected", { exact: true }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), `cg:page-display:v1:${chain}:en:governance-core`)).toBeNull();
  } finally { scripts.release(); }
});
