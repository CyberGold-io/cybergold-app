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

const { cygldOut, tokenSymbol } = cybergoldFlowData.issueFromTokenExactOut;

test.describe("Issue From Token Exact Out", () => {
  test("Middle Toggle: Issue From Token Exact Out -> Redeem To Token Exact In", async ({ page, metamask }) => {
    await setupIssueFromToken(page, metamask, tokenSymbol);

    const buyInput = getMainInput(page, "buy");
    await buyInput.click();
    await buyInput.fill(cygldOut);
    await expectQuotedAmount(page, "sell");

    await clickReverseSwapDirection(page);

    await expect(getTokenButton(page, "sell", "CYGLD")).toBeVisible();
    await expect(getTokenButton(page, "buy", tokenSymbol)).toBeVisible();

    const sellInput = getMainInput(page, "sell");
    await expect(sellInput).toBeEditable();
    await expect(sellInput).toHaveValue(cygldOut);

    const newBuyInput = getMainInput(page, "buy");
    await expect(newBuyInput).toHaveJSProperty("readOnly", true);
    await expectQuotedAmount(page, "buy");
    await expectFeeDetails(page);
  });
});
