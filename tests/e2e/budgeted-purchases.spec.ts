import { expect, test, type Locator, type Page } from "./fixtures/app-test";
import { context, install } from "./fixtures/token-quotes";
import { coreIntentRequest, tradeFixture } from "./fixtures/trade-core";
import { intentFixture } from "./fixtures/quote-intent";
import { marketTradeFixture } from "./fixtures/market-quotes";
import { selectBasket } from "./fixtures/swap-selection";
import { protocolAddresses, tokenAddresses } from "../fixtures/protocol-configuration";
import type { TradeQuote, TradeQuoteRequest } from "../../app/utils/tradeQuote";

const unit = 10n ** 18n;
const owner = "0x0000000000000000000000000000000000000011";

async function expectThemeColor(page: Page, locator: Locator, token: string) {
  const expected = await page.evaluate(token => {
    const sample = document.createElement("span");
    sample.style.color = `var(${token})`;
    document.body.append(sample);
    const color = getComputedStyle(sample).color;
    sample.remove();
    return color;
  }, token);
  for (const element of await locator.all()) await expect(element).toHaveCSS("color", expected);
}

async function wallet(page: Page) {
  await page.addInitScript(({ owner }) => {
    let chain = "0x7a69";
    window.addEventListener("budget-fixture-wrong-chain", () => { chain = "0x1"; });
    const provider = { selectedAddress: owner,
      request: async ({ method }: { method: string }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [owner];
        if (method === "eth_chainId") return chain;
        if (method === "net_version") return "31337";
        throw new Error(`Read-only budget fixture rejects ${method}`);
      }, on: () => {}, removeListener: () => {} };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "2ea2d599-e4e1-47f2-83dc-50964f820e25", name: "Budget fixture wallet", rdns: "io.synthetic.budget",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner });
  await page.route("**/api/account/wallet-balances*", route => route.fulfill({ json: { context, holder: owner,
    native: { status: "success", value: String(100n * unit) }, tokens: [
      { id: "paxg", address: tokenAddresses.PAXG, balance: { status: "success", value: String(40n * unit) } },
      { id: "xaut", address: tokenAddresses.XAUT, balance: { status: "success", value: String(40n * 10n ** 6n) } },
      { id: "cygld", address: protocolAddresses.core, balance: { status: "success", value: String(100n * unit) } },
    ] } }));
}

function quotedPurchase(strategy: "core" | "market", request: TradeQuoteRequest) {
  const inputUnit = request.counterToken.toLowerCase() === tokenAddresses.XAUT.toLowerCase() ? 10n ** 6n : unit;
  const capped = request.side === "buy" && BigInt(request.amount) >= 50n * inputUnit;
  const spend = capped ? 30n * inputUnit : BigInt(request.amount);
  if (strategy === "market") {
    const value = marketTradeFixture({ ...request, amount: String(spend) });
    value.providerRequest.amount = request.amount;
    value.providerQuote.plan.amount = request.amount;
    return value;
  }
  const coreRequest = coreIntentRequest(request);
  const providerQuote = intentFixture(coreRequest);
  if (capped) {
    const maximum = 303n * inputUnit / 10n;
    providerQuote.expectedInputAmount = String(spend);
    providerQuote.maximumInputAmount = String(maximum);
    providerQuote.executionAmount = String(40n * unit);
    providerQuote.displayAmount = String(40n * unit);
    if (providerQuote.initialPreview) providerQuote.initialPreview.netCygldOut = String(40n * unit);
  }
  return tradeFixture(providerQuote, coreRequest);
}

async function selectToken(page: Page, symbol = "PAXG") {
  await page.locator('main button[aria-haspopup="dialog"]').first().click();
  await page.getByPlaceholder("Search currency...").fill(symbol);
  await page.locator("#dropdown-from").getByRole("button").filter({ has: page.getByText(symbol, { exact: true }) }).click();
}

async function fixture(page: Page, strategy: "core" | "market") {
  await install(page); await wallet(page);
  await page.route("**/api/fx", route => route.fulfill({ json: { base: "USD", rates: { USD: 1, EUR: .9, CHF: .8, RUB: 90 },
    fetchedAt: new Date().toISOString(), stale: false } }));
  let held = false, count = 0;
  const releases: (() => void)[] = [];
  await page.route("**/api/quotes/trade/stream", async route => {
    count++;
    if (held) await new Promise<void>(resolve => releases.push(resolve));
    const value = quotedPurchase(strategy, route.request().postDataJSON());
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "complete", value }) + "\n" });
  });
  return { hold: () => { held = true; }, release: () => { held = false; releases.splice(0).forEach(resolve => resolve()); }, count: () => count };
}

