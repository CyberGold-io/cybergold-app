import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { Page } from "@playwright/test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, zeroAddress, type Hex, type Address } from "viem";
import { HISTORICAL_HELPERS_EXECUTION_ABI as HELPERS_EXECUTION_ABI } from "../../tests/fixtures/helpers-execution-legacy.ts";
import { formatMeaningfulDecimalString } from "./formatting.ts";
import { actualAmount, assertUiEconomics, assertWalletEconomics, displayedAmount, positiveDisplayedAmount, walletDisplayMatches, selectedTolerance, uiAmountLimits,
  walletEvidence, type UiAmount, type UiQuoteSnapshot } from "../../tests/trading/uiEconomics.ts";
import { observeUiReceipt, uiReceiptResult } from "../../tests/trading/uiReceipt.ts";
import { observeUiGas, ownedReceiptGas } from "../../tests/trading/uiGas.ts";
import { failureResult, resultFor, type ScenarioResult } from "../../tests/trading/regression.ts";
import { tradeScenarios } from "../../tests/trading/scenarios.ts";
import { parseUiQuoteCapture, quoteAssets } from "../../tests/trading/uiQuoteCapture.ts";
import { protocolConfigurationFixture as config, tokenAddresses as tokens } from "../../tests/fixtures/protocol-configuration.ts";

const owner = "0x0000000000000000000000000000000000000001" as const;
const hash = `0x${"a".repeat(64)}` as Hex, blockHash = `0x${"b".repeat(64)}` as Hex;
const cygld = tokens.CYGLD, counter = tokens.PAXG;
const amount = (token: string, value: bigint, native = false): UiAmount => ({ type: native ? "native" : "erc20", token,
  decimals: 18, amount: String(value), roundingUnit: "1", rounding: "exact" });
function snapshot(mode: "exact-in" | "exact-out", input = counter as string, output = cygld as string): UiQuoteSnapshot {
  return { inputMode: mode, toleranceBps: 50, input: [amount(input, 1000n, input === zeroAddress)], output: [amount(output, 2000n, output === zeroAddress)],
    executionBound: mode === "exact-in" ? { side: "output", amounts: [amount(output, 1990n, output === zeroAddress)] }
      : { side: "input", amounts: [amount(input, 1005n, input === zeroAddress)] } };
}
function event(name: string, args: Record<string, unknown>) {
  const abi = HELPERS_EXECUTION_ABI.find(row => row.type === "event" && row.name === name)!;
  if (abi.type !== "event") throw new Error("Fixture event missing");
  const values = abi.inputs.filter(row => !row.indexed);
  return { address: config.contracts.helpers! as Address, topics: encodeEventTopics({ abi: [abi], eventName: name as never, args: args as never }) as Hex[],
    data: encodeAbiParameters(values, values.map(row => args[row.name]) as never) };
}
const receipt = (logs: ReturnType<typeof event>[]) => ({ transactionHash: hash, blockHash, blockNumber: 100n, status: "success" as const, logs });
const functionData = (name: string, args: unknown[]) => encodeFunctionData({ abi: HELPERS_EXECUTION_ABI, functionName: name as never, args: args as never });
const scenarioFor = (asset: string, side: string, mode: string) => tradeScenarios.find(row => row.requestedStrategy === "core" && row.asset === asset && row.side === side && row.inputMode === mode)!;

test("integer display parsing retains full user input, rounded and truncated visible precision", () => {
  assert.deepEqual(displayedAmount("9 007 199 254 740 993.123456", 6, false), { amount: "9007199254740993123456", roundingUnit: "1", rounding: "exact" });
  assert.deepEqual(displayedAmount("0.0₆1234", 18, true), { amount: "123400000000", roundingUnit: "100000000", rounding: "truncated" });
  assert.deepEqual(displayedAmount("0.123", 6, true), { amount: "123000", roundingUnit: "1000", rounding: "rounded" });
  assert.equal(selectedTolerance("0.555"), 56); assert.equal(selectedTolerance("0"), 0); assert.equal(selectedTolerance("1"), 100);
  assert.throws(() => displayedAmount("private-provider-body", 18, true), /ui-displayed-amount-invalid/);
});

