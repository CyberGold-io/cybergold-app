import { expect, test, type Page } from "./fixtures/app-test";
import { protocolAddresses, tokenAddresses } from "../fixtures/protocol-configuration";
import { context, install } from "./fixtures/token-quotes";
import { install as installBasket } from "./fixtures/basket-quotes";
import { selectBasket } from "./fixtures/swap-selection";

const tokenKey = "cybergold:display:tokens:v1:31337";
const goldKey = "cybergold:display:gold:v1";
const fxKey = "cybergold:display:fx:v1";
const tokenUsdKey = "cybergold:display:token-usd:v1:31337";
const owner = "0x0000000000000000000000000000000000000011";
const paxg = "0x45804880de22913dafe09f4980848ece6ecbaf78";
const unit = 10n ** 18n;

const feeDisplaySlots = ["feeTotal", "feeProtocolLabel", "feeProtocolValue", "feeHelpersLabel", "feeHelpersValue",
  "feeApplicationLabel", "feeApplicationValue", "feeNetworkValue", "feeMinimumOutput"] as const;

async function prepareFeeDisplay(page: Page) {
  const observed = await install(page);
  const economicRequests: Record<string, unknown>[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/economic-quotes/stream") economicRequests.push(request.postDataJSON());
  });
  await installEthDisplayPrices(page, () => 2000);
  await page.route("**/api/transaction/fees", route => route.fulfill({ json: {
    context, maxFeePerGas: "2000000000", maxPriorityFeePerGas: "1",
  } }));
  await page.goto("/en");
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await page.locator("#sell-amount").fill("0.01");
  await expect(page.locator("#buy-amount")).toHaveText("0.01");
  expect(economicRequests.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: /Total fee/ }).click();
  const quoteCount = economicRequests.length;
  await page.locator("#execution-tolerance").fill("0.25");
  await expect(page.locator("#execution-tolerance")).toHaveValue("0.25");
  await expect(page.getByTestId("swap-minimum-output")).toContainText("0.009975 ETH");
  expect(economicRequests).toHaveLength(quoteCount);
  await expect(page.getByTestId("swap-network-fee")).toContainText("ETH");
  await expect(page.locator('[data-trade-display="feeTotal"]')).not.toHaveText("...");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return { ...observed, economicRequests };
}

async function selectPaxg(page: Page) {
  await page.locator('main button[aria-haspopup="dialog"]').first().click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Search currency...", exact: true }).fill("PAXG");
  await page.getByRole("dialog").getByRole("button").filter({ has: page.getByText("PAXG", { exact: true }) }).click();
}

async function hold(page: Page, pattern: string) {
  let release!: () => void, requests = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(pattern, async route => { requests++; await waiting; await route.fallback(); });
  return { release, requests: () => requests };
}

async function cached(page: Page, key: string) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null"), key);
}

async function installEthDisplayPrices(page: Page, price: () => number) {
  const usdc = tokenAddresses.USDC.toLowerCase(), weth = tokenAddresses.WETH.toLowerCase();
  await page.route("**/api/pools/snapshot", async route => {
    const request = route.request().postDataJSON();
    const [token0, token1] = [request.tokenA.toLowerCase(), request.tokenB.toLowerCase()].sort();
    await route.fulfill({ json: { context: { ...context, observedAt: new Date().toISOString() },
      exists: token0 === usdc && token1 === weth,
      poolAddress: "0x00000000000000000000000000000000000000c3", token0, token1, fee: request.fee,
      marginalPrice: { numerator: String(unit), denominator: String(price() * 1_000_000) },
    } });
  });
}

