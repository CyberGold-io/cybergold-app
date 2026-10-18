import { decodeEventLog, decodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import { HELPERS_EXECUTION_ABI } from "../../app/contracts/cybergold-helpers/execution.ts";
import { tradeReceipt, tradeRefundEvidence } from "../../app/utils/tradeReceipt.ts";
import { marketSwapReceipt } from "../../app/utils/marketSwap.ts";
import { configuredToken, type Scenario } from "./scenarios.ts";
import { requireInvariant, resultFor, type ScenarioResult } from "./regression.ts";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { fetchTransactionReceipt } from "../../app/utils/transactionReceipt.ts";
import { actualAmount, assertUiEconomics, measuredUiEconomics, type ActualUiAmount, type UiQuoteSnapshot } from "./uiEconomics.ts";
import { receiptQualityTerms, type QualityAmount } from "./quoteQuality.ts";

/** Project only integer economics from mined calldata; signatures stay in memory. */
export function observeUiReceipt(scenario: Scenario, config: ProtocolConfiguration, owner: Address, input: Hex,
  receipt: NonNullable<Awaited<ReturnType<typeof fetchTransactionReceipt>>>, userAmount: bigint, basketAmounts: bigint[], uiQuote: UiQuoteSnapshot,
  evidence?: ScenarioResult) {
  const decoded = decodeFunctionData({ abi: HELPERS_EXECUTION_ABI, data: input });
  const operation = decoded.functionName, args = decoded.args as unknown as [Record<string, unknown>, unknown, unknown];
  const params = args[0], strategy: "market" | "core" = operation.startsWith("swapExact") ? "market" : "core";
  const result: ScenarioResult = Object.assign(evidence ?? {}, { ...resultFor(scenario, "execution"), id: evidence?.id ?? `ui-${scenario.id}`, requestedStrategy: "auto" as const,
    actualStrategy: strategy, actualOperation: operation, transactionHash: receipt.transactionHash,
    context: { chainId: config.chainId, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash }, uiQuote });
  const checks: (() => void)[] = [];
  const check = (value: unknown, code: string) => checks.push(() => requireInvariant(value, code));
  let actual: { input: ActualUiAmount[]; output: ActualUiAmount[]; maximum: ActualUiAmount[]; minimum: ActualUiAmount[] };
  let recovery: QualityAmount[] = [];
  const cygld = config.contracts.core!;
  requireInvariant(receipt.status === "success", "receipt-reverted");
  result.receipt = { ...result.receipt, refunds: tradeRefundEvidence(receipt.logs, config.contracts.helpers as Address, owner) };
  if (scenario.asset === "BASKET") {
    requireInvariant(strategy === "core", "basket-strategy-mismatch");
    const events = receipt.logs.filter(log => log.address.toLowerCase() === config.contracts.helpers!.toLowerCase()).flatMap(log => {
      try { return [decodeEventLog({ abi: HELPERS_EXECUTION_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] })]; } catch { return []; }
    });
    const event = events.find(event => event.eventName === (scenario.side === "buy" ? "IssuedFromBasket" : "RedeemedToBasket")
      && "payer" in event.args && event.args.payer.toLowerCase() === owner.toLowerCase()
      && "recipient" in event.args && event.args.recipient.toLowerCase() === owner.toLowerCase());
    requireInvariant(event, "operation-event-missing");
    if (event.eventName === "IssuedFromBasket") {
      const permissions = Array.isArray(args[1]) ? args[1] as { token: string; maximumInputAmount: bigint }[]
        : (args[1] as { permit: { permitted: { token: string; amount: bigint }[] } }).permit.permitted
          .map(row => ({ token: row.token, maximumInputAmount: row.amount }));
      const maximum = permissions.map(row => row.maximumInputAmount);
      const minimum = (params.minimumNetCygldOut ?? params.netCygldOut) as bigint;
      check(event.args.amountsIn.length === maximum.length, "receipt-basket-order-mismatch");
      event.args.amountsIn.forEach((amount, index) => check(amount <= (permissions.find(row => row.token.toLowerCase() === event.args.orderedCoreAssets[index].toLowerCase())?.maximumInputAmount ?? -1n), "receipt-basket-budget-exceeded"));
      check(event.args.netCygldOut >= minimum, "receipt-output-minimum-missed");
      if (scenario.inputMode === "exact-in") permissions.forEach(row => check(row.maximumInputAmount <= basketAmounts[uiQuote.input.findIndex(value => value.token.toLowerCase() === row.token.toLowerCase())], "ui-input-budget-exceeded"));
      else check(minimum >= userAmount, "ui-output-target-not-protected");
      result.bounds = { inputMaximum: maximum.map(String), outputMinimum: String(minimum) };
      result.receipt = { ...result.receipt, amountsIn: event.args.amountsIn.map(String), amountOut: String(event.args.netCygldOut),
        protocolFeeCygld: String(event.args.protocolFeeCygld), helperFeeCygld: String(event.args.helperFeeCygld) };
      actual = { input: event.args.orderedCoreAssets.map((token, index) => actualAmount(token, event.args.amountsIn[index])),
        output: [actualAmount(cygld, event.args.netCygldOut)], maximum: permissions.map(row => actualAmount(row.token, row.maximumInputAmount)),
        minimum: [actualAmount(cygld, minimum)] };
    } else if (event.eventName === "RedeemedToBasket") {
      recovery = event.args.tokens.flatMap((token, index) => event.args.kinds[index] !== 0 || event.args.ids[index] !== 0n
        ? [{ asset: token.toLowerCase(), amount: String(event.args.amounts[index]), kind: event.args.kinds[index], id: String(event.args.ids[index]) }] : []);
      const minimum = params.expectedCoreOutputs as { kind: number; token: string; id: bigint; minimumAmount: bigint }[];
      check(event.args.amounts.length === minimum.length, "receipt-basket-output-order-mismatch");
      event.args.amounts.forEach((amount, index) => check(amount >= (minimum.find(row => row.kind === event.args.kinds[index]
        && row.id === event.args.ids[index] && row.token.toLowerCase() === event.args.tokens[index].toLowerCase())?.minimumAmount ?? 2n ** 256n), "receipt-basket-output-minimum-missed"));
      const maximum = params.grossCygldIn as bigint;
      check(event.args.grossCygldIn <= maximum, "receipt-input-maximum-exceeded");
      if (scenario.inputMode === "exact-in") check(maximum <= userAmount, "ui-input-budget-exceeded");
      else minimum.filter(row => row.kind === 0 && row.id === 0n).forEach(row => check(row.minimumAmount >= basketAmounts[uiQuote.output.findIndex(value => value.token.toLowerCase() === row.token.toLowerCase())], "ui-output-target-not-protected"));
      result.bounds = { inputMaximum: String(maximum), outputMinimum: minimum.map(row => String(row.minimumAmount)) };
      result.receipt = { ...result.receipt, inputUsed: String(event.args.grossCygldIn), amountsOut: event.args.amounts.map(String),
        protocolFeeCygld: String(event.args.protocolFeeCygld), helperFeeCygld: String(event.args.helperFeeCygld) };
      actual = { input: [actualAmount(cygld, event.args.grossCygldIn)], maximum: [actualAmount(cygld, maximum)],
        output: event.args.tokens.flatMap((token, index) => event.args.kinds[index] === 0 && event.args.ids[index] === 0n
          ? [actualAmount(token, event.args.amounts[index])] : []),
        minimum: minimum.filter(row => row.kind === 0 && row.id === 0n).map(row => actualAmount(row.token, row.minimumAmount)) };
    }
  } else {
    const token = configuredToken(config, scenario.asset);
    if (strategy === "market") {
      const market = marketSwapReceipt(receipt.logs, config.contracts.helpers as Address, owner);
      requireInvariant(token.type === "erc20" && market?.counterToken.toLowerCase() === token.address.toLowerCase()
        && market.recipient.toLowerCase() === owner.toLowerCase() && market.side === (scenario.side === "buy" ? 0 : 1)
        && market.exactInput === (scenario.inputMode === "exact-in"), "market-receipt-intent-mismatch");
    } else requireInvariant(operation.startsWith(scenario.side === "buy" ? "issueFrom" : "redeemTo"), "core-receipt-direction-mismatch");
    const measured = tradeReceipt(receipt.logs, config.contracts.helpers as Address, owner, strategy,
      (scenario.side === "sell" ? config.contracts.core : token.type === "native" ? zeroAddress : token.address) as Address);
    requireInvariant(measured?.operation === (strategy === "market" ? "swap" : scenario.side === "buy" ? "issue" : "redeem"), "operation-event-missing");
    recovery = measured.recoveryAssets.map((asset, i) => ({ asset: asset.toLowerCase(), amount: String(measured.recoveryShareAmounts[i]), kind: 1 }));
    const maximum = strategy === "market" ? (scenario.inputMode === "exact-in" ? params.amount : params.bound) as bigint
      : (scenario.side === "buy" ? params.maximumInputAmount ?? params.maximumNativeIn : params.grossCygldIn) as bigint;
    const minimum = strategy === "market" ? (scenario.inputMode === "exact-in" ? params.bound : params.amount) as bigint
      : (scenario.side === "buy" ? params.netCygldOut : params.minimumAmountOut) as bigint;
    check(measured.inputUsed + measured.inputRefund <= maximum, "receipt-refund-budget-mismatch");
    check(measured.amountOut >= minimum, "receipt-output-minimum-missed");
    if (scenario.inputMode === "exact-in") check(maximum <= userAmount, "ui-input-budget-exceeded");
    else check(minimum >= userAmount, "ui-output-target-not-protected");
    result.bounds = { inputMaximum: String(maximum), outputMinimum: String(minimum) };
    result.receipt = { ...result.receipt, inputUsed: String(measured.inputUsed), amountOut: String(measured.amountOut), inputRefund: String(measured.inputRefund),
      outputRefund: String(measured.outputRefund), protocolFeeCygld: String(measured.protocolFeeCygld), helperFeeCygld: String(measured.helperFeeCygld),
      recoveryShareAmounts: measured.recoveryShareAmounts.map(String) };
    const native = strategy === "core" && operation.includes("Native");
    const counter = strategy === "market" ? params.counterToken as string : native ? zeroAddress
      : (scenario.side === "buy" ? params.inputToken : params.outputToken) as string;
    const inputToken = scenario.side === "sell" ? cygld : counter;
    const outputToken = scenario.side === "buy" ? cygld : counter;
    actual = { input: [actualAmount(inputToken, measured.inputUsed, scenario.side === "buy" && native)],
      output: [actualAmount(outputToken, measured.amountOut + measured.outputRefund, scenario.side === "sell" && native)],
      maximum: [actualAmount(inputToken, maximum, scenario.side === "buy" && native)],
      minimum: [actualAmount(outputToken, minimum, scenario.side === "sell" && native)] };
  }
  const economics = measuredUiEconomics(uiQuote, actual!);
  result.bounds = { inputMaximum: economics.maximum.length === 1 ? String(economics.maximum[0]) : economics.maximum.map(String),
    outputMinimum: economics.minimum.length === 1 ? String(economics.minimum[0]) : economics.minimum.map(String) };
  result.receipt = { ...result.receipt, netPaid: economics.paid.map(String), netReceived: economics.received.map(String) };
  const terms = (rows: ActualUiAmount[]) => rows.map(row => ({ asset: row.token.toLowerCase(), amount: String(row.amount) }));
  result.executionTerms = receiptQualityTerms({ inputSpent: terms(actual!.input), netOutput: [...terms(actual!.output), ...recovery],
    inputMaximum: terms(actual!.maximum), ...(scenario.inputMode === "exact-in"
      ? { requestedInput: uiQuote.input.map(row => ({ asset: row.token.toLowerCase(), amount: row.amount })) } : {}) },
  result.receipt.refunds as { asset: string; amount: string }[], strategy === "market"
    ? [{ asset: actual!.output[0].token.toLowerCase(), amount: result.receipt.outputRefund as string }] : []);
  return { result, validate() {
    checks.forEach(check => check());
    assertUiEconomics(uiQuote, actual!);
    result.status = "pass"; delete result.code;
    return result;
  } };
}

export function uiReceiptResult(...args: Parameters<typeof observeUiReceipt>): ScenarioResult {
  return observeUiReceipt(...args).validate();
}
