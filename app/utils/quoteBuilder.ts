import type { QuoteMode, RouteQuoteCandidate } from "../types";

// Keep the better quote:
// - exact-in: maximize output
// - exact-out: minimize required input
export function considerCandidate(
  currentBest: RouteQuoteCandidate | undefined,
  mode: QuoteMode,
  candidate: RouteQuoteCandidate
): RouteQuoteCandidate {
  if (!currentBest) return candidate;

  const isBetter =
    mode === "exact-in"
      ? candidate.quote > currentBest.quote
      : candidate.quote < currentBest.quote;

  return isBetter ? candidate : currentBest;
}

type QuoteTarget = {
  inputAsset: `0x${string}`;
  outputAsset: `0x${string}`;
  amount: bigint;
};

type QuoteExactInputFn = (args: {
  path: `0x${string}`;
  amountIn: bigint;
}) => Promise<unknown>;

type QuoteExactOutputFn = (args: {
  path: `0x${string}`;
  amountOut: bigint;
}) => Promise<unknown>;

type DebugLogger = (message: string, payload: Record<string, unknown>) => void;

export async function tryPathQuote(params: {
  path: `0x${string}`;
  target: QuoteTarget;
  mode: QuoteMode;
  quoteExactInput: QuoteExactInputFn;
  quoteExactOutput: QuoteExactOutputFn;
  debug?: DebugLogger;
}): Promise<bigint | undefined> {
  const {
    path,
    target,
    mode,
    quoteExactInput,
    quoteExactOutput,
    debug,
  } = params;

  debug?.("trying-path", {
    input: target.inputAsset,
    output: target.outputAsset,
    amount: target.amount.toString(),
    quoteMode: mode,
    path,
  });

  const quote =
    mode === "exact-in"
      ? await quoteExactInput({
          path,
          amountIn: target.amount,
        })
      : await quoteExactOutput({
          path,
          amountOut: target.amount,
        });

  debug?.("path-quote-result", {
    path,
    quote: String(quote),
  });

  return typeof quote === "bigint" && quote > 0n ? quote : undefined;
}
