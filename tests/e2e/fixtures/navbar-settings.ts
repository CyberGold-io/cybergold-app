import { expect, type Page } from "@playwright/test";

export async function openNavbarSettings(page: Page, group?: "currency" | "goldUnit" | "locale" | "theme") {
  const trigger = page.getByRole("button", { name: "Settings", exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  const panel = page.locator('[data-navbar-menu="settings"]');
  await expect(panel).toBeVisible();
  if (group) {
    const button = panel.locator(`[data-navbar-toggle="${group}"]`);
    // Theme is intentionally hidden in the product; these tests still exercise
    // its retained selection/persistence behavior by revealing it in the fixture.
    if (group === "theme") await button.locator("..").evaluate(element => element.removeAttribute("hidden"));
    if (await button.getAttribute("aria-expanded") !== "true") await button.click();
  }
  return panel;
}
