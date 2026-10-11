// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../testWithMetaMask";
import { cybergoldFlowData } from "../../../test-data/cybergold-flow-data";
import {
  clickReverseSwapDirection,
  ensureMainInputEditable,
  expectFeeDetails,
  expectQuotedAmount,
  getMainInput,
  getTokenButton,
  setupRedeemToToken,
} from "../helpers";

const { cygldIn, tokenSymbol } = cybergoldFlowData.redeemToTokenExactIn;

test.describe("Redeem To Token Exact In", () => {
  test("Middle Toggle: Redeem To Token Exact In -> Issue From Token Exact Out", async ({ page, metamask }) => {
    await setupRedeemToToken(page, metamask, tokenSymbol);

    const sellInput = await ensureMainInputEditable(page, "sell");
    await sellInput.fill(cygldIn);
    await expectQuotedAmount(page, "buy");

    await clickReverseSwapDirection(page);

    await expect(getTokenButton(page, "sell", tokenSymbol)).toBeVisible();
    await expect(getTokenButton(page, "buy", "CYGLD")).toBeVisible();

    const buyInput = getMainInput(page, "buy");
    await expect(buyInput).toBeEditable();
    await expect(buyInput).toHaveValue(cygldIn);

    const newSellInput = getMainInput(page, "sell");
    await expect(newSellInput).toHaveJSProperty("readOnly", true);
    await expectQuotedAmount(page, "sell");
    await expectFeeDetails(page);
  });
});
