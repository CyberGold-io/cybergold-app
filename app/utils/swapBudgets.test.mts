import assert from "node:assert/strict";
import test from "node:test";

import type { erc20Token } from "../config/tokens.ts";
import { computeSwapBudgetsExactIn } from "./swapBudgets.ts";

const ASSET = "0x0000000000000000000000000000000000000001";
const EXITING_ASSET = "0x0000000000000000000000000000000000000002";
const EXTERNAL_INPUT = "0x0000000000000000000000000000000000000003";

const token: erc20Token = {
  id: "asset",
  symbol: "ASSET",
  name: "Asset",
  type: "erc20",
  address: ASSET,
  decimals: 18,
};

test("exact-in budget planning accepts a one-asset basket without swap legs", () => {
  assert.deepEqual(
    computeSwapBudgetsExactIn({
      inputToken: ASSET,
      inputAmount: 1_000n,
      components: [{ token, targetWeight: 10_000n }],
    }),
    { reservedInput: 1_000n, budgets: [] }
  );
});

test("exact-in budget planning omits zero-target Exiting basket members", () => {
  const components: { token: erc20Token; targetWeight: bigint }[] = [
    { token, targetWeight: 10_000n },
    {
      token: { ...token, id: "exiting", address: EXITING_ASSET },
      targetWeight: 0n,
    },
  ];

  assert.deepEqual(
    computeSwapBudgetsExactIn({
      inputToken: EXTERNAL_INPUT,
      inputAmount: 1_000n,
      components,
    }),
    {
      reservedInput: 0n,
      budgets: [{ outputAsset: ASSET, amountIn: 1_000n }],
    }
  );
  assert.deepEqual(
    computeSwapBudgetsExactIn({
      inputToken: ASSET,
      inputAmount: 1_000n,
      components,
    }),
    { reservedInput: 1_000n, budgets: [] }
  );
});
