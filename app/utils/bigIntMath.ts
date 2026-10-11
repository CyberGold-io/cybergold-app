// 10^decimals as bigint, e.g. for 18 decimals it returns 10^18 as bigint:
export const pow10 = (decimals: number): bigint => 10n ** BigInt(decimals);

// floor (default, deterministic)
export const mulDiv = (a: bigint, b: bigint, denom: bigint): bigint => {
  if (denom === 0n) throw new Error("mulDiv: denom is 0");
  return (a * b) / denom;
};

// optional: round half up - to review a need
export const mulDivRound = (a: bigint, b: bigint, denom: bigint): bigint => {
  if (denom === 0n) throw new Error("mulDivRound: denom is 0");
  return (a * b + denom / 2n) / denom;
};