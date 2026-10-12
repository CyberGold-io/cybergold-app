import { decodeEventLog, decodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import { HELPERS_EXECUTION_ABI } from "../../app/contracts/cybergold-helpers/execution.ts";
import { tradeReceipt } from "../../app/utils/tradeReceipt.ts";
import { configuredToken, type Scenario } from "./scenarios.ts";
import { requireInvariant, resultFor, type ScenarioResult } from "./regression.ts";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { fetchTransactionReceipt } from "../../app/utils/transactionReceipt.ts";

/** Project only integer economics from mined calldata; signatures stay in memory. */
export function uiReceiptResult(scenario: Scenario, config: ProtocolConfiguration, owner: Address, input: Hex,
  receipt: NonNullable<Awaited<ReturnType<typeof fetchTransactionReceipt>>>, userAmount: bigint, basketAmounts: bigint[]): ScenarioResult {
  const decoded = decodeFunctionData({ abi: HELPERS_EXECUTION_ABI, data: input });
  const operation = decoded.functionName, args = decoded.args as unknown as [Record<string, unknown>, unknown, unknown];
  const params = args[0], strategy = operation.startsWith("swapExact") ? "market" : "core";
  const result: ScenarioResult = { ...resultFor(scenario, "execution"), id: `ui-${scenario.id}`, requestedStrategy: "auto",
    actualStrategy: strategy, actualOperation: operation, transactionHash: receipt.transactionHash,
    context: { chainId: config.chainId, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash } };
  requireInvariant(receipt.status === "success", "receipt-reverted");
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
      const maximum = Array.isArray(args[1]) ? (args[1] as { maximumInputAmount: bigint }[]).map(row => row.maximumInputAmount)
        : (args[1] as { permit: { permitted: { amount: bigint }[] } }).permit.permitted.map(row => row.amount);
      const minimum = (params.minimumNetCygldOut ?? params.netCygldOut) as bigint;
      requireInvariant(event.args.amountsIn.length === maximum.length, "receipt-basket-order-mismatch");
      event.args.amountsIn.forEach((amount, index) => requireInvariant(amount <= maximum[index], "receipt-basket-budget-exceeded"));
      requireInvariant(event.args.netCygldOut >= minimum, "receipt-output-minimum-missed");
      if (scenario.inputMode === "exact-in") maximum.forEach((amount, index) => requireInvariant(amount <= basketAmounts[index], "ui-input-budget-exceeded"));
      else requireInvariant(minimum >= userAmount, "ui-output-target-not-protected");
      result.bounds = { inputMaximum: maximum.map(String), outputMinimum: String(minimum) };
      result.receipt = { amountsIn: event.args.amountsIn.map(String), amountOut: String(event.args.netCygldOut),
        protocolFeeCygld: String(event.args.protocolFeeCygld), helperFeeCygld: String(event.args.helperFeeCygld) };
    } else if (event.eventName === "RedeemedToBasket") {
      const minimum = params.expectedCoreOutputs as { kind: number; token: string; id: bigint; minimumAmount: bigint }[];
      requireInvariant(event.args.amounts.length === minimum.length, "receipt-basket-output-order-mismatch");
      event.args.amounts.forEach((amount, index) => requireInvariant(amount >= minimum[index].minimumAmount, "receipt-basket-output-minimum-missed"));
      const maximum = params.grossCygldIn as bigint;
      requireInvariant(event.args.grossCygldIn <= maximum, "receipt-input-maximum-exceeded");
      if (scenario.inputMode === "exact-in") requireInvariant(maximum <= userAmount, "ui-input-budget-exceeded");
      else minimum.filter(row => row.kind === 0).forEach((row, index) => requireInvariant(row.minimumAmount >= basketAmounts[index], "ui-output-target-not-protected"));
      result.bounds = { inputMaximum: String(maximum), outputMinimum: minimum.map(row => String(row.minimumAmount)) };
      result.receipt = { inputUsed: String(event.args.grossCygldIn), amountsOut: event.args.amounts.map(String),
        protocolFeeCygld: String(event.args.protocolFeeCygld), helperFeeCygld: String(event.args.helperFeeCygld) };
    }
  } else {
    const token = configuredToken(config, scenario.asset);
    const measured = tradeReceipt(receipt.logs, config.contracts.helpers as Address, owner, strategy,
      (scenario.side === "sell" ? config.contracts.core : token.type === "native" ? zeroAddress : token.address) as Address);
    requireInvariant(measured?.operation === (strategy === "market" ? "swap" : scenario.side === "buy" ? "issue" : "redeem"), "operation-event-missing");
    const maximum = strategy === "market" ? (scenario.inputMode === "exact-in" ? params.amount : params.bound) as bigint
      : (scenario.side === "buy" ? params.maximumInputAmount ?? params.maximumNativeIn : params.grossCygldIn) as bigint;
    const minimum = strategy === "market" ? (scenario.inputMode === "exact-in" ? params.bound : params.amount) as bigint
      : (scenario.side === "buy" ? params.netCygldOut : params.minimumAmountOut) as bigint;
    requireInvariant(measured.inputUsed + measured.inputRefund <= maximum, "receipt-refund-budget-mismatch");
    requireInvariant(measured.amountOut >= minimum, "receipt-output-minimum-missed");
    if (scenario.inputMode === "exact-in") requireInvariant(maximum <= userAmount, "ui-input-budget-exceeded");
    else requireInvariant(minimum >= userAmount, "ui-output-target-not-protected");
    result.bounds = { inputMaximum: String(maximum), outputMinimum: String(minimum) };
    result.receipt = { inputUsed: String(measured.inputUsed), amountOut: String(measured.amountOut), inputRefund: String(measured.inputRefund),
      outputRefund: String(measured.outputRefund), protocolFeeCygld: String(measured.protocolFeeCygld), helperFeeCygld: String(measured.helperFeeCygld),
      recoveryShareAmounts: measured.recoveryShareAmounts.map(String) };
  }
  result.status = "pass"; return result;
}
