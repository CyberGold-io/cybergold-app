import { defineWalletSetup } from "@synthetixio/synpress-cache";
import { MetaMask } from "@synthetixio/synpress-metamask/playwright";

type MetaMaskConstructor = ConstructorParameters<typeof MetaMask>;

const seedPhrase = process.env.SYNPRESS_WALLET_SEED_PHRASE;
const walletPassword = process.env.SYNPRESS_WALLET_PASSWORD;

if (!seedPhrase) throw new Error("SYNPRESS_WALLET_SEED_PHRASE is required");
if (!walletPassword) throw new Error("SYNPRESS_WALLET_PASSWORD is required");

export default defineWalletSetup(
  walletPassword,
  async (context, walletPage) => {
    const metamask = new MetaMask(
      context as unknown as MetaMaskConstructor[0],
      walletPage as unknown as MetaMaskConstructor[1],
      walletPassword
    );

    console.log("[metamask-setup] initial-url", walletPage.url());
    await walletPage.bringToFront();
    await walletPage.getByTestId("onboarding-import-wallet").waitFor({ state: "visible", timeout: 20_000 });
    console.log("[metamask-setup] import-button-visible");

    await metamask.importWallet(seedPhrase);
    console.log("[metamask-setup] import-wallet-finished", walletPage.url());

    const onboardingCompleteButton = walletPage.getByTestId("onboarding-complete-done");
    const shouldFinishOnboarding = await onboardingCompleteButton.isVisible().catch(() => false);
    if (shouldFinishOnboarding) {
      console.log("[metamask-setup] completion-button-visible");
      await onboardingCompleteButton.click();
      console.log("[metamask-setup] completion-button-clicked", walletPage.url());
      await onboardingCompleteButton.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {
        console.log("[metamask-setup] completion-button-still-visible", walletPage.url());
      });
      await walletPage.waitForLoadState("domcontentloaded").catch(() => undefined);
      await walletPage.waitForTimeout(1000);
      console.log("[metamask-setup] completion-settled", walletPage.url());
    } else {
      console.log("[metamask-setup] completion-button-not-visible", walletPage.url());
    }
  }
);
