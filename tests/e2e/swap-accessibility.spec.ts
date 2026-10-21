import { routeWalletBalances } from "./fixtures/wallet-balances";
import { selectBasket } from "./fixtures/swap-selection";
import { expect, test, type Page } from "./fixtures/app-test";
import { choose, context, install } from "./fixtures/token-quotes";

async function installWallet(page: Page, chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337)) {
  await page.addInitScript(({ chain }) => {
    const account = "0x00000000000000000000000000000000000000a1";
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      isMetaMask: true, selectedAddress: account,
      request: async ({ method }: { method: string }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [account];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [account] }] }];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        throw new Error(`Synthetic read-only wallet rejects ${method}`);
      },
      on: (event: string, listener: (...args: unknown[]) => void) => {
        const callbacks = listeners.get(event) ?? new Set();
        callbacks.add(listener); listeners.set(event, callbacks);
      },
      removeListener: (event: string, listener: (...args: unknown[]) => void) => listeners.get(event)?.delete(listener),
    };
    Object.defineProperty(window, "ethereum", { configurable: true, value: provider });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "MetaMask", rdns: "io.metamask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" },
    } }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, { chain });
  await install(page);
  await routeWalletBalances(page, route => route.fulfill({ json: {
    context, holder: "0x00000000000000000000000000000000000000a1",
    native: { status: "success", value: "1000000000000000000" },
    tokens: [{ id: "weth", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      balance: { status: "success", value: "1234567890123456789" } }],
  } }));
}

test("the empty swap form can open wallet connection while quotes are unavailable", async ({ page }) => {
  await install(page, "token-preview");
  await page.goto("/en");
  const connect = page.getByRole("button", { name: "Please connect your wallet", exact: true });
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(page.getByText("Connect a Wallet", { exact: true })).toBeVisible();
});

test("amount controls and wallet filter have names and visible keyboard focus", async ({ page }) => {
  await installWallet(page);
  await page.goto("/en");
  await expect(page.getByRole("switch")).not.toBeChecked();
  await selectBasket(page);
  await expect(page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true })).toBeVisible();
  await choose(page, "WETH");
  const sell = page.getByRole("textbox", { name: "Your budget WETH", exact: true });
  await expect(sell).toBeVisible();
  await expect(page.getByRole("status", { name: "You Buy CYGLD", exact: true })).toBeVisible();
  const walletFilter = page.getByRole("switch", { name: "Show only tokens available in wallet", exact: true });
  await walletFilter.focus();
  await walletFilter.press("Tab");
  await expect(sell).toBeFocused();
  await expect.poll(() => sell.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
});

test("localized currency picker supports search, arrow selection and Escape focus return", async ({ page }) => {
  await install(page);
  await page.goto("/fr");
  const trigger = page.locator('button[aria-haspopup="dialog"]').first();
  await trigger.focus();
  await trigger.press("Enter");
  const picker = page.getByRole("dialog", { name: "Choisir une devise", exact: true });
  const search = picker.getByRole("textbox", { name: "Rechercher une devise...", exact: true });
  await expect(search).toBeFocused();
  await search.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.press("Enter");
  await search.fill("  weth  ");
  await search.press("ArrowDown");
  const option = picker.getByRole("button", { name: "WETH Wrapped Ether WETH", exact: true });
  await expect(option).toBeFocused();
  await option.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText("WETH");
});

test("maximum token sell amount remains usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installWallet(page);
  await page.goto("/en");
  const walletFilter = page.getByRole("switch", { name: "Show only tokens available in wallet", exact: true });
  await expect(walletFilter).not.toBeChecked();
  await choose(page, "WETH");
  const maximum = page.getByRole("button", { name: "Use maximum sell amount", exact: true });
  await expect(maximum).toBeVisible();
  await maximum.click();
  const sell = page.getByRole("textbox", { name: "Your budget WETH", exact: true });
  await expect(sell).not.toHaveValue("");
  await expect.poll(async () => Number((await sell.inputValue()).replace(/\s/g, ""))).toBeGreaterThan(1.23);
});

test("a wallet on another network receives the actual blocked-action reason", async ({ page }) => {
  const target = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
  await installWallet(page, target === 1 ? 31337 : 1);
  await page.goto("/en");
  const swap = page.getByRole("button", { name: /^Wrong network — switch to / });
  await expect(swap).toBeVisible();
  await expect(swap).toBeDisabled();
});
