// spec: specs/cybergold-token-flows.plan.md
// seed: tests/seed.spec.ts

import { expect, test } from "../../testWithMetaMask";
import { cybergoldFlowData } from "../../../test-data/cybergold-flow-data";
import {
  expectQuotedAmount,
  getMainInput,
  getSwapButton,
  parseAmount,
  readWalletBalances,
  setupIssueFromToken,
} from "../helpers";

const { fallbackTokenId, fallbackTokenSymbol, tokenId, tokenIn, tokenSymbol } =
  cybergoldFlowData.issueFromTokenExactIn;

function formatWalletBackedAmount(walletBalance: number, preferredAmount: string) {
  const preferred = Number(preferredAmount);
  const amount = walletBalance >= preferred ? preferred : walletBalance * 0.8;
  return amount.toFixed(8).replace(/\.?0+$/, "");
}

test.describe("Issue From Token Exact In", () => {
  test("Quote fails when token balance is insufficient", async ({ page, metamask }) => {
    const selectedTokenSymbol = await setupIssueFromToken(page, metamask, [
      tokenSymbol,
      fallbackTokenSymbol,
    ]);
    const selectedTokenId = selectedTokenSymbol === fallbackTokenSymbol ? fallbackTokenId : tokenId;

    const balances = await readWalletBalances(page, [selectedTokenId]);
    const selectedTokenBalance = balances[selectedTokenId];
    const excessiveAmount = String(Math.ceil(selectedTokenBalance + 1000));
    const walletBackedAmount = formatWalletBackedAmount(selectedTokenBalance, tokenIn);

    const sellInput = getMainInput(page, "sell");
    await sellInput.fill(excessiveAmount);
    expect(parseAmount(await sellInput.inputValue())).toBe(Number(excessiveAmount));
    await expect(page.getByText(/Amount exceeds wallet balance/i)).toBeVisible({ timeout: 30_000 });
    await expect(await getSwapButton(page)).toBeDisabled();

    await sellInput.fill(walletBackedAmount);
    await expect(sellInput).toHaveValue(walletBackedAmount);
    await expect(page.getByText(/Amount exceeds wallet balance/i)).not.toBeVisible({ timeout: 10_000 });
    await expectQuotedAmount(page, "buy");
  });
});
