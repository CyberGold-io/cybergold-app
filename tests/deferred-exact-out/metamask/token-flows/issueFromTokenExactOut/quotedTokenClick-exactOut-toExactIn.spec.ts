// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../../../metamask/testWithMetaMask";
import { cybergoldFlowData } from "../../../../test-data/cybergold-flow-data";
import { expectQuotedAmount, expectSwapDisabled, getMainInput, setupIssueFromToken } from "../../../../metamask/token-flows/helpers";

const { cygldOut, tokenSymbol } = cybergoldFlowData.issueFromTokenExactOut;

test.describe("Issue From Token Exact Out", () => {
  test("Quoted Token Click: Issue From Token Exact Out -> Issue From Token Exact In", async ({ page, metamask }) => {
    await setupIssueFromToken(page, metamask, tokenSymbol);

    const buyInput = getMainInput(page, "buy");
    await buyInput.click();
    await buyInput.fill(cygldOut);
    await expect(buyInput).toBeEditable();

    const sellInput = getMainInput(page, "sell");
    await expectQuotedAmount(page, "sell");
    await expect(sellInput).toHaveJSProperty("readOnly", true);

    await page.waitForTimeout(5000);
    await sellInput.click();
    await expect(sellInput).toBeEditable();
    await expect(buyInput).toHaveJSProperty("readOnly", true);
    await expectSwapDisabled(page);
  });
});
