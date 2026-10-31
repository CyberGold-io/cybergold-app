import assert from "node:assert/strict";
import { expect, test } from "@playwright/test";
import { approveUntilMined } from "../trading/uiCompletion";
import { isUiCompletionDeadlineError } from "../trading/uiDiagnostics";

test.use({ actionTimeout: 0 });

for (const succeed of [true, false]) test(`original receipt recheck ${succeed ? "observes completion" : "does not treat a submitted hash as completion"}`, async ({ page }) => {
  await page.setContent('<button>Check confirmation</button><output id="count">0</output><div id="status"></div><section id="swapsection"><button>Waiting for confirmation</button></section>');
  await page.getByRole("button", { name: "Check confirmation" }).evaluate((button, succeeds) => {
    button.addEventListener("click", () => {
      document.querySelector("output")!.textContent = "1";
      if (succeeds) document.querySelector("#status")!.textContent = "Transaction confirmed";
      button.remove();
    });
  }, succeed);
  const run = approveUntilMined(page, () => true, undefined, undefined, performance.now() + 1000);
  if (succeed) await run;
  else await assert.rejects(run, isUiCompletionDeadlineError);
  await expect(page.locator("#count")).toHaveText("1");
  expect(await page.evaluate(() => "ethereum" in window)).toBe(false);
});
