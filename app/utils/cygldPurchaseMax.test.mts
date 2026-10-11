import assert from "node:assert/strict";
import test from "node:test";
import { findCygldPurchaseMax, type CygldPurchaseMaxRequest } from "./cygldPurchaseMax.ts";

test("Max uses the cap quote when disconnected or when its maximum fits the wallet", async () => {
  for (const spendableInput of [undefined, 202n, 1000n]) {
    const requests: CygldPurchaseMaxRequest[] = [];
    const result = await findCygldPurchaseMax({ netCygldCap: 100n, spendableInput,
      fetchQuoteIntent: async request => {
        requests.push(request);
        return { executionAmount: request.amount, expectedInputAmount: 200n, maximumInputAmount: 202n };
      } });
    assert.deepEqual(result, { netCygldOut: 100n, expectedInputAmount: 200n, maximumInputAmount: 202n });
    assert.deepEqual(requests, [{ mode: "issue-exact-out", amount: 100n }]);
  }
});

test("wallet-limited Max leaves selected tolerance room and confirms an exact-output spending ceiling", async () => {
  const requests: CygldPurchaseMaxRequest[] = [];
  const result = await findCygldPurchaseMax({ netCygldCap: 1000n, spendableInput: 101n,
    slippageBps: 100, fetchQuoteIntent: async request => {
      requests.push(request);
      if (request.mode === "issue-exact-in") {
        return { executionAmount: request.amount * 2n, maximumInputAmount: request.amount };
      }
      const expectedInputAmount = (request.amount + 1n) / 2n;
      return { executionAmount: request.amount, expectedInputAmount,
        maximumInputAmount: (expectedInputAmount * 101n + 99n) / 100n };
    } });
  assert.deepEqual(result, { netCygldOut: 200n, expectedInputAmount: 100n, maximumInputAmount: 101n });
  assert.deepEqual(requests, [{ mode: "issue-exact-out", amount: 1000n },
    { mode: "issue-exact-in", amount: 100n }, { mode: "issue-exact-out", amount: 200n }]);
});

test("rounded per-leg ceilings or market movement trigger a smaller affordable target", async () => {
  const requests: CygldPurchaseMaxRequest[] = [];
  const result = await findCygldPurchaseMax({ netCygldCap: 100n, spendableInput: 5n,
    slippageBps: 0, fetchQuoteIntent: async request => {
      requests.push(request);
      return request.mode === "issue-exact-in"
        ? { executionAmount: 5n, maximumInputAmount: request.amount }
        : { executionAmount: request.amount, expectedInputAmount: request.amount, maximumInputAmount: request.amount + 1n };
    } });
  assert.deepEqual(result, { netCygldOut: 4n, expectedInputAmount: 4n, maximumInputAmount: 5n });
  assert.deepEqual(requests.map(r => [r.mode, r.amount]), [
    ["issue-exact-out", 100n], ["issue-exact-in", 5n], ["issue-exact-out", 5n], ["issue-exact-out", 4n],
  ]);
});

test("Max keeps wide wallet amounts and the full supported tolerance domain exact", async () => {
  const wallet = 10n ** 40n + 1n;
  for (const slippageBps of [0, 37, 100, 10_000]) {
    let observedBudget: bigint | undefined;
    const result = await findCygldPurchaseMax({ netCygldCap: wallet * 2n, spendableInput: wallet,
      slippageBps, fetchQuoteIntent: async request => {
        if (request.mode === "issue-exact-in") {
          observedBudget = request.amount;
          return { executionAmount: request.amount, maximumInputAmount: request.amount };
        }
        const maximumInputAmount = (request.amount * (10_000n + BigInt(slippageBps)) + 9_999n) / 10_000n;
        return { executionAmount: request.amount, expectedInputAmount: request.amount, maximumInputAmount };
      } });
    assert.equal(observedBudget, wallet * 10_000n / (10_000n + BigInt(slippageBps)));
    assert.equal(result!.netCygldOut, observedBudget);
    assert.ok(result!.maximumInputAmount <= wallet);
  }
});

test("zero available purchases need no quote and ordinary quote errors remain visible", async () => {
  const fetchQuoteIntent = async () => { throw new Error("supplier unavailable"); };
  assert.equal(await findCygldPurchaseMax({ netCygldCap: 0n, fetchQuoteIntent }), undefined);
  assert.equal(await findCygldPurchaseMax({ netCygldCap: 1n, spendableInput: 0n, fetchQuoteIntent }), undefined);
  await assert.rejects(findCygldPurchaseMax({ netCygldCap: 1n, fetchQuoteIntent }), /supplier unavailable/);
});
