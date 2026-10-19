import { defineWalletSetup } from "@synthetixio/synpress-cache";
import { walletOnboardingStep } from "../tests/trading/runnerDiagnostics.ts";
import { importMetaMaskWallet } from "../tests/metamask/import-wallet.ts";

const seedPhrase = process.env.SYNPRESS_WALLET_SEED_PHRASE;
const walletPassword = process.env.SYNPRESS_WALLET_PASSWORD;

if (!seedPhrase) throw new Error("SYNPRESS_WALLET_SEED_PHRASE is required");
if (!walletPassword) throw new Error("SYNPRESS_WALLET_PASSWORD is required");

export default defineWalletSetup(
  walletPassword,
  async (context, walletPage) => {
    console.log("[metamask-setup] initial-url", walletPage.url());
    walletOnboardingStep(context, "focus");
    await walletPage.bringToFront();
    walletOnboardingStep(context, "import-button");
    await walletPage.getByTestId("onboarding-import-wallet").waitFor({ state: "visible", timeout: 20_000 });
    console.log("[metamask-setup] import-button-visible");

    walletOnboardingStep(context, "import-wallet");
    await importMetaMaskWallet(context as unknown as Parameters<typeof importMetaMaskWallet>[0],
      walletPage as unknown as Parameters<typeof importMetaMaskWallet>[1], seedPhrase, walletPassword);
    console.log("[metamask-setup] import-wallet-finished", walletPage.url());

    const onboardingCompleteButton = walletPage.getByTestId("onboarding-complete-done");
    walletOnboardingStep(context, "completion-check");
    const shouldFinishOnboarding = await onboardingCompleteButton.isVisible().catch(() => false);
    if (shouldFinishOnboarding) {
      console.log("[metamask-setup] completion-button-visible");
      walletOnboardingStep(context, "completion-click");
      await onboardingCompleteButton.click();
      console.log("[metamask-setup] completion-button-clicked", walletPage.url());
      walletOnboardingStep(context, "completion-hidden");
      await onboardingCompleteButton.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {
        console.log("[metamask-setup] completion-button-still-visible", walletPage.url());
      });
      walletOnboardingStep(context, "completion-settle");
      await walletPage.waitForLoadState("domcontentloaded").catch(() => undefined);
      await walletPage.waitForTimeout(1000);
      console.log("[metamask-setup] completion-settled", walletPage.url());
    } else {
      console.log("[metamask-setup] completion-button-not-visible", walletPage.url());
    }
    walletOnboardingStep(context, "complete");
  }
);
