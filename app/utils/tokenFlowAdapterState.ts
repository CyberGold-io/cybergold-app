import { QuotePreviewError, quoteErrorKeys } from "./quoteErrors.ts";

type AdapterApproval = {
  data?: boolean;
  isSuccess: boolean;
  isError: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error?: Error | null;
};

export function tokenFlowAdapterState({
  requiresSwapAdapter,
  hasConfiguredAdapter,
  approval,
}: {
  requiresSwapAdapter: boolean;
  hasConfiguredAdapter: boolean;
  approval: AdapterApproval;
}) {
  // Direct basket-asset transfers and recovery-share outputs do not use an adapter.
  if (!requiresSwapAdapter) return { ready: true, pending: false, error: undefined };
  const error = !hasConfiguredAdapter
    ? "tokenSwapAdapterInvalid" as const
    : approval.isError
      ? approval.error instanceof QuotePreviewError && approval.error.code.startsWith("rpc-")
        ? quoteErrorKeys[approval.error.code]
        : "tokenSwapAdapterApprovalUnavailable" as const
      : approval.data === false
        ? "tokenSwapAdapterNotApproved" as const
        : undefined;
  return {
    ready: hasConfiguredAdapter && approval.isSuccess && approval.data === true,
    pending: hasConfiguredAdapter && approval.data === undefined &&
      (approval.isLoading || approval.isFetching),
    error,
  };
}