test("quote readiness accepts grouped large amounts and compact native amounts without parsing display syntax as raw decimal input", () => {
  for (const value of ["9 921.398", "0.0₄4469", "0.000096", "0.0001437"]) assert.equal(positiveDisplayedAmount(value, 18), true);
  for (const value of ["", "...", "0", "not-ready", "-1"]) assert.equal(positiveDisplayedAmount(value, 18), false);
});

test("wallet display checks preserve settled sub-display-precision gold movements and reject stale observable balances", () => {
  // Retained $1 PAXG cases: both raw balances round to the same three-place modal value.
  for (const raw of [5598763902343388700n, 5599004135968125793n])
    assert.equal(walletDisplayMatches("5.599 PAXG", raw, 18, "PAXG"), true);
  for (const raw of [4839129009683146782n, 4838983884460492100n])
    assert.equal(walletDisplayMatches("4.839 PAXG", raw, 18, "PAXG"), true);
  assert.equal(walletDisplayMatches("9 921.398 USDC", 9921397856n, 6, "USDC"), true);
  assert.equal(walletDisplayMatches("0.000 PAXG", 499999999999999n, 18, "PAXG"), true);
  assert.equal(walletDisplayMatches("0.000 PAXG", 500000000000000n, 18, "PAXG"), false);
  assert.equal(walletDisplayMatches("0.001 PAXG", 500000000000000n, 18, "PAXG"), true);
  assert.equal(walletDisplayMatches("5.599 PAXG", 5600000000000000000n, 18, "PAXG"), false);
  assert.equal(walletDisplayMatches("... PAXG", 1n, 18, "PAXG"), false);
  assert.equal(walletDisplayMatches("5.599 CYGLD", 5599004135968125793n, 18, "PAXG"), false);
});

test("wallet display checks follow the product formatter at binary floating-point rounding boundaries", () => {
  const raw = 1234499999999999999n;
  assert.equal(walletDisplayMatches("1.235 PAXG", raw, 18, "PAXG"), true);
  assert.equal(walletDisplayMatches("1.234 PAXG", raw, 18, "PAXG"), false);
});

test("zero tolerance permits only the formatter's quantization and integer boundary", () => {
  const quote = snapshot("exact-in"); quote.toleranceBps = 0;
  quote.output = [{ ...amount(cygld, 123000n), ...displayedAmount("0.123", 6, true), decimals: 6 }];
  quote.executionBound.amounts = [amount(cygld, 122500n)];
  const economics = { input: [actualAmount(counter, 1000n)], output: [actualAmount(cygld, 122500n)],
    maximum: [actualAmount(counter, 1000n)], minimum: [actualAmount(cygld, 122500n)] };
  assertUiEconomics(quote, economics);
  assert.throws(() => assertUiEconomics(quote, { ...economics, output: [actualAmount(cygld, 122499n)] }), /ui-received-output-tolerance-missed/);
  const source = "0.099996", displayed = formatMeaningfulDecimalString(source);
  assert.equal(displayed, "0.1");
  quote.output = [{ ...amount(cygld, 0n), ...displayedAmount(displayed, 6, true), decimals: 6 }];
  quote.executionBound.amounts = [amount(cygld, 99996n)];
  assertUiEconomics(quote, { ...economics, output: [actualAmount(cygld, 99996n)], minimum: [actualAmount(cygld, 99996n)] });
});

