import { expect, test, type Page } from "./fixtures/app-test";

const snapshotTimestamp = Date.now();
const bucket = { bucketStartMs: snapshotTimestamp - 3_600_000, mintCygld: 20, redeemCygld: 3,
  netCygld: 17, supplyCygld: 123, transferredCygld: 45, transferTxCount: 4 };

const summary = {
  enabled: true,
  chainHeadTimestampMs: snapshotTimestamp,
  protocolLogicUpdate: null,
  protocolParameterUpdate: null,
  metrics: { currentTotalSupplyCygld: 123, netIssuance24hCygld: 0,
    holderCount: 2, issuanceFeePercent: 0.1, redemptionFeePercent: 0.1, paused: true },
  basket: { cygldRefGrams: 2, assets: [{
    address: "0x45804880de22913dafe09f4980848ece6ecbaf78", symbol: "PAXG",
    targetPercent: 100, actualPercent: 100, driftPercent: 0, decimals: 18,
    reserveBalance: 12, reserveBalanceRaw: "12000000000000000000",
    totalSupply: 100, totalSupplyRaw: "100000000000000000000",
    goldRefGrams: 31.1034768, cygldPerUnitFp18: "15551738400000000000",
    cygldPerToken: 15.5517384,
  }] },
  series: { "24H": [bucket], "7D": [bucket], "1M": [bucket] },
};

async function installDashboardResponses(page: Page, options: {
  available: boolean;
  staleGold?: boolean;
  goldFetchedAt?: string;
  goldPrice?: number;
  goldUnavailable?: () => boolean;
  goldRequest?: () => void;
  getSummary?: () => typeof summary;
}) {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/protocol/config") { await route.fallback(); return; }
    if (pathname === "/api/dashboard/onchain-summary") {
      await route.fulfill(options.available ? { json: options.getSummary?.() ?? summary } : {
        status: 503, json: { error: "The historical dashboard is rebuilding." },
      });
    } else if (pathname === "/api/gold") {
      options.goldRequest?.();
      if (options.goldUnavailable?.()) {
        await route.fulfill({ status: 503, json: { error: "Gold supplier unavailable" } });
        return;
      }
      await route.fulfill({ json: { price: options.goldPrice ?? 3110.34768,
        fetchedAt: options.goldFetchedAt ?? new Date().toISOString(), stale: options.staleGold ?? false } });
    } else {
      await route.fulfill({ status: 503, json: { error: "Unrelated data unavailable in this fixture" } });
    }
  });
}

function observeMarketDiagnostics(page: Page) {
  const diagnostics: string[] = [];
  page.on("console", message => {
    if (message.type() === "debug" && message.text().startsWith("[market-data]")) {
      diagnostics.push(message.text());
    }
  });
  return diagnostics;
}

async function expectQuietMarketDiagnostics(page: Page, diagnostics: string[]) {
  await expect(page.getByTestId("market-data-stale-notice")).toHaveCount(0);
  if (process.env.PLAYWRIGHT_APP_MODE === "production") {
    expect(diagnostics).toHaveLength(0);
  } else {
    await expect.poll(() => diagnostics.length).toBeGreaterThan(0);
  }
}

function supplySummary(supply: number) {
  const point = { ...bucket, mintCygld: supply, redeemCygld: 0, netCygld: supply,
    supplyCygld: supply, transferredCygld: supply };
  return { ...summary, metrics: { ...summary.metrics, currentTotalSupplyCygld: supply },
    series: { "24H": [point], "7D": [point], "1M": [point] } };
}

for (const viewport of [{ name: "desktop", width: 1280 }, { name: "mobile", width: 390 }]) {
  test(`${viewport.name} refresh replaces zero supply with fractional CYGLD`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: 900 });
    let current = supplySummary(0);
    await installDashboardResponses(page, { available: true, getSummary: () => current });
    await page.goto("/en/dashboard");
    await expect(page.getByText("0 CYGLD", { exact: true })).toHaveCount(3);

    current = supplySummary(0.155517383999999999);
    const response = page.waitForResponse("**/api/dashboard/onchain-summary");
    await page.getByRole("button", { name: "Refresh Data", exact: true }).filter({ visible: true }).click();
    await response;
    await expect(page.getByText("0.155517 CYGLD", { exact: true })).toHaveCount(3);
    await expect(page.getByText("+0.155517 CYGLD", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh Data", exact: true }).filter({ visible: true }))
      .toHaveAttribute("aria-busy", "false");
  });
}

