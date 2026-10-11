// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../testWithMetaMask";
import { cybergoldFlowData } from "../../../test-data/cybergold-flow-data";
import {
  expectFeeDetails,
  expectQuotedAmount,
  getMainInput,
  readWalletBalances,
  setupIssueFromToken,
  submitSwapAndExpectSuccess,
} from "../helpers";

const { cygldOut, tokenId, tokenSymbol } = cybergoldFlowData.issueFromTokenExactOut;

test.describe("Issue From Token Exact Out", () => {
  test("User requests exact CYGLD output and app calculates required token input", async ({ page, metamask }) => {
    await setupIssueFromToken(page, metamask, tokenSymbol);

    const initialBalances = await readWalletBalances(page, [tokenId, "cygld"]);

    const buyInput = getMainInput(page, "buy");
    await buyInput.click();
    await expect(buyInput).toBeEditable();
    await buyInput.fill(cygldOut);
    await expect(buyInput).toHaveValue(cygldOut);

    const sellInput = getMainInput(page, "sell");
    await expect(sellInput).toHaveJSProperty("readOnly", true);
    const quotedTokenIn = await expectQuotedAmount(page, "sell");
    expect(initialBalances[tokenId]).toBeGreaterThanOrEqual(quotedTokenIn);

    await expectFeeDetails(page);
    await submitSwapAndExpectSuccess(page, metamask);

    const finalBalances = await readWalletBalances(page, [tokenId, "cygld"]);
    expect(finalBalances[tokenId]).toBeLessThan(initialBalances[tokenId]);
    expect(finalBalances["cygld"]).toBeGreaterThan(initialBalances["cygld"]);
  });
});
