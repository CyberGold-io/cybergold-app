import { readFile, rename, writeFile } from "node:fs/promises";
import { basename } from "node:path";

export const runnerStages = ["origin", "config-facts", "wallet-cache", "wallet-tests", "independent-report", "ui-report", "fork-qualification", "complete"] as const;
export const walletSetupStages = ["setup-import", "profile", "extension", "browser-launch", "extension-worker", "wallet-onboarding", "wallet-ready", "browser-close"] as const;
export const walletOnboardingSteps = ["navigation", "focus", "other-pages-close", "setup-callback", "import-button", "import-wallet", "completion-check", "completion-click", "completion-hidden", "completion-settle", "complete"] as const;
export type WalletOnboardingDiagnostic = { step: typeof walletOnboardingSteps[number]; elapsedMs: number };
const errorClasses = new Set(["Error", "TypeError", "SyntaxError", "TimeoutError", "AbortError", "ReferenceError", "RangeError", "AggregateError", "UnknownError", "SystemError"]);
const errorCodes = new Set(["ENOENT", "EACCES", "EROFS", "ENOSPC", "ENOMEM"]);
const signals = new Set(["SIGINT", "SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV", "SIGILL", "SIGTRAP"]);
export type SafeRunnerError = { errorClass: string; errorCode?: string };
export type WalletSetupDiagnostic = { stage: typeof walletSetupStages[number]; result: "running" | "pass" | "fail"; onboarding?: WalletOnboardingDiagnostic } & Partial<SafeRunnerError>;
export type WalletRequestDiagnostic = {
  method: "eth_sendTransaction" | "eth_signTypedData_v4"; settlement: "pending" | "fulfilled" | "rejected";
  elapsedMs: number; pendingBefore: number; pendingAfter: number; deadlineExpired?: boolean;
  notificationSelection?: "existing-notification" | "existing-extension" | "created"; notificationViewCount?: number;
  clickAttempts: number; clickCompleted: number; lastClickErrorClass?: string;
  lastClickErrorKind?: "ambiguous" | "timeout" | "closed" | "other";
};
export type WalletTestDiagnostics = Partial<Record<"ui" | "independent", WalletSetupDiagnostic>>;
export type RunnerDiagnostic = { stage: typeof runnerStages[number]; exitCode?: number; signal?: string;
  walletSetup?: WalletSetupDiagnostic; walletTests?: WalletTestDiagnostics } & Partial<SafeRunnerError>;

const onboardingObservers = new WeakMap<object, (step: WalletOnboardingDiagnostic["step"]) => void>();
/** In-memory only; callers attach snapshots to their existing checkpoint writes. */
export function observeWalletOnboarding(context: object) {
  const started = performance.now();
  let step: WalletOnboardingDiagnostic["step"] = "navigation", finished: number | undefined;
  onboardingObservers.set(context, value => { step = value; });
  return {
    snapshot: (): WalletOnboardingDiagnostic => ({ step, elapsedMs: Math.max(0, Math.round((finished ?? performance.now()) - started)) }),
    stop: () => { finished ??= performance.now(); onboardingObservers.delete(context); },
  };
}
export function walletOnboardingStep(context: object, step: WalletOnboardingDiagnostic["step"]) {
  try { onboardingObservers.get(context)?.(step); } catch { /* Optional observation cannot replace setup's outcome. */ }
}
export function safeWalletClickError(error: unknown) {
  try {
    const source = error as { message?: unknown } | undefined;
    const message = typeof source?.message === "string" ? source.message : "";
    const kind = /strict mode violation/.test(message) ? "ambiguous" as const
      : /Target page, context or browser has been closed|Target closed/.test(message) ? "closed" as const
      : safeRunnerError(error).errorClass === "TimeoutError" ? "timeout" as const : "other" as const;
    return { lastClickErrorClass: safeRunnerError(error).errorClass, lastClickErrorKind: kind };
  } catch { return { lastClickErrorClass: "UnknownError", lastClickErrorKind: "other" as const }; }
}

export function walletFixtureOutput(file: string, environment: Record<string, string | undefined> = process.env) {
  if (basename(file) === "fixed-api-roundtrips.spec.ts") return environment.TRADE_REGRESSION_UI_FIXTURE_OUTPUT;
  if (basename(file) === "regression-execution.spec.ts") return environment.TRADE_REGRESSION_INDEPENDENT_FIXTURE_OUTPUT;
}

/** Exception messages, stacks and arbitrary names can contain signing data. */
export function safeRunnerError(error: unknown): SafeRunnerError {
  const source = error as { name?: string; code?: string } | undefined;
  return { errorClass: errorClasses.has(source?.name ?? "") ? source!.name! : "UnknownError",
    ...(errorCodes.has(source?.code ?? "") ? { errorCode: source!.code } : {}) };
}
export function safeCommandResult(code: number | null, signal: string | null) {
  return { ...(Number.isInteger(code) && code! >= 0 && code! <= 255 ? { exitCode: code! } : {}),
    ...(signals.has(signal ?? "") ? { signal: signal! } : {}) };
}
export async function writeWalletSetupDiagnostic(path: string | undefined, value: WalletSetupDiagnostic) {
  if (!path) return;
  try {
    await writeFile(path + ".tmp", JSON.stringify(value) + "\n");
    await rename(path + ".tmp", path);
  } catch { /* Optional observations never change wallet setup's result. */ }
}
export async function readWalletSetupDiagnostic(path: string): Promise<WalletSetupDiagnostic | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!walletSetupStages.includes(value.stage) || !["running", "pass", "fail"].includes(value.result)) return;
    return { stage: value.stage, result: value.result,
      ...(errorClasses.has(value.errorClass) ? { errorClass: value.errorClass } : {}),
      ...(errorCodes.has(value.errorCode) ? { errorCode: value.errorCode } : {}),
      ...(walletOnboardingSteps.includes(value.onboarding?.step) && Number.isSafeInteger(value.onboarding?.elapsedMs)
        && value.onboarding.elapsedMs >= 0 ? { onboarding: { step: value.onboarding.step, elapsedMs: value.onboarding.elapsedMs } } : {}) };
  } catch { /* A missing diagnostic is independent of the operation. */ }
}

export async function readWalletTestDiagnostics(paths: Record<"ui" | "independent", string>): Promise<WalletTestDiagnostics> {
  const [ui, independent] = await Promise.all([readWalletSetupDiagnostic(paths.ui), readWalletSetupDiagnostic(paths.independent)]);
  return { ...(ui ? { ui } : {}), ...(independent ? { independent } : {}) };
}