async function installReadOnlyWallet(page: Page) {
  const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
  await page.addInitScript(({ owner, chain }) => {
    const methods: string[] = [];
    const provider = { isMetaMask: false, selectedAddress: owner,
      request: async ({ method }: { method: string }) => {
        methods.push(method);
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [owner];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts",
          caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        throw new Error(`Read-only display fixture rejects ${method}`);
      }, on: () => {}, removeListener: () => {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    Object.assign(window, { __displayCacheWalletMethods: methods });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "Synthetic ordinary wallet", rdns: "io.synthetic.ordinary",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner, chain });
  await page.route("**/api/account/wallet-balances*", route => route.fulfill({ json: { context, holder: owner,
    native: { status: "success", value: String(100n * unit) }, tokens: [
      { id: "paxg", address: paxg, balance: { status: "success", value: String(20n * unit) } },
      { id: "cygld", address: protocolAddresses.core, balance: { status: "success", value: String(100n * unit) } },
    ] } }));
}

test("expanded fee estimates and the chosen tolerance survive reload before hydration", async ({ page }) => {
  const observed = await prepareFeeDisplay(page);
  const before = await page.getByTestId("trade-live-view").evaluate((root, keys) => Object.fromEntries(keys.map(key =>
    [key, root.querySelector(`[data-trade-display="${key}"]`)?.textContent?.trim() ?? ""])), [...feeDisplaySlots]);
  // Exercise the complete saved fee row even when no independent token-price
  // observation can be restored while fresh quote and gas quantities arrive.
  await page.addInitScript(key => localStorage.removeItem(key), tokenUsdKey);
  const scripts = await hold(page, "**/_next/static/**/*.js*");
  const held = await Promise.all(["**/api/protocol/config", "**/api/protocol/facts", "**/api/gold", "**/api/fx",
    "**/api/pools/**", "**/api/economic-quotes", "**/api/transaction/fees"].map(pattern => hold(page, pattern)));
  try {
    await page.reload({ waitUntil: "commit" });
    await expect.poll(scripts.requests).toBeGreaterThan(0);
    const cachedView = page.getByTestId("trade-cached-view");
    await expect(cachedView).toBeVisible();
    const details = cachedView.locator("[data-trade-fees]");
    const disclosure = details.getByRole("button", { name: /Total fee/ });
    await expect(details).toHaveAttribute("open", "");
    for (const key of feeDisplaySlots) {
      await expect(details.locator(`[data-trade-display="${key}"]`)).toHaveText(before[key]);
    }
    const tolerance = cachedView.getByLabel("Execution tolerance:", { exact: true });
    await expect(tolerance).toHaveValue("0.25");
    await disclosure.click();
    await expect(tolerance).toBeHidden();
    await disclosure.click();
    await expect(tolerance).toBeVisible();
    await tolerance.fill("0.5");
    await expect(tolerance).toHaveValue("0.5");

    scripts.release();
    await expect.poll(held[0].requests).toBeGreaterThan(0);
    await expect(cachedView).toBeHidden();
    const liveFees = page.getByTestId("swap-fees");
    await expect(liveFees).toHaveAttribute("open", "");
    await expect(page.locator("#execution-tolerance")).toHaveValue("0.5");
    await expect(liveFees.locator('[data-trade-display="feeTotal"]')).toHaveText(before.feeTotal);
    await expect(page.getByText(/updating[.…]*/i)).toHaveCount(0);
    const liveDisclosure = liveFees.getByRole("button", { name: /Total fee/ });
    await liveDisclosure.click();
    await expect(page.locator("#execution-tolerance")).toBeHidden();
    await liveDisclosure.click();
    await expect(page.locator("#execution-tolerance")).toBeEditable();
    const gasResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/transaction/fees");
    held.forEach((value, index) => { if (index !== 4) value.release(); });
    await gasResponse;
    await expect(page.locator("#execution-tolerance")).toHaveValue("0.5");
    // Tolerance changes protect the selected observation; quote requests stay wallet/execution-free.
    expect(observed.economicRequests.every(request => request.slippageBps === undefined && request.deadline === undefined)).toBe(true);
    await expect(page.getByTestId("swap-minimum-output")).toContainText("0.00995 ETH");
    await expect.poll(held[4].requests).toBeGreaterThan(0);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(liveFees.locator('[data-trade-display="feeNetworkValue"]')).toHaveText(before.feeNetworkValue);
  } finally { scripts.release(); held.forEach(value => value.release()); }
  await expect(page.getByTestId("swap-minimum-output")).toContainText("0.00995 ETH");
});

test("fee preferences and native edits survive hydration even without a trade display snapshot", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", message => {
    if (["error", "warning"].includes(message.type()) && /hydrat|server.rendered HTML/i.test(message.text())) hydrationErrors.push(message.text());
  });
  page.on("pageerror", error => { if (/hydrat/i.test(error.message)) hydrationErrors.push(error.message); });
  await install(page);
  await page.addInitScript(() => sessionStorage.setItem("cg:swap-fee-preferences:v1", JSON.stringify({
    detailsOpen: true, slippageBps: 25,
  })));
  const scripts = await hold(page, "**/_next/static/**/*.js*");
  const configuration = await hold(page, "**/api/protocol/config");
  try {
    await page.goto("/en", { waitUntil: "commit" });
    await expect.poll(scripts.requests).toBeGreaterThan(0);
    await expect(page.getByTestId("trade-cached-view")).toBeHidden();
    const details = page.getByTestId("swap-fees");
    const disclosure = details.getByRole("button", { name: /Total fee/ });
    const tolerance = page.getByLabel("Execution tolerance:", { exact: true });
    await expect(details).toHaveAttribute("open", "");
    await expect(tolerance).toHaveValue("0.25");
    await disclosure.click();
    await expect(tolerance).toBeHidden();
    await disclosure.click();
    await tolerance.fill("0.5");
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("cg:swap-fee-preferences:v1") ?? "null")?.slippageBps)).toBe(50);
    await disclosure.click();
    await expect(tolerance).toBeHidden();
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("cg:swap-fee-preferences:v1") ?? "null")?.detailsOpen)).toBe(false);

    scripts.release();
    await expect.poll(configuration.requests).toBeGreaterThan(0);
    await expect(details).not.toHaveAttribute("open", "");
    await disclosure.click();
    await expect(page.locator("#execution-tolerance")).toHaveValue("0.5");
    await page.locator("#execution-tolerance").fill("0.6");
    await expect(page.locator("#execution-tolerance")).toHaveValue("0.6");
    await expect(page.getByText(/updating[.…]*/i)).toHaveCount(0);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(hydrationErrors).toEqual([]);
  } finally { scripts.release(); configuration.release(); }
});

