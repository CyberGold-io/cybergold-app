import { DEFAULT_SLIPPAGE_BPS } from "./swapPolicy.ts";

export type CygldPurchaseMaxQuote = {
  executionAmount: bigint;
  expectedInputAmount?: bigint;
  maximumInputAmount: bigint;
};

export type CygldPurchaseMaxRequest = {
  mode: "issue-exact-in" | "issue-exact-out";
  amount: bigint;
};

export type CygldPurchaseMax = {
  netCygldOut: bigint;
  expectedInputAmount: bigint;
  maximumInputAmount: bigint;
};

/** Find a capped exact-output purchase that fits the wallet's spending ceiling. */
export async function findCygldPurchaseMax({ netCygldCap, spendableInput,
  slippageBps = DEFAULT_SLIPPAGE_BPS, fetchQuoteIntent }: {
  netCygldCap: bigint;
  spendableInput?: bigint;
  slippageBps?: number;
  fetchQuoteIntent: (request: CygldPurchaseMaxRequest) => Promise<CygldPurchaseMaxQuote>;
}): Promise<CygldPurchaseMax | undefined> {
  if (netCygldCap === 0n || spendableInput === 0n) return undefined;
  const purchase = (quote: CygldPurchaseMaxQuote): CygldPurchaseMax => ({
    netCygldOut: quote.executionAmount,
    expectedInputAmount: quote.expectedInputAmount ?? quote.maximumInputAmount,
    maximumInputAmount: quote.maximumInputAmount,
  });
  const capped = await fetchQuoteIntent({ mode: "issue-exact-out", amount: netCygldCap });
  if (spendableInput === undefined || capped.maximumInputAmount <= spendableInput) {
    return purchase(capped);
  }

  // An input-budget preview does not reserve additional input for tolerance.
  // Leave that room here, then quote exact output to obtain the actual ceiling.
  const budget = spendableInput * 10_000n / (10_000n + BigInt(slippageBps));
  if (budget === 0n) return undefined;
  const estimate = await fetchQuoteIntent({ mode: "issue-exact-in", amount: budget });
  let target = estimate.executionAmount < netCygldCap ? estimate.executionAmount : netCygldCap;
  while (target > 0n) {
    const quote = await fetchQuoteIntent({ mode: "issue-exact-out", amount: target });
    if (quote.maximumInputAmount <= spendableInput) return purchase(quote);
    // Separate DEX legs round their ceilings up; reprice a smaller target when
    // that rounding or a market move consumes the wallet's remaining margin.
    const reduced = target * spendableInput / quote.maximumInputAmount;
    target = reduced < target ? reduced : target - 1n;
  }
  return undefined;
}
