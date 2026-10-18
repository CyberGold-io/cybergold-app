import { expect, test, type Page } from "./fixtures/app-test";
import { tokenDisplayCacheKey } from "../../app/utils/publicDisplayCache";
import { install } from "./fixtures/token-quotes";

const pickers = (page: Page) => page.locator('main button[aria-haspopup="dialog"]');

function hydrationErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", message => {
    if (["error", "warning"].includes(message.type()) && /hydrat|server rendered HTML|server-rendered HTML/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", error => {
    if (/hydrat/i.test(error.message)) errors.push(error.message);
  });
  return errors;
}

async function holdConfiguration(page: Page) {
  let release!: () => void, requests = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/protocol/config", async route => {
    requests++;
    await pending;
    await route.fallback();
  });
  return { release, requests: () => requests };
}

test("buy picker is enabled in server HTML and stays usable while cold configuration loads", async ({ browser, baseURL, page }) => {
  const serverContext = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const serverPage = await serverContext.newPage();
    await serverPage.goto("/en");
    await expect(pickers(serverPage)).toHaveCount(2);
    await expect(pickers(serverPage).last()).toBeEnabled();
  } finally { await serverContext.close(); }

  const errors = hydrationErrors(page);
  await install(page);
  const configuration = await holdConfiguration(page);
  try {
    await page.goto("/en");
    await expect.poll(configuration.requests).toBeGreaterThan(0);
    const buyPicker = pickers(page).last();
    await expect(buyPicker).toBeEnabled();
    await buyPicker.click();
    const dialog = page.getByRole("dialog", { name: "Choose currency", exact: true });
    await expect(dialog.getByRole("textbox", { name: "Search currency...", exact: true })).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveText("...");
    await expect(dialog.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(errors).toEqual([]);

    configuration.release();
    const wrappedEther = dialog.getByRole("button").filter({ has: page.getByText("Wrapped Ether", { exact: true }) });
    await expect(wrappedEther).toBeVisible();
    await wrappedEther.click();
    await expect(buyPicker).toContainText("WETH");
    await expect(pickers(page).first()).toContainText("CYGLD");
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { configuration.release(); }
});

test("buy picker hydrates without warnings on a warm catalog reload and opens before live configuration returns", async ({ page }) => {
  const errors = hydrationErrors(page);
  await install(page);
  await page.goto("/en");
  await pickers(page).first().click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Search currency...", exact: true }).fill("PAXG");
  await page.getByRole("dialog").getByRole("button").filter({ has: page.getByText("PAXG", { exact: true }) }).click();
  const cacheKey = tokenDisplayCacheKey(Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337));
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]")
    .some((token: { id: string }) => token.id === "weth"), cacheKey)).toBe(true);

  const configuration = await holdConfiguration(page);
  try {
    await page.reload();
    await expect.poll(configuration.requests).toBeGreaterThan(0);
    await expect(pickers(page).first()).toContainText("PAXG");
    const buyPicker = pickers(page).last();
    await expect(buyPicker).toContainText("CYGLD");
    await expect(buyPicker).toBeEnabled();
    await buyPicker.click();
    const dialog = page.getByRole("dialog", { name: "Choose currency", exact: true });
    await dialog.getByRole("textbox", { name: "Search currency...", exact: true }).fill("WETH");
    await dialog.getByRole("button").filter({ has: page.getByText("Wrapped Ether", { exact: true }) }).click();
    await expect(buyPicker).toContainText("WETH");
    await expect(pickers(page).first()).toContainText("CYGLD");
    expect(errors).toEqual([]);

    configuration.release();
    await expect(buyPicker.locator("#buy-token-label")).toHaveText("WETH");
    await expect(buyPicker).toBeEnabled();
    expect(errors).toEqual([]);
  } finally { configuration.release(); }
});
