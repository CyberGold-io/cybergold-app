import { protocolAddresses } from "../../fixtures/protocol-configuration";
import type { Page } from "@playwright/test";
import type { MarketQuote, MarketQuoteRequest, MarketModelRequest, MarketQuoteModelPacket } from "../../../app/utils/marketQuote";
import { marketModelFamily } from "../../../app/utils/marketQuote";
import { install, context } from "./token-quotes";

const core = protocolAddresses.core!, helpers = protocolAddresses.helpers!;
const counter = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
export function marketFixture(request: MarketQuoteRequest): MarketQuote {
  const amount = BigInt(request.amount), buy = request.side === "buy", exactIn = request.mode === "exact-in";
  const routed = !buy && exactIn ? amount * 1000n / 1001n : buy && !exactIn ? ceil(amount * 1000n, 999n) : amount;
  const fee = buy && !exactIn ? routed - amount : ceil(routed, 1000n);
  const net = buy && exactIn ? routed - fee : exactIn ? routed : amount;
  const total = buy ? routed : routed + fee;
  const maximum = exactIn ? amount : ceil(total * 101n, 100n), minimum = exactIn ? net * 99n / 100n : net;
  const feeFact = { asset: core, ratePpm: 1000, amount: String(fee), basis: "quoted" as const, notional: String(routed) };
  const tokenIn = buy ? counter : core, tokenOut = buy ? core : counter;
  const params = { side: buy ? 0 as const : 1 as const, counterToken: counter, amount: request.amount,
    bound: String(exactIn ? minimum : maximum), routedInput: String(!buy && exactIn ? routed : 0n), feeCygld: String(fee),
    recipient: request.recipient, deadline: request.deadline, adapter: request.adapter ?? protocolAddresses.adapter, data: "0xab" };
  const route = { version: 1 as const, executionContext: "helpers-market" as const, mode: exactIn ? "exactIn" as const : "exactOut" as const,
    tokenIn, tokenOut, inputAmount: String(routed), outputAmount: String(buy && !exactIn ? routed : exactIn ? routed : amount),
    limit: String(exactIn ? minimum + (buy ? fee : 0n) : maximum - (!buy ? fee : 0n)), deadline: request.deadline,
    branches: [{ amountIn: String(routed), hops: [{ zeroForOne: true, pool: { id: "fixture-v4", protocol: "v4" as const,
      token0: { address: tokenIn, decimals: 18, chainId: context.chainId }, token1: { address: tokenOut, decimals: 18, chainId: context.chainId },
      feePips: 100, tickSpacing: 1, hooks: `0x${"0".repeat(40)}`, poolManager: helpers } }] }] };
  return { operation: "market", side: request.side, mode: request.mode, tokenIn, tokenOut,
    amountIn: String(routed), amountOut: route.outputAmount, totalInput: String(total), netOutput: String(net),
    grossOutput: route.outputAmount, routedAmountIn: String(routed), inputMaximum: String(maximum), outputMinimum: String(minimum),
    refundDust: String(!buy && exactIn ? amount - routed - fee : 0n), fee: feeFact, params, adapterData: params.data,
    plan: { side: request.side, mode: request.mode, amount: request.amount, slippageBps: request.slippageBps ?? 100, route, params, fee: feeFact },
    context, qualification: "quoter", feeBeneficiaryDisplay: { address: helpers, observedAt: context.observedAt }, metrics: { candidateCalls: 1, totalMs: 1 } };
}

export function marketModelFixture(request: MarketModelRequest): MarketQuoteModelPacket {
  const quote = marketFixture({ ...request, amount: "1000000000000000000", recipient: helpers, deadline: "1900000000" });
  return { namespace: "market", family: marketModelFamily(request), intent: { ...request, adapter: request.adapter ?? protocolAddresses.adapter }, cygld: core, feeRatePpm: 1000, context,
    routes: [{ route: quote.plan.route, amountIn: "0", amountOut: "0", points: [], exchangeRate: { numerator: "1", denominator: "1" },
      feeRetention: { numerator: "1", denominator: "1" }, localImpact: { numerator: "0", denominator: "1" } }] };
}

export async function installMarket(page: Page, waitForQuote?: () => Promise<void>) {
  const coreObservations = await install(page);
  const requests: MarketQuoteRequest[] = [], models: MarketModelRequest[] = [];
  await page.route("**/api/quotes/market/**", async route => {
    if (new URL(route.request().url()).pathname.endsWith("/model")) {
      const request = route.request().postDataJSON(); models.push(request);
      await route.fulfill({ json: marketModelFixture(request) }); return;
    }
    const request = route.request().postDataJSON(); requests.push(request);
    await waitForQuote?.();
    await route.fulfill({ contentType: "application/x-ndjson", body:
      JSON.stringify({ type: "complete", value: marketFixture(request) }) + "\n" });
  });
  return { requests, models, coreObservations };
}
