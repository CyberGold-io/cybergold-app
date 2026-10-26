import { expect, test, type Page, type Locator } from "./fixtures/app-test";
import { context, install } from "./fixtures/token-quotes";
import { install as installBasket, asset } from "./fixtures/basket-quotes";
import { selectBasket } from "./fixtures/swap-selection";
import { protocolAddresses } from "../fixtures/protocol-configuration";

const owner = "0x0000000000000000000000000000000000000011";
const unit = 10n ** 18n;

async function wallet(page: Page) {
  await page.addInitScript(({ owner }) => {
    const release: (() => void)[] = [];
    Object.assign(window, { __releaseRefreshWallet: () => release.splice(0).forEach(fn => fn()) });
    const provider = { selectedAddress: owner, request: async ({ method }: { method: string }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") {
        if (sessionStorage.getItem("hold-refresh-wallet") === "true") await new Promise<void>(resolve => release.push(resolve));
        return [owner];
      }
      if (method === "eth_chainId") return "0x7a69";
      if (method === "net_version") return "31337";
      throw new Error(`Read-only refresh fixture rejects ${method}`);
    }, on: () => {}, removeListener: () => {} };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "30491a20-549d-4608-9d6b-688d06c5f379", name: "Refresh fixture wallet", rdns: "io.synthetic.refresh",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner });
  await page.route("**/api/account/wallet-balances*", route => route.fulfill({ json: { context, holder: owner,
    native: { status: "success", value: String(100n * unit) }, tokens: [
      { id: "paxg", address: asset, balance: { status: "success", value: String(20n * unit) } },
      { id: "cygld", address: protocolAddresses.core, balance: { status: "success", value: String(100n * unit) } },
    ] } }));
}

async function hold(page: Page, pattern: string) {
  let release!: () => void, count = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(pattern, async route => { count++; await waiting; await route.fallback(); });
  return { release, count: () => count };
}

async function capture(root: Locator) {
  return root.evaluate(root => {
    const visible = (node: Element) => node.checkVisibility();
    return {
      slots: Object.fromEntries([...root.querySelectorAll<HTMLElement>("[data-trade-display]")].filter(visible)
        .map(node => [node.dataset.tradeDisplay!, node instanceof HTMLInputElement ? node.value : node.textContent?.trim() ?? ""])),
      rows: [...root.querySelectorAll<HTMLElement>("[data-trade-basket-row]")].filter(visible).map(row => ({
        id: row.dataset.tradeBasketRow, text: row.textContent?.trim(),
        amount: row.querySelector<HTMLInputElement>("input:not([hidden])")?.value,
      })),
      controls: [...root.querySelectorAll("[data-trade-action], [data-trade-max], [data-trade-wallet-filter]")].filter(visible).map(node => {
        const style = getComputedStyle(node);
        return { color: style.color, background: style.backgroundColor, opacity: style.opacity };
      }),
      max: [...root.querySelectorAll("[data-trade-max]")].filter(visible).length,
      filter: [...root.querySelectorAll("[data-trade-wallet-filter]")].filter(visible).map(node => node.getAttribute("aria-checked")),
    };
  });
}

async function stableSnapshot(page: Page) {
  await expect(page.getByRole("button", { name: "Open wallet menu", exact: true })).toBeVisible();
  await expect(page.locator('[data-trade-action]')).toHaveText("Swap currencies");
  await expect(page.locator('[data-trade-action]')).toBeEnabled();
  if (!await page.locator("[data-trade-fees]").evaluate(node => (node as HTMLDetailsElement).open)) {
    await page.getByRole("button", { name: /Total fee/ }).click();
  }
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return capture(page.getByTestId("trade-live-view"));
}

async function reloadHeld(page: Page, check: (cached: Locator, live: Locator, hydrate: () => Promise<void>) => Promise<void>) {
  await page.evaluate(() => sessionStorage.setItem("hold-refresh-wallet", "true"));
  const scripts = await hold(page, "**/_next/static/**/*.js*");
  const feeds = await hold(page, "**/api/**");
  try {
    await page.reload({ waitUntil: "commit" });
    await expect.poll(scripts.count).toBeGreaterThan(0);
    await expect(page.getByTestId("trade-cached-view")).toBeVisible();
    await check(page.getByTestId("trade-cached-view"), page.getByTestId("trade-live-view"), async () => {
      scripts.release();
      await expect.poll(feeds.count).toBeGreaterThan(0);
      await expect(page.getByTestId("trade-cached-view")).toBeHidden();
    });
  } finally {
    scripts.release(); feeds.release();
    await page.evaluate(() => {
      sessionStorage.removeItem("hold-refresh-wallet");
      (window as unknown as { __releaseRefreshWallet?: () => void }).__releaseRefreshWallet?.();
    }).catch(() => undefined);
  }
}

