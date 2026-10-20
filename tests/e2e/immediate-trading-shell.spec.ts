import { universalFixture } from "./fixtures/universal-exact-input";
import { marketUniversalFixture } from "./fixtures/market-quotes";
import { expect, test, type Page } from "./fixtures/app-test";
import { protocolAddresses } from "../fixtures/protocol-configuration";
import { context, install } from "./fixtures/token-quotes";

const owner = "0x0000000000000000000000000000000000000011";
const paxg = "0x45804880de22913dafe09f4980848ece6ecbaf78";
const unit = 10n ** 18n;
const feeRows = ["swap-protocol-fee", "swap-helpers-fee", "swap-front-end-fee", "swap-network-fee"] as const;

async function hold(page: Page, pattern: string) {
  let release!: () => void, requests = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(pattern, async route => { requests++; await pending; await route.fallback(); });
  return { release, requests: () => requests };
}

async function openFees(page: Page) {
  const button = page.getByRole("button", { name: /^Total fee/ });
  await expect(button).toBeVisible();
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
  for (const row of feeRows) await expect(page.getByTestId(row)).toBeVisible();
  await expect(page.getByRole("slider", { name: "Adjust execution tolerance", exact: true })).toBeVisible();
}

async function selectPaxg(page: Page) {
  await page.locator('main button[aria-haspopup="dialog"]').first().click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Search currency...", exact: true }).fill("PAXG");
  await page.getByRole("dialog").getByRole("button").filter({ has: page.getByText("PAXG", { exact: true }) }).click();
}

async function readOnlyWallet(page: Page, basket = false) {
  const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
  await page.addInitScript(({ owner, chain, basket }) => {
    const methods: string[] = [];
    const provider = { isMetaMask: false, selectedAddress: owner,
      request: async ({ method }: { method: string }) => {
        methods.push(method);
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [owner];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts",
          caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        throw new Error(`Read-only shell fixture rejects ${method}`);
      }, on: () => {}, removeListener: () => {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    Object.assign(window, { __shellWalletMethods: methods });
    sessionStorage.setItem("cg:swap-form-state:v1", JSON.stringify({ isSellInputEnabled: true,
      showOnlyWalletTokens: false, sellTokenId: basket ? "goldbasket" : "paxg", buyTokenId: "cygld" }));
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "Synthetic ordinary wallet", rdns: "io.synthetic.ordinary",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner, chain, basket });
  await page.route("**/api/account/wallet-balances*", route => route.fulfill({ json: { context, holder: owner,
    native: { status: "success", value: String(100n * unit) }, tokens: [
      { id: "paxg", address: paxg, balance: { status: "success", value: String(20n * unit) } },
      { id: "cygld", address: protocolAddresses.core, balance: { status: "success", value: String(100n * unit) } },
    ] } }));
}

test("cold configuration leaves the entire trading shell and searchable picker visible", async ({ page }) => {
  await install(page);
  const configuration = await hold(page, "**/api/protocol/config");
  try {
    await page.goto("/en");
    await expect.poll(configuration.requests).toBeGreaterThan(0);
    await expect(page.getByText("Your budget", { exact: true })).toBeVisible();
    await expect(page.getByText("You Buy", { exact: true })).toBeVisible();
    await expect(page.locator("#sell-amount")).toBeVisible();
    await expect(page.locator("#buy-amount")).toBeVisible();
    await expect(page.locator("#sell-amount")).toBeFocused();
    const pickers = page.locator('main button[aria-haspopup="dialog"]');
    await expect(pickers).toHaveCount(2);
    await expect(pickers.first()).toBeVisible(); await expect(pickers.last()).toBeVisible();
    await openFees(page);
    await expect(page.getByTestId("swap-fees").getByRole("button", { name: /^Total fee/ })).toContainText("...");
    await expect(page.getByTestId("swap-minimum-output")).toContainText("...");
    await expect(page.getByTestId("sell-amount-equivalents").filter({ visible: true })).toHaveText("~ 0.00 g of gold • $0.00");
    await expect(page.getByTestId("buy-amount-equivalents").filter({ visible: true })).toHaveText("~ 0.00 g of gold • $0.00");
    await expect(page.locator("#swapsection").getByRole("button", { name: "Please connect your wallet", exact: true })).toBeVisible();
    await pickers.first().click();
    const picker = page.getByRole("dialog", { name: "Choose currency", exact: true });
    await expect(picker.getByRole("textbox", { name: "Search currency...", exact: true })).toBeVisible();
    await expect(picker.getByRole("status")).toHaveText("...");
    await expect(picker.getByRole("status")).toHaveAttribute("aria-busy", "true");
    await expect(picker.getByText("No tokens found", { exact: true })).toHaveCount(0);
  } finally { configuration.release(); }
});

test("known token controls and safety labels remain visible while independent data is pending", async ({ page }) => {
  await install(page);
  const held = await Promise.all(["**/api/protocol/facts", "**/api/gold", "**/api/fx",
    "**/api/pools/**", "**/api/quotes/**"].map(pattern => hold(page, pattern)));
  try {
    await page.goto("/en"); await selectPaxg(page);
    await page.locator("#sell-amount").fill("1");
    await expect.poll(held[4].requests).toBeGreaterThan(0);
    await openFees(page);
    await expect(page.locator("#sell-amount")).toHaveValue("1");
    await expect(page.locator("#buy-amount")).toBeVisible();
    await expect(page.locator("#buy-amount")).toHaveText("...");
    await expect(page.getByTestId("swap-minimum-output")).toContainText("...");
    await expect(page.getByRole("button", { name: "Reverse swap direction", exact: true })).toContainText("1 CYGLD ≈ ...");
    await expect(page.getByTestId("sell-amount-equivalents").filter({ visible: true })).toContainText("...");
    await expect(page.getByTestId("buy-amount-equivalents").filter({ visible: true })).toContainText("...");
    for (const row of feeRows) await expect(page.getByTestId(row)).toBeVisible();
  } finally { held.forEach(value => value.release()); }
});

for (const strategy of ["core", "market"] as const) {
  test(`${strategy} winner fills values without inserting or removing fee-detail rows`, async ({ page }) => {
    await install(page);
    let release!: () => void, requests = 0;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/quotes/trade/model", route => route.fulfill({ json: {
      namespace: "trade", intent: route.request().postDataJSON(), models: [],
    } }));
    await page.route("**/api/quotes/universal-exact-input", async route => {
      requests++; const request = route.request().postDataJSON();
      await pending;
      const value = strategy === "market" ? marketUniversalFixture(request) : universalFixture(request);
      await route.fulfill({ json: value });
    });
    try {
      await page.goto("/en"); await selectPaxg(page); await openFees(page);
      await page.locator("#sell-amount").fill("1");
      await expect.poll(() => requests).toBeGreaterThan(0);
      await expect(page.getByTestId("swap-minimum-output")).toContainText("...");
      const before = await page.getByTestId("swap-fees").boundingBox();
      release();
      await expect(page.locator("#buy-amount")).toHaveText(strategy === "market" ? "0.999" : "1");
      await expect(page.getByTestId("swap-minimum-output")).not.toContainText("...");
      for (const row of feeRows) await expect(page.getByTestId(row)).toBeVisible();
      const after = await page.getByTestId("swap-fees").boundingBox();
      expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(2);
      expect(after!.width).toBe(before!.width);
    } finally { release(); }
  });
}