test("editing the cached spend before hydration clears fees belonging to the previous amount", async ({ page }) => {
  await prepareFeeDisplay(page);
  const scripts = await hold(page, "**/_next/static/**/*.js*");
  const held = await Promise.all(["**/api/protocol/config", "**/api/protocol/facts", "**/api/gold", "**/api/fx",
    "**/api/pools/**", "**/api/economic-quotes", "**/api/transaction/fees"].map(pattern => hold(page, pattern)));
  try {
    await page.reload({ waitUntil: "commit" });
    await expect.poll(scripts.requests).toBeGreaterThan(0);
    const cachedView = page.getByTestId("trade-cached-view");
    await expect(cachedView).toBeVisible();
    await cachedView.locator('[data-trade-display="sellAmount"]').fill("0.02");
    for (const key of ["feeTotal", "feeProtocolValue", "feeHelpersValue", "feeApplicationValue", "feeNetworkValue", "feeMinimumOutput"]) {
      await expect(cachedView.locator(`[data-trade-display="${key}"]`)).toHaveText("...");
    }
    scripts.release();
    await expect.poll(held[0].requests).toBeGreaterThan(0);
    await expect(cachedView).toBeHidden();
    await expect(page.locator("#sell-amount")).toHaveValue("0.02");
    await expect(page.locator('[data-trade-live] [data-trade-display="feeTotal"]')).toHaveText("...");
    await expect(page.getByTestId("swap-minimum-output")).not.toContainText("0.009975 ETH");
  } finally { scripts.release(); held.forEach(value => value.release()); }
});

