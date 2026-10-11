import type { Address } from "viem";
import type { erc20Token } from "../config/tokens.ts";

type BasketComponent = { token: erc20Token; targetWeight: bigint};
type SwapBudget = { outputAsset: Address; amountIn: bigint };
type SwapTarget = { asset: Address; targetOut: bigint };

function splitAmountByWeights(
  totalAmount: bigint,
  weights: readonly bigint[]
): bigint[] | undefined {
  if (totalAmount <= 0n) return undefined;
  if (!weights.length) return undefined;

  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  if (totalWeight <= 0n) return undefined;

  const amounts: bigint[] = [];
  let allocated = 0n;
  for (let i = 0; i < weights.length; i++) {
    const isLast = i === weights.length - 1;
    const amount = isLast ? totalAmount - allocated : (totalAmount * weights[i]) / totalWeight;
    allocated += amount;
    amounts.push(amount);
  }
  return amounts;
}

// Allocating the input token amount across the basket components, proportional to their weights in the basket:
export function computeSwapBudgetsExactIn(params: {
  inputToken: Address;
  inputAmount: bigint;
  components: readonly BasketComponent[];
}): { reservedInput: bigint; budgets: SwapBudget[] } | undefined {
  
const { inputToken, inputAmount, components } = params;

  if (inputAmount <= 0n) return undefined;
  if (!components.length) return undefined;

  // Checking if the input token belongs to the basket:
  const inputTokenIndex = components.findIndex(
    (component) => component.token.address.toLowerCase() === inputToken.toLowerCase()
  );

  const weights = components.map((c) => c.targetWeight ?? 0n); // obtaining an array of weights, defaulting to 0 if not defined
  const positiveComponents = components
    .map((component, index) => ({ component, index, weight: weights[index] }))
    .filter(({ weight }) => weight > 0n);
  if (!positiveComponents.length) return undefined;

  // ---- Case A: input token NOT in basket -> we need to allocate 100% of input amount across all assets
  if (inputTokenIndex === -1) {
    const allocated = splitAmountByWeights(
      inputAmount,
      positiveComponents.map(({ weight }) => weight)
    );
    if (!allocated) return undefined;
    const budgets = allocated.map((amountIn, i) => ({
      outputAsset: positiveComponents[i].component.token.address,
      amountIn,
    }));
    if (budgets.some((budget) => budget.amountIn <= 0n)) return undefined; // quote.amountIn must be > 0
    const totalAllocated = budgets.reduce((sum, budget) => sum + budget.amountIn, 0n);
    if (totalAllocated > inputAmount) return undefined; // total allocation ≤ inputAmount

    return { reservedInput: 0n, budgets };
  }

  // ---- Case B: input token IS in basket -> calculate amount for this token, the rest - allocate accross other components
  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  if (totalWeight <= 0n) return undefined;
  const inputTokenWeight = weights[inputTokenIndex];
  const reservedInput = (inputAmount * inputTokenWeight) / totalWeight; // portion of input amount for the input token itself, as a part of the basket.
  const remainingAmount = inputAmount - reservedInput; // amuont to allocate among other basket components

  const remainingWeights = totalWeight - inputTokenWeight;
  // If basket has only the input asset, nothing to swap
  if (remainingWeights <= 0n) return { reservedInput, budgets: [] };

  const remainingBasketComponents = components
    .map((component, index) => ({ asset: component.token.address, w: weights[index], i: index }))
    .filter((x) => x.i !== inputTokenIndex && x.w > 0n); // exclude the direct input and zero-target lifecycle members

  const allocatedRemaining = splitAmountByWeights(
    remainingAmount,
    remainingBasketComponents.map((x) => x.w)
  );
  if (!allocatedRemaining) return undefined;
  const budgets = remainingBasketComponents.map((component, index) => ({
    outputAsset: component.asset,
    amountIn: allocatedRemaining[index],
  }));
  if (budgets.some((budget) => budget.amountIn <= 0n)) return undefined; // quote.amountIn must be > 0
  const totalAllocated = budgets.reduce((sum, budget) => sum + budget.amountIn, 0n);
  if (totalAllocated > inputAmount) return undefined; // total allocation ≤ inputAmount

  // sum(budgets) == remaining by construction
  return { reservedInput, budgets };
}

export function computeSwapBudgetsExactOut(params: {
  outputToken: Address;
  outputAmount: bigint;
  components: readonly BasketComponent[];
}): { directOutput: bigint; targets: SwapTarget[] } | undefined {
  const { outputToken, outputAmount, components } = params;

  if (outputAmount <= 0n) return undefined;
  if (!components.length) return undefined;

  // Checking if the output token belongs to the basket:
  const outputTokenIndex = components.findIndex(
    (component) => component.token.address.toLowerCase() === outputToken.toLowerCase()
  );
  const weights = components.map((component) => component.targetWeight ?? 0n);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight <= 0n) return undefined;

  // ---- Case A: output token NOT in basket -> we need to allocate 100% of output amount across all assets
  if (outputTokenIndex === -1) {
    const allocated = splitAmountByWeights(outputAmount, weights);
    if (!allocated) return undefined;
    const targets = components.map((component, index) => ({
      asset: component.token.address as Address,
      targetOut: allocated[index],
    }));
    return { directOutput: 0n, targets };
  }

  // ---- Case B: output token IS in basket -> we need to allocate to it a non-swap portion corresponding to its weight
  const outputTokenWeight = weights[outputTokenIndex];
  const directOutput = (outputAmount * outputTokenWeight) / totalWeight;
  const remainingOutput = outputAmount - directOutput; // the remaining output amount needs to be allocated among other basket tokens 
  const remainingWeight = totalWeight - outputTokenWeight;

  if (remainingWeight <= 0n) {
    return {
      directOutput,
      targets: [{ asset: components[outputTokenIndex].token.address as Address, targetOut: directOutput }],
    };
  }

  const remainingComponents = components
    .map((component, index) => ({
      asset: component.token.address as Address,
      weight: weights[index],
      index,
    }))
    .filter((component) => component.index !== outputTokenIndex);

  const allocatedRemaining = splitAmountByWeights(
    remainingOutput,
    remainingComponents.map((component) => component.weight)
  );
  if (!allocatedRemaining) return undefined;

  let remainingIndex = 0;
  const targets = components.map((component, index) => {
    if (index === outputTokenIndex) {
      return { asset: component.token.address as Address, targetOut: directOutput };
    }
    const targetOut = allocatedRemaining[remainingIndex] ?? 0n;
    remainingIndex += 1;
    return { asset: component.token.address as Address, targetOut };
  });

  return { directOutput, targets };
}
