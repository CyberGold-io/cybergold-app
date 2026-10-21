import { readFileSync } from "node:fs";
import { decodeFunctionData, decodeAbiParameters, encodeAbiParameters } from "viem";
import { HELPERS_TRADE_EXACT_INPUT_ABI } from "../contracts/generated/helpersTradeExactInput.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { zeroAddress, zeroHash, type Address } from "viem";
import { exactInputFunding, exactInputNativeValue, exactInputPermissions, exactInputPlan,
  fetchUniversalExactInputQuote, retainedInputCharges } from "./universalExactInput.ts";

const token = "0x0000000000000000000000000000000000000001" as Address;
const helpers = "0x0000000000000000000000000000000000000002" as Address;
const emptyPermit = { value: 0n, deadline: 0n, v: 0, r: zeroHash, s: zeroHash };
const permit2 = { permit: { permitted: [{ token, amount: 9n }], nonce: 3n, deadline: 100n }, signature: "0x1234" as const };

test("native transaction value and ERC20 permissions follow exact acquired physical currencies losslessly", () => {
  const amount = 2n ** 200n;
  const plan = exactInputPlan({ intent: 0, inputs: [{ currency: zeroAddress, amount: String(amount) }],
    outputCurrency: token, recipient: helpers, deadline: "2000000000", minimumOutput: "9", body: "0x1234" });
  assert.equal(exactInputNativeValue(plan), amount);
  assert.deepEqual(exactInputPermissions(plan), []);
  assert.equal(plan.minimumOutput, 9n);
  assert.equal(exactInputNativeValue({ ...plan, inputs: [{ currency: token, amount }] }), 0n);
  assert.deepEqual(exactInputPermissions({ ...plan, inputs: [{ currency: token, amount }] }), [{ token, amount }]);
});

test("native authorization placeholders do not shift the compact ERC20 or Permit2 subset", () => {
  const plan = { intent: 0 as const, inputs: [{ currency: zeroAddress, amount: 5n }, { currency: token, amount: 9n }],
    outputCurrency: token, recipient: helpers, deadline: 100n, minimumOutput: 1n, body: "0x" as const };
  const funding = exactInputFunding(plan, { inputs: [{ token, maximumInputAmount: 9n, authorization: 2, permit: emptyPermit }], permit2 }, emptyPermit);
  assert.deepEqual(funding.authorizations.map(row => row.kind), [0, 2]);
  assert.equal(funding.permit2, permit2, "one signed batch is reused once, not split per branch");
});

test("returned physical-asset retention remains distinct from refunds and scalar output", () => {
  const charges = retainedInputCharges([{ currency: token, amount: String(2n ** 200n), stage: "4", branch: 2 }]);
  assert.deepEqual(charges, [{ currency: token, amount: 2n ** 200n, stage: 4n, branch: 2n }]);
});

test("quote unavailability is an ordinary Backend error, without a fabricated deployed target or legacy fallback", async () => {
  const calls: string[] = [];
  await assert.rejects(fetchUniversalExactInputQuote({ intent: 0, inputs: [{ currency: zeroAddress, amount: "5" }],
    outputCurrency: token, recipient: helpers, deadline: "100" }, undefined, async (url) => {
    calls.push(String(url)); return new Response(JSON.stringify({ detail: "quote-unavailable" }), { status: 503 });
  }));
  assert.deepEqual(calls, ["/api/quotes/universal-exact-input"]);
});

test("frozen four-intent ABI fixtures decode losslessly against the compiled Solidity interface", () => {
  const corpus = JSON.parse(readFileSync(new URL("../../tests/fixtures/universal-exact-input.json", import.meta.url), "utf8"));
  assert.deepEqual(corpus.fixtures.map((row: {plan: {intent:number}}) => row.plan.intent), [0,1,2,3]);
  for (const fixture of corpus.fixtures) {
    const decoded = decodeFunctionData({abi:HELPERS_TRADE_EXACT_INPUT_ABI,data:fixture.calldata});
    assert.equal(decoded.functionName,"executeExactInput");
    assert.equal(decoded.args[0].body,fixture.plan.body); assert.equal(decoded.args[0].inputs.length,fixture.plan.inputs.length);
    decoded.args[0].inputs.forEach((row,index)=>assert.equal(row.amount,BigInt(fixture.plan.inputs[index].amount)));
    assert.equal(exactInputNativeValue(exactInputPlan(fixture.plan)),BigInt(fixture.nativeValue));
    assert.equal(fixture.calldata.slice(0,10),corpus.selector);
  }
});

test("canonical Python producer plan bytes decode and re-encode identically with the compiled Solidity ABI", () => {
  const corpus = JSON.parse(readFileSync(new URL("../../tests/fixtures/universal-exact-input-backend.json", import.meta.url), "utf8"));
  const execution = HELPERS_TRADE_EXACT_INPUT_ABI.find(row => row.type === "function" && row.name === "executeExactInput")!;
  for (const fixture of corpus.cases) {
    const [decoded] = decodeAbiParameters([execution.inputs[0]], fixture.encodedPlan);
    assert.equal(decoded.intent, fixture.plan.intent); assert.equal(decoded.body, fixture.plan.body);
    assert.equal(encodeAbiParameters([execution.inputs[0]], [exactInputPlan(fixture.plan)]), fixture.encodedPlan);
  }
});