for (const strategy of ["core", "market"] as const) test(`${strategy} purchase always shows one spending field and highlights a limited budget`, async ({ page }) => {
  await page.setViewportSize({ width: strategy === "market" ? 390 : 1280, height: 950 });
  await fixture(page, strategy);
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await selectToken(page);
  await expect(page.locator("#sell-amount-label")).toHaveText("Your budget");
  const spending = page.getByTestId("purchase-spending");
  const value = spending.locator("[data-trade-spending-value]");
  const equivalent = spending.locator('[data-trade-display="purchaseSpendingEquivalent"]');
  await expect(spending).toBeVisible();
  await expect(spending).toContainText("Spending");
  await expect(value).toHaveText("0 PAXG");
  await expect(equivalent).toHaveText("~ 0.00 g of gold • $0.00");
  await expect(value).toHaveAttribute("data-limited", "false");
  await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "empty");
  await expectThemeColor(page, value, "--text-input");
  await page.locator("#sell-amount").fill("100");
  await expect(value).toHaveText("30 PAXG");
  await expect(equivalent).toHaveText("~ 933.10 g of gold • $93 310.43");
  await expect(value).toHaveAttribute("data-limited", "true");
  await value.focus();
  await expect(spending.getByRole("tooltip")).toBeVisible();
  await expect(spending.getByRole("tooltip")).toContainText(/issuance capacity.*market liquidity/i);
  await page.locator("#sell-amount").focus();
  await expect(spending.getByRole("tooltip")).toBeHidden();
  await expect(page.getByText("Estimated spend", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Maximum spend", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Estimated unused budget", { exact: true })).toHaveCount(0);
  await expect(page.locator("#sell-amount")).toHaveValue("100");
  await expect(page.locator("#sell-amount")).toBeEditable();
  await expect(page.locator("#buy-amount")).toHaveText(strategy === "core" ? "40" : "29.97");
  await expect(page.locator("#buy-amount")).toHaveJSProperty("tagName", "OUTPUT");
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  await expect(page.locator("#sell-wallet-balance-warning")).toHaveCount(0);
  await page.screenshot({ path: `out/audit/budgeted-purchases/${strategy}.png`, fullPage: true });
  await page.locator("#sell-amount").fill("20");
  await expect(spending).toBeVisible();
  await expect(value).toHaveText("20 PAXG");
  await expect(equivalent).toHaveText("~ 622.07 g of gold • $62 206.95");
  await expect(value).toHaveAttribute("data-limited", "false");
  await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "confirmed");
  await expectThemeColor(page, value, "--text-input");
  await expect(page.locator("#sell-amount-label")).toHaveText("Your budget");
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await expect(page.locator("#sell-amount-label")).toHaveText("You Sell");
  await page.locator("#sell-amount").fill("10");
  await expect(spending).toBeVisible();
  await expect(value).toHaveText("10 CYGLD");
  await expect(value).toHaveAttribute("data-limited", "false");
  await expect(equivalent).toHaveText("~ 20.00 g of gold • $2 000.00");
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
});

test("CYGLD basket redemption spending uses the selected fiat currency and gold units", async ({ page }) => {
  await fixture(page, "core");
  await page.addInitScript(() => {
    localStorage.setItem("display-currency", "CHF");
    localStorage.setItem("display-gold-unit", "imperial");
    sessionStorage.setItem("cg:swap-form-state:v1", JSON.stringify({ sellTokenId: "cygld", buyTokenId: "paxg", sellAmount: "10" }));
  });
  await page.goto("/en");
  await selectBasket(page, "buy");
  const spending = page.getByTestId("purchase-spending");
  await expect(spending).toBeVisible();
  await expect(spending.locator("[data-trade-spending-value]")).toHaveText("10 CYGLD");
  await expect(spending.locator('[data-trade-display="purchaseSpendingEquivalent"]')).toHaveText(/~ 0\.643 troy oz • CHF\s*1 600\.00/);
  await expect(page.locator("#sell-amount-label")).toHaveText("You Sell");
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
});

