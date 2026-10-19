import { selectBasket } from "../../e2e/fixtures/swap-selection";
import { expect, test } from "../../e2e/fixtures/app-test";
import { install, asset, previewSelectors, recoverySelector, precisionSelector } from "../../e2e/fixtures/basket-quotes";

for (const precision of [0, 6, "unavailable"] as const) {
  test(`recovery quote share amounts use permanent precision through ${precision}`, async ({ page }) => {
    const observed = await install(page, false, false, precision);
    await page.goto("/en");
    await selectBasket(page);
    await page.getByRole("button", { name: "Reverse swap direction" }).click();
    await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().click();
    await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("3");
    await expect(page.getByText("Recovery shares included", { exact: true })).toBeVisible();
    const expected = precision === 6 ? "2.500001 recovery shares" : precision === 0 ? "2500001 recovery shares" : "Share amount unavailable";
    await expect(page.getByText(expected, { exact: true })).toBeVisible();
    expect(observed.precisionReads.length).toBeGreaterThan(0);
    expect(observed.precisionReads.every(value => value.toLowerCase() === asset)).toBe(true);
    expect(observed.rpcSelectors).not.toContain(precisionSelector);
  });
}

test("all four basket quote modes use the focused API", async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en");
  await selectBasket(page);
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect.poll(() => observed.previews).toContain("issue-exact-in");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last().click();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last().fill("2");
  await expect.poll(() => observed.previews).toContain("issue-exact-out");
  await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().click();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("3");
  await expect.poll(() => observed.previews).toContain("redeem-exact-in");
  await page.getByRole("button", { name: /^Basket assets/ }).click();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last().fill("4");
  await expect.poll(() => observed.previews).toContain("redeem-exact-out");
  expect(observed.recoveryReads.length).toBeGreaterThan(0);
  expect(observed.rpcSelectors).not.toContain(recoverySelector);
  expect(observed.rpcSelectors.filter(value => previewSelectors.has(value))).toEqual([]);
});

test("unavailable recovery assets cannot become an empty basket or trigger browser RPC", async ({ page }) => {
  const observed = await install(page, false, true);
  await page.goto("/en");
  await selectBasket(page);
  await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await page.getByRole("button", { name: /^Basket assets/ }).click();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last().click();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last().fill("4");
  await expect.poll(() => observed.recoveryReads.length).toBeGreaterThan(0);
  // Disconnected exact-output flows show the connect-wallet button. Observe
  // the existing rendered flow diagnostic after its query retry completes.
  await expect.poll(() => observed.diagnostics.some(row => row.operation === "quote" && row.outcome === "failed"),
    { timeout: 10_000 }).toBe(true);
  await expect(page.getByRole("button", { name: "Please connect your wallet", exact: true })).toBeEnabled();
  expect(observed.recoveryReads.length).toBeGreaterThan(0);
  expect(observed.previews).not.toContain("redeem-exact-out");
  expect(observed.rpcSelectors).not.toContain(recoverySelector);
});

test("a failed basket quote never retries through generic browser RPC", async ({ page }) => {
  const observed = await install(page, true);
  await page.goto("/en");
  await selectBasket(page);
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect.poll(() => observed.previews).toContain("issue-exact-in");
  await expect(page.getByText("Unable to reach the quote service. Retry.", { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(observed.rpcSelectors.filter(value => previewSelectors.has(value))).toEqual([]);
});