test("hard reload preserves both selected assets and their nonzero values before hydration", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const hydrationErrors: string[] = [];
  page.on("console", message => {
    if (["error", "warning"].includes(message.type()) && /hydrat|server.rendered HTML/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });
  page.on("pageerror", error => {
    if (/hydrat/i.test(error.message)) hydrationErrors.push(error.message);
  });
  await install(page);
  await installEthDisplayPrices(page, () => 2000);
  await page.addInitScript(() => {
    localStorage.setItem("display-currency", "EUR");
    localStorage.setItem("display-gold-unit", "imperial");
  });
  await page.goto("/en");
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await page.locator("#sell-amount").fill("0.01");
  await expect(page.locator("#sell-token-label")).toHaveText("CYGLD");
  await expect(page.locator("#buy-token-label")).toHaveText("ETH");
  await expect(page.locator("#buy-amount")).toHaveText("0.01");
  await expect(page.locator('[data-navbar-currency-option="EUR"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-navbar-gold-unit-option="imperial"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Connect wallet$/i })).toBeVisible();
  const equivalents = (side: "sell" | "buy") => page.getByTestId(`${side}-amount-equivalents`).filter({ visible: true });
  for (const side of ["sell", "buy"] as const) {
    await expect(equivalents(side)).toContainText("troy oz");
    await expect(equivalents(side)).not.toContainText("...");
    await expect(equivalents(side)).not.toContainText("$0.00");
    await expect(equivalents(side)).toContainText("€");
  }
  const before = {
    sellEquivalent: (await equivalents("sell").textContent())!.trim(),
    buyEquivalent: (await equivalents("buy").textContent())!.trim(),
    reference: (await page.getByRole("button", { name: "Reverse swap direction", exact: true }).textContent())!.trim(),
  };
  // Give the completed display a browser paint before performing a true reload.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const scripts = await hold(page, "**/_next/static/**/*.js*");
  const held = await Promise.all(["**/api/protocol/config", "**/api/protocol/facts", "**/api/gold",
    "**/api/fx", "**/api/pools/**", "**/api/quotes/trade/**"].map(pattern => hold(page, pattern)));
  try {
    // React cannot have restored anything: its external bundles are held until
    // after the first-paint assertions. An eventual hydrated assertion misses
    // the ETH / zero-value flash that this regression covers.
    await page.reload({ waitUntil: "commit" });
    await expect.poll(scripts.requests).toBeGreaterThan(0);
    const snapshot = page.getByTestId("trade-cached-view");
    await expect(snapshot).toBeVisible();
    await expect(page.getByTestId("trade-live-view")).toBeHidden();
    const retained = (key: string) => snapshot.locator(`[data-trade-display="${key}"]`).filter({ visible: true });
    await expect(retained("sellSymbol")).toHaveText("CYGLD");
    await expect(retained("buySymbol")).toHaveText("ETH");
    await expect(retained("sellAmount")).toHaveValue("0.01");
    await expect(retained("buyAmount")).toHaveText("0.01");
    await expect(retained("sellEquivalent")).toHaveText(before.sellEquivalent);
    await expect(retained("buyEquivalent")).toHaveText(before.buyEquivalent);
    await expect(retained("reference")).toHaveText(before.reference);
    await expect(page.locator('[data-navbar-currency-option="EUR"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-navbar-gold-unit-option="imperial"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Connect wallet$/i })).toBeVisible();
    await expect(page.getByText(/updating[.…]*/i)).toHaveCount(0);

    await page.evaluate(() => {
      const state = { stopped: false, frames: [] as Record<string, string>[] };
      Object.assign(window, { __tradeReloadFrames: state });
      const visible = (element: Element) => {
        if (!element.getClientRects().length) return false;
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
        }
        return true;
      };
      const sample = () => {
        if (state.stopped) return;
        const root = [...document.querySelectorAll('[data-testid="trade-cached-view"], [data-testid="trade-live-view"]')].find(visible);
        const fields = Object.fromEntries(["sellSymbol", "buySymbol", "sellAmount", "buyAmount", "sellEquivalent", "buyEquivalent"]
          .map(key => {
            const element = [...(root?.querySelectorAll(`[data-trade-display="${key}"]`) ?? [])].find(visible);
            return [key, element instanceof HTMLInputElement ? element.value : element?.textContent?.trim() ?? ""];
          }));
        const preference = (key: string) => {
          const attribute = key === "currency" ? "data-navbar-currency-option" : "data-navbar-gold-unit-option";
          return document.querySelector(`nav [${attribute}][aria-pressed="true"]`)?.getAttribute(attribute) ?? "";
        };
        const connectVisible = [...document.querySelectorAll("button")].some(button => visible(button)
          && [...button.querySelectorAll("span")].some(label => visible(label) && label.textContent?.trim().toLowerCase() === "connect wallet"));
        state.frames.push({ ...fields, currency: preference("currency"), goldUnit: preference("gold-unit"),
          connectVisible: String(connectVisible) });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    scripts.release();
    await expect.poll(held[0].requests).toBeGreaterThan(0);
    await expect(snapshot).toBeHidden();
    await expect(page.getByTestId("trade-live-view")).toBeVisible();
    await expect(page.locator("#sell-token-label")).toHaveText("CYGLD");
    await expect(page.locator("#buy-token-label")).toHaveText("ETH");
    await expect(page.locator("#sell-amount")).toHaveValue("0.01");
    await expect(page.locator("#buy-amount")).toHaveText("0.01");
    await expect(equivalents("sell")).toHaveText(before.sellEquivalent);
    await expect(equivalents("buy")).toHaveText(before.buyEquivalent);
    await expect(page.locator('[data-navbar-currency-option="EUR"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-navbar-gold-unit-option="imperial"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Connect wallet$/i })).toBeVisible();
    await expect(page.getByText(/updating[.…]*/i)).toHaveCount(0);
    expect(hydrationErrors).toEqual([]);
    const frames = await page.evaluate(() => new Promise<Record<string, string>[]>(resolve => requestAnimationFrame(() => {
      const state = (window as unknown as { __tradeReloadFrames: { stopped: boolean; frames: Record<string, string>[] } }).__tradeReloadFrames;
      state.stopped = true;
      resolve(state.frames);
    })));
    await test.info().attach("reload-painted-values", { body: JSON.stringify(frames), contentType: "application/json" });
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(frame => JSON.stringify(frame) === JSON.stringify({
      sellSymbol: "CYGLD", buySymbol: "ETH", sellAmount: "0.01", buyAmount: "0.01",
      sellEquivalent: before.sellEquivalent, buyEquivalent: before.buyEquivalent,
      currency: "EUR", goldUnit: "imperial", connectVisible: "true",
    }))).toBe(true);

    // A retained estimate belongs to its saved input. Editing the amount must
    // discard that receive estimate while current Backend data is unavailable.
    await page.locator("#sell-amount").fill("0.02");
    await expect(page.locator("#buy-amount")).toHaveText("...");
    await expect(equivalents("buy")).not.toHaveText(before.buyEquivalent);
  } finally { scripts.release(); held.forEach(value => value.release()); }
});

test("input edits before hydration survive the handoff and remain editable during background refresh", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", message => {
    if (["error", "warning"].includes(message.type()) && /hydrat|server.rendered HTML/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });
  page.on("pageerror", error => {
    if (/hydrat/i.test(error.message)) hydrationErrors.push(error.message);
  });
  await install(page);
  await installEthDisplayPrices(page, () => 2000);
  await page.goto("/en");
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await page.locator("#sell-amount").fill("0.01");
  await expect(page.locator("#buy-amount")).toHaveText("0.01");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  const scripts = await hold(page, "**/_next/static/**/*.js*");
  const held = await Promise.all(["**/api/protocol/config", "**/api/protocol/facts", "**/api/gold",
    "**/api/fx", "**/api/pools/**", "**/api/quotes/trade/**"].map(pattern => hold(page, pattern)));
  try {
    await page.reload({ waitUntil: "commit" });
    await expect.poll(scripts.requests).toBeGreaterThan(0);
    const snapshot = page.getByTestId("trade-cached-view");
    await expect(snapshot).toBeVisible();
    const cachedInput = snapshot.locator('[data-trade-display="sellAmount"]');
    await expect(cachedInput).toBeEditable();
    await cachedInput.fill("0.02");
    await expect(cachedInput).toHaveValue("0.02");
    await expect(cachedInput).toBeFocused();
    await expect(snapshot.locator('[data-trade-display="buyAmount"]')).toHaveText("...");
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("cg:swap-form-state:v1") ?? "null")?.sellAmount))
      .toBe("0.02");

    // The native input listener saves the edit before React can load; restoring
    // the draft must use that new amount instead of the earlier cached amount.
    scripts.release();
    await expect.poll(held[0].requests).toBeGreaterThan(0);
    await expect(snapshot).toBeHidden();
    const input = page.locator("#sell-amount");
    await expect(input).toBeEditable();
    await expect(input).toHaveValue("0.02");
    await expect(input).toBeFocused();
    expect(await input.evaluate(element => {
      const input = element as HTMLInputElement;
      return [input.selectionStart, input.selectionEnd];
    })).toEqual([4, 4]);
    await expect(page.locator("#sell-token-label")).toHaveText("CYGLD");
    await expect(page.locator("#buy-token-label")).toHaveText("ETH");
    await expect(page.locator("#buy-amount")).toHaveText("...");
    // Continue typing at the saved caret instead of refocusing with fill(),
    // which could conceal a broken focus handoff.
    await input.press("Backspace");
    await input.press("3");
    await expect(input).toHaveValue("0.03");
    await expect(input).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(/updating[.…]*/i)).toHaveCount(0);

    held.forEach(value => value.release());
    await expect(page.locator("#buy-amount")).toHaveText("0.03");
    await expect(input).toHaveValue("0.03");
    expect(hydrationErrors).toEqual([]);
  } finally { scripts.release(); held.forEach(value => value.release()); }
});

test("basket rows and native driver edits survive hydration while fresh composition is pending", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", message => {
    if (["error", "warning"].includes(message.type()) && /hydrat|server.rendered HTML/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });
  page.on("pageerror", error => {
    if (/hydrat/i.test(error.message)) hydrationErrors.push(error.message);
  });
  const observed = await installBasket(page);
  await page.goto("/en");
  await selectBasket(page);
  const driver = page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true });
  await driver.fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("1");
  await expect.poll(() => observed.previews).toContain("issue-exact-in");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  const scripts = await hold(page, "**/_next/static/**/*.js*");
  const configuration = await hold(page, "**/api/protocol/config");
  const facts = await hold(page, "**/api/protocol/facts");
  try {
    await page.reload({ waitUntil: "commit" });
    await expect.poll(scripts.requests).toBeGreaterThan(0);
    const snapshot = page.getByTestId("trade-cached-view");
    const cachedInput = snapshot.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true });
    await expect(cachedInput).toBeEditable();
    await expect(cachedInput).toHaveAccessibleName("Sell amount (PAXG)");
    await cachedInput.fill("2");
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("cg:swap-form-state:v1") ?? "null")?.driverAmountStr))
      .toBe("2");

    scripts.release();
    await expect.poll(configuration.requests).toBeGreaterThan(0);
    await expect(snapshot).toBeHidden();
    await expect(driver).toHaveValue("2");
    await expect(driver).toBeFocused();
    await expect(driver).toBeEditable();
    // Primitive presentation rows already provide the same editable layout.
    // Fresh composition supplies execution data independently.
    configuration.release();
    await expect.poll(facts.requests).toBeGreaterThan(0);
    await expect(driver).toBeEditable();
    await driver.fill("3");
    await expect(driver).toBeFocused();
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("cg:swap-form-state:v1") ?? "null")?.driverAmountStr))
      .toBe("3");

    facts.release();
    await expect(snapshot).toBeHidden();
    await expect(driver).toBeEditable();
    await expect(driver).toHaveValue("3");
    await expect(driver).toBeFocused();
    // Let the ordinary row-focus callback run too; it must not select the
    // whole amount after the native caret has been handed to the live row.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await driver.evaluate(element => {
      const input = element as HTMLInputElement;
      return [input.selectionStart, input.selectionEnd];
    })).toEqual([1, 1]);
    await driver.press("4");
    await expect(driver).toHaveValue("34");
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("cg:swap-form-state:v1") ?? "null")?.driverAmountStr))
      .toBe("34");
    expect(observed.previews.every(mode => mode === "issue-exact-in")).toBe(true);
    expect(hydrationErrors).toEqual([]);
  } finally { scripts.release(); configuration.release(); facts.release(); }
});