test("directional tolerance accepts favorable amounts but rejects adverse input/output beyond selected bps", () => {
  for (const mode of ["exact-in", "exact-out"] as const) {
    const quote = snapshot(mode), limits = uiAmountLimits(quote);
    const economic = { input: [actualAmount(counter, limits.maximum[0])], output: [actualAmount(cygld, limits.minimum[0])],
      maximum: [actualAmount(counter, limits.maximum[0])], minimum: [actualAmount(cygld, limits.minimum[0])] };
    assertUiEconomics(quote, economic);
    assertUiEconomics(quote, { ...economic, input: [actualAmount(counter, 990n)], output: [actualAmount(cygld, 2200n)] });
    assert.throws(() => assertUiEconomics(quote, { ...economic, input: [actualAmount(counter, limits.maximum[0] + 1n)] }), /ui-paid-input-tolerance-exceeded/);
    assert.throws(() => assertUiEconomics(quote, { ...economic, output: [actualAmount(cygld, limits.minimum[0] - 1n)] }), /ui-received-output-tolerance-missed/);
  }
});

test("signed bounds cannot be looser than the displayed quote and its exact shown protection", () => {
  for (const mode of ["exact-in", "exact-out"] as const) {
    const quote = snapshot(mode), economic = { input: [actualAmount(counter, 1000n)], output: [actualAmount(cygld, 2000n)],
      maximum: [actualAmount(counter, mode === "exact-in" ? 1000n : 1005n)], minimum: [actualAmount(cygld, mode === "exact-in" ? 1990n : 2000n)] };
    assert.throws(() => assertUiEconomics(quote, { ...economic, maximum: [actualAmount(counter, 1006n)] }), /ui-calldata-input-tolerance-exceeded/);
    assert.throws(() => assertUiEconomics(quote, { ...economic, minimum: [actualAmount(cygld, 1989n)] }), /ui-calldata-output-tolerance-missed/);
    quote.executionBound.amounts[0].amount = mode === "exact-in" ? "1991" : "1004";
    assert.throws(() => assertUiEconomics(quote, economic), /ui-displayed-execution-bound-not-protected/);
  }
});

for (const side of ["buy", "sell"] as const) for (const mode of ["exact-in", "exact-out"] as const) for (const native of [false, true])
  test(`Core ${native ? "native" : "token"} ${side} ${mode} binds displayed net economics including fees/refund`, () => {
    const token = native ? zeroAddress : counter, inputToken = side === "buy" ? token : cygld, outputToken = side === "buy" ? cygld : token;
    const quote = snapshot(mode, inputToken, outputToken), maximum = mode === "exact-in" ? 1000n : 1005n, minimum = mode === "exact-in" ? 1990n : 2000n;
    const name = side === "buy" ? native ? "issueFromNativeExactOut" : "issueFromTokenExactOut" : native ? "redeemToNativeExactIn" : "redeemToTokenExactIn";
    const params = side === "buy" ? { maximumInputAmount: maximum, maximumNativeIn: maximum, inputToken: token, netCygldOut: minimum }
      : { grossCygldIn: maximum, outputToken: token, recipient: owner, minimumAmountOut: minimum, expectedCoreOutputs: [] };
    const data = functionData(name, side === "buy" ? [params, { recipient: owner, expectedOrderedCoreAssets: [counter] }, []] : [params, []]);
    const logs = side === "buy" ? [event("Issued", { payer: owner, recipient: owner, inputToken: token, inputUsed: maximum - 5n,
      netCygldOut: 2000n, protocolFeeCygld: 20n, helperFeeCygld: 10n }), event("DustRefunded", { payer: owner, asset: token, amount: 5n })]
      : [event("Redeemed", { payer: owner, recipient: owner, outputToken: token, grossCygldIn: maximum, amountOut: 2000n,
        recoveryAssets: [], recoveryShareAmounts: [], protocolFeeCygld: 20n, helperFeeCygld: 10n })];
    logs.push(event("DustRefunded", { payer: owner, asset: tokens.XAUT, amount: 2n ** 100n }));
    const result = uiReceiptResult(scenarioFor(native ? "ETH" : "PAXG", side, mode), config, owner, data, receipt(logs), mode === "exact-in" ? 1000n : 2000n, [], quote);
    assert.equal(result.status, "pass"); assert.deepEqual(result.receipt!.netPaid, [String(side === "buy" ? maximum - 5n : maximum)]);
    assert.deepEqual(result.receipt!.netReceived, ["2000"]); assert.equal(result.receipt!.protocolFeeCygld, "20");
    const refunds = side === "buy" ? [{ asset: token, amount: "5" }] : [];
    assert.deepEqual(result.receipt!.refunds, [...refunds, { asset: tokens.XAUT, amount: String(2n ** 100n) }]);
    assert.equal(result.receipt!.inputRefund, side === "buy" ? "5" : "0");
    assert.deepEqual(result.executionTerms!.inputSpent!.map(row => row.amount), [String(side === "buy" ? maximum - 5n : maximum)]);
    assert.deepEqual(result.executionTerms!.netOutput!.map(row => row.amount), ["2000", String(2n ** 100n)]);
  });

