import { expect, test, type Locator, type Page } from "./fixtures/app-test";
import { install } from "./fixtures/token-quotes";
import { selectBasket } from "./fixtures/swap-selection";
import { openNavbarSettings } from "./fixtures/navbar-settings";

const input = (page: Page) => page.locator('#sell-amount:visible');
async function select(amount: Locator, start: number, end = start) {
  await amount.evaluate((element, range) => {
    const field = element as HTMLInputElement;
    field.focus(); field.setSelectionRange(range[0], range[1]);
  }, [start, end]);
}
async function caret(amount: Locator) {
  return amount.evaluate(element => (element as HTMLInputElement).selectionStart);
}
async function paste(page: Page, text: string) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(text => navigator.clipboard.writeText(text), text);
  await page.keyboard.press("ControlOrMeta+V");
}

for (const [locale, formatted, grouped] of [
  ["en", "12,345.67", "1,234"], ["fr", "12\u202f345,67", "1\u202f234"], ["de", "12.345,67", "1.234"],
] as const) {
  test(`${locale}: typing and paste keep grouping decorative and the amount exact`, async ({ page }) => {
    const observed = await install(page);
    await page.goto(`/${locale}`);
    const amount = input(page);
    await expect(amount).toBeFocused();
    await page.keyboard.type("12345.67");
    await expect(amount).toHaveValue(formatted);
    await expect.poll(() => observed.intents.at(-1)?.amount).toBe("12345670000000000000000");
    await select(amount, 0, formatted.length);
    await paste(page, formatted);
    await expect(amount).toHaveValue(formatted);
    await expect.poll(() => observed.intents.at(-1)?.amount).toBe("12345670000000000000000");
    await select(amount, 0, formatted.length);
    await paste(page, grouped);
    await expect(amount).toHaveValue(grouped);
    await expect.poll(() => observed.intents.at(-1)?.amount).toBe("1234000000000000000000");
    await select(amount, 0, grouped.length);
    await page.keyboard.type("12,34");
    await expect(amount).toHaveValue(locale === "en" ? "12.34" : "12,34");
    await expect.poll(() => observed.intents.at(-1)?.amount).toBe("12340000000000000000");
    await select(amount, 0, 5);
    await page.keyboard.press("ControlOrMeta+C");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(locale === "en" ? "12.34" : "12,34");
  });
}

test("arrow keys, mid-number edits, deletion, selection, copy and cut ignore grouping", async ({ page }) => {
  await install(page);
  await page.goto("/en");
  const amount = input(page);
  await amount.fill("12345.67");
  await expect(amount).toHaveValue("12,345.67");
  await select(amount, 2);
  await page.keyboard.press("ArrowRight");
  expect(await caret(amount)).toBe(4);
  await page.keyboard.press("ArrowLeft");
  expect(await caret(amount)).toBe(2);
  await page.keyboard.press("ArrowLeft");
  expect(await caret(amount)).toBe(1);
  await select(amount, 3);
  await page.keyboard.press("Backspace");
  await expect(amount).toHaveValue("1,345.67");
  expect(await caret(amount)).toBe(1);
  await amount.fill("12345.67");
  await select(amount, 2);
  await page.keyboard.press("Delete");
  await expect(amount).toHaveValue("1,245.67");
  await amount.fill("1234567");
  await select(amount, 3);
  await page.keyboard.type("9");
  await expect(amount).toHaveValue("12,934,567");
  expect(await caret(amount)).toBe(4);
  await amount.fill("12345.67");
  await select(amount, 3, 6);
  await paste(page, "9");
  await expect(amount).toHaveValue("129.67");

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await amount.fill("12345.6700");
  await select(amount, 0, 11);
  await page.keyboard.press("ControlOrMeta+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("12345.6700");
  await page.keyboard.press("ControlOrMeta+X");
  await expect(amount).toHaveValue("");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("12345.6700");
});

test("decimal separators can be deleted and paste preserves fractional zeros and full precision", async ({ page }) => {
  const observed = await install(page);
  await page.goto("/de");
  const amount = input(page);
  await amount.fill("12345.67");
  await select(amount, 7);
  await page.keyboard.press("Backspace");
  await expect(amount).toHaveValue("1.234.567");
  await amount.fill("1.25");
  await select(amount, 3);
  await paste(page, "00");
  await expect(amount).toHaveValue("1,2005");
  await select(amount, 0, 6);
  await paste(page, "9,007,199,254,740,993.123456789012345678");
  await expect(amount).toHaveValue("9.007.199.254.740.993,123456789012345678");
  await expect.poll(() => observed.intents.at(-1)?.amount).toBe("9007199254740993123456789012345678");
});

test("language changes and reload retain the amount while updating both separators", async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en");
  await input(page).fill("12345.67");
  await expect.poll(() => observed.intents.at(-1)?.amount).toBe("12345670000000000000000");
  const settings = await openNavbarSettings(page, "locale");
  await settings.getByRole("button", { name: "German", exact: true }).click();
  await expect(page).toHaveURL(/\/de$/);
  await expect(input(page)).toHaveValue("12.345,67");
  await page.reload();
  await expect(input(page)).toHaveValue("12.345,67");
  await expect.poll(() => observed.intents.at(-1)?.amount).toBe("12345670000000000000000");
});

