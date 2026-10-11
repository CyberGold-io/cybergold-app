import { protocolAddresses } from "../../fixtures/protocol-configuration";
import { encodeUniswapAdapterData } from "../../../app/utils/encodeUniswapAdapterData";
import type { QuoteIntentRequest } from "../../../app/utils/quoteIntent";
import { context } from "./token-quotes";

const usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const usdt = "0xdac17f958d2ee523a2206206994597c13d831ec7";
export function intentFixture(request: QuoteIntentRequest, phase: "first" | "better" | "complete" = "complete", current = context) {
  const decimal = [usdc, usdt].includes(request.quoteToken.toLowerCase()) ? 6n : 18n;
  const exactIn = request.mode.endsWith("exact-in"), issue = request.mode.startsWith("issue");
  const amount = BigInt(request.amount), fees = { protocolFeeCygld: "0", helperFeeCygld: "0" };
  const base = issue === exactIn ? amount * 10n ** 18n / 10n ** decimal : amount * 10n ** decimal / 10n ** 18n;
  const provisional = base * (exactIn ? phase === "first" ? 1n : 2n : phase === "first" ? 2n : 1n);
  // Non-progressive fixtures preserve the original unit-price contract.
  const display = phase === "complete" ? base : provisional;
  const execution = issue ? exactIn ? display : amount : exactIn ? amount : display;
  const slippageBps = request.slippageBps ?? 100;
  const minimum = (value: bigint) => value === 0n ? 0n : value * (10_000n - BigInt(slippageBps)) / 10_000n || 1n;
  const maximum = (value: bigint) => (value * (10_000n + BigInt(slippageBps)) + 9_999n) / 10_000n;
  const maximumInput = issue ? exactIn ? amount : maximum(display) : 0n;
  const minimumOutput = exactIn ? minimum(display) : amount;
  const projectedCoreOutputs = request.orderedAssets.map(token => ({ kind: 0, token, id: "0", amount: String(amount) }));
  const preview = issue ? { orderedCoreAssets: request.orderedAssets, fees }
    : { projectedCoreOutputs, minimumAmountOut: String(minimumOutput), fees };
  const quotes = request.orderedAssets.filter(token => token.toLowerCase() !== request.quoteToken.toLowerCase()).map(token => {
    const [inputAsset, outputAsset] = issue ? [request.quoteToken, token] : [token, request.quoteToken];
    const path = `0x${(issue ? outputAsset : inputAsset).slice(2)}0001f4${(issue ? inputAsset : outputAsset).slice(2)}` as `0x${string}`;
    const inputLimit = exactIn ? amount : maximum(display);
    const outputLimit = issue ? amount : minimumOutput;
    const leg = { adapter: request.adapter ?? protocolAddresses.adapter, minimumAmountOut: String(outputLimit),
      data: encodeUniswapAdapterData(path, issue ? inputLimit : outputLimit, BigInt(request.deadline), !issue) };
    return issue ? { ...leg, outputAsset, amountIn: String(inputLimit) }
      : { ...leg, inputAsset, inputAmount: String(amount) };
  });
  return { mode: request.mode, context: current, quotes, preview,
    initialPreview: issue && exactIn ? { orderedCoreAssets: request.orderedAssets, netCygldOut: String(display), fees } : null,
    basketPreview: issue ? { orderedCoreAssets: request.orderedAssets, amountsInExact: request.orderedAssets.map(() => String(amount)), fees }
      : { projectedCoreOutputs, fees },
    displayAmount: String(display), executionAmount: String(execution), maximumInputAmount: String(maximumInput),
    slippageBps, expectedInputAmount: issue ? String(exactIn ? amount : display) : undefined,
    metrics: { rpcReads: 1, rpcReadsRequested: 1, rpcReadsCoalesced: 0, rpcReadsReused: 0, candidateCalls: quotes.length, iterations: 0, totalMs: 1 } };
}
