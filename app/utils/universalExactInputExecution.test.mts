import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { decodeFunctionData, encodeFunctionData, zeroAddress, zeroHash } from "viem";
import * as universal from "./universalExactInput.ts";
import * as economic from "./economicQuotes.ts";
import { DEFAULT_SLIPPAGE_BPS } from "./swapPolicy.ts";
import { captureTradeQuote, economicTradeQuote, tradeQuoteResult } from "./tradeQuote.ts";
import { HELPERS_TRADE_EXACT_INPUT_ABI } from "../contracts/generated/helpersTradeExactInput.ts";

const owner = "0x0000000000000000000000000000000000000001" as const;
const token = "0x0000000000000000000000000000000000000002" as const;
const helpers = "0x0000000000000000000000000000000000000003" as const;
const permit = { value: 0n, deadline: 0n, v: 0, r: zeroHash, s: zeroHash };
const p2 = { permit: { permitted: [], nonce: 0n, deadline: 0n }, signature: "0x" };
const quote = (): universal.UniversalExactInputQuote => ({ strategy: "universal", settlementPolicy: "protocol-retained-input", retentionDisclosure: { custodian: helpers, beneficiary: "helpers-owner-at-settlement" },
  planDescription: {}, searchCoverage: { coreSharesPercent: [0,25,50,75,100], orders: ["core-first", "market-first"], maxCoreInvocations: 1, maxAmmHops: 3, scope: "selected-inventory" }, estimatedRecipientOutputs: [{ kind: 0, token, id: "0", amount: "22" }], recoveryShares: [], routeFamily: "mixed", operation: "executeExactInput",
  plan: { intent: 0, inputs: [{ currency: zeroAddress, amount: "19" }], outputCurrency: token, recipient: owner,
    deadline: "2000000000", minimumOutput: "21", body: "0x1234" },
  deployment: { helpers, adapter: token, encoding: "uniswap-routing-v1" }, inputs: [{ currency: zeroAddress, amount: "19" }],
  quotedInput: "19", quotedOutput: "22", inputMaximum: "19", outputMinimum: "21", estimatedRetainedInputCharges: [],
  fees: { coreProtocolFeeCygld: "1", coreHelpersFeeCygld: "2", marketFeeCygld: "3" },
  context: { chainId: 1, blockNumber: "1", blockHash: zeroHash, observedAt: "2026-10-20" } });

function fixture(prepare = async (input: Record<string, unknown>) => ({ inputs: (input.permitted as {token:string;amount:bigint}[]).map(row => ({ token: row.token, maximumInputAmount: row.amount, authorization: 2, permit })), permit2: p2 }), failure?: Error,
  preparation: (quote: economic.EconomicQuote, input: unknown) => Promise<universal.UniversalExactInputQuote> = async () => quote()) {
  const authorizations: Record<string, unknown>[] = [], simulations: unknown[][] = [], writes: Record<string, unknown>[] = [];
  const preparations: unknown[][] = [], events: string[] = [];
  const dependencies: Record<string, unknown> = {
    react: { useCallback: (value: unknown) => value }, wagmi: { useWalletClient: () => ({ data: {} }),
      useWriteContract: () => ({ writeContractAsync: async (value: Record<string, unknown>) => { writes.push(value); return "0x01"; } }) },
    "@/app/contracts/generated/helpersTradeExactInput": { HELPERS_TRADE_EXACT_INPUT_ABI },
    "@/app/utils/expectedChain": { EXPECTED_CHAIN_ID: 1, assertWalletOnExpectedChain: async () => {} },
    "@/app/utils/helpersExecutionGas": { estimateHelpersExecutionGas: async (...args: unknown[]) => { simulations.push(args); if (failure) throw failure; return 100n; } },
    "@/app/utils/universalExactInput": universal,
    "@/app/utils/economicQuotes": { ...economic, fetchTxPreparation: async (...args: [economic.EconomicQuote, unknown]) => { events.push("preparation"); preparations.push(structuredClone(args)); return preparation(...args); } },
    "@/app/utils/swapPolicy": { DEFAULT_SLIPPAGE_BPS },
    "./usePurchaseAuthorization": { emptyTokenPermit: permit, usePurchaseAuthorization: () => ({ preparePurchaseAuthorization: async (input: Record<string, unknown>) => { events.push("authorization"); authorizations.push(input); return prepare(input); } }) },
    "./useExecutionFeeEstimate": { useExecutionFeeEstimate: () => ({ estimateSignedContractFee: async (...args: unknown[]) => { simulations.push(args); } }) },
  };
  const filename = new URL("../hooks/flows/shared/useUniversalExactInputExecution.ts", import.meta.url);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, () => { submit: (value: economic.SelectedExactInputQuote, params: unknown, bounds?: economic.AcceptedExecutionBounds) => Promise<unknown> }> = {};
  runInNewContext(output, { exports, require: (name: string) => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; }, structuredClone, fetch });
  return { ...exports.useUniversalExactInputExecution(), authorizations, simulations, writes, preparations, events };
}

