import { expect, type Page } from "@playwright/test";
import { walletRequestButton } from "../metamask/wallet-ui.ts";

export type WalletRequestCleanup = {
  cleanup: "settled" | "context-closed" | "unresolved";
  cleanupElapsedMs: number;
  cleanupClickAttempts: number;
  cleanupClickCompleted: number;
};
const disposalErrors = new WeakSet<object>();
/** Preserve an ordinary teardown error through per-scenario result capture. */
export function isWalletRequestCleanupError(error: unknown): boolean {
  return typeof error === "object" && error !== null && disposalErrors.has(error);
}
/** The owned resource ended; outer fixture teardown handles this ordinary error. */
export function walletRequestContextClosedError() {
  const error = new Error("Wallet browser context closed during native request cleanup.");
  disposalErrors.add(error);
  return error;
}

/** Close this run's owned wallet resource, preserving the original deadline
 * failure. A close failure keeps its ordinary identity for fixture teardown.
 * Callers establish the owner's accepted receipt-deadline condition.
 */
export async function closeOwnedWalletContext(page: Page, originalError: unknown,
  observe: (value: WalletRequestCleanup) => void = () => {}): Promise<never> {
  const started = performance.now();
  let error = originalError;
  let cleanup: WalletRequestCleanup["cleanup"] = "context-closed";
  try { await page.context().close(); } catch (closeError) { error = closeError; cleanup = "unresolved"; }
  try { observe({ cleanup, cleanupElapsedMs: Math.max(0, Math.round(performance.now() - started)),
    cleanupClickAttempts: 0, cleanupClickCompleted: 0 }); } catch { /* Optional close evidence cannot replace the original error. */ }
  const failure = typeof error === "object" && error !== null ? error : new Error("Wallet context cleanup failed.");
  disposalErrors.add(failure);
  throw failure;
}

/** Release an already-owned native request, never submit a replacement.
 * EIP-1193 has no cancellation method. Reject the native prompt; if it cannot
 * settle, dispose the owned browser context so a later case cannot click it.
 * A request can fulfill while rejection is opening: its caller keeps that
 * original result and reconciles it through the existing receipt path.
 */
export async function cleanupOwnedWalletRequest(page: Page, isSettled: () => boolean | Promise<boolean>,
  observe: (value: WalletRequestCleanup) => void = () => {}) {
  const started = performance.now();
  let attempts = 0, completed = 0;
  const snapshot = (cleanup: WalletRequestCleanup["cleanup"]) => {
    const value = { cleanup, cleanupElapsedMs: Math.max(0, Math.round(performance.now() - started)),
      cleanupClickAttempts: attempts, cleanupClickCompleted: completed };
    try { observe(value); } catch { /* Optional evidence cannot replace cleanup. */ }
    return value;
  };
  try {
    await expect.poll(async () => {
      if (await isSettled()) return true;
      const context = page.context();
      const extensionId = new URL(context.serviceWorkers()[0].url()).host;
      for (const popup of context.pages()) {
        if (!popup.url().startsWith(`chrome-extension://${extensionId}/`)) continue;
        const reject = walletRequestButton(popup, true)
          .or(popup.locator('.page-container__footer [data-testid="page-container-footer-cancel"]'));
        try {
          if (!await reject.isVisible()) continue;
          if (await isSettled()) return true;
          attempts++;
          await reject.click({ timeout: 1000 });
          completed++;
        } catch { /* Closed/disabled native views may settle their original request. */ }
        if (await isSettled()) return true;
      }
      return isSettled();
    }, { timeout: 5000, intervals: [100, 250, 500] }).toBe(true);
    return snapshot("settled");
  } catch {
    // Recheck before disposal: the native result may have arrived at the
    // cleanup deadline. Closing a DApp tab alone leaves MetaMask requests alive.
    try { if (await isSettled()) return snapshot("settled"); } catch {}
    try {
      await page.context().close();
      return snapshot("context-closed");
    } catch (error) {
      snapshot("unresolved");
      const failure = typeof error === "object" && error !== null ? error : new Error("Wallet context cleanup failed.");
      disposalErrors.add(failure);
      throw failure;
    }
  }
}