test("hard reload retains selector names and catalog while configuration refresh is unfinished", async ({ page }) => {
  await install(page); await page.goto("/en"); await selectPaxg(page);
  await expect.poll(async () => (await cached(page, tokenKey))?.some((token: { id: string }) => token.id === "paxg")).toBe(true);
  const configuration = await hold(page, "**/api/protocol/config");
  try {
    await page.reload(); await expect.poll(configuration.requests).toBeGreaterThan(0);
    const pickers = page.locator('main button[aria-haspopup="dialog"]');
    await expect(pickers.first()).toContainText("PAXG");
    await expect(pickers.last()).toContainText("CYGLD");
    await expect(pickers.locator(".animate-spin")).toHaveCount(0);
    await pickers.first().click();
    const picker = page.getByRole("dialog", { name: "Choose currency", exact: true });
    await expect(picker.getByRole("textbox", { name: "Search currency...", exact: true })).toBeVisible();
    await expect(picker.getByRole("button").filter({ has: page.getByText("Wrapped Ether", { exact: true }) })).toBeVisible();
    await expect(picker.getByText("No tokens found", { exact: true })).toHaveCount(0);
  } finally { configuration.release(); }
});

test("a saved nonzero amount never displays zero equivalents while cold prices are unavailable", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) hydrationErrors.push(message.text());
  });
  await install(page);
  await page.addInitScript(() => sessionStorage.setItem("cg:swap-form-state:v1", JSON.stringify({
    showOnlyWalletTokens: false, sellTokenId: "eth", buyTokenId: "cygld", sellAmount: "0.01",
  })));
  const held = await Promise.all(["**/api/protocol/config", "**/api/protocol/facts", "**/api/gold",
    "**/api/fx", "**/api/pools/**"].map(pattern => hold(page, pattern)));
  try {
    await page.goto("/en");
    await expect.poll(held[0].requests).toBeGreaterThan(0);
    await expect(page.locator("#sell-amount")).toHaveValue("0.01");
    const pickers = page.locator('main button[aria-haspopup="dialog"]');
    await expect(pickers.first()).toContainText("ETH");
    await expect(pickers.last()).toContainText("CYGLD");
    await expect(pickers.locator(".animate-spin")).toHaveCount(0);
    await page.locator("#sell-amount").fill("0.02");
    await expect(page.locator("#sell-amount")).toHaveValue("0.02");
    await expect(page.locator("#sell-amount")).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(pickers.first().getByRole("img", { name: "ETH", exact: true })).toHaveAttribute("src", /eth-purple/);
    expect(hydrationErrors).toEqual([]);
    for (const side of ["sell", "buy"]) {
      const equivalent = page.getByTestId(`${side}-amount-equivalents`).filter({ visible: true });
      await expect(equivalent).toContainText("...");
      await expect(equivalent).not.toContainText("$0.00");
    }
  } finally { held.forEach(value => value.release()); }
});

