import { expect, test, type Page } from "./fixtures/app-test";
import { protocolAddresses } from "../fixtures/protocol-configuration";
import { context, install } from "./fixtures/token-quotes";

const tokenKey = "cybergold:display:tokens:v1:31337";
const goldKey = "cybergold:display:gold:v1";
const fxKey = "cybergold:display:fx:v1";
const owner = "0x0000000000000000000000000000000000000011";
const paxg = "0x45804880de22913dafe09f4980848ece6ecbaf78";
const unit = 10n ** 18n;

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

test("hard reload retains selector names and catalog while configuration refresh is unfinished", async ({ page }) => {
  await install(page); await page.goto("/en"); await selectPaxg(page);
  await expect.poll(async () => (await cached(page, tokenKey))?.some((token: { id: string }) => token.id === "paxg")).toBe(true);
  const configuration = await hold(page, "**/api/protocol/config");
  try {
    await page.reload(); await expect.poll(configuration.requests).toBeGreaterThan(0);
    const pickers = page.locator('main button[aria-haspopup="dialog"]');
    await expect(pickers.first()).toContainText("PAXG");
    await expect(pickers.last()).toContainText("CYGLD");
    await pickers.first().click();
    const picker = page.getByRole("dialog", { name: "Choose currency", exact: true });
    await expect(picker.getByRole("textbox", { name: "Search currency...", exact: true })).toBeVisible();
    await expect(picker.getByRole("button").filter({ has: page.getByText("Wrapped Ether", { exact: true }) })).toBeVisible();
    await expect(picker.getByText("No tokens found", { exact: true })).toHaveCount(0);
  } finally { configuration.release(); }
});

test("retained display metadata cannot issue a quote or execute before live configuration returns", async ({ page }) => {
  const observed = await install(page); await installReadOnlyWallet(page);
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu", exact: true })).toBeVisible();
  await page.getByRole("switch").uncheck(); await selectPaxg(page);
  await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveValue("1");
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
    await expect(page.locator("#buy-amount")).toHaveValue("2");
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
