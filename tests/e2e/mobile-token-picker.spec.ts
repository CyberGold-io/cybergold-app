import { expect, test } from "./fixtures/app-test";
import { install } from "./fixtures/token-quotes";

test.use({ isMobile: true, hasTouch: true });

for (const width of [320, 390, 844]) {
  test(`mobile token search stays readable and selection preserves the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    await install(page); await page.goto("/fr");
    const trigger = page.locator('main button[aria-haspopup="dialog"]').first();
    const viewport = () => page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1, width: window.visualViewport?.width ?? innerWidth,
      documentWidth: document.documentElement.scrollWidth, screenWidth: document.documentElement.clientWidth,
    }));
    const before = await viewport();
    await trigger.click();
    const picker = page.getByRole("dialog", { name: "Choisir une devise", exact: true });
    const search = picker.getByRole("textbox", { name: "Rechercher une devise...", exact: true });
    await expect(search).toBeFocused();
    // Readability avoids phone focus zoom; a mobile WebKit context is not a physical iPhone keyboard test.
    expect(await search.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
    const rect = await picker.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
    await search.fill("WETH");
    await picker.getByRole("button", { name: "WETH Wrapped Ether WETH", exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveText("WETH");
    const after = await viewport();
    expect(after.scale).toBe(before.scale);
    expect(after.width).toBe(before.width);
    expect(after.documentWidth).toBeLessThanOrEqual(after.screenWidth);
    await trigger.click(); await search.press("Escape");
    expect((await viewport()).scale).toBe(before.scale);
    await page.screenshot({ path: `out/audit/mobile-visibility/${width}-fr-${test.info().project.name}.png`, fullPage: true });
  });
}
