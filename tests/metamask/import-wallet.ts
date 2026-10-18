import type { BrowserContext, Page } from "@playwright/test";
import { walletOnboardingStep, type WalletOnboardingDiagnostic } from "../trading/runnerDiagnostics.ts";

/** Synpress 0.0.14's public MetaMask import sequence, with safe action progress.
 * Its whole-phrase typing crosses React's textarea-to-word-input transition and
 * can lose words. Use MetaMask's existing paste handler once for SRP entry.
 */
export async function importMetaMaskWallet(context: BrowserContext, page: Page, seedPhrase: string, password: string) {
  const action = async (step: WalletOnboardingDiagnostic["step"], perform: () => Promise<unknown>) => {
    walletOnboardingStep(context, step);
    await perform();
  };
  await action("import-choice", () => page.getByTestId("onboarding-import-wallet").click());
  await action("import-srp-choice", () => page.getByTestId("onboarding-import-with-srp-button").click());
  await action("import-srp-fill", async () => {
    await page.getByTestId("srp-input-import__srp-note").click();
    const session = await context.newCDPSession(page);
    let failed = false;
    try {
      const tree = await session.send("Page.getFrameTree");
      const world = await session.send("Page.createIsolatedWorld", {
        frameId: tree.frameTree.frame.id, worldName: "cybergold-owned-wallet-import",
      });
      // MetaMask scuttles main-world evaluation. This owned isolated world uses
      // the existing DOM paste handler without clipboard access or permissions.
      // Pass the phrase as an argument; never place it in executable source.
      const response = await session.send("Runtime.callFunctionOn", {
        executionContextId: world.executionContextId,
        functionDeclaration: `function(selector, phrase) {
          const field = document.querySelector(selector);
          const data = new DataTransfer();
          data.setData("text/plain", phrase);
          field.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
        }`,
        arguments: [{ value: '[data-testid="srp-input-import__srp-note"]' }, { value: seedPhrase }],
        returnByValue: true,
      });
      if (response.exceptionDetails) throw new Error("wallet-seed-paste-failed");
    } catch (error) { failed = true; throw error; }
    finally {
      try { await session.detach(); }
      catch (error) { if (!failed) throw error; }
    }
  });
  await action("import-srp-confirm", () => page.getByTestId("import-srp-confirm").click());
  await action("import-password-fill", () => page.getByTestId("create-password-new-input").type(password, { delay: 20 }));
  await action("import-password-confirm", () => page.getByTestId("create-password-confirm-input").type(password, { delay: 20 }));
  await action("import-password-terms", () => page.getByTestId("create-password-terms").click());
  await action("import-password-submit", () => page.getByTestId("create-password-submit").click());
  // The pinned MetaMask UI starts opted in. Synpress clicks this to opt out.
  await action("import-metrics-opt-out", () => page.locator("#metametrics-opt-in").click());
  await action("import-metrics-confirm", () => page.getByTestId("metametrics-i-agree").click());
}
