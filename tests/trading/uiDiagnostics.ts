import { errors, type Page } from "@playwright/test";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import { quoteDiagnostics, safeDiagnosticReferences, safeQuoteDiagnostics, type QuoteDiagnostics } from "../../app/utils/diagnosticReferences.ts";
import { knownQuoteError, type QuotePreviewError } from "../../app/utils/quoteErrors.ts";
import { failureResult, RegressionAssertionError, tokenRequest, type ScenarioResult, type UiObservationPhase } from "./regression.ts";
import { ScenarioUnavailableError, type Scenario } from "./scenarios.ts";
import type { UiSwapObservation } from "./uiSwapObservation.ts";
import { browserQuoteMatcher } from "./browserQuoteObservation.ts";
import { safeRunnerError } from "./runnerDiagnostics.ts";

/** Core confirmation appears in both the receipt card and its existing toast. */
export function confirmedTransactionText(page: Page) {
  return page.getByText(/^Transaction confirmed$/i).filter({ visible: true }).first();
}

/** Scope optional UI evidence to the latest original request for this case. */
export function createUiQuoteDiagnostics(scenario: Scenario, config: ProtocolConfiguration) {
  const expected = scenario.asset === "BASKET" ? undefined : tokenRequest(scenario, config, config.contracts.helpers!);
  const universalMatches = browserQuoteMatcher(scenario, config, scenario.amountRaw ?? "0", scenario.basketAssets ?? []);
  let refs = {} as ReturnType<typeof safeDiagnosticReferences>;
  let reason: QuotePreviewError["code"] | undefined;
  let work: QuoteDiagnostics | undefined;
  return {
    request(path: string, body: unknown, attempt: unknown) {
      if (!body || typeof body !== "object") return false;
      const value = body as Record<string, unknown>;
      if (path === "/api/economic-quotes" || path === "/api/quotes/universal-exact-input") {
        if (!universalMatches({ path, request: value, status: 0 })) return false;
      } else if (expected) {
        if (path !== "/api/quotes/trade/stream" || value.mode !== expected.mode || value.side !== expected.side
          || value.amount !== expected.amount || value.native !== expected.native
          || typeof value.counterToken !== "string" || value.counterToken.toLowerCase() !== expected.counterToken.toLowerCase()) return false;
      } else {
        if (path !== "/api/quotes/basket-preview" || value.mode !== `${scenario.side === "buy" ? "issue" : "redeem"}-${scenario.inputMode}`) return false;
        const amounts = value.netCygldOut ?? value.grossCygldIn ?? value.maximumAmountsIn
          ?? (Array.isArray(value.minimumOutputs) ? value.minimumOutputs.map(row => row.minimumAmount) : []);
        if (!(Array.isArray(amounts) ? amounts : [amounts]).some(amount => typeof amount === "string" && /^[1-9][0-9]*$/.test(amount))) return false;
      }
      const safe = safeDiagnosticReferences({ attemptId: attempt });
      if (!safe.attemptId) return false;
      refs = safe; reason = undefined; work = undefined; return true;
    },
    diagnostic(event: unknown) {
      if (!event || typeof event !== "object") return false;
      const value = event as Record<string, unknown>, safe = safeDiagnosticReferences(value);
      if (value.operation !== "quote" || !refs.attemptId || safe.attemptId !== refs.attemptId) return false;
      refs = { ...refs, ...safe };
      reason = value.outcome === "failed" ? knownQuoteError({ code: value.errorClassification })?.code : undefined;
      work = value.outcome === "failed" ? quoteDiagnostics(value) : undefined;
      return true;
    },
    snapshot() { return { refs: { ...refs }, reason, quoteDiagnostics: safeQuoteDiagnostics(work) }; },
  };
}

/** Label the existing assertion without changing its predicate or fail status. */
export async function uiPreparationAssertion(code: "ui-quoted-amount-not-ready" | "ui-swap-not-enabled", assertion: () => Promise<unknown>) {
  try { await assertion(); } catch (error) {
    if (error && typeof error === "object" && "matcherResult" in error) throw new RegressionAssertionError(code);
    throw error;
  }
}

const completionDeadlines = new WeakSet<object>();
/** The existing UI completion poll exhausted its own deadline, not an arbitrary UI error. */
export function isUiCompletionDeadlineError(error: unknown) {
  return typeof error === "object" && error !== null && completionDeadlines.has(error);
}

export async function uiCompletionAssertion(assertion: () => Promise<unknown>, submitted: () => boolean) {
  try { await assertion(); } catch (error) {
    if (error && typeof error === "object" && "matcherResult" in error) {
      const failure = submitted() ? new ScenarioUnavailableError("submitted-unconfirmed")
        : new RegressionAssertionError("ui-completion-not-observed");
      completionDeadlines.add(failure);
      throw failure;
    }
    throw error;
  }
}

/** An App-reported revert is a terminal UI failure, not independent receipt proof. */
export function uiSwapTerminalFailure(observation: UiSwapObservation | undefined) {
  if (observation?.outcome === "reverted" && observation.transactionHash)
    return new RegressionAssertionError("product-reported-revert");
}

/** A constant caller phase fills only the missing context of a generic error or deadline. */
export function uiObservationFailure(result: ScenarioResult, error: unknown, phase: UiObservationPhase) {
  const failed = failureResult(result, error);
  return (failed.code === "unexpected-error" || failed.code === "service-unavailable") && !failed.reason ? { ...failed, reason: phase } : failed;
}

/** Keep the existing setup failure classification with only projected diagnostics. */
export function uiSetupFailure(result: ScenarioResult, error: unknown,
  evidence: Pick<ScenarioResult, "refs" | "reason" | "quoteDiagnostics">) {
  return { ...safeRunnerError(error), ...failureResult({ ...result, ...evidence }, error),
    code: error instanceof errors.TimeoutError ? "ui-setup-timeout" : "ui-setup-failed" };
}
