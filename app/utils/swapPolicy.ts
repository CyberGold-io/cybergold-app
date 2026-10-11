export const DEFAULT_SLIPPAGE_BPS = 100; // 1% execution tolerance.

export const SLIPPAGE_POLICY = {
  SLIPPAGE_BPS: BigInt(DEFAULT_SLIPPAGE_BPS),
  BPS_DENOMINATOR: 10_000n, // basis points in 100%, used for slippage calculations
} as const;

export const applySlippageFloor = (amount: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS) => {
  if (amount === 0n) return 0n;
  const floored =
    (amount *
      (SLIPPAGE_POLICY.BPS_DENOMINATOR - BigInt(slippageBps))) /
    SLIPPAGE_POLICY.BPS_DENOMINATOR;
  return floored === 0n ? 1n : floored;
};

export const applySlippageCeil = (amount: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS) => {
  const numerator =
    amount *
    (SLIPPAGE_POLICY.BPS_DENOMINATOR + BigInt(slippageBps));
  return (
    (numerator + SLIPPAGE_POLICY.BPS_DENOMINATOR - 1n) /
    SLIPPAGE_POLICY.BPS_DENOMINATOR
  );
};

export const SWAP_DEADLINE_TTL_SEC = 600n; // 10 minutes
export const PERMIT_DEADLINE_TTL_SEC = 1200n; // 20 minutes

export const DEADLINE_POLICY = {
  SWAP_DEADLINE_TTL_SEC,
  PERMIT_DEADLINE_TTL_SEC,
} as const;

export function buildDeadline(ttlSec: bigint = SWAP_DEADLINE_TTL_SEC): bigint {
  return BigInt(Math.floor(Date.now() / 1000)) + ttlSec;
}

const quoteDeadlines = new Map<string, { createdAt: number; deadline: bigint }>();
/** Keep exact preview calldata stable during the existing 10 s reuse window. */
export function buildQuoteDeadline(scope?: string): bigint {
  if (!scope) return buildDeadline();
  const now = performance.now();
  const retained = quoteDeadlines.get(scope);
  if (retained && now - retained.createdAt < 10_000) return retained.deadline;
  const deadline = buildDeadline();
  quoteDeadlines.set(scope, { createdAt: now, deadline });
  while (quoteDeadlines.size > 64) quoteDeadlines.delete(quoteDeadlines.keys().next().value!);
  return deadline;
}

export const GAS_POLICY = {
  ISSUE_BASE_GAS: 360_000n,
  ISSUE_PER_TOKEN_GAS: 55_000n,
  REDEEM_BASE_GAS: 280_000n,
  REDEEM_PER_TOKEN_GAS: 20_000n,
} as const;

export const UNISWAP_FEE_POLICY = {
  FEE_CANDIDATES: [100, 500, 3000, 10000] as const, // candidate fee tiers for direct pool routing
  VIA_WETH_FEE_CANDIDATES: [500, 3000, 10000] as const, // candidate fee tiers for token->WETH and WETH->token routing
} as const;