for (const strategy of ["core", "market"] as const) test(`${strategy} XAUt purchases display the same spending field as PAXG`, async ({ page }) => {
  const observed = await fixture(page, strategy);
  await page.goto("/en");
  await selectToken(page, "XAUt");
  const spending = page.getByTestId("purchase-spending");
  const value = spending.locator("[data-trade-spending-value]");
  await expect(spending).toBeVisible();
  await expect(value).toHaveText("0 XAUt");
  observed.hold();
  try {
    const before = observed.count();
    await page.locator("#sell-amount").fill("100");
    await expect.poll(observed.count).toBeGreaterThan(before);
    await expect(value).toHaveText("…");
    await expect(spending.locator('[data-trade-display="purchaseSpendingEquivalent"]')).toHaveText("…");
    await expect(value).toHaveAttribute("data-limited", "false");
    observed.release();
    await expect(value).toHaveText("30 XAUt");
    await expect(value).toHaveAttribute("data-limited", "true");
    await value.focus();
    await expect(spending.getByRole("tooltip")).toBeVisible();
  } finally { observed.release(); }
});

for (const { strategy, freshBalance, stage } of [
  { strategy: "core", freshBalance: "31", stage: "network" },
  { strategy: "market", freshBalance: "31", stage: "network" },
  { strategy: "core", freshBalance: "30.1", stage: "balance" },
] as const) test(`${strategy} submission checks the selected funding ceiling against a fresh ${freshBalance} PAXG balance`, async ({ page }) => {
  await fixture(page, strategy);
  const failedStages: string[] = [];
  let preflights = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname !== "/api/diagnostics") return;
    const event = request.postDataJSON();
    if (event.operation === "swap" && event.outcome === "failed") failedStages.push(event.stage);
  });
  await page.route("**/api/account/wallet-balances*", async route => {
    if (new URL(route.request().url()).searchParams.get("purpose") !== "swap-preflight") return route.fallback();
    preflights++;
    // Stop at the existing fresh-network check after the balance check passes.
    // The read-only fixture never reaches signing or submission.
    await page.evaluate(() => window.dispatchEvent(new Event("budget-fixture-wrong-chain")));
    await route.fulfill({ json: { context, holder: owner, native: { status: "success", value: String(100n * unit) }, tokens: [
      { id: "paxg", address: tokenAddresses.PAXG, balance: { status: "success", value: freshBalance === "30.1" ? String(301n * unit / 10n) : String(31n * unit) } },
    ] } });
  });
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await selectToken(page); await page.locator("#sell-amount").fill("100");
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click();
  await expect.poll(() => preflights).toBe(1);
  await expect.poll(() => failedStages).toEqual([stage]);
});

