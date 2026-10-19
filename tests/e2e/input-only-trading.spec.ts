import { expect, test } from "./fixtures/app-test";
import { choose, install } from "./fixtures/token-quotes";
import { install as installBasket } from "./fixtures/basket-quotes";
import { selectBasket } from "./fixtures/swap-selection";

test("receive token entry remains read-only through focus typing and paste", async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en");
  await choose(page, "WETH");
  await page.locator("#sell-amount").fill("1");
  const receive = page.locator("#buy-amount");
  await expect(receive).toHaveValue("1");
  await expect(receive).toHaveAttribute("readonly", "");
  await receive.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("999");
  await receive.dispatchEvent("paste");
  await expect(receive).toHaveValue("1");
  await expect(page.locator("#sell-amount")).toHaveValue("1");
  expect(observed.intents.length).toBeGreaterThan(0);
  expect(observed.intents.every(intent => intent.mode === "issue-exact-in")).toBe(true);
  await expect(page.getByRole("button", { name: "Use maximum purchase amount", exact: true })).toHaveCount(0);
});

test("basket receive components cannot become output targets", async ({ page }) => {
  const observed = await installBasket(page);
  await page.goto("/en");
  await selectBasket(page);
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await page.locator("#sell-amount").fill("3");
  const received = page.locator('#buy-basket-composition input[readonly]').first();
  await expect(received).toBeVisible();
  const amount = await received.inputValue();
  await received.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("999");
  await received.dispatchEvent("paste");
  await expect(received).toHaveValue(amount);
  await expect(page.locator("#sell-amount")).toHaveValue("3");
  await expect(page.getByRole("button", { name: /Edit buy amount/ })).toHaveCount(0);
  expect(observed.previews).toContain("redeem-exact-in");
  expect(observed.previews.some(mode => mode.endsWith("exact-out"))).toBe(false);
});

test("direction reversal clears the spend draft and requotes only after a new input", async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en");
  await choose(page, "WETH");
  await page.locator("#sell-amount").fill("2");
  await expect(page.locator("#buy-amount")).toHaveValue("2");
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await expect(page.locator("#sell-amount")).toHaveValue("");
  await expect(page.locator("#buy-amount")).toHaveValue("");
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
  await expect(page.locator("#buy-amount")).toHaveValue("");
  await expect(page.locator("#buy-amount")).toHaveAttribute("readonly", "");
  await page.locator("#sell-amount").fill("4");
  await expect.poll(() => observed.intents.at(-1)?.mode).toBe("issue-exact-in");
  expect(observed.intents.every(intent => intent.mode.endsWith("exact-in"))).toBe(true);
});
