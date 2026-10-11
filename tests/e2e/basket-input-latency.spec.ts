import { selectBasket } from "./fixtures/swap-selection";
import { expect, test } from "./fixtures/app-test";
import { mkdirSync, writeFileSync } from "node:fs";
import { install } from "./fixtures/basket-quotes";

const modes = ["issue-exact-in", "issue-exact-out", "redeem-exact-in", "redeem-exact-out"];
const records: unknown[] = [];
test.afterAll(() => {
  if (!process.env.QUOTE_EVALUATION_DIR) return;
  mkdirSync(process.env.QUOTE_EVALUATION_DIR, { recursive: true });
  writeFileSync(`${process.env.QUOTE_EVALUATION_DIR}/basket-selected-browser.json`, JSON.stringify({
    scope: "Disconnected Chromium with a controlled 250ms API response; three edits 40ms apart. No live RPC latency claim.",
    samples: records,
  }, null, 2));
});

for (let repeat = 1; repeat <= 3; repeat++) for (const mode of modes) {
  test(`${repeat} ${mode}: edited Basket intent and cached revisit`, async ({ page }) => {
    const observed = await install(page, false, false, undefined, 250);
    await page.goto("/en");
    await selectBasket(page);
    if (mode.startsWith("redeem")) await page.getByRole("button", { name: "Reverse swap direction" }).click();
    if (mode === "redeem-exact-out") await page.getByRole("button", { name: /^Basket assets/ }).click();
    const inputs = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)');
    const input = mode.endsWith("exact-in") ? inputs.first() : inputs.last();
    await input.click();
    const measure = async (values: string[]) => {
      const offset = observed.timings.length;
      let lastEditAt = Date.now();
      for (let i = 0; i < values.length; i++) {
        lastEditAt = Date.now();
        await input.fill(values[i]);
        if (i < values.length - 1) await page.waitForTimeout(40);
      }
      await page.waitForTimeout(450);
      await expect.poll(() => observed.timings.slice(offset).every(row => row.completedAt !== undefined)).toBe(true);
      const rows = observed.timings.slice(offset).filter(row => row.mode === mode);
      return { requests: rows.length,
        responseAfterLastEditMs: rows.length ? rows.at(-1)!.completedAt! - lastEditAt : null,
        displayedInputs: await inputs.evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value)) };
    };
    const rapid = await measure(["1", "12", "123"]);
    expect(rapid.requests).toBe(3);
    const single = await measure(["456"]);
    expect(single.requests).toBe(1);
    const revisit = await measure(["123"]);
    expect(revisit.requests).toBe(0);
    expect(revisit.displayedInputs).toEqual(rapid.displayedInputs);
    records.push({ repeat, mode, rapid, single, revisit });
  });
}

for (const mode of ["issue-exact-out", "redeem-exact-in"]) {
  test(`${mode}: request starts without advancing the input timer`, async ({ page }) => {
    const observed = await install(page);
    await page.goto("/en");
    await selectBasket(page);
    if (mode.startsWith("redeem")) await page.getByRole("button", { name: "Reverse swap direction" }).click();
    const input = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)')[mode.endsWith("exact-in") ? "first" : "last"]();
    await input.click();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    await input.fill("789");
    await expect.poll(() => observed.previews).toContain(mode);
  });
}
