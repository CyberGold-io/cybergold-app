import { errors, expect, type Page } from "@playwright/test";
import { notification, walletRequestButton } from "../metamask/wallet-ui.ts";
import { getSwapButton } from "../metamask/token-flows/helpers.ts";
import { confirmedTransactionText, uiCompletionAssertion } from "./uiDiagnostics.ts";
import type { UiConfirmationDiagnostic } from "./runnerDiagnostics.ts";

export type UiCompletionObservationPhase = "before-action" | "after-action";

/** Observe the original UI flow without opening another confirmation window. */
export async function approveUntilMined(page: Page, submitted: () => boolean, observe: (phase: UiCompletionObservationPhase) => Promise<Error | undefined> = async () => undefined,
  nativeProgress: ((event: { selection?: Pick<UiConfirmationDiagnostic, "notificationSelection" | "notificationViewCount">;
    click?: "attempted" | "completed"; error?: unknown; view?: Page }) => void) | undefined = undefined, deadline: number) {
  const record = (event: Parameters<NonNullable<typeof nativeProgress>>[0]) => {
    try { nativeProgress?.(event); } catch { /* Optional evidence cannot change a native action. */ }
  };
  const success = confirmedTransactionText(page);
  const failure = page.getByText(/^Transaction failed$/i);
  const remaining = () => Math.max(0, deadline - performance.now());
  const inspect = async (phase: UiCompletionObservationPhase) => {
    if (!remaining()) return false;
    let terminalFailure: Error | undefined;
    try { terminalFailure = await observe(phase); } catch { /* Optional evidence never changes the UI assertion. */ }
    if (terminalFailure) throw terminalFailure;
    if (!remaining()) return false;
    if (await failure.isVisible()) throw new Error((await page.locator("[data-sonner-toast]").allTextContents()).join(" | "));
    const visible = await success.isVisible();
    return visible && remaining() > 0;
  };
  await uiCompletionAssertion(async () => {
    const timeout = remaining();
    // A zero Playwright timeout means unlimited, not an expired original window.
    if (!timeout) { expect(false).toBe(true); return; }
    let pollIndex = 0;
    const intervals = [250, 500, 1000];
    await expect.poll(async () => {
      const nextInterval = intervals[Math.min(pollIndex++, intervals.length - 1)];
      const finishPoll = async () => {
        if (await inspect("after-action")) return true;
        if (remaining() > nextInterval) return false;
        // Playwright otherwise stops when its next interval cannot fit. Spend
        // only that original remainder on local observations, never more clicks
        // or optional receipt HTTP. Late completion still fails the same deadline.
        while (remaining() > 0) {
          await new Promise<void>(resolve => setTimeout(resolve, Math.min(50, remaining())));
          if (await inspect("after-action")) return true;
        }
        return false;
      };
      if (await inspect("before-action")) return true;
      if (!remaining()) return false;
      // A temporary confirmation read failure exposes the product's existing
      // receipt-only recovery. Exercise it within this same completion window;
      // never click Swap again or create another wallet request.
      const recheck = page.getByRole("button", { name: /^Check confirmation$/i });
      if (await recheck.isVisible() && await recheck.isEnabled()) {
        const timeout = Math.min(1000, remaining());
        if (!timeout) return false;
        await recheck.click({ timeout }).catch(error => {
          if (!(error instanceof errors.TimeoutError)) throw error;
        });
        return finishPoll();
      }
      const step = await (await getSwapButton(page)).innerText();
      if (!remaining()) return false;
      if (!/^MetaMask \d+ of \d+:/.test(step)) return finishPoll();
      const popup = await notification(page, selection => record({ selection }), walletRequestButton);
      if (popup) {
        // Selection and click use the same native request control.
        const confirm = walletRequestButton(popup);
        // A native request can navigate or close between polls. Let one click
        // check visibility/enabled state atomically, then re-read the App result.
        try {
          const timeout = Math.min(1000, remaining());
          if (!timeout) return false;
          record({ click: "attempted" });
          await confirm.click({ timeout });
          record({ click: "completed" });
        } catch (error) {
          record({ error, view: popup });
          if (!(error instanceof errors.TimeoutError) && !popup.isClosed()) throw error;
        }
      }
      // The final native click can finish when no polling interval fits. Read the
      // existing UI criterion now, within the same original absolute deadline.
      return finishPoll();
    }, { timeout, intervals: [...intervals] }).toBe(true);
  }, submitted);
}