test("a partial purchase retains its spending across reload and clears old terms on a pre-hydration edit", async ({ page }) => {
  const observed = await fixture(page, "core");
  const hydrationErrors: string[] = [];
  page.on("console", message => { if (/hydrat|didn't match/i.test(message.text())) hydrationErrors.push(message.text()); });
  await page.goto("/en"); await selectToken(page);
  await page.locator("#sell-amount").fill("100");
  await expect(page.getByTestId("purchase-spending")).toContainText("30 PAXG");
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("cybergold:trade-display:v1:31337:en") ?? "null")?.values.purchaseSpendingVisible)).toBe("true");
  let releaseScripts!: () => void;
  const scripts = new Promise<void>(resolve => { releaseScripts = resolve; });
  await page.route("**/_next/static/**/*.js*", async route => { await scripts; await route.continue(); });
  observed.hold();
  try {
    await page.reload({ waitUntil: "commit" });
    const cached = page.getByTestId("trade-cached-view");
    await expect(cached).toBeVisible();
    await expect(page.locator('[data-testid="buy-wallet-balance"], [data-trade-display="buyBalance"]')).toHaveCount(0);
    await expect(cached.locator('[data-trade-display="sellBalance"]')).toHaveText("40 PAXG");
    await expect(cached.locator("[data-trade-spending]")).toBeVisible();
    await expect(cached.locator('[data-trade-display="spendAmountLabel"]')).toHaveText("Your budget");
    await expect(cached.locator('[data-trade-display="purchaseSpendingValue"]')).toHaveText("30 PAXG");
    await expect(cached.locator('[data-trade-display="purchaseSpendingEquivalent"]')).toHaveText("~ 933.10 g of gold • $93 310.43");
    await expect(cached.locator("[data-trade-spending-value]")).toHaveAttribute("data-limited", "true");
    await expect(cached.locator("[data-trade-evaluation]")).toHaveAttribute("data-trade-evaluation", "confirmed");
    await expectThemeColor(page, cached.locator("[data-trade-spending-value]"), "--text-amber");
    await expect(cached.locator('[data-trade-display="sellAmount"]')).toBeEditable();
    await cached.locator('[data-trade-display="sellAmount"]').fill("101");
    await expect(cached.locator("[data-trade-spending]")).toBeVisible();
    await expect(cached.locator('[data-trade-display="purchaseSpendingValue"]')).toHaveText("…");
    await expect(cached.locator('[data-trade-display="purchaseSpendingEquivalent"]')).toHaveText("…");
    await expect(cached.locator("[data-trade-spending-value]")).toHaveAttribute("data-limited", "false");
    await expect(cached.locator("[data-trade-evaluation]")).toHaveAttribute("data-trade-evaluation", "pending");
    await expectThemeColor(page, cached.locator("[data-trade-spending-value]"), "--text-input-disabled");
    await cached.locator('[data-trade-display="sellAmount"]').fill("100");
    await expect(cached.locator("[data-trade-evaluation]")).toHaveAttribute("data-trade-evaluation", "pending");
    await cached.locator('[data-trade-display="sellAmount"]').fill("101");
    releaseScripts();
    await expect(cached).toBeHidden();
    await expect(page.locator("#sell-amount")).toHaveValue("101");
    observed.release();
    await expect(page.getByTestId("purchase-spending")).toContainText("30 PAXG");
    await expect(page.getByTestId("purchase-spending").locator('[data-trade-display="purchaseSpendingEquivalent"]')).toHaveText("~ 933.10 g of gold • $93 310.43");
    expect(hydrationErrors).toEqual([]);
  } finally { releaseScripts(); observed.release(); }
});

test("an affordable purchase budget never flashes a wallet warning while its quote is pending after reload", async ({ page }) => {
  const observed = await fixture(page, "core");
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("cg:swap-fee-preferences:v1")) {
      sessionStorage.setItem("cg:swap-fee-preferences:v1", JSON.stringify({ detailsOpen: true, slippageBps: 50 }));
    }
  });
  await page.goto("/en");
  await expect(page.locator("#execution-tolerance")).toHaveValue("0.5");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await selectToken(page);
  observed.hold();
  try {
    const before = observed.count();
    await page.locator("#sell-amount").fill("100");
    await expect.poll(observed.count).toBeGreaterThan(before);
    await expect(page.locator("#sell-wallet-balance-warning")).toHaveCount(0);
    await expect(page.locator("#sell-amount")).not.toHaveClass(/text-text-amber/);
    await expect(page.locator("[data-trade-action]")).toBeDisabled();
    observed.release();
    await expect(page.getByTestId("purchase-spending")).toContainText("30 PAXG");
    await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
    const quoted = observed.count();
    observed.hold();
    await page.reload();
    await expect.poll(observed.count).toBeGreaterThan(quoted);
    await expect(page.getByTestId("trade-live-view")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
    await expect(page.locator("#sell-amount")).toHaveValue("100");
    await expect(page.locator("#execution-tolerance")).toHaveValue("0.5");
    await expect(page.getByTestId("purchase-spending")).toContainText("30 PAXG");
    await expect(page.locator("#sell-wallet-balance-warning")).toHaveCount(0);
    await expect(page.locator("#sell-amount")).not.toHaveClass(/text-text-amber/);
    await expect(page.locator("[data-trade-action]")).toBeDisabled();
    await expect(page.locator("[data-trade-action]")).not.toContainText(/balance/i);
    await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "confirmed");
    await page.locator("#sell-amount").fill("101");
    await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "pending");
    await page.locator("#sell-amount").fill("100");
    await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "pending");
    await expect(page.locator("[data-trade-action]")).toBeDisabled();
    observed.release();
    await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
    await expect(page.getByTestId("purchase-spending").locator('[data-trade-display="purchaseSpendingValue"]')).toHaveText("30 PAXG");
    await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
    observed.hold();
    await page.locator("#sell-amount").fill("200");
    await expect(page.locator("#sell-wallet-balance-warning")).toHaveCount(1);
    await expect(page.locator("#sell-amount")).toHaveClass(/text-text-amber/);
  } finally { observed.release(); }
});

