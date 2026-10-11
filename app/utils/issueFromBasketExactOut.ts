const PPM_DENOMINATOR = 1_000_000n;

const ceilDiv = (numerator: bigint, denominator: bigint) => {
  if (denominator <= 0n) {
    throw new Error("ceilDiv: denominator must be positive");
  }
  return numerator === 0n ? 0n : ((numerator - 1n) / denominator) + 1n;
};

export function computeGrossCygldForIssueExactOut(
  targetNetCygldOut: bigint,
  helperFeePpm: bigint,
  issuanceFeePpm: bigint,
) {
  if (targetNetCygldOut <= 0n) return 0n;

  const helperDenominator = PPM_DENOMINATOR - helperFeePpm;
  const issuanceDenominator = PPM_DENOMINATOR - issuanceFeePpm;

  if (helperDenominator <= 0n || issuanceDenominator <= 0n) {
    throw new Error("Invalid fee ppm for IssueFromBasketExactOut");
  }

  const minUserCygld = ceilDiv(targetNetCygldOut * PPM_DENOMINATOR, helperDenominator);
  return ceilDiv(minUserCygld * PPM_DENOMINATOR, issuanceDenominator);
}