test("automatic polling still updates fractional supply without a click", async ({ page }) => {
  await page.clock.install();
  let current = supplySummary(0);
  await installDashboardResponses(page, { available: true, getSummary: () => current });
  await page.goto("/en/dashboard");
  await expect(page.getByText("0 CYGLD", { exact: true })).toHaveCount(3);
  current = supplySummary(0.155517383999999999);
  const response = page.waitForResponse("**/api/dashboard/onchain-summary");
  await page.clock.fastForward(30_000);
  await response;
  await expect(page.getByText("0.155517 CYGLD", { exact: true })).toHaveCount(3);
});

test("refresh can retry an unavailable dashboard", async ({ page }) => {
  const options = { available: false, getSummary: () => supplySummary(0.155517383999999999) };
  await installDashboardResponses(page, options);
  await page.goto("/en/dashboard");
  await expect(page.getByText("On-chain dashboard unavailable", { exact: true })).toBeVisible();
  options.available = true;
  await page.getByRole("button", { name: "Refresh Data", exact: true }).filter({ visible: true }).click();
  await expect(page.getByText("0.155517 CYGLD", { exact: true })).toHaveCount(3);
  await expect(page.getByText("On-chain dashboard unavailable", { exact: true })).toHaveCount(0);
});

test("French supply and flows preserve fractional CYGLD", async ({ page }) => {
  await installDashboardResponses(page, { available: true, getSummary: () => supplySummary(0.155517383999999999) });
  await page.goto("/fr/dashboard");
  await expect(page.getByText("0,155517 CYGLD", { exact: true })).toHaveCount(3);
  await expect(page.getByText("+0,155517 CYGLD", { exact: true })).toBeVisible();
});

