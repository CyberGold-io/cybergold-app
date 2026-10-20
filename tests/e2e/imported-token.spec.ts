import { routeCoreIntent } from "./fixtures/trade-core";
import { expect, test, type Page } from "./fixtures/app-test";
import { install, context } from "./fixtures/token-quotes";

const token = "0x00000000000000000000000000000000000000ab";
const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const success = <T,>(value: T) => ({ status: "success", value });
const metadata = { context: { ...context, chainId, blockTimestamp: "1791600000" }, token: { chainId, address: token },
  metadata: { name: success("Imported sample"), symbol: success("NEW"), decimals: success(6) },
  authorization: { kind: "unknown", confidence: "unknown" } };

async function observeWallet(page: Page) {
  const holder = "0x00000000000000000000000000000000000000a1";
  await page.addInitScript(({ holder, chainId }) => {
    const provider = { isMetaMask: true, selectedAddress: holder,
      request: async ({ method }: { method: string }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [holder];
        if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
        if (method === "net_version") return String(chainId);
        throw new Error(`Synthetic import wallet rejects ${method}`);
      }, on: () => {}, removeListener: () => {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  }, { holder, chainId });
  await page.route("**/api/account/wallet-balances*", route => route.fulfill({ json: {
    context: metadata.context, holder, native: success("0"), tokens: (["cygld", "paxg", "xaut", "usdt", "usdc", "weth"]).map(id => ({ id, address: holder, balance: success("0") })),
  } }));
  return holder;
}

async function importSelected(page: Page, address = token) {
  const trigger = page.locator('main button[aria-haspopup="dialog"]').first();
  await trigger.click(); const picker = page.getByRole("dialog");
  await picker.getByRole("textbox").fill(address);
  await picker.getByRole("button", { name: "NEW Imported sample NEW", exact: true }).click();
  await expect(trigger).toHaveText("NEW"); await expect(trigger).toBeFocused();
}

test("imported address quotes with its own precision and retains selection across language navigation", async ({ page }) => {
  const observed = await install(page); let imports = 0;
  await page.route("**/api/tokens/metadata*", route => { imports++; return route.fulfill({ json: metadata }); });
  await page.goto("/en"); await importSelected(page, token.replace(/ab$/, "aB"));
  const amount = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
  await amount.fill("1.234567");
  await expect.poll(() => observed.intents.at(-1)?.amount).toBe("1234567");
  expect(observed.intents.at(-1)?.token.toLowerCase()).toBe(token);
  await amount.fill("2.345678"); await expect.poll(() => observed.intents.at(-1)?.amount).toBe("2345678");
  expect(imports).toBe(1); expect(observed.rpcSelectors).toEqual([]);
  await page.goto("/fr");
  await expect(page.locator('main button[aria-haspopup="dialog"]').first()).toHaveText("NEW");
  await expect(page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first()).toHaveValue("2,345678");
  expect(imports).toBe(1);
});

test("import unavailable precision stays unresolved and presents a localized actionable read failure", async ({ page }) => {
  await install(page);
  await page.route("**/api/tokens/metadata*", route => route.fulfill({ json: { ...metadata,
    metadata: { ...metadata.metadata, decimals: { status: "failure", error: "contract-read-failed" } } } }));
  await page.goto("/en"); await page.locator('main button[aria-haspopup="dialog"]').first().click();
  const picker = page.getByRole("dialog"); await picker.getByRole("textbox").fill(token);
  await expect(picker.getByRole("status")).toHaveText("Token precision is temporarily unavailable. Try again.");
  await expect(picker.getByRole("button", { name: /Imported sample/ })).toHaveCount(0);
});

test("import does not manufacture a liquidity route", async ({ page }) => {
  await install(page);
  await page.route("**/api/tokens/metadata*", route => route.fulfill({ json: metadata }));
  await routeCoreIntent(page, route => route.fulfill({ contentType: "application/x-ndjson",
    body: JSON.stringify({ type: "error", code: "quote-no-route", error: "No route", correlationId: "fixture" }) + "\n" }));
  await page.goto("/en"); await importSelected(page);
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect(page.getByText("No exchange route is available for this amount.", { exact: true })).toBeVisible();
});

test("mobile imported-token selection remains within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await install(page);
  await page.route("**/api/tokens/metadata*", route => route.fulfill({ json: metadata }));
  await page.goto("/en");
  await page.locator('main button[aria-haspopup="dialog"]').first().click();
  const picker = page.getByRole("dialog"); const search = picker.getByRole("textbox");
  await search.fill(token); await expect(picker.getByRole("button", { name: /Imported sample/ })).toBeVisible();
  const rect = (await picker.boundingBox())!; expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(320);
  expect(await search.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  await picker.getByRole("button", { name: "NEW Imported sample NEW", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("imported balance and MAX retain token precision and appear in the wallet panel", async ({ page }) => {
  const observed = await install(page); const holder = await observeWallet(page); let reads = 0;
  let discoveries = 0;
  await page.route("**/api/tokens/metadata*", route => {
    reads++;
    const purpose = new URL(route.request().url()).searchParams.get("purpose");
    if (purpose !== "balance") discoveries++;
    return route.fulfill({ json: { ...metadata, holder, balance: success("1234567") } });
  });
  await page.goto("/en"); await expect(page.getByRole("switch", { name: "Show only tokens available in wallet" })).not.toBeChecked();
  await importSelected(page);
  await expect(page.getByTestId("sell-wallet-balance")).toHaveText("1.23457 NEW");
  await page.getByRole("button", { name: "Use maximum sell amount", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Your budget NEW", exact: true })).toHaveValue("1.234");
  await expect.poll(() => observed.intents.at(-1)?.amount).toBe("1234567");
  await page.getByRole("button", { name: "Open wallet menu" }).click();
  await expect(page.getByTestId(`wallet-balance-amount-${chainId}:${token}`)).toHaveText("1.235 NEW");
  const count = reads; await page.getByRole("button", { name: "Close balances", exact: true }).click();
  await page.getByRole("textbox", { name: "Your budget NEW", exact: true }).fill("0.5");
  expect(reads).toBe(count);
  expect(discoveries).toBe(1);
});

test("wallet-only import filtering retains unknown balances without presenting zero", async ({ page }) => {
  await install(page); const holder = await observeWallet(page);
  await page.route("**/api/tokens/metadata*", route => route.fulfill({ json: { ...metadata, holder, balance: { status: "failure", error: "contract-read-failed" } } }));
  await page.goto("/en"); await page.getByRole("switch", { name: "Show only tokens available in wallet" }).check();
  await page.locator('main button[aria-haspopup="dialog"]').first().click();
  const picker = page.getByRole("dialog"); await picker.getByRole("textbox").fill(token);
  await expect(picker.getByRole("status")).toHaveText("Token balance is temporarily unavailable. Try again.");
  await expect(picker.getByRole("button", { name: /Imported sample/ })).toHaveCount(0);
  await picker.getByRole("textbox").press("Escape");
  await page.getByRole("switch", { name: "Show only tokens available in wallet" }).uncheck();
  await page.locator('main button[aria-haspopup="dialog"]').first().click();
  await page.getByRole("dialog").getByRole("button", { name: "NEW Imported sample NEW", exact: true }).click();
  await expect(page.getByTestId("sell-wallet-balance")).toHaveText("... NEW");
});
