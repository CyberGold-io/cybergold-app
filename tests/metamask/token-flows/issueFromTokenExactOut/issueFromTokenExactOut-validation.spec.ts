// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../testWithMetaMask";
import { cybergoldFlowData } from "../../../test-data/cybergold-flow-data";
import {
  expectQuotedAmount,
  expectSwapDisabled,
  getMainInput,
  parseAmount,
  setupIssueFromToken,
} from "../helpers";

const { cygldOut, tokenSymbol } = cybergoldFlowData.issueFromTokenExactOut;

test.describe("Issue From Token Exact Out", () => {
  test("Quote fails when calculated token input would exceed wallet balance", async ({ page, metamask }) => {
    await setupIssueFromToken(page, metamask, tokenSymbol);

    const buyInput = getMainInput(page, "buy");
    await buyInput.click();
    await buyInput.fill("1000000");
    expect(parseAmount(await buyInput.inputValue())).toBe(1000000);
    await expectSwapDisabled(page);
    await page.waitForTimeout(5000);

    await buyInput.fill(cygldOut);
    await expect(buyInput).toHaveValue(cygldOut);
    await expectQuotedAmount(page, "sell");
  });
});