test("cached Ether prices value the edited amount during reload and fresh prices replace them", async ({ page }) => {
  await install(page);
  let refresh = false;
  await installEthDisplayPrices(page, () => refresh ? 3000 : 2000);
  await page.route("**/api/gold", route => route.fulfill({ json: { price: refresh ? 6220.69536 : 3110.34768,
    fetchedAt: new Date().toISOString(), stale: false } }));
  await page.goto("/en");
  await page.locator("#sell-amount").fill("0.01");
  const equivalent = page.getByTestId("sell-amount-equivalents").filter({ visible: true });
  await expect(equivalent).toHaveText("~ 0.20 g of gold • $20.00");
  await expect.poll(async () => (await cached(page, tokenUsdKey))?.[JSON.stringify(["eth", "native", "native", 18])]).toBe(2000);
  const held = await Promise.all(["**/api/protocol/config", "**/api/protocol/facts", "**/api/gold",
    "**/api/fx", "**/api/pools/**"].map(pattern => hold(page, pattern)));
  try {
    await page.reload();
    await expect.poll(held[0].requests).toBeGreaterThan(0);
    await expect.poll(held[2].requests).toBeGreaterThan(0);
    await expect.poll(held[3].requests).toBeGreaterThan(0);
    await expect(page.locator("#sell-amount")).toHaveValue("0.01");
    const pickers = page.locator('main button[aria-haspopup="dialog"]');
    await expect(pickers.first()).toContainText("ETH");
    await expect(pickers.last()).toContainText("CYGLD");
    await expect(pickers.locator(".animate-spin")).toHaveCount(0);
    await expect(equivalent).toHaveText("~ 0.20 g of gold • $20.00");
    await page.locator("#sell-amount").fill("0.02");
    await expect(equivalent).toHaveText("~ 0.40 g of gold • $40.00");
    // A price fallback values the current edit; it cannot restore the old amount.
    held[0].release();
    await expect.poll(held[1].requests).toBeGreaterThan(0);
    await expect.poll(held[4].requests).toBeGreaterThan(0);
    await expect(equivalent).toHaveText("~ 0.40 g of gold • $40.00");
    refresh = true;
    held.forEach(value => value.release());
    await expect(equivalent).toHaveText("~ 0.30 g of gold • $60.00");
    await expect(page.locator("#sell-amount")).toHaveValue("0.02");
  } finally { held.forEach(value => value.release()); }
});