const plateauSpending = 30_334_978_745_396_727n;
const plateauOutput = 936n * unit / 1_000n;

/** The range is supplied by the Backend fixture, rather than inferred by the App. */
async function plateauFixture(page: Page, strategy: "core" | "market", bounded = false) {
  await fixture(page, strategy);
  let modelHeld = false, quoteHeld = false, changed = false, modelRequests = 0, quoteRequests = 0;
  const modelReleases: (() => void)[] = [], quoteReleases: (() => void)[] = [];
  const quote = (request: TradeQuoteRequest): TradeQuote => {
    request = { ...request, recipient: request.recipient ?? owner, deadline: request.deadline ?? "1900000000" };
    const spending = changed ? unit / 50n : plateauSpending;
    const output = changed ? 6n * unit / 10n : plateauOutput;
    if (strategy === "market") {
      const value = marketTradeFixture({ ...request, amount: String(spending) });
      value.providerRequest.amount = request.amount;
      value.providerQuote.plan.amount = request.amount;
      value.providerQuote.netOutput = String(output);
      value.quotedOutput = String(output);
      return value;
    }
    const coreRequest = coreIntentRequest(request);
    const providerQuote = intentFixture(coreRequest);
    providerQuote.expectedInputAmount = String(spending);
    providerQuote.maximumInputAmount = String(spending);
    providerQuote.executionAmount = String(output);
    providerQuote.displayAmount = String(output);
    if (providerQuote.initialPreview) providerQuote.initialPreview.netCygldOut = String(output);
    return tradeFixture(providerQuote, coreRequest);
  };
  const packet = (request: TradeQuoteRequest) => {
    const value = quote(request);
    return { namespace: "trade", intent: { side: request.side, mode: request.mode, counterToken: request.counterToken,
      amount: request.amount, native: request.native, slippageBps: request.slippageBps },
      models: [], estimate: { strategy, amount: value.quotedOutput },
      budgetRange: { minimumBudget: value.inputMaximum, ...(bounded ? { maximumBudget: request.amount } : {}),
        quotedInput: value.quotedInput, quotedOutput: value.quotedOutput } };
  };
  await page.route("**/api/quotes/trade/model", async route => {
    modelRequests++;
    if (modelHeld) await new Promise<void>(resolve => modelReleases.push(resolve));
    const request = route.request().postDataJSON();
    await route.fulfill({ json: packet(request) });
  });
  await page.route("**/api/quotes/trade/stream", async route => {
    quoteRequests++;
    if (quoteHeld) await new Promise<void>(resolve => quoteReleases.push(resolve));
    const request = route.request().postDataJSON();
    await route.fulfill({ contentType: "application/x-ndjson", body:
      JSON.stringify({ type: "model", value: packet(request) }) + "\n" +
      JSON.stringify({ type: "complete", value: quote(request) }) + "\n" });
  });
  return { hold: () => { modelHeld = true; quoteHeld = true; }, change: () => { changed = true; },
    releaseModel: () => { modelHeld = false; modelReleases.splice(0).forEach(resolve => resolve()); },
    release: () => { modelHeld = false; quoteHeld = false; [...modelReleases.splice(0), ...quoteReleases.splice(0)].forEach(resolve => resolve()); },
    modelRequests: () => modelRequests, quoteRequests: () => quoteRequests };
}

