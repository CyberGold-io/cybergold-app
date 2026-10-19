import { expect, test, type Locator, type Page } from "./fixtures/app-test";
import { choose, install } from "./fixtures/token-quotes";
import { install as installBasket } from "./fixtures/basket-quotes";
import { selectBasket } from "./fixtures/swap-selection";

async function selectAndCopyAmount(page: Page, amount: Locator) {
  const displayed = (await amount.textContent())!.trim();
  await expect(amount).toHaveJSProperty("tagName", "OUTPUT");
  await expect(amount).toHaveJSProperty("tabIndex", -1);
  await expect(amount).toHaveJSProperty("isContentEditable", false);
  await expect(amount).toHaveCSS("user-select", "text");
  await expect(amount).toHaveCSS("border-top-width", "0px");
  await expect(amount).toHaveCSS("outline-style", "none");
  await amount.scrollIntoViewIfNeeded();
  const bounds = await amount.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rectangle = range.getBoundingClientRect();
    return { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height };
  });
  await page.mouse.move(bounds.x - 1, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width + 1, bounds.y + bounds.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(displayed);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.keyboard.press("ControlOrMeta+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(displayed);
  await expect(amount).not.toBeFocused();
  return displayed;
}

test("receive token amount is selectable copyable text without an editing control", async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en");
  await choose(page, "WETH");
  await page.locator("#sell-amount").fill("1");
  const receive = page.locator("#buy-amount");
  await expect(receive).toHaveText("1");
  await expect(receive).toHaveAccessibleName("You Buy CYGLD");
  await receive.evaluate(element => (element as HTMLElement).focus());
  await expect(page.locator("#sell-amount")).toBeFocused();
  await receive.click();
  await expect(receive).not.toBeFocused();
  expect(await selectAndCopyAmount(page, receive)).toBe("1");
  await expect(receive).toHaveText("1");
  await expect(page.locator("#sell-amount")).toHaveValue("1");
  expect(observed.intents.length).toBeGreaterThan(0);
  expect(observed.intents.every(intent => intent.mode === "issue-exact-in")).toBe(true);
  await expect(page.getByRole("button", { name: "Use maximum purchase amount", exact: true })).toHaveCount(0);
});

test("basket receive components cannot become output targets", async ({ page }) => {
  const observed = await installBasket(page);
  await page.goto("/en");
  await selectBasket(page);
  const driver = page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true });
  await driver.fill("1");
  await expect.poll(() => observed.previews).toContain("issue-exact-in");
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await expect(page.locator("#sell-amount")).toHaveValue("");
  await expect(page.locator("#sell-amount")).toBeFocused();
  await page.locator("#sell-amount").fill("3");
  const received = page.locator('#buy-basket-composition output').first();
  await expect(received).toBeVisible();
  await expect.poll(() => observed.previews).toContain("redeem-exact-in");
  await expect(received).not.toHaveAttribute("aria-busy", "true");
  await expect(received).toHaveAccessibleName("Buy amount (PAXG)");
  await received.click();
  await expect(received).not.toBeFocused();
  const amount = await selectAndCopyAmount(page, received);
  await expect(received).toHaveText(amount);
  await expect(page.locator("#sell-amount")).toHaveValue("3");
  await expect(page.getByRole("button", { name: /Edit buy amount/ })).toHaveCount(0);
  expect(observed.previews).toContain("redeem-exact-in");
  expect(observed.previews.some(mode => mode.endsWith("exact-out"))).toBe(false);
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await expect(driver).toHaveValue("");
  await expect(driver).toBeFocused();
  await expect(page.locator("#buy-amount")).toHaveText(/^0(?:[.,]0+)?$/);
});

test("direction reversal clears the spend draft and requotes only after a new input", async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en");
  await choose(page, "WETH");
  await page.locator("#sell-amount").fill("2");
  await expect(page.locator("#buy-amount")).toHaveText("2");
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await expect(page.locator("#sell-amount")).toHaveValue("");
  await expect(page.locator("#buy-amount")).toHaveText(/^0(?:[.,]0+)?$/);
  await expect(page.locator("#sell-amount")).toBeFocused();
  await page.locator("#sell-amount").fill("3");
  await expect.poll(() => observed.intents.at(-1)?.mode).toBe("redeem-exact-in");
  expect(observed.intents.every(intent => intent.mode.endsWith("exact-in"))).toBe(true);
});

test("a legacy output-driven session cannot reinterpret received units as spending units", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("cg:swap-form-state:v1", JSON.stringify({
    isSellInputEnabled: false, sellTokenId: "weth", buyTokenId: "cygld", sellAmount: "50", buyAmount: "777",
    driverToken: "0x45804880De22913dAFE09f4980848ECE6EcbAf78", driverAmountStr: "100", showOnlyWalletTokens: false,
  })));
  const observed = await install(page);
  await page.goto("/en");
  await expect(page.locator("#sell-amount")).toHaveValue("");
  await expect(page.locator("#buy-amount")).toHaveText(/^0(?:[.,]0+)?$/);
  await expect(page.locator("#buy-amount")).toHaveJSProperty("tagName", "OUTPUT");
  await page.locator("#sell-amount").fill("4");
  await expect.poll(() => observed.intents.at(-1)?.mode).toBe("issue-exact-in");
  expect(observed.intents.every(intent => intent.mode.endsWith("exact-in"))).toBe(true);
});