test("retained display metadata cannot issue a quote or execute before live configuration returns", async ({ page }) => {
  const observed = await install(page); await installReadOnlyWallet(page);
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu", exact: true })).toBeVisible();
  await page.getByRole("switch").uncheck(); await selectPaxg(page);
  await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("1");
  await expect.poll(async () => (await cached(page, tokenKey))?.some((token: { id: string }) => token.id === "paxg")).toBe(true);
  const quoteRequests = observed.rawIntents.length;
  const configuration = await hold(page, "**/api/protocol/config");
  try {
    await page.reload(); await expect.poll(configuration.requests).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Open wallet menu", exact: true })).toBeVisible();
    await expect(page.locator('main button[aria-haspopup="dialog"]').first()).toContainText("PAXG");
    await expect(page.locator("#sell-amount")).toHaveValue("1");
    await page.locator("#sell-amount").fill("2");
    const action = page.locator("#swapsection").getByRole("button", { name: "Enter valid amounts", exact: true });
    await expect(action).toBeVisible(); await expect(action).toBeDisabled();
    // Pass the existing input debounce: no cached token address can become
    // the live trade endpoint merely because it is useful to the selector.
    await page.clock.install(); await page.clock.runFor(1_000);
    expect(observed.rawIntents.length).toBe(quoteRequests);
    expect(await page.evaluate(() => (window as unknown as { __displayCacheWalletMethods: string[] }).__displayCacheWalletMethods)
      .then(methods => methods.some(method => method.startsWith("eth_sign") || method === "eth_sendTransaction"))).toBe(false);
    configuration.release();
    await expect.poll(async () => { await page.clock.runFor(500); return observed.rawIntents.length; }).toBeGreaterThan(quoteRequests);
    await expect(page.locator("#buy-amount")).toHaveText("2");
    await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  } finally { configuration.release(); }
});

