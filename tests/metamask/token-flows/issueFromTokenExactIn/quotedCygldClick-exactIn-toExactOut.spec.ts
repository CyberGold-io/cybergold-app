// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../testWithMetaMask";
import { cybergoldFlowData } from "../../../test-data/cybergold-flow-data";
import { expectFeeDetails, expectQuotedAmount, getMainInput, parseAmount, setupIssueFromToken } from "../helpers";

const { tokenIn, tokenSymbol } = cybergoldFlowData.issueFromTokenExactIn;

test.describe("Issue From Token Exact In", () => {
  test("Quoted CYGLD Click: Issue From Token Exact In -> Issue From Token Exact Out", async ({ page, metamask }) => {
    await setupIssueFromToken(page, metamask, tokenSymbol);

    const sellInput = getMainInput(page, "sell");
    await sellInput.fill(tokenIn);
    await expect(sellInput).toBeEditable();

    const buyInput = getMainInput(page, "buy");
    const quotedCygldOut = await expectQuotedAmount(page, "buy");
    await expect(buyInput).toHaveJSProperty("readOnly", true);

    await page.waitForTimeout(5000);
    await buyInput.click();
    await expect(buyInput).toBeEditable();
    const editableCygldOut = parseAmount(await buyInput.inputValue());
    expect(editableCygldOut).toBeGreaterThan(0);
    expect(Math.abs(editableCygldOut - quotedCygldOut)).toBeLessThan(0.01);
    await expect(sellInput).toHaveJSProperty("readOnly", true);
    const quotedPaxgIn = await expectQuotedAmount(page, "sell");
    expect(quotedPaxgIn).toBeGreaterThan(0);
    await expectFeeDetails(page);
  });
});