test("a connected single-token swap retains all visible slots before hydration and through background reads", async ({ page }) => {
  await install(page); await wallet(page);
  await page.goto("/en");
  await page.locator("#sell-amount").fill("0.01");
  await expect(page.locator("#buy-amount")).toHaveText("0.01");
  const before = await stableSnapshot(page);
  await reloadHeld(page, async (cached, live, hydrate) => {
    expect(await capture(cached)).toEqual(before);
    await expect(cached.locator('[data-trade-action]')).toBeDisabled();
    await hydrate();
    expect(await capture(live)).toEqual(before);
    await expect(live.locator('[data-trade-action]')).toBeDisabled();
  });
});

for (const side of ["sell", "buy"] as const) test(`${side} basket rows retain their structure and values before hydration`, async ({ page }) => {
  await installBasket(page); await wallet(page);
  await page.goto("/en");
  await selectBasket(page, side);
  if (side === "sell") await page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true }).fill("1");
  else await page.locator("#sell-amount").fill("0.01");
  if (side === "sell") await expect(page.locator("#buy-amount")).toHaveText("1");
  else await expect(page.locator('[data-trade-basket-rows="buy"] output:visible')).toHaveText("1");
  const before = await stableSnapshot(page);
  await reloadHeld(page, async (cached, live, hydrate) => {
    expect(await capture(cached)).toEqual(before);
    if (side === "sell") {
      const spend = cached.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true });
      await expect(spend).toBeEditable();
      await spend.fill("2");
      await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("cg:swap-form-state:v1") ?? "null")?.driverAmountStr)).toBe("2");
      await hydrate();
      const restored = live.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true });
      await expect(restored).toBeEditable(); await expect(restored).toHaveValue("2"); await expect(restored).toBeFocused();
    } else {
      await hydrate();
      expect(await capture(live)).toEqual(before);
    }
  });
});

test("a failed background quote read preserves the latest completed output and fees", async ({ page }) => {
  await install(page); await wallet(page);
  await page.goto("/en");
  await page.locator("#sell-amount").fill("0.01");
  await expect(page.locator("#buy-amount")).toHaveText("0.01");
  await stableSnapshot(page);
  await page.locator("#sell-amount").fill("0.02");
  await expect(page.locator("#buy-amount")).toHaveText("0.02");
  await stableSnapshot(page);
  const slots = ["buyAmount", "buyEquivalent", "feeTotal", "feeProtocolValue", "feeHelpersValue", "feeApplicationValue", "feeNetworkValue", "feeMinimumOutput"];
  const before = await page.getByTestId("trade-live-view").evaluate((root, keys) => Object.fromEntries(keys.map(key =>
    [key, root.querySelector(`[data-trade-display="${key}"]`)?.textContent?.trim() ?? ""])), slots);
  let failedReads = 0;
  await page.route("**/api/economic-quotes", async route => {
    failedReads++;
    await route.fulfill({ status: 503, json: { error: "Fresh quote is temporarily unavailable" } });
  });
  await page.reload();
  await expect.poll(() => failedReads).toBeGreaterThan(0);
  await expect(page.locator('[data-trade-action]')).not.toHaveText("Swap currencies");
  for (const key of slots) {
    await expect(page.getByTestId("trade-live-view").locator(`[data-trade-display="${key}"]`).first()).toHaveText(before[key]);
  }
  await expect(page.locator('[data-trade-action]')).toBeDisabled();
});

test("a focused cached basket component keeps its own row and caret at handoff", async ({ page }) => {
  const second = "0x0000000000000000000000000000000000000088";
  await install(page, "", undefined, false, [asset, second]);
  await page.goto("/en");
  await selectBasket(page);
  await page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true }).fill("1");
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("cybergold:trade-display:v1:31337:en") ?? "null")?.basketRows?.length)).toBe(2);
  await reloadHeld(page, async (cached, live, hydrate) => {
    const selected = cached.getByRole("textbox", { name: "Sell amount (GOLD2)", exact: true });
    await selected.focus();
    await selected.evaluate(node => (node as HTMLInputElement).setSelectionRange(1, 1));
    const before = await selected.inputValue();
    await hydrate();
    const restored = live.getByRole("textbox", { name: "Sell amount (GOLD2)", exact: true });
    await expect(restored).toBeFocused();
    await expect(restored).toHaveValue(before);
    expect(await restored.evaluate(node => [(node as HTMLInputElement).selectionStart, (node as HTMLInputElement).selectionEnd])).toEqual([1, 1]);
  });
});