test("connected MAX and balance slots render before configuration and remain disabled until balances are usable", async ({ page }) => {
  await install(page); await readOnlyWallet(page);
  const configuration = await hold(page, "**/api/protocol/config");
  const balances = await hold(page, "**/api/account/wallet-balances*");
  try {
    await page.goto("/en");
    await expect(page.getByRole("button", { name: "Open wallet menu", exact: true })).toBeVisible();
    await expect.poll(configuration.requests).toBeGreaterThan(0);
    const sellMax = page.getByRole("button", { name: "Use maximum sell amount", exact: true });
    const buyMax = page.getByRole("button", { name: "Use maximum purchase amount", exact: true });
    await expect(sellMax).toBeVisible(); await expect(sellMax).toBeDisabled();
    await expect(buyMax).toHaveCount(0);
    await expect(page.getByTestId("sell-wallet-balance")).toBeHidden();
    await expect(page.getByTestId("buy-wallet-balance")).toBeHidden();
    const before = await sellMax.boundingBox();
    configuration.release();
    await expect.poll(balances.requests).toBeGreaterThan(0);
    await expect(page.getByTestId("sell-wallet-balance")).toBeHidden();
    await expect(sellMax).toBeDisabled(); await expect(buyMax).toHaveCount(0);
    balances.release();
    await expect(page.getByTestId("sell-wallet-balance")).toContainText("20 PAXG");
    await expect(sellMax).toBeEnabled(); await expect(buyMax).toHaveCount(0);
    const after = await sellMax.boundingBox();
    expect(after!.width).toBe(before!.width); expect(after!.height).toBe(before!.height);
    expect(await page.evaluate(() => (window as unknown as { __shellWalletMethods: string[] }).__shellWalletMethods)
      .then(methods => methods.some(method => method.startsWith("eth_sign") || method === "eth_sendTransaction"))).toBe(false);
  } finally { configuration.release(); balances.release(); }
});

test("a restored Basket renders before facts arrive and an amount cannot enable a missing executor", async ({ page }) => {
  await install(page); await readOnlyWallet(page, true);
  const facts = await hold(page, "**/api/protocol/facts");
  try {
    await page.goto("/en");
    await expect(page.getByRole("button", { name: "Open wallet menu", exact: true })).toBeVisible();
    await expect.poll(facts.requests).toBeGreaterThan(0);
    const composition = page.locator("#sell-basket-composition");
    await expect(composition).toBeVisible();
    await expect(composition).toContainText("Basket"); await expect(composition).toContainText("...");
    const maximum = composition.getByRole("button", { name: "Use maximum sell amount", exact: true });
    await expect(maximum).toBeVisible(); await expect(maximum).toBeDisabled();
    await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
    await page.locator("#sell-amount").click(); await page.locator("#sell-amount").fill("1");
    const receiveBasket = page.locator("#buy-basket-composition");
    await expect(receiveBasket).toBeVisible(); await expect(receiveBasket).toContainText("...");
    await openFees(page);
    await expect(page.getByTestId("swap-minimum-output")).toContainText("...");
    const pendingSwap = page.locator("#swapsection").getByRole("button", { name: /^Quote processing/ });
    await expect(pendingSwap).toBeVisible(); await expect(pendingSwap).toBeDisabled();
    await expect(pendingSwap.locator("svg")).toHaveCount(0);
    await expect(page.locator("#swapsection").getByRole("button", { name: "Swap currencies", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __shellWalletMethods: string[] }).__shellWalletMethods)
      .then(methods => methods.some(method => method.startsWith("eth_sign") || method === "eth_sendTransaction"))).toBe(false);
    facts.release();
    await expect(receiveBasket).toContainText("PAXG");
  } finally { facts.release(); }
});