for (const side of ["buy", "sell"] as const) for (const mode of ["exact-in", "exact-out"] as const)
  test(`market ${side} ${mode} includes sell fees once and the wallet's output refund`, () => {
    const quote = snapshot(mode, side === "buy" ? counter : cygld, side === "buy" ? cygld : counter);
    const maximum = mode === "exact-in" ? 1000n : 1005n, minimum = mode === "exact-in" ? 1990n : 2000n;
    const data = functionData(mode === "exact-in" ? "swapExactInput" : "swapExactOutput", [{ side: side === "buy" ? 0 : 1, counterToken: counter,
      amount: mode === "exact-in" ? maximum : minimum, bound: mode === "exact-in" ? minimum : maximum, routedInput: 990n,
      feeCygld: 2n, recipient: owner, deadline: 1900000000n, adapter: config.adapter.observation ?? config.contracts.uniswapAdapter, data: "0x" },
      { mode: 0, nativePermit: { value: 0n, deadline: 0n, v: 0, r: blockHash, s: blockHash },
        permit2: { permit: { permitted: { token: counter, amount: 0n }, nonce: 0n, deadline: 0n }, signature: "0x" } }]);
    const logs = [event("MarketSwapExecuted", { payer: owner, recipient: owner, counterToken: counter, side: side === "buy" ? 0 : 1,
      exactInput: mode === "exact-in", swapInput: side === "buy" ? 995n : 993n, amountOut: 2000n, inputRefund: 5n, outputRefund: 7n,
      feeCygld: 2n, feeRecipient: config.contracts.helpers })];
    const result = uiReceiptResult(scenarioFor("PAXG", side, mode), config, owner, data, receipt(logs), mode === "exact-in" ? 1000n : 2000n, [], quote);
    assert.deepEqual(result.receipt!.netPaid, ["995"]); assert.deepEqual(result.receipt!.netReceived, ["2007"]);
    assert.deepEqual(result.receipt!.refunds, []);
    assert.deepEqual(result.executionTerms!.inputSpent!.map(row => row.amount), ["995"]);
    assert.deepEqual(result.executionTerms!.netOutput!.map(row => row.amount), ["2007"]);
  });

