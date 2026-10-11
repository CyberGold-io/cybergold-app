export function observeApprovalConfirmation(confirmation: Promise<unknown>) {
  return confirmation.then(
    () => ({ status: "fulfilled" } as const),
    reason => ({ status: "rejected", reason } as const),
  );
}

/** Signing can overlap mining; the permit cannot reach the swap until both finish. */
export async function preparePermitWithPendingApproval<T>(
  confirmation: ReturnType<typeof observeApprovalConfirmation>,
  preparePermit: () => Promise<T>,
): Promise<T> {
  const permit = await preparePermit();
  const result = await confirmation;
  if (result.status === "rejected") throw result.reason;
  return permit;
}
