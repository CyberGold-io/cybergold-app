// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../testWithMetaMask";
import { cybergoldFlowData } from "../../../test-data/cybergold-flow-data";
import {
  clickReverseSwapDirection,
  expectFeeDetails,
  expectQuotedAmount,
  getMainInput,
  getTokenButton,
  setupRedeemToToken,
} from "../helpers";

const { tokenOut, tokenSymbol } = cybergoldFlowData.redeemToTokenExactOut;

test.describe("Redeem To Token Exact Out", () => {
  test("Middle Toggle: Redeem To Token Exact Out -> Issue From Token Exact In", async ({ page, metamask }) => {
    await setupRedeemToToken(page, metamask, tokenSymbol);

    const buyInput = getMainInput(page, "buy");
    await buyInput.click();
    await buyInput.fill(tokenOut);
    await expectQuotedAmount(page, "sell");

    await clickReverseSwapDirection(page);

    await expect(getTokenButton(page, "sell", tokenSymbol)).toBeVisible();
    await expect(getTokenButton(page, "buy", "CYGLD")).toBeVisible();

    const sellInput = getMainInput(page, "sell");
    await expect(sellInput).toBeEditable();
    await expect(sellInput).toHaveValue(tokenOut);

    const newBuyInput = getMainInput(page, "buy");
    await expect(newBuyInput).toHaveJSProperty("readOnly", true);
    await expectQuotedAmount(page, "buy");
    await expectFeeDetails(page);
  });
});
