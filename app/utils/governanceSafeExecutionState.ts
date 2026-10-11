import type { HistoryStatus } from "./governanceSafeContracts";

export type SafeReplacementReason = "repriced" | "replaced" | "cancelled";

export type LocalSafeExecutionState =
  | "submitted"
  | "repriced"
  | "replaced"
  | "cancelled"
  | "executed"
  | "failed"
  | "unknown";

export function isLocalSafeExecutionState(value: unknown): value is LocalSafeExecutionState {
  return (
    value === "submitted" ||
    value === "repriced" ||
    value === "replaced" ||
    value === "cancelled" ||
    value === "executed" ||
    value === "failed" ||
    value === "unknown"
  );
}

export function finalHistoryStatusFromLocalState(
  state: LocalSafeExecutionState | undefined
): HistoryStatus | undefined {
  if (state === "executed" || state === "failed") {
    return state;
  }
  return undefined;
}

export function resolveLocalSafeExecutionState(options: {
  safeEventStatus?: HistoryStatus;
  replacementReason?: SafeReplacementReason;
}): LocalSafeExecutionState {
  const { safeEventStatus, replacementReason } = options;
  if (safeEventStatus === "executed" || safeEventStatus === "failed") {
    return safeEventStatus;
  }
  if (replacementReason === "repriced") return "repriced";
  if (replacementReason === "replaced") return "replaced";
  if (replacementReason === "cancelled") return "cancelled";
  return "unknown";
}
