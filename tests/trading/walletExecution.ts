import { decodeEventLog, decodeFunctionData, encodeFunctionData, erc20Abi, serializeTypedData,
  toHex, zeroAddress, type Address, type Hex } from "viem";
import { expect, type Page } from "@playwright/test";
import { HELPERS_EXECUTION_ABI } from "../../app/contracts/cybergold-helpers/execution.ts";
import { tradeReceipt } from "../../app/utils/tradeReceipt.ts";
import { fetchTransactionReceipt } from "../../app/utils/transactionReceipt.ts";
import { estimateHelpersExecutionGas } from "../../app/utils/helpersExecutionGas.ts";
import { fetchTokenPermit, tokenPermitTypedData, tokenPurchaseApprovalAmounts, tokenPurchaseAuthorization, signedTokenPermit } from "../../app/utils/tokenPermit.ts";
import { getTokensNeedingPermit2Approval } from "../../app/utils/tokensApproval.ts";
import { fetchBasketPermitIssuanceInstalled, fetchHelpersRouterFacts, fetchTokenPermitIssuanceInstalled, permit2FromFacts } from "../../app/utils/helpersRouterFacts.ts";
import { fetchPermit2Context } from "../../app/utils/permit2/context.ts";
import { notification } from "../metamask/wallet-ui.ts";
import { ScenarioUnavailableError } from "./scenarios.ts";
import { readJson, requireInvariant, type QuoteObservation, type ScenarioResult } from "./regression.ts";
import { safeRunnerError, safeWalletClickError, type WalletRequestDiagnostic } from "./runnerDiagnostics.ts";
import { protocolConfigurationValues, type ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { HelpersExecutionOperation } from "../../app/utils/helpersExecutionGas.ts";
import type { QuoteIntent } from "../../app/utils/quoteIntent.ts";
import type { BasketPreview } from "../../app/utils/basketPreview.ts";
import type { MarketQuote } from "../../app/utils/marketQuote.ts";
import type { CygldPermit } from "../../app/hooks/flows/shared/types.ts";

const emptyPermit = { value: 0n, deadline: 0n, v: 0, r: `0x${"0".repeat(64)}` as Hex, s: `0x${"0".repeat(64)}` as Hex };
const emptyPermit2 = { permit: { permitted: [] as { token: Address; amount: bigint }[], nonce: 0n, deadline: 0n }, signature: "0x" as Hex };
// A timed-out observer does not cancel the native request. Count its settlement
// separately so a later case on the same page can report that pending request.
const pendingWalletRequests = new WeakMap<Page, number>();

function safeWalletRequestErrorCode(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    && ([4001, 4100, 4200, 4900, 4901, -32700, -32600, -32601, -32602, -32603].includes(value)
      || (value >= -32099 && value <= -32000)) ? value : undefined;
}

/** Native MetaMask owns every signature and broadcast; no signer exists in Node. */
export async function requestWallet(page: Page, request: { method: string; params: unknown[] }, reject = false, result?: ScenarioResult): Promise<unknown> {
  await page.bringToFront();
  let settled = false;
  const started = performance.now(), pendingBefore = pendingWalletRequests.get(page) ?? 0;
  pendingWalletRequests.set(page, pendingBefore + 1);
  let observing = true;
  const diagnostic: WalletRequestDiagnostic | undefined = request.method === "eth_sendTransaction" || request.method === "eth_signTypedData_v4"
    ? { method: request.method, settlement: "pending", elapsedMs: 0, pendingBefore, pendingAfter: pendingBefore + 1,
      clickAttempts: 0, clickCompleted: 0 } : undefined;
  const snapshot = () => {
    if (!diagnostic || !observing) return;
    diagnostic.elapsedMs = Math.max(0, Math.round(performance.now() - started));
    diagnostic.pendingAfter = pendingWalletRequests.get(page) ?? 0;
    try { if (result) result.walletRequest = { ...diagnostic }; }
    catch { /* Optional observations cannot replace the wallet's outcome. */ }
  };
  const settlement = (value: "fulfilled" | "rejected") => {
    settled = true;
    pendingWalletRequests.set(page, Math.max(0, (pendingWalletRequests.get(page) ?? 1) - 1));
    if (diagnostic) diagnostic.settlement = value;
    snapshot();
  };
  snapshot();
  const pending = page.evaluate(async input => {
    try { return await (window as unknown as { ethereum: { request: (input: unknown) => Promise<unknown> } }).ethereum.request(input); }
    catch (error) {
      // Capture only owned metadata before Playwright serializes Error fields.
      let errorClass = "UnknownError", walletRequestErrorCode: number | undefined;
      try {
        const source = error as { name?: unknown; code?: unknown } | undefined;
        if (typeof source?.name === "string" && ["Error", "TypeError", "SyntaxError", "TimeoutError", "AbortError", "ReferenceError", "RangeError", "AggregateError", "UnknownError", "SystemError"].includes(source.name)) errorClass = source.name;
        const code = source?.code;
        if (typeof code === "number" && Number.isInteger(code)
          && ([4001, 4100, 4200, 4900, 4901, -32700, -32600, -32601, -32602, -32603].includes(code)
            || (code >= -32099 && code <= -32000))) walletRequestErrorCode = code;
      } catch { /* Optional metadata cannot replace the wallet rejection. */ }
      return { __cybergoldWalletRequestRejected: true, errorClass,
        ...(walletRequestErrorCode === undefined ? {} : { walletRequestErrorCode }) };
    }
  }, request).then(value => {
    if (value && typeof value === "object" && "__cybergoldWalletRequestRejected" in value && value.__cybergoldWalletRequestRejected === true) {
      settlement("rejected");
      const rejection = value as { errorClass?: string; walletRequestErrorCode?: unknown };
      const error = new Error("Wallet request failed.") as Error & { walletRequestErrorCode?: number };
      error.name = safeRunnerError({ name: rejection.errorClass }).errorClass;
      const code = safeWalletRequestErrorCode(rejection.walletRequestErrorCode);
      if (code !== undefined) error.walletRequestErrorCode = code;
      throw error;
    }
    settlement("fulfilled");
    return value;
  }, error => { settlement("rejected"); throw error; });
  void pending.catch(() => undefined);
  try {
    await expect.poll(async () => {
      if (settled) return true;
      const popup = await notification(page, value => { if (diagnostic) Object.assign(diagnostic, value); snapshot(); });
      const button = reject ? popup.getByTestId("confirm-footer-cancel-button")
        : popup.getByTestId("confirm-footer-button").or(popup.getByTestId("confirm-btn"));
      if (diagnostic) diagnostic.clickAttempts++;
      snapshot();
      await button.click({ timeout: 1000 }).then(() => {
        if (diagnostic) diagnostic.clickCompleted++;
        snapshot();
      }).catch(error => {
        if (diagnostic) Object.assign(diagnostic, safeWalletClickError(error));
        snapshot();
      });
      return settled;
    }, { timeout: 90_000, intervals: [250, 500, 1000] }).toBe(true);
  } catch (error) {
    if (!settled) {
      if (diagnostic) diagnostic.deadlineExpired = true;
      throw new ScenarioUnavailableError(request.method === "eth_signTypedData_v4"
        ? "wallet-authorization-timeout" : "wallet-submission-timeout");
    }
    throw error;
  } finally {
    snapshot();
    observing = false; // Freeze this case; a later native settlement only updates the page's count.
  }
  return pending;
}

export async function waitReceipt(hash: Hex, fetcher: typeof fetch) {
  let receipt: Awaited<ReturnType<typeof fetchTransactionReceipt>>;
  try {
    await expect.poll(async () => { receipt = await fetchTransactionReceipt(hash, undefined, fetcher); return receipt !== null; },
      { timeout: 90_000, intervals: [500, 1000, 2000] }).toBe(true);
  } catch {
    // A broadcast hash exists, but this confirmation deadline did not establish
    // its chain outcome. Retain the hash; do not report a failed transaction.
    throw new ScenarioUnavailableError("submitted-unconfirmed");
  }
  requireInvariant(receipt!.status === "success", "receipt-reverted"); return receipt!;
}
async function approval(page: Page, token: Address, owner: Address, spender: Address, amount: bigint, chainId: number, fetcher: typeof fetch, result: ScenarioResult) {
  result.executionStage = "approval-submission";
  result.lastApproval = { assetAddress: token, spenderAddress: spender, amountRaw: String(amount) };
  const hash = await requestWallet(page, { method: "eth_sendTransaction", params: [{ from: owner, to: token,
    chainId: toHex(chainId), gas: toHex(120_000), data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }) }] }, false, result) as Hex;
  (result.approvalTransactionHashes ??= []).push(hash);
  result.executionStage = "approval-confirmation";
  await waitReceipt(hash, fetcher);
}
async function allowance(page: Page, token: Address, owner: Address, amount: bigint, config: ProtocolConfiguration, fetcher: typeof fetch, result: ScenarioResult) {
  result.executionStage = "allowance-read";
  const context = await fetchTokenPermit(token, owner, fetcher);
  if (context.allowance.status !== "success") throw new ScenarioUnavailableError("allowance-unavailable");
  if (BigInt(context.allowance.value) < amount) await approval(page, token, owner, config.contracts.helpers as Address, amount, config.chainId, fetcher, result);
}
async function nativePermit(page: Page, token: Address, owner: Address, amount: bigint, config: ProtocolConfiguration, fetcher: typeof fetch, result: ScenarioResult): Promise<CygldPermit> {
  result.executionStage = "native-permit-read";
  let context = await fetchTokenPermit(token, owner, fetcher);
  if (context.allowance.status === "success" && BigInt(context.allowance.value) >= amount) {
    await approval(page, token, owner, config.contracts.helpers as Address, 0n, config.chainId, fetcher, result);
    result.executionStage = "native-permit-read";
    context = await fetchTokenPermit(token, owner, fetcher);
  }
  const selected = tokenPurchaseAuthorization(context, amount, true);
  if (selected.kind !== "permit") throw new ScenarioUnavailableError("native-permit-unavailable");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const typed = tokenPermitTypedData(owner, config.contracts.helpers as Address, amount, deadline, selected.domain, selected.nonce);
  result.executionStage = "authorization-signature";
  const signature = await requestWallet(page, { method: "eth_signTypedData_v4", params: [owner, serializeTypedData(typed)] }, false, result) as Hex;
  return signedTokenPermit(amount, deadline, signature);
}
async function permit2(page: Page, inputs: { token: Address; amount: bigint }[], owner: Address, config: ProtocolConfiguration, fetcher: typeof fetch, result: ScenarioResult, single = false) {
  result.executionStage = "permit2-read";
  const spender = permit2FromFacts(await fetchHelpersRouterFacts(undefined, fetcher));
  const approvals = await getTokensNeedingPermit2Approval({ owner, permitted: inputs, fetchImpl: fetcher });
  const resetAllowanceToken = protocolConfigurationValues(config).tokenAddresses.USDT;
  // Keep exact test grants and reuse ordinary allowance/reset selection.
  for (const input of approvals) for (const amount of tokenPurchaseApprovalAmounts(input.token, input.allowance, input.amount, resetAllowanceToken))
    await approval(page, input.token, owner, spender, amount, config.chainId, fetcher, result);
  result.executionStage = "permit2-read";
  const observation = await fetchPermit2Context({ mode: "nonce", owner }, fetcher);
  const nonce = BigInt(observation.result.nonce), deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const permitted = single ? inputs[0] : inputs;
  const domain = { name: "Permit2", chainId: config.chainId, verifyingContract: spender };
  const primaryType = single ? "PermitTransferFrom" : "PermitBatchTransferFrom";
  const types = { EIP712Domain: [{ name: "name", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
    TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
    [primaryType]: [{ name: "permitted", type: single ? "TokenPermissions" : "TokenPermissions[]" }, { name: "spender", type: "address" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
  result.executionStage = "authorization-signature";
  const signature = await requestWallet(page, { method: "eth_signTypedData_v4", params: [owner, serializeTypedData({ domain, types, primaryType,
    message: { permitted, spender: config.contracts.helpers as Address, nonce, deadline } })] }, false, result) as Hex;
  return { permit: { permitted: inputs, nonce, deadline }, signature };
}

export async function executionPlan(observation: QuoteObservation, page: Page, owner: Address, config: ProtocolConfiguration, fetcher: typeof fetch) {
  const { scenario, value, result } = observation;
  result.executionStage = "execution-plan";
  const maximum = typeof result.bounds?.inputMaximum === "string" ? BigInt(result.bounds.inputMaximum) : 0n,
    minimum = typeof result.bounds?.outputMinimum === "string" ? BigInt(result.bounds.outputMinimum) : 0n;
  let operation: HelpersExecutionOperation, args: unknown[], nativeValue: bigint | undefined;
  const auth: string[] = [];
  if (scenario.asset === "BASKET") {
    const preview = value as BasketPreview;
    if (preview.mode.startsWith("issue")) {
      requireInvariant(preview.mode === "issue-exact-in" || preview.mode === "issue-exact-out", "basket-mode-mismatch");
      const maxima = result.bounds!.inputMaximum as string[];
      const inputs = preview.result.orderedCoreAssets.map((token, index) => ({ token: token as Address, amount: BigInt(maxima[index]) }));
      result.executionStage = "authorization-availability";
      const mixed = await fetchBasketPermitIssuanceInstalled(scenario.inputMode, fetcher);
      const request = preview.mode === "issue-exact-in" ? { recipient: owner, minimumNetCygldOut: minimum }
        : { recipient: owner, netCygldOut: minimum };
      if (mixed) {
        const authorization = [];
        // One direct allowance plus Permit2 inputs proves a mixed basket; the
        // output-target case proves sufficient existing ordinary allowances.
        const permitInputs = scenario.inputMode === "exact-in" ? inputs.slice(1).filter(input => input.amount > 0n) : [];
        for (const input of inputs) {
          const usePermit2 = permitInputs.includes(input);
          if (!usePermit2 && input.amount > 0n) await allowance(page, input.token, owner, input.amount, config, fetcher, result);
          authorization.push({ token: input.token, maximumInputAmount: input.amount, authorization: usePermit2 ? 2 : 0, permit: emptyPermit });
          auth.push(usePermit2 ? "permit2" : "allowance");
        }
        const signed = permitInputs.length ? await permit2(page, permitInputs, owner, config, fetcher, result) : emptyPermit2;
        operation = preview.mode === "issue-exact-in" ? "issueFromBasketExactInWithMixedPermits" : "issueFromBasketExactOutWithMixedPermits";
        args = [request, authorization, signed];
      } else {
        const signed = await permit2(page, inputs, owner, config, fetcher, result); auth.push("permit2");
        operation = preview.mode === "issue-exact-in" ? "issueFromBasketExactInWithPermit2" : "issueFromBasketExactOutWithPermit2";
        args = [request, signed];
      }
    } else {
      requireInvariant(preview.mode === "redeem-exact-in" || preview.mode === "redeem-exact-out", "basket-mode-mismatch");
      const minima = result.bounds!.outputMinimum as string[];
      const request = { grossCygldIn: maximum, recipient: owner, expectedCoreOutputs: preview.result.projectedCoreOutputs.map((output, index) => ({
        kind: output.kind, token: output.token, id: BigInt(output.id), minimumAmount: BigInt(minima[index]),
      })) };
      await allowance(page, config.contracts.core as Address, owner, maximum, config, fetcher, result); auth.push("allowance");
      operation = "redeemToBasketExactIn"; args = [request];
    }
  } else if (scenario.requestedStrategy === "market") {
    const quote = value as MarketQuote, token = quote.tokenIn as Address;
    await allowance(page, token, owner, maximum, config, fetcher, result); auth.push("allowance");
    const params = { ...quote.params, amount: BigInt(quote.params.amount), bound: BigInt(quote.params.bound),
      routedInput: BigInt(quote.params.routedInput), feeCygld: BigInt(quote.params.feeCygld), deadline: BigInt(quote.params.deadline) };
    operation = scenario.inputMode === "exact-in" ? "swapExactInput" : "swapExactOutput";
    args = [params, { mode: 0, nativePermit: emptyPermit,
      permit2: { permit: { permitted: { token: zeroAddress, amount: 0n }, nonce: 0n, deadline: 0n }, signature: "0x" } }];
  } else {
    const quote = value as QuoteIntent, request = observation.request as { counterToken: string; native: boolean; deadline: string };
    if (scenario.side === "buy") {
      const execution = { recipient: owner, expectedOrderedCoreAssets: "orderedCoreAssets" in quote.preview ? quote.preview.orderedCoreAssets : [] };
      const legs = quote.quotes.map(leg => ({ adapter: leg.adapter, amountIn: "amountIn" in leg ? BigInt(leg.amountIn) : 0n,
        minimumAmountOut: BigInt(leg.minimumAmountOut), data: leg.data }));
      if (request.native) { operation = "issueFromNativeExactOut"; args = [{ maximumNativeIn: maximum, netCygldOut: BigInt(quote.executionAmount) }, execution, legs]; nativeValue = maximum; auth.push("native"); }
      else {
        const token = request.counterToken as Address, params = { inputToken: token, maximumInputAmount: maximum, netCygldOut: BigInt(quote.executionAmount) };
        // Keep native permit and Permit2 coverage on independent exact-output
        // quotes, so an unavailable budget quote does not hide those fixtures.
        if (scenario.inputMode === "exact-in") {
          await allowance(page, token, owner, maximum, config, fetcher, result); auth.push("allowance"); operation = "issueFromTokenExactOut"; args = [params, execution, legs];
        } else if (scenario.asset === "USDC") {
          result.executionStage = "authorization-availability";
          if (!await fetchTokenPermitIssuanceInstalled(fetcher)) throw new ScenarioUnavailableError("native-permit-unavailable");
          const signed = await nativePermit(page, token, owner, maximum, config, fetcher, result); auth.push("native-permit");
          operation = "issueFromTokenExactOutWithPermit"; args = [params, execution, signed, legs];
        } else {
          const signed = await permit2(page, [{ token, amount: maximum }], owner, config, fetcher, result, true); auth.push("permit2");
          operation = "issueFromTokenExactOutWithPermit2"; args = [params, execution, { permit: { ...signed.permit, permitted: signed.permit.permitted[0] }, signature: signed.signature }, legs];
        }
      }
    } else {
      const outputs = quote.expectedCoreOutputs ?? ("projectedCoreOutputs" in quote.preview ? quote.preview.projectedCoreOutputs.map(output => ({
        kind: output.kind, token: output.token, id: output.id, minimumAmount: String(BigInt(output.amount) * 99n / 100n),
      })) : []);
      const redemption = { grossCygldIn: BigInt(quote.executionAmount), recipient: owner, minimumAmountOut: minimum,
        expectedCoreOutputs: outputs.map(output => ({ ...output, id: BigInt(output.id), minimumAmount: BigInt(output.minimumAmount) })) };
      const legs = quote.quotes.map(leg => ({ adapter: leg.adapter, minimumAmountOut: BigInt(leg.minimumAmountOut), data: leg.data }));
      await allowance(page, config.contracts.core as Address, owner, maximum, config, fetcher, result); auth.push("allowance");
      operation = request.native ? "redeemToNativeExactIn" : "redeemToTokenExactIn";
      args = [request.native ? redemption : { ...redemption, outputToken: request.counterToken }, legs];
    }
  }
  result.authorization = [...new Set(auth)];
  return { operation, args, nativeValue };
}

export async function executeScenario(observation: QuoteObservation, page: Page, owner: Address, config: ProtocolConfiguration, fetcher: typeof fetch): Promise<ScenarioResult> {
  const result = observation.result; result.layer = "execution"; result.status = "unavailable"; result.code = "execution-not-completed";
  try {
  const { operation, args, nativeValue } = await executionPlan(observation, page, owner, config, fetcher);
  result.executionStage = "execution-simulation";
  const gas = await estimateHelpersExecutionGas(owner, operation, args, nativeValue, fetcher, undefined, config.contracts.helpers as Address);
  result.executionStage = "execution-encoding";
  const data = encodeFunctionData({ abi: HELPERS_EXECUTION_ABI, functionName: operation, args: args as never });
  result.executionStage = "execution-submission";
  const hash = await requestWallet(page, { method: "eth_sendTransaction", params: [{ from: owner, to: config.contracts.helpers,
    chainId: toHex(config.chainId), data, value: toHex(nativeValue ?? 0n), gas: toHex(gas * 12n / 10n) }] }, false, result) as Hex;
  result.transactionHash = hash; // Retain submission evidence before any receipt read.
  result.executionStage = "execution-confirmation";
  const receipt = await waitReceipt(hash, fetcher);
  result.executionStage = "execution-transaction-read";
  const observed = await readJson<{ transaction: { input: Hex; to: string; from: string } | null }>(fetcher, `/api/transaction/wait/transaction?hash=${hash}`);
  result.executionStage = "execution-receipt-assertions";
  requireInvariant(observed.transaction?.to.toLowerCase() === config.contracts.helpers!.toLowerCase() && observed.transaction?.from.toLowerCase() === owner.toLowerCase(), "transaction-party-mismatch");
  requireInvariant(decodeFunctionData({ abi: HELPERS_EXECUTION_ABI, data: observed.transaction!.input }).functionName === operation, "execution-selector-mismatch");
  result.actualOperation = operation;
  if (observation.scenario.asset === "BASKET") {
    const expectedEvent = observation.scenario.side === "buy" ? "IssuedFromBasket" : "RedeemedToBasket";
    const events = receipt.logs.filter(log => log.address.toLowerCase() === config.contracts.helpers!.toLowerCase()).flatMap(log => {
      try { return [decodeEventLog({ abi: HELPERS_EXECUTION_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] })]; } catch { return []; }
    });
    const event = events.find(event => event.eventName === expectedEvent && "payer" in event.args && event.args.payer.toLowerCase() === owner.toLowerCase()
      && "recipient" in event.args && event.args.recipient.toLowerCase() === owner.toLowerCase());
    requireInvariant(event, "operation-event-missing");
    if (event.eventName === "IssuedFromBasket") {
      const maximum = result.bounds!.inputMaximum as string[];
      const quote = observation.value as Extract<BasketPreview, { mode: "issue-exact-in" | "issue-exact-out" }>;
      requireInvariant(event.args.amountsIn.length === maximum.length && event.args.orderedCoreAssets.every((token, index) => token.toLowerCase() === quote.result.orderedCoreAssets[index]?.toLowerCase()), "receipt-basket-order-mismatch");
      event.args.amountsIn.forEach((amount, index) => requireInvariant(amount <= BigInt(maximum[index]), "receipt-basket-budget-exceeded"));
      requireInvariant(event.args.netCygldOut >= BigInt(result.bounds!.outputMinimum as string), "receipt-output-minimum-missed");
      result.receipt = { amountsIn: event.args.amountsIn.map(String), amountOut: String(event.args.netCygldOut),
        protocolFeeCygld: String(event.args.protocolFeeCygld), helperFeeCygld: String(event.args.helperFeeCygld) };
    } else if (event.eventName === "RedeemedToBasket") {
      const minimum = result.bounds!.outputMinimum as string[];
      const quote = observation.value as Extract<BasketPreview, { mode: "redeem-exact-in" | "redeem-exact-out" }>;
      requireInvariant(event.args.amounts.length === minimum.length && event.args.tokens.every((token, index) => token.toLowerCase() === quote.result.projectedCoreOutputs[index]?.token.toLowerCase()
        && event.args.ids[index] === BigInt(quote.result.projectedCoreOutputs[index].id) && event.args.kinds[index] === quote.result.projectedCoreOutputs[index].kind), "receipt-basket-output-order-mismatch");
      event.args.amounts.forEach((amount, index) => requireInvariant(amount >= BigInt(minimum[index]), "receipt-basket-output-minimum-missed"));
      requireInvariant(event.args.grossCygldIn <= BigInt(result.bounds!.inputMaximum as string), "receipt-input-maximum-exceeded");
      result.receipt = { inputUsed: String(event.args.grossCygldIn), amountsOut: event.args.amounts.map(String),
        protocolFeeCygld: String(event.args.protocolFeeCygld), helperFeeCygld: String(event.args.helperFeeCygld) };
    }
  } else {
    const measured = tradeReceipt(receipt.logs, config.contracts.helpers as Address, owner, observation.scenario.requestedStrategy,
      (observation.scenario.side === "buy" ? observation.scenario.asset === "ETH" ? zeroAddress : (observation.request as { counterToken: string }).counterToken : config.contracts.core) as Address);
    requireInvariant(measured?.operation === (observation.scenario.requestedStrategy === "market" ? "swap" : observation.scenario.side === "buy" ? "issue" : "redeem"), "operation-event-missing");
    requireInvariant(measured.inputUsed <= BigInt(result.bounds!.inputMaximum as string), "receipt-input-maximum-exceeded");
    requireInvariant(measured.inputUsed + measured.inputRefund <= BigInt(result.bounds!.inputMaximum as string), "receipt-refund-budget-mismatch");
    requireInvariant(measured.amountOut >= BigInt(result.bounds!.outputMinimum as string), "receipt-output-minimum-missed");
    result.receipt = { inputUsed: String(measured.inputUsed), amountOut: String(measured.amountOut), inputRefund: String(measured.inputRefund),
      outputRefund: String(measured.outputRefund), protocolFeeCygld: String(measured.protocolFeeCygld), helperFeeCygld: String(measured.helperFeeCygld),
      recoveryShareAmounts: measured.recoveryShareAmounts.map(String) };
  }
  result.context = { chainId: config.chainId, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash };
  result.status = "pass"; result.executionStage = "complete"; delete result.code; return result;
  } catch (error) {
    Object.assign(result, safeRunnerError(error));
    try {
      const code = safeWalletRequestErrorCode((error as { walletRequestErrorCode?: unknown })?.walletRequestErrorCode);
      if (code !== undefined) result.walletRequestErrorCode = code;
    } catch { /* Optional metadata cannot replace the operation's error. */ }
    throw error;
  }
}
