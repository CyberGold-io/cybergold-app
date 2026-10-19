import { selectBasket } from "./fixtures/swap-selection";
import { expect, test } from "./fixtures/app-test";
import { choose, context, install } from "./fixtures/token-quotes";

for (const symbol of ["BASKET", "WETH", "ETH", "USDC"]) {
  test(`${symbol}: gas is estimated without a wallet in input-driven purchases and redemptions`, async ({ page }) => {
    const observed = await install(page);
    let fees = 0, executionSimulations = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/transaction/helpers-execution") executionSimulations++;
    });
    await page.route("**/api/transaction/fees", route => {
      fees++;
      return route.fulfill({ json: { context, maxFeePerGas: "2000000000", maxPriorityFeePerGas: "1000000000" } });
    });
    await page.goto("/en");
    await expect(page.getByRole("button", { name: "Connect Wallet", exact: true })).toBeVisible();
    if (symbol === "BASKET") await selectBasket(page);
    else await choose(page, symbol);
    await page.getByRole("button", { name: /Total fee/ }).click();
    const gas = page.getByText("Transaction fee (gas):", { exact: true }).locator("..");
    const placeholder = () => expect(gas).toHaveText("Transaction fee (gas):...");
    await placeholder();

    const inputs = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)');
    const quoted = (mode: string) => expect.poll(() => symbol === "BASKET"
      ? observed.previews.includes(mode) : observed.intents.some(value => value.mode === mode)).toBe(true);
    await inputs.first().click(); await inputs.first().fill("0"); await placeholder();
    await inputs.first().fill("1");
    await quoted("issue-exact-in"); await expect(gas).toContainText("~ 0.00083 ETH");
    // Development Strict Mode can cancel and restart the mount fetch. Measure
    // cache reuse from the settled display; production has one mount request.
    await expect.poll(() => fees).toBeGreaterThan(0);
    const initialFees = fees;
    await inputs.first().fill("0"); await placeholder();
    await inputs.first().fill(""); await placeholder();
    await page.getByRole("button", { name: "Reverse swap direction" }).click();
    await inputs.first().click(); await inputs.first().fill("3");
    await quoted("redeem-exact-in"); await expect(gas).toContainText("~ 0.0006 ETH");
    await inputs.first().fill("0"); await placeholder();
    await inputs.first().fill(""); await placeholder();
    expect(fees).toBe(initialFees); expect(executionSimulations).toBe(0);
    await expect(page.getByRole("button", { name: "Please connect your wallet", exact: true })).toBeVisible();
  });
}

test("disconnected gas-price cache refreshes only after the head hash changes", async ({ page }) => {
  let head = { ...context }, fees = 0;
  await install(page, "", undefined, false, undefined, () => head);
  await page.route("**/api/transaction/fees", route => {
    fees++;
    return route.fulfill({ json: { context: head,
      maxFeePerGas: head.blockHash === context.blockHash ? "1000000000" : "2000000000",
      maxPriorityFeePerGas: "1" } });
  });
  await page.goto("/en"); await choose(page, "WETH");
  await page.getByRole("button", { name: /Total fee/ }).click();
  const gas = page.getByText("Transaction fee (gas):", { exact: true }).locator("..");
  await expect(gas).toHaveText("Transaction fee (gas):...");
  const edited = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
  await edited.fill("1");
  await expect(page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last()).toHaveValue("1");
  await expect(gas).toContainText("~ 0.000415 ETH");
  const initialFees = fees;
  await edited.fill("2");
  await expect(page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last()).toHaveValue("2");
  await page.clock.install(); await page.clock.runFor(60_000);
  expect(fees).toBe(initialFees);
  head = { ...head, blockHash: `0x${"b".repeat(64)}` };
  await page.clock.runFor(1_000);
  await expect.poll(async () => { await page.clock.runFor(1_000); return fees; }).toBe(initialFees + 1);
  await expect(gas).toContainText("~ 0.00083 ETH");
  await page.clock.runFor(5_000); expect(fees).toBe(initialFees + 1);
  await expect(page.getByRole("button", { name: "Please connect your wallet", exact: true })).toBeVisible();
});