for (const strategy of ["core", "market"] as const) for (const editedBudget of ["0.5", "2"] as const)
  test(`${strategy} capped budget edit 1 → ${editedBudget} immediately reuses the Backend range while both requests are pending`, async ({ page }) => {
  const observed = await plateauFixture(page, strategy);
  if (strategy === "market") await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/en"); await selectToken(page);
  const input = page.locator("#sell-amount"), output = page.locator("#buy-amount");
  const spending = page.getByTestId("purchase-spending").locator("[data-trade-spending-value]");
  const equivalent = page.getByTestId("purchase-spending").locator('[data-trade-display="purchaseSpendingEquivalent"]');
  const evaluation = page.locator("#swapsection");
  const quotedValues = page.locator('#buy-amount, [data-trade-spending-value], [data-trade-display="purchaseSpendingEquivalent"], [data-trade-display="buyEquivalent"]');
  await input.fill("1");
  await expect(spending).toHaveText("0.030334978745396727 PAXG");
  await expect(output).toHaveText("0.936");
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  await expect(evaluation).toHaveAttribute("data-trade-evaluation", "confirmed");
  await expectThemeColor(page, spending, "--text-amber");
  await expectThemeColor(page, output, "--text-input");
  await expect(page.locator('[data-testid="buy-wallet-balance"], [data-trade-display="buyBalance"]')).toHaveCount(0);
  await expect(page.getByTestId("sell-wallet-balance")).toHaveText("40 PAXG");
  const value = await equivalent.textContent();
  const clockStart = new Date();
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000));
  observed.hold();
  const before = observed.quoteRequests();
  try {
    await input.fill(editedBudget);
    await expect.poll(async () => { await page.clock.runFor(0); return spending.textContent(); })
      .toBe("0.030334978745396727 PAXG");
    await expect(output).toHaveText("0.936");
    await expect(equivalent).toHaveText(value!);
    await expect(spending).toHaveAttribute("data-limited", "true");
    await expect(evaluation).toHaveAttribute("data-trade-evaluation", "pending");
    await expectThemeColor(page, quotedValues, "--text-input-disabled");
    await expect(page.locator("[data-trade-action]")).toBeDisabled();
    // No debounce time elapsed and neither fresh endpoint has responded.
    expect(observed.quoteRequests()).toBe(before);
    await page.clock.runFor(150);
    await expect.poll(observed.quoteRequests).toBeGreaterThan(before);
    await expect(output).toHaveText("0.936");
    await expect(spending).toHaveText("0.030334978745396727 PAXG");
    await expect(page.locator("[data-trade-action]")).toBeDisabled();
    // Receiving another display model does not confirm an executable quote.
    const modelResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/quotes/trade/model");
    observed.releaseModel();
    await modelResponse;
    await page.clock.runFor(0);
    await expect(evaluation).toHaveAttribute("data-trade-evaluation", "pending");
    await expectThemeColor(page, quotedValues, "--text-input-disabled");
    await expect(page.locator("[data-trade-action]")).toBeDisabled();
    observed.change(); observed.release();
    await expect.poll(async () => { await page.clock.runFor(0); return spending.textContent(); }).toBe("0.02 PAXG");
    await expect(output).toHaveText("0.6");
    await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
    await expect(evaluation).toHaveAttribute("data-trade-evaluation", "confirmed");
    await expectThemeColor(page, spending, "--text-amber");
    await expectThemeColor(page, output, "--text-input");
    await test.info().attach("capped-range-reuse", { contentType: "application/json", body: JSON.stringify({
      strategy, budgetBefore: "1", budgetAfter: editedBudget, spendingRaw: String(plateauSpending), outputRaw: String(plateauOutput),
      immediateLogicalMilliseconds: 0, heldFreshEndpoints: ["/api/quotes/trade/model", "/api/quotes/trade/stream"],
      modelRequests: observed.modelRequests(), quoteRequests: observed.quoteRequests(), freshSpending: "0.02 PAXG", freshOutput: "0.6 CYGLD",
      pendingColor: "--text-input-disabled", modelAloneConfirms: false,
      scope: "Backend-supplied advisory range; no transaction submitted" }) });
  } finally { observed.release(); await page.clock.resume(); }
});

test("a Backend capped range is not reused outside its budgets or for another input token", async ({ page }) => {
  const observed = await plateauFixture(page, "core", true);
  await page.goto("/en"); await selectToken(page);
  const input = page.locator("#sell-amount"), output = page.locator("#buy-amount");
  const spending = page.getByTestId("purchase-spending").locator("[data-trade-spending-value]");
  await input.fill("1");
  await expect(spending).toHaveText("0.030334978745396727 PAXG");
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  observed.hold();
  try {
    for (const budget of ["0.01", "2"]) {
      await input.fill(budget);
      await expect(spending).toHaveText("…");
      await expect(output).not.toHaveText("0.936");
      await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "pending");
      await expectThemeColor(page, spending, "--text-input-disabled");
      await expect(page.locator("[data-trade-action]")).toBeDisabled();
    }
    await selectToken(page, "XAUt"); await input.fill("0.5");
    await expect(spending).toHaveText("…");
    await expect(output).not.toHaveText("0.936");
    await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "pending");
    await expectThemeColor(page, spending, "--text-input-disabled");
    await expect(page.locator("[data-trade-action]")).toBeDisabled();
  } finally { observed.release(); }
});