test("gold and FX display fallback retain acquisition age across reload and ordinary refresh still replaces them", async ({ page }) => {
  await install(page);
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem("display-currency", "EUR"));
  await page.addInitScript(() => {
    const rows: { at: number; feeds: string[] }[] = [];
    Object.assign(window, { __displayCacheFreshness: rows });
    const original = console.debug.bind(console);
    console.debug = (...args: unknown[]) => {
      const details = args[1] as { feeds?: string[] } | undefined;
      if (String(args[0]).startsWith("[market-data] stale feeds") && Array.isArray(details?.feeds)) {
        rows.push({ at: Date.now(), feeds: [...details.feeds] });
      }
      original(...args);
    };
  });
  const goldTime = new Date(Date.now() - 59 * 60_000).toISOString();
  const fxTime = new Date(Date.now() - 4 * 60_000).toISOString();
  let refresh = false;
  await page.route("**/api/gold", route => route.fulfill({ json: { price: refresh ? 6220.69536 : 3110.34768,
    fetchedAt: refresh ? new Date().toISOString() : goldTime, stale: false } }));
  await page.route("**/api/fx", route => route.fulfill({ json: { base: "USD",
    rates: { USD: 1, EUR: refresh ? .5 : .8, CHF: .9, RUB: 90 },
    fetchedAt: refresh ? new Date().toISOString() : fxTime, stale: false } }));
  await page.goto("/en");
  const reference = page.getByRole("button", { name: "Reverse swap direction", exact: true });
  await expect(reference).toContainText("160");
  await expect.poll(async () => (await cached(page, goldKey))?.fetchedAt).toBe(goldTime);
  await expect.poll(async () => (await cached(page, fxKey))?.fetchedAt).toBe(fxTime);
  const previousReference = await reference.textContent();
  const gold = await hold(page, "**/api/gold"), fx = await hold(page, "**/api/fx");
  try {
    await page.reload();
    await expect.poll(gold.requests).toBeGreaterThan(0); await expect.poll(fx.requests).toBeGreaterThan(0);
    await expect(reference).toHaveText(previousReference!);
    expect((await cached(page, goldKey)).fetchedAt).toBe(goldTime);
    expect((await cached(page, fxKey)).fetchedAt).toBe(fxTime);
    await page.clock.fastForward(61_000);
    const expiredAt = Math.max(Date.parse(goldTime) + 3_600_000, Date.parse(fxTime) + 300_000);
    if (process.env.PLAYWRIGHT_APP_MODE === "production") {
      // Production deliberately omits debug-only freshness diagnostics. The
      // cache age, retained display and subsequent refresh checks still apply.
      expect(await page.evaluate(() => (window as unknown as { __displayCacheFreshness: unknown[] }).__displayCacheFreshness)).toEqual([]);
    } else {
      await expect.poll(() => page.evaluate(expiredAt =>
        (window as unknown as { __displayCacheFreshness: { at: number; feeds: string[] }[] }).__displayCacheFreshness
          .some(value => value.at >= expiredAt && value.feeds.includes("gold quote") && value.feeds.includes("FX rates")), expiredAt)).toBe(true);
    }
    await expect(reference).toHaveText(previousReference!);
    expect((await cached(page, goldKey)).fetchedAt).toBe(goldTime);
    expect((await cached(page, fxKey)).fetchedAt).toBe(fxTime);
    refresh = true; gold.release(); fx.release();
    await expect.poll(async () => { await page.clock.runFor(0); return (await cached(page, goldKey))?.price; }).toBe(6220.69536);
    await expect.poll(async () => { await page.clock.runFor(0); return (await cached(page, fxKey))?.rates.EUR; }).toBe(.5);
    await expect(reference).toContainText("200");
    expect((await cached(page, goldKey)).fetchedAt).not.toBe(goldTime);
    expect((await cached(page, fxKey)).fetchedAt).not.toBe(fxTime);
  } finally { gold.release(); fx.release(); }
});
