// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../testWithMetaMask";
import { cybergoldFlowData } from "../../../test-data/cybergold-flow-data";
import {
  connectMetaMaskIfNeeded,
  expectFeeDetails,
  expectQuotedAmount,
  getMainInput,
  getTokenButton,
  readWalletBalances,
  selectToken,
  showAllSellTokens,
  submitSwapAndExpectSuccess,
} from "../helpers";

const { tokenCases } = cybergoldFlowData.issueFromTokenExactIn;

test.describe("Issue From Token Exact In", () => {
  test("User issues CYGLD from PAXG, USDC, and ETH exact inputs in sequence", async ({ page, metamask }) => {
    for (const { tokenId, tokenIn, tokenSymbol } of tokenCases) {
      await page.goto("/en");
      await connectMetaMaskIfNeeded(page, metamask);
      await showAllSellTokens(page);
      await selectToken(page, "sell", tokenSymbol);
      await expect(getTokenButton(page, "sell", tokenSymbol)).toBeVisible();
      await expect(getTokenButton(page, "buy", "CYGLD")).toBeVisible();

      const initialBalances = await readWalletBalances(page, [tokenId, "cygld"]);
      expect(initialBalances[tokenId]).toBeGreaterThanOrEqual(Number(tokenIn));

      const sellInput = getMainInput(page, "sell");
      await expect(sellInput).toBeEditable();
      await sellInput.fill("");
      await sellInput.fill(tokenIn);
      await expect(sellInput).toHaveValue(tokenIn);

      const buyInput = getMainInput(page, "buy");
      await expect(buyInput).toHaveJSProperty("readOnly", true);
      await expectQuotedAmount(page, "buy");

      await expectFeeDetails(page);
      await submitSwapAndExpectSuccess(page, metamask);

      const finalBalances = await readWalletBalances(page, [tokenId, "cygld"]);
      expect(finalBalances[tokenId]).toBeLessThan(initialBalances[tokenId]);
      expect(finalBalances["cygld"]).toBeGreaterThan(initialBalances["cygld"]);
    }
  });
});