test("wrong displayed output fails even when the mined transaction satisfied its own lower bound, preserving evidence", () => {
  const scenario = scenarioFor("PAXG", "buy", "exact-in"), quote = snapshot("exact-in"); quote.output[0].amount = "3000";
  const sink = { ...resultFor(scenario, "execution"), refs: { requestId: "e9eb96b2-8ecf-429d-9e08-244f43257e8e" } };
  const data = functionData("issueFromTokenExactOut", [{ inputToken: counter, maximumInputAmount: 1000n, netCygldOut: 1990n }, { recipient: owner, expectedOrderedCoreAssets: [counter] }, []]);
  const observed = observeUiReceipt(scenario, config, owner, data, receipt([event("Issued", { payer: owner, recipient: owner, inputToken: counter,
    inputUsed: 995n, netCygldOut: 2000n, protocolFeeCygld: 20n, helperFeeCygld: 10n }), event("DustRefunded", { payer: owner, asset: counter, amount: 5n }),
    event("DustRefunded", { payer: owner, asset: tokens.XAUT, amount: 7n })]), 1000n, [], quote, sink);
  sink.wallet = walletEvidence(quote, { input: ["2000"], output: ["0"], native: "0" }, { input: ["1005"], output: ["2000"], native: "0" }, 0n, []);
  let failed: ScenarioResult = sink;
  try { observed.validate(); } catch (error) { failed = failureResult(sink, error); }
  assert.equal(failed.status, "fail"); assert.equal(failed.code, "ui-calldata-output-tolerance-missed");
  assert.equal(failed.uiQuote!.output[0].amount, "3000"); assert.deepEqual(failed.receipt!.netPaid, ["995"]);
  assert.deepEqual(failed.receipt!.netReceived, ["2000"]); assert.deepEqual(failed.wallet!.inputDelta, ["995"]);
  assert.equal(failed.transactionHash, hash); assert.equal(failed.refs!.requestId, sink.refs.requestId);
  assert.deepEqual(failed.receipt!.refunds, [{ asset: counter, amount: "5" }, { asset: tokens.XAUT, amount: "7" }]);
});

test("native wallet deltas exclude trade and approval gas; refunds and receipt net input are not subtracted twice", () => {
  const quote = snapshot("exact-in", zeroAddress), before = { input: ["1200"], output: ["10"], native: "1200" };
  const after = { input: ["195"], output: ["2017"], native: "195" }, gas = 10n;
  const evidence = walletEvidence(quote, before, after, gas, [hash]);
  assertWalletEconomics(evidence, [995n], [2007n]);
  assert.throws(() => assertWalletEconomics(evidence, [990n], [2007n]), /wallet-paid-receipt-mismatch/);
  const redeem = snapshot("exact-in", cygld, zeroAddress);
  assertWalletEconomics(walletEvidence(redeem, { input: ["1200"], output: ["10"], native: "10" },
    { input: ["200"], output: ["2007"], native: "2007" }, 10n, [hash]), [1000n], [2007n]);
});

test("gas receipt parsing ignores unmined/other owners and retains exact uint precision", () => {
  const mined = { receipt: { from: owner, transactionHash: hash, status: "0x1", gasUsed: "0x5208", effectiveGasPrice: "0x100000000000000" } };
  assert.deepEqual(ownedReceiptGas(mined, owner), { hash, paid: 21000n * 2n ** 56n });
  assert.equal(ownedReceiptGas({ receipt: null }, owner), undefined);
  assert.equal(ownedReceiptGas(mined, counter), undefined);
});

test("captured quote uses the observed tolerance and asset identities without converting through floating point", () => {
  const scenario = scenarioFor("USDC", "buy", "exact-in"), assets = quoteAssets(scenario, config, []);
  const captured = parseUiQuoteCapture({ input: ["100"], output: ["2.123"], tolerance: "0.25", bound: "2.1176925 CYGLD", mode: "exact-in" }, assets, "exact-in");
  assert.equal(captured.toleranceBps, 25); assert.equal(captured.input[0].amount, "100000000"); assert.equal(captured.output[0].amount, "2123000000000000000");
  assertUiEconomics(captured, { input: [actualAmount(tokens.USDC, 100000000n)], output: [actualAmount(cygld, 2123000000000000000n)],
    maximum: [actualAmount(tokens.USDC, 100000000n)], minimum: [actualAmount(cygld, 2117692500000000000n)] });
  assert.throws(() => assertUiEconomics(captured, { input: [actualAmount(counter, 100000000n)], output: [actualAmount(cygld, 2123000000000000000n)],
    maximum: [actualAmount(tokens.USDC, 100000000n)], minimum: [actualAmount(cygld, 2117692500000000000n)] }), /ui-input-asset-mismatch/);
});