test("basket component inputs share locale editing and clipboard behavior", async ({ page }) => {
  await install(page);
  await page.goto("/en");
  await selectBasket(page);
  const amount = page.locator('[data-trade-basket="sell"] input:visible').first();
  await amount.fill("12345.67");
  await expect(amount).toHaveValue("12,345.67");
  await select(amount, 3);
  await page.keyboard.press("Backspace");
  await expect(amount).toHaveValue("1,345.67");
  await select(amount, 0, 8);
  await paste(page, "12,345.67");
  await expect(amount).toHaveValue("12,345.67");
});

for (const basket of [false, true]) test(`cached ${basket ? "basket" : "main"} input keeps editing semantics before hydration`, async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en");
  if (basket) await selectBasket(page);
  const liveAmount = basket ? page.locator('[data-trade-basket="sell"] input:visible').first() : input(page);
  await liveAmount.fill("12345.67");
  await expect(liveAmount).toHaveValue("12,345.67");
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage)
    .some(key => key.startsWith("cybergold:trade-display:v1:")))).toBe(true);
  let releaseScripts!: () => void;
  const scriptsHeld = new Promise<void>(resolve => { releaseScripts = resolve; });
  await page.route("**/_next/static/**/*.js", async route => { await scriptsHeld; await route.continue(); });
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    const cached = page.locator('[data-trade-cached]');
    const amount = basket ? cached.locator('[data-trade-basket="sell"] input:visible').first()
      : cached.locator('input[data-trade-display="sellAmount"]');
    await expect(amount).toBeVisible();
    await select(amount, 0, 9);
    await page.keyboard.type("12345,67");
    await expect(amount).toHaveValue("12,345.67");
    await select(amount, 3);
    await page.keyboard.press("Backspace");
    await expect(amount).toHaveValue("1,345.67");
    await select(amount, 0, 8);
    await paste(page, "12,345.67");
    await expect(amount).toHaveValue("12,345.67");
    await select(amount, 0, 9);
    await page.keyboard.press("ControlOrMeta+C");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("12345.67");
    releaseScripts();
    await page.unroute("**/_next/static/**/*.js");
    await expect(page.locator('[data-trade-live]')).toBeVisible();
    const restored = basket ? page.locator('[data-trade-live] [data-trade-basket="sell"] input:visible').first() : input(page);
    await expect(restored).toHaveValue("12,345.67");
    if (!basket) await expect.poll(() => observed.intents.at(-1)?.amount).toBe("12345670000000000000000");
  } finally { releaseScripts(); }
});
