export function sameAddressOrder(
  actual: readonly string[] | undefined,
  expected: readonly string[]
) {
  return (
    actual !== undefined &&
    actual.length === expected.length &&
    actual.every(
      (address, index) =>
        address.toLowerCase() === expected[index]?.toLowerCase()
    )
  );
}