for (const side of ["buy", "sell"] as const) for (const mode of ["exact-in", "exact-out"] as const)
  test(`basket ${side} ${mode} compares every asset by identity despite permit/output order and recovery shares`, () => {
    const a = amount(counter, 1000n), b = amount(tokens.XAUT, 3000n), c = amount(cygld, side === "buy" ? 2000n : 1000n);
    const quote: UiQuoteSnapshot = { inputMode: mode, toleranceBps: 50, input: side === "buy" ? [a, b] : [c], output: side === "buy" ? [c] : [a, b],
      executionBound: mode === "exact-in" ? { side: "output", amounts: side === "buy" ? [amount(cygld, 1990n)] : [amount(counter, 995n), amount(tokens.XAUT, 2985n)] }
        : { side: "input", amounts: side === "buy" ? [amount(counter, 1005n), amount(tokens.XAUT, 3015n)] : [amount(cygld, 1005n)] } };
    let data: Hex, logs: ReturnType<typeof event>[];
    if (side === "buy") {
      const maxima = mode === "exact-in" ? [1000n, 3000n] : [1005n, 3015n];
      const minimum = mode === "exact-in" ? 1990n : 2000n;
      data = functionData(mode === "exact-in" ? "issueFromBasketExactInWithPermit2" : "issueFromBasketExactOutWithPermit2",
        [{ recipient: owner, minimumNetCygldOut: minimum, netCygldOut: minimum }, { permit: { permitted: [{ token: tokens.XAUT, amount: maxima[1] },
          { token: counter, amount: maxima[0] }], nonce: 0n, deadline: 1900000000n }, signature: "0x" }]);
      logs = [event("IssuedFromBasket", { payer: owner, recipient: owner, orderedCoreAssets: [counter, tokens.XAUT], amountsIn: [995n, 2995n],
        netCygldOut: 2000n, protocolFeeCygld: 20n, helperFeeCygld: 10n })];
    } else {
      const minima = mode === "exact-in" ? [995n, 2985n] : [1000n, 3000n];
      data = functionData("redeemToBasketExactIn", [{ grossCygldIn: mode === "exact-in" ? 1000n : 1005n, recipient: owner,
        expectedCoreOutputs: [{ kind: 0, token: tokens.XAUT, id: 0n, minimumAmount: minima[1] },
          { kind: 1, token: counter, id: 9n, minimumAmount: 7n }, { kind: 0, token: counter, id: 0n, minimumAmount: minima[0] }] }]);
      logs = [event("RedeemedToBasket", { payer: owner, recipient: owner, grossCygldIn: 1000n,
        kinds: [0, 1, 0], tokens: [counter, counter, tokens.XAUT], ids: [0n, 9n, 0n], amounts: [1000n, 7n, 3000n], protocolFeeCygld: 20n, helperFeeCygld: 10n })];
    }
    logs.push(event("DustRefunded", { payer: owner, asset: tokens.XAUT, amount: 5n }));
    const result = uiReceiptResult(scenarioFor("BASKET", side, mode), config, owner, data, receipt(logs), side === "buy" ? 2000n : 1000n, [1000n, 3000n], quote);
    assert.equal(result.status, "pass");
    assert.deepEqual(result.receipt!.netPaid, side === "buy" ? ["995", "2995"] : ["1000"]);
    assert.deepEqual(result.receipt!.netReceived, side === "buy" ? ["2000"] : ["1000", "3000"]);
    assert.deepEqual(result.receipt!.refunds, [{ asset: tokens.XAUT, amount: "5" }]);
    const wrong = structuredClone(quote);
    (side === "buy" ? wrong.input : wrong.output)[1].amount = side === "buy" ? "2000" : "4000";
    assert.throws(() => uiReceiptResult(scenarioFor("BASKET", side, mode), config, owner, data, receipt(logs), side === "buy" ? 2000n : 1000n, [1000n, 3000n], wrong),
      side === "buy" ? /ui-calldata-input-tolerance-exceeded/ : /ui-calldata-output-tolerance-missed/);
  });