async function expectNoInventedMarketMetrics(page: Page) {
  await expect(page.getByText("A verified backing ratio is not available.", { exact: true })).toBeVisible();
  await expect(page.getByText("Historical CYGLD market prices are not available.", { exact: true })).toBeVisible();
  await expect(page.getByText("CYGLD market-price and peg data are not available.", { exact: true })).toHaveCount(2);
  await expect(page.getByText("102.3%", { exact: true })).toHaveCount(0);
  await expect(page.getByText("+0.02%", { exact: true })).toHaveCount(0);
  await expect(page.getByText("CYGLD spot price", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Peg tracking", exact: true }).locator("..").locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "CYGLD price trend", exact: true }).locator("..").locator("canvas")).toHaveCount(0);
}

test("a rebuilding dashboard never substitutes invented financial values or charts", async ({ page }) => {
  await installDashboardResponses(page, { available: false });
  await page.goto("/en/dashboard");
  await expect(page.getByText("On-chain dashboard unavailable", { exact: true })).toBeVisible();
  await expectNoInventedMarketMetrics(page);
  const reference = page.getByText("CYGLD gold reference", { exact: true }).locator("..").locator("..");
  await expect(reference).toContainText("N/A");
  await expect(reference).not.toContainText("1 CYGLD =");
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("completed history preserves observed metrics but does not fabricate unsupported market series", async ({ page }) => {
  await installDashboardResponses(page, { available: true });
  await page.goto("/en/dashboard");
  await expect(page.getByText("123 CYGLD", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("dashboard-snapshot-time")).toContainText("Data through");
  await expect(page.getByTestId("dashboard-snapshot-time")).toContainText("UTC");
  await expectNoInventedMarketMetrics(page);
  const reference = page.getByText("CYGLD gold reference", { exact: true }).locator("..").locator("..");
  await expect(reference).toContainText("200");
  await expect(reference).toContainText("1 CYGLD =");
  await expect(page.getByText("+17 CYGLD", { exact: true })).toBeVisible();
  await expect(page.getByText("45 CYGLD", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Basket composition snapshot", exact: true })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(3);
  // Allow the chart's entry animation to finish before capturing visual evidence.
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: "out/audit/followups-dashboard-charts.png", fullPage: true });
  await expect(page.getByText("On-chain dashboard unavailable", { exact: true })).toHaveCount(0);
});

test("a stale or fallback gold feed cannot supply a displayed fiat reference", async ({ page }) => {
  const diagnostics = observeMarketDiagnostics(page);
  await installDashboardResponses(page, { available: true, staleGold: true });
  await page.goto("/en/dashboard");
  await expect(page.getByText("123 CYGLD", { exact: true }).first()).toBeVisible();
  const reference = page.getByText("CYGLD gold reference", { exact: true }).locator("..").locator("..");
  await expect(reference).toContainText("N/A");
  await expect(reference).toContainText("1 CYGLD =");
  await expectQuietMarketDiagnostics(page, diagnostics);
});

test("an expired acquisition keeps its last displayed approximation while refreshing", async ({ page }) => {
  const diagnostics = observeMarketDiagnostics(page);
  const now = Date.now();
  await page.clock.install({ time: new Date(now - 10_000) });
  await page.clock.pauseAt(new Date(now));
  const originalAcquisition = new Date(now - 3_600_000 + 1_000).toISOString();
  const options = { available: true, goldFetchedAt: originalAcquisition, goldPrice: 3110.34768 };
  await installDashboardResponses(page, options);
  await page.goto("/en/dashboard");
  const reference = page.getByText("CYGLD gold reference", { exact: true }).locator("..").locator("..");
  await expect(reference).toContainText("200");
  await page.clock.runFor(1_500);
  await expect(reference).toContainText("200");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cybergold:display:gold:v1") ?? "null")?.fetchedAt)).toBe(originalAcquisition);
  await expectQuietMarketDiagnostics(page, diagnostics);
  options.goldFetchedAt = new Date(now + 1_500).toISOString();
  options.goldPrice = 6220.69536;
  await page.clock.runFor(10_100);
  await expect(reference).toContainText("400");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cybergold:display:gold:v1") ?? "null")?.fetchedAt)).toBe(options.goldFetchedAt);
});

test("the Governance dashboard does not invent proposal counts or timelock readiness", async ({ page }) => {
  await installDashboardResponses(page, { available: false });
  await page.goto("/en/dashboard#governance");
  const panel = page.getByRole("tabpanel", { name: "Governance", exact: true });
  await expect(panel.getByText("Governance dashboard unavailable", { exact: true })).toBeVisible();
  await expect(panel.getByText("2", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Ready", { exact: true })).toHaveCount(0);
});

test("gold refreshes at thirty minutes and keeps its last displayed price through a supplier outage", async ({ page }) => {
  const diagnostics = observeMarketDiagnostics(page);
  const now = Date.now();
  await page.clock.install({ time: new Date(now - 10_000) });
  await page.clock.pauseAt(new Date(now));
  let requests = 0, unavailable = false;
  await installDashboardResponses(page, { available: true,
    goldFetchedAt: new Date(now - 1_800_000 + 1_000).toISOString(),
    goldRequest: () => requests++, goldUnavailable: () => unavailable });
  await page.goto("/en/dashboard");
  const reference = page.getByText("CYGLD gold reference", { exact: true }).locator("..").locator("..");
  await expect(reference).toContainText("200");
  expect(requests).toBe(1);
  unavailable = true;
  // Polling has a ten-second minimum; it cannot hammer a failed supplier every second.
  await page.clock.runFor(10_100);
  await expect.poll(() => requests).toBeGreaterThan(1);
  await expect(reference).toContainText("200");
  await expect(page.getByTestId("market-data-stale-notice")).toHaveCount(0);
  expect(diagnostics).toHaveLength(0);
  await page.clock.fastForward(1_792_000);
  await expect(reference).toContainText("200");
  await expectQuietMarketDiagnostics(page, diagnostics);
});
