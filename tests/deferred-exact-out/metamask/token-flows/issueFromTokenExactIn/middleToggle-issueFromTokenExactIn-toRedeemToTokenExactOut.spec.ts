// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../../../metamask/testWithMetaMask";
import { cybergoldFlowData } from "../../../../test-data/cybergold-flow-data";
import {
  clickReverseSwapDirection,
  expectFeeDetails,
  expectQuotedAmount,
  getMainInput,
  getTokenButton,
  setupIssueFromToken,
} from "../../../../metamask/token-flows/helpers";

const usdcCase = cybergoldFlowData.issueFromTokenExactIn.tokenCases.find(
  ({ tokenSymbol }) => tokenSymbol === "USDC"
);

if (!usdcCase) {
  throw new Error("USDC issue-from-token exact-in test case is required for the middle toggle spec.");
}

test.describe("Issue From Token Exact In", () => {
  test("Middle Toggle: Issue From Token Exact In -> Redeem To Token Exact Out", async ({ page, metamask }) => {
    const { tokenIn, tokenSymbol } = usdcCase;
    await setupIssueFromToken(page, metamask, tokenSymbol);

    const sellInput = getMainInput(page, "sell");
    await sellInput.fill(tokenIn);
    await expectQuotedAmount(page, "buy");

    await clickReverseSwapDirection(page);

    await expect(getTokenButton(page, "sell", "CYGLD")).toBeVisible();
    await expect(getTokenButton(page, "buy", tokenSymbol)).toBeVisible();

    const buyInput = getMainInput(page, "buy");
    await expect(buyInput).toBeEditable();
    await expect(buyInput).toHaveValue(tokenIn);

    const newSellInput = getMainInput(page, "sell");
    await expect(newSellInput).toHaveJSProperty("readOnly", true);
    await expectQuotedAmount(page, "sell");
    await expectFeeDetails(page);
  });
});
