// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../../../metamask/testWithMetaMask";
import { cybergoldFlowData } from "../../../../test-data/cybergold-flow-data";
import {
  ensureMainInputEditable,
  expectQuotedAmount,
  expectSwapDisabled,
  getMainInput,
  parseAmount,
  setupRedeemToToken,
} from "../../../../metamask/token-flows/helpers";

const { cygldIn, tokenSymbol } = cybergoldFlowData.redeemToTokenExactIn;

test.describe("Redeem To Token Exact In", () => {
  test("Quoted Token Click: Redeem To Token Exact In -> Redeem To Token Exact Out", async ({ page, metamask }) => {
    await setupRedeemToToken(page, metamask, tokenSymbol);

    const sellInput = await ensureMainInputEditable(page, "sell");
    await sellInput.fill(cygldIn);

    const buyInput = getMainInput(page, "buy");
    const quotedTokenOut = await expectQuotedAmount(page, "buy");
    await expect(buyInput).toHaveJSProperty("readOnly", true);

    await page.waitForTimeout(5000);
    await buyInput.click({ trial: true });
    await buyInput.click();
    await expect(buyInput).toBeEditable();
    const editableTokenOut = parseAmount(await buyInput.inputValue());
    expect(editableTokenOut).toBeGreaterThan(0);
    expect(Math.abs(editableTokenOut - quotedTokenOut)).toBeLessThan(0.01);
    await expect(sellInput).toHaveJSProperty("readOnly", true);
    await expectSwapDisabled(page);
  });
});
