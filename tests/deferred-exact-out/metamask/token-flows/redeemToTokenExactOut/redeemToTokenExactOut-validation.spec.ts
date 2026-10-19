// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../../../metamask/testWithMetaMask";
import { cybergoldFlowData } from "../../../../test-data/cybergold-flow-data";
import {
  expectQuotedAmount,
  expectSwapDisabled,
  getMainInput,
  parseAmount,
  setupRedeemToToken,
} from "../../../../metamask/token-flows/helpers";

const { tokenOut, tokenSymbol } = cybergoldFlowData.redeemToTokenExactOut;

test.describe("Redeem To Token Exact Out", () => {
  test("Quote fails when requested token output is impossible or too small", async ({ page, metamask }) => {
    await setupRedeemToToken(page, metamask, tokenSymbol);

    const buyInput = getMainInput(page, "buy");
    await buyInput.click();
    await buyInput.fill("1000000");
    expect(parseAmount(await buyInput.inputValue())).toBe(1000000);
    await expectSwapDisabled(page);
    await page.waitForTimeout(5000);

    await buyInput.fill("0.000001");
    await expect(buyInput).toHaveValue("0.000001");
    await expectSwapDisabled(page);

    await buyInput.fill(tokenOut);
    await expect(buyInput).toHaveValue(tokenOut);
    await expectQuotedAmount(page, "sell");
  });
});
