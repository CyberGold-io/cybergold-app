import type { Address } from "viem";
import type { FlowState, QuoteTarget } from "../types";

type IssueExactInBudget = {
  outputAsset: Address;
  amountIn: bigint;
};

type IssueExactOutTarget = {
  outputAsset: Address;
  amountOut: bigint;
};

type RedeemExactInSource = {
  inputAsset: Address;
  inputAmount: bigint;
};

type BuildQuoteTargetsArgs = {
  flowState: FlowState | undefined;
  issueInputTokenAddress: Address | undefined;
  redeemOutputTokenAddress: Address | undefined;
  issueExactInBudgets: IssueExactInBudget[];
  issueExactOutTargets: IssueExactOutTarget[];
  redeemExactInSources: RedeemExactInSource[];
  debug?: (message: string, payload: Record<string, unknown>) => void;
};

export function buildQuoteTargets({
  flowState,
  issueInputTokenAddress,
  redeemOutputTokenAddress,
  issueExactInBudgets,
  issueExactOutTargets,
  redeemExactInSources,
  debug,
}: BuildQuoteTargetsArgs): QuoteTarget[] {
  if (!flowState || flowState.route !== "token") {
    debug?.("build-quote-targets-skipped", {
      reason: "unsupported-flow",
      flowState,
    });
    return [];
  }

  if (flowState.direction === "issue" && flowState.inputMode === "exact-in") {
    if (!issueInputTokenAddress) {
      debug?.("build-quote-targets-skipped", {
        reason: "missing-issue-input-token",
        flowState,
      });
      return [];
    }
    const targets = issueExactInBudgets.map((budget) => ({
      inputAsset: issueInputTokenAddress,
      outputAsset: budget.outputAsset,
      amount: budget.amountIn,
    }));
    debug?.("build-quote-targets", {
      flow: "issue-token-exact-in",
      targetsCount: targets.length,
    });
    return targets;
  }

  if (flowState.direction === "issue" && flowState.inputMode === "exact-out") {
    if (!issueInputTokenAddress) {
      debug?.("build-quote-targets-skipped", {
        reason: "missing-issue-input-token",
        flowState,
      });
      return [];
    }
    const targets = issueExactOutTargets
      .filter(
        (target) =>
          target.outputAsset.toLowerCase() !== issueInputTokenAddress.toLowerCase()
      )
      .map((target) => ({
        inputAsset: issueInputTokenAddress,
        outputAsset: target.outputAsset,
        amount: target.amountOut,
      }));
    debug?.("build-quote-targets", {
      flow: "issue-token-exact-out",
      targetsCount: targets.length,
    });
    return targets;
  }

  if (flowState.direction === "redeem" && flowState.inputMode === "exact-in") {
    if (!redeemOutputTokenAddress) {
      debug?.("build-quote-targets-skipped", {
        reason: "missing-redeem-output-token",
        flowState,
      });
      return [];
    }
    const targets = redeemExactInSources.map((source) => ({
      inputAsset: source.inputAsset,
      outputAsset: redeemOutputTokenAddress,
      amount: source.inputAmount,
    }));
    debug?.("build-quote-targets", {
      flow: "redeem-token-exact-in",
      targetsCount: targets.length,
    });
    return targets;
  }

  debug?.("build-quote-targets-skipped", {
    reason: "unhandled-flow",
    flowState,
  });
  return [];
}