test("naturally observed gas sums trade/approvals once, ignores stale attempts and later unmined reads", async () => {
  const page = new EventEmitter(), observation = observeUiGas(page as unknown as Page, owner);
  const request = () => ({ url: () => "https://public.app/api/transaction/wait/receipt" });
  const respond = (request: object, receipt: unknown) => page.emit("response", { request: () => request, ok: () => true, json: async () => ({ receipt }) });
  const raw = (hash: string, gasUsed: string) => ({ from: owner, transactionHash: hash, status: "0x1", gasUsed, effectiveGasPrice: "0x2" });
  observation.begin(); const stale = request(); page.emit("request", stale);
  observation.begin(); const trade = request(), approval = request(); page.emit("request", trade); page.emit("request", approval);
  respond(stale, raw(`0x${"c".repeat(64)}`, "0xffff")); respond(trade, raw(hash, "0x20")); respond(approval, raw(`0x${"d".repeat(64)}`, "0x10"));
  respond(trade, raw(hash, "0x20")); respond(approval, null);
  assert.deepEqual(await observation.finish(), { paid: 96n, hashes: [hash, `0x${"d".repeat(64)}`] });
});

test("a mined revert retains its known classification instead of demanding nonexistent successful events", () => {
  const scenario = scenarioFor("PAXG", "buy", "exact-in"), sink = resultFor(scenario, "execution");
  const data = functionData("issueFromTokenExactOut", [{ inputToken: counter, maximumInputAmount: 1000n, netCygldOut: 1990n }, { recipient: owner, expectedOrderedCoreAssets: [counter] }, []]);
  assert.throws(() => observeUiReceipt(scenario, config, owner, data, { ...receipt([]), status: "reverted" }, 1000n, [], snapshot("exact-in"), sink), /receipt-reverted/);
  assert.equal(sink.transactionHash, hash); assert.equal(sink.actualOperation, "issueFromTokenExactOut");
});

test("an incorrect wallet direction fails while retaining exact signed delta and unsigned balances", () => {
  const evidence = walletEvidence(snapshot("exact-in"), { input: ["10"], output: ["10"] }, { input: ["11"], output: ["9"] }, 0n, []);
  assert.deepEqual(evidence.inputDelta, ["-1"]); assert.deepEqual(evidence.outputDelta, ["-1"]);
  assert.throws(() => assertWalletEconomics(evidence, [1n], [1n]), /wallet-paid-receipt-mismatch/);
  assert.deepEqual(evidence.inputBefore, ["10"]); assert.deepEqual(evidence.inputAfter, ["11"]);
});

test("native redemption still receives its displayed target when gas exceeds the payout and ETH balance falls", () => {
  const quote = snapshot("exact-out", cygld, zeroAddress), payout = 600000000000000n, gas = 900000000000000n;
  quote.output[0].amount = String(payout);
  const before = { input: ["5000"], output: ["1000000000000000000"] }, after = { input: ["4000"], output: ["999700000000000000"] };
  assert.ok(BigInt(after.output[0]) < BigInt(before.output[0]));
  const actual = { input: [actualAmount(cygld, 1000n)], output: [actualAmount(zeroAddress, payout, true)],
    maximum: [actualAmount(cygld, 1005n)], minimum: [actualAmount(zeroAddress, payout, true)] };
  assertUiEconomics(quote, actual);
  const evidence = walletEvidence(quote, before, after, gas, [hash]);
  assertWalletEconomics(evidence, [1000n], [payout]);
  assert.equal(evidence.outputDelta[0], String(payout)); assert.equal(evidence.nativeGasPaid, String(gas));
});
