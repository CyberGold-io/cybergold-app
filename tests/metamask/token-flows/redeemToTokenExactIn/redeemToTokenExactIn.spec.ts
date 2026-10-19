// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../testWithMetaMask";
import { cybergoldFlowData } from "../../../test-data/cybergold-flow-data";
import {
  expectFeeDetails,
  expectQuotedAmount,
  ensureMainInputEditable,
  getMainInput,
  readWalletBalances,
  setupRedeemToToken,
  submitSwapAndExpectSuccess,
} from "../helpers";

const { cygldIn, tokenId, tokenSymbol } = cybergoldFlowData.redeemToTokenExactIn;

test.describe("Redeem To Token Exact In", () => {
  test("User provides exact CYGLD input and receives quoted token output", async ({ page, metamask }) => {
    await setupRedeemToToken(page, metamask, tokenSymbol);

    const initialBalances = await readWalletBalances(page, ["cygld", tokenId]);
    expect(initialBalances["cygld"]).toBeGreaterThanOrEqual(Number(cygldIn));

    const sellInput = await ensureMainInputEditable(page, "sell");
    await sellInput.fill(cygldIn);
    await expect(sellInput).toHaveValue(cygldIn);

    const buyOutput = getMainInput(page, "buy");
    await expect(buyOutput).toHaveJSProperty("tagName", "OUTPUT");
    await expect(buyOutput).toHaveJSProperty("tabIndex", -1);
    await expectQuotedAmount(page, "buy");

    await expectFeeDetails(page);
    await submitSwapAndExpectSuccess(page, metamask);

    const finalBalances = await readWalletBalances(page, ["cygld", tokenId]);
    expect(finalBalances["cygld"]).toBeLessThan(initialBalances["cygld"]);
    expect(finalBalances[tokenId]).toBeGreaterThan(initialBalances[tokenId]);
  });
});
