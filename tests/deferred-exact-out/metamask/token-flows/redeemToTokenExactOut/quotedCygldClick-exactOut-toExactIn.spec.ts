// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../../../metamask/testWithMetaMask";
import { cybergoldFlowData } from "../../../../test-data/cybergold-flow-data";
import { expectQuotedAmount, expectSwapDisabled, getMainInput, parseAmount, setupRedeemToToken } from "../../../../metamask/token-flows/helpers";

const { tokenOut, tokenSymbol } = cybergoldFlowData.redeemToTokenExactOut;

test.describe("Redeem To Token Exact Out", () => {
  test("Quoted CYGLD Click: Redeem To Token Exact Out -> Redeem To Token Exact In", async ({ page, metamask }) => {
    await setupRedeemToToken(page, metamask, tokenSymbol);

    const buyInput = getMainInput(page, "buy");
    await buyInput.click();
    await buyInput.fill(tokenOut);
    await expect(buyInput).toBeEditable();

    const sellInput = getMainInput(page, "sell");
    const quotedCygldIn = await expectQuotedAmount(page, "sell");
    await expect(sellInput).toHaveJSProperty("readOnly", true);

    await page.waitForTimeout(5000);
    await sellInput.click({ trial: true });
    await sellInput.click();
    await expect(sellInput).toBeEditable();
    const editableCygldIn = parseAmount(await sellInput.inputValue());
    expect(editableCygldIn).toBeGreaterThan(0);
    expect(Math.abs(editableCygldIn - quotedCygldIn)).toBeLessThan(0.01);
    await expect(buyInput).toHaveJSProperty("readOnly", true);
    await expectSwapDisabled(page);
  });
});
