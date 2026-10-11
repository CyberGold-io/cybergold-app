// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../testWithMetaMask";
import { cybergoldFlowData } from "../../../test-data/cybergold-flow-data";
import {
  expectFeeDetails,
  expectQuotedAmount,
  getMainInput,
  readWalletBalances,
  setupRedeemToToken,
  submitSwapAndExpectSuccess,
} from "../helpers";

const { tokenId, tokenOut, tokenSymbol } = cybergoldFlowData.redeemToTokenExactOut;

test.describe("Redeem To Token Exact Out", () => {
  test("User requests exact token output and app calculates required CYGLD input", async ({ page, metamask }) => {
    await setupRedeemToToken(page, metamask, tokenSymbol);

    const initialBalances = await readWalletBalances(page, ["cygld", tokenId]);

    const buyInput = getMainInput(page, "buy");
    await buyInput.click();
    await expect(buyInput).toBeEditable();
    await buyInput.fill(tokenOut);
    await expect(buyInput).toHaveValue(tokenOut);

    const sellInput = getMainInput(page, "sell");
    await expect(sellInput).toHaveJSProperty("readOnly", true);
    const quotedCygldIn = await expectQuotedAmount(page, "sell");
    expect(initialBalances["cygld"]).toBeGreaterThanOrEqual(quotedCygldIn);

    await expectFeeDetails(page);
    await submitSwapAndExpectSuccess(page, metamask);

    const finalBalances = await readWalletBalances(page, ["cygld", tokenId]);
    expect(finalBalances["cygld"]).toBeLessThan(initialBalances["cygld"]);
    expect(finalBalances[tokenId]).toBeGreaterThan(initialBalances[tokenId]);
  });
});