test("native exact-input signs no token permission, sends exact msg.value and simulates the captured ABI tuple", async () => {
  const value = fixture(); await value.submit(quote(), { owner, recipient: owner });
  assert.equal(value.authorizations[0].exactApproval, true); assert.deepEqual(value.authorizations[0].permitted, []);
  const written = value.writes[0]; assert.equal(written.address, helpers); assert.equal(written.value, 19n);
  const encoded = encodeFunctionData({ abi: HELPERS_TRADE_EXACT_INPUT_ABI, functionName: "executeExactInput", args: written.args as never });
  const decoded = decodeFunctionData({ abi: HELPERS_TRADE_EXACT_INPUT_ABI, data: encoded });
  assert.equal(decoded.functionName, "executeExactInput"); assert.equal(decoded.args[0].inputs[0].amount, 19n);
  assert.equal(decoded.args[1].authorizations[0].kind, 0); assert.equal(value.simulations[0][3], 19n);
});

test("wallet preparation cannot mutate the accepted plan or enlarge token authorization", async () => {
  const source = quote(); source.plan.inputs = [{ currency: token, amount: "23" }];
  const value = fixture(async input => { source.plan.minimumOutput = "0"; source.plan.body = "0xffff";
    return { inputs: (input.permitted as {token:string;amount:bigint}[]).map(row => ({ token: row.token, maximumInputAmount: row.amount, authorization: 2, permit })), permit2: p2 }; });
  await value.submit(source, { owner, recipient: owner });
  assert.deepEqual(value.authorizations[0].permitted, [{ token, amount: 23n }]);
  const args = value.writes[0].args as [universal.ExactInputPlan]; assert.equal(args[0].minimumOutput, 21n); assert.equal(args[0].body, "0x1234");
  assert.equal(value.writes[0].value, 0n);
});

test("existing Market signed-call failure prevents submission without replacement funding", async () => {
  const error = new Error("simulation reverted"), value = fixture(undefined, error);
  await assert.rejects(value.submit(quote(), { owner, recipient: owner }), error); assert.equal(value.writes.length, 0); assert.equal(value.authorizations.length, 1);
});


test("Market-containing wallet batches complete exact funding before mandatory signed-call simulation", async () => {
  const value = fixture(); let submitted = false;
  const batch = { approvals: [], submit: async () => { submitted = true; return "batch"; } };
  await value.submit(quote(), { owner, recipient: owner, walletBatch: batch });
  assert.equal(value.authorizations[0].walletBatch, undefined);
  assert.equal(value.simulations.length, 1); assert.equal(submitted, true); assert.equal(value.writes.length, 0);
});

function economicQuote(): economic.EconomicQuote {
  const source = quote(), { plan } = source;
  const terms = { ...source } as Partial<universal.UniversalExactInputQuote>;
  delete terms.plan; delete terms.outputMinimum; delete terms.planDescription;
  return { ...terms, request: { intent: plan.intent, inputs: plan.inputs, outputCurrency: plan.outputCurrency },
    plan: { allocations: [{ kind: 1, amountIn: "19" }], conversions: {}, body: {} } } as economic.EconomicQuote;
}

test("Swap prepares semantic quotes before authorization and executes the returned funding and calldata", async () => {
  const prepared = quote(); prepared.plan.inputs = [{ currency: token, amount: "17" }]; prepared.plan.body = "0xabcd";
  const value = fixture(undefined, undefined, async () => prepared);
  await value.submit(economicQuote(), { owner, recipient: owner }, { minimumOutput: "21" });
  assert.deepEqual(value.events, ["preparation", "authorization"]);
  assert.deepEqual(value.preparations[0][1], { sender: owner, recipient: owner, slippageBps: 100, acceptedBounds: { minimumOutput: "21" } });
  assert.deepEqual(value.authorizations[0].permitted, [{ token, amount: 17n }]);
  const args = value.writes[0].args as [universal.ExactInputPlan];
  assert.equal(args[0].body, "0xabcd"); assert.equal(args[0].inputs[0].amount, 17n);
  assert.equal(value.writes[0].value, 0n);
});

test("preparation failure performs no permission, signature, simulation or submission", async () => {
  const failure = new Error("accepted minimum cannot be met");
  const value = fixture(undefined, undefined, async () => { throw failure; });
  await assert.rejects(value.submit(economicQuote(), { owner, recipient: owner }), failure);
  assert.deepEqual(value.events, ["preparation"]);
  assert.equal(value.authorizations.length, 0); assert.equal(value.simulations.length, 0); assert.equal(value.writes.length, 0);
});

test("legacy wire quotes with a semantic replay record prepare again with their frozen guards", async () => {
  const source = { ...quote(), economicQuote: economicQuote() }, value = fixture();
  await value.submit(source, { owner, recipient: owner });
  assert.deepEqual(value.events, ["preparation", "authorization"]);
  const input = value.preparations[0][1] as { acceptedBounds: economic.AcceptedExecutionBounds };
  assert.deepEqual(input.acceptedBounds, { inputs: source.plan.inputs, minimumOutput: source.plan.minimumOutput });
});

test("tolerance updates display guards without changing the economic quote and capture preserves them", () => {
  const measured = economicQuote();
  const input = { side: "buy" as const, mode: "exact-in" as const, counterToken: token, native: false,
    amount: "19", recipient: owner, slippageBps: 500 };
  const value = economicTradeQuote(measured, input), selected = tradeQuoteResult(value, input.slippageBps);
  assert.equal(selected.outputMinimum, 20n);
  assert.equal(captureTradeQuote(selected).outputMinimum, 20n);
  assert.equal(tradeQuoteResult(value, 100).outputMinimum, 21n);
  assert.equal("outputMinimum" in measured, false);
  assert.equal("recipient" in value.providerRequest, false);
  assert.equal("deadline" in value.providerRequest, false);
});
