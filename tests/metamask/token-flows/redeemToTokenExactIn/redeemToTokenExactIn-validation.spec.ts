// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../testWithMetaMask";
import { cybergoldFlowData } from "../../../test-data/cybergold-flow-data";
import {
  ensureMainInputEditable,
  expectQuotedAmount,
  expectSwapDisabled,
  parseAmount,
  setupRedeemToToken,
} from "../helpers";

const { cygldIn, tokenSymbol } = cybergoldFlowData.redeemToTokenExactIn;

test.describe("Redeem To Token Exact In", () => {
  test("Quote fails with zero or invalid CYGLD input", async ({ page, metamask }) => {
    await setupRedeemToToken(page, metamask, tokenSymbol);

    const sellInput = await ensureMainInputEditable(page, "sell");
    await expectSwapDisabled(page);

    await sellInput.fill("0");
    await expect(sellInput).toHaveValue("0");
    await expectSwapDisabled(page, /Enter|amount|swap/i);

    await sellInput.fill("1000000");
    expect(parseAmount(await sellInput.inputValue())).toBe(1000000);
    await expectSwapDisabled(page);
    await page.waitForTimeout(5000);

    await sellInput.fill(cygldIn);
    await expect(sellInput).toHaveValue(cygldIn);
    await expectQuotedAmount(page, "buy");
  });
});
