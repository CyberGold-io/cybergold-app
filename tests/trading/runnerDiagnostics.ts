import { readFile, rename, writeFile } from "node:fs/promises";
import { basename } from "node:path";

export const runnerStages = ["origin", "config-facts", "wallet-cache", "wallet-tests", "independent-report", "ui-report", "fork-qualification", "complete"] as const;
export const walletSetupStages = ["setup-import", "profile", "extension", "browser-launch", "extension-worker", "wallet-onboarding", "wallet-ready", "browser-close"] as const;
const errorClasses = new Set(["Error", "TypeError", "SyntaxError", "TimeoutError", "AbortError", "ReferenceError", "RangeError", "AggregateError", "UnknownError", "SystemError"]);
const errorCodes = new Set(["ENOENT", "EACCES", "EROFS", "ENOSPC", "ENOMEM"]);
const signals = new Set(["SIGINT", "SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV", "SIGILL", "SIGTRAP"]);
export type SafeRunnerError = { errorClass: string; errorCode?: string };
export type WalletSetupDiagnostic = { stage: typeof walletSetupStages[number]; result: "running" | "pass" | "fail" } & Partial<SafeRunnerError>;
export type WalletTestDiagnostics = Partial<Record<"ui" | "independent", WalletSetupDiagnostic>>;
export type RunnerDiagnostic = { stage: typeof runnerStages[number]; exitCode?: number; signal?: string;
  walletSetup?: WalletSetupDiagnostic; walletTests?: WalletTestDiagnostics } & Partial<SafeRunnerError>;

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
      ...(errorCodes.has(value.errorCode) ? { errorCode: value.errorCode } : {}) };
  } catch { /* A missing diagnostic is independent of the operation. */ }
}

export async function readWalletTestDiagnostics(paths: Record<"ui" | "independent", string>): Promise<WalletTestDiagnostics> {
  const [ui, independent] = await Promise.all([readWalletSetupDiagnostic(paths.ui), readWalletSetupDiagnostic(paths.independent)]);
  return { ...(ui ? { ui } : {}), ...(independent ? { independent } : {}) };
}
