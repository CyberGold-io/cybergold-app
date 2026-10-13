import { testWithSynpress } from "@synthetixio/synpress-core";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext } from "@playwright/test";
import {
  MetaMask,
  metaMaskFixtures,
} from "@synthetixio/synpress-metamask/playwright";
import metamaskSetup from "../../wallet-setup/metamask.setup";
import { safeRunnerError, walletFixtureOutput, writeWalletSetupDiagnostic, type WalletSetupDiagnostic } from "../trading/runnerDiagnostics";

type MetaMaskConstructor = ConstructorParameters<typeof MetaMask>;

export const test = testWithSynpress(metaMaskFixtures(metamaskSetup)).extend<{
  metamask: MetaMask;
}>({
  // Keep Synpress Anvil fixtures and load the extension in current Chromium.
  // Import the disposable wallet into each fresh context instead of copying
  // browser profile state whose lock/session restoration differs on Linux.
  // Hosted imports must not consume the session's behavior deadline. Native
  // actions retain their own timeouts; startup/import has a separate budget.
  context: [async ({}, fixtureUse, testInfo) => {
    const diagnosticOutput = walletFixtureOutput(testInfo.file);
    let stage: WalletSetupDiagnostic["stage"] = "profile";
    let profile: string | undefined;
    let context: BrowserContext | undefined;
    let failed = false;
    const checkpoint = (result: WalletSetupDiagnostic["result"]) => writeWalletSetupDiagnostic(diagnosticOutput, { stage, result });
    try {
      await checkpoint("running");
      profile = await mkdtemp(join(tmpdir(), "cybergold-wallet-profile-"));
      stage = "extension"; await checkpoint("running");
      const extension = await realpath(resolve(".cache-synpress/metamask-chrome-13.13.1"));
      stage = "browser-launch"; await checkpoint("running");
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium", headless: false,
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      stage = "extension-worker"; await checkpoint("running");
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      const extensionId = new URL(worker.url()).host;
      const home = `chrome-extension://${extensionId}/home.html`;
      const page = context.pages().find(candidate => candidate.url().startsWith(home)) ?? await context.newPage();
      stage = "wallet-onboarding"; await checkpoint("running");
      await page.goto(home, { waitUntil: "domcontentloaded" });
      await page.bringToFront();
      for (const other of context.pages()) if (other !== page) await other.close();
      console.log("MetaMask fixture extension:", extensionId);
      await metamaskSetup.fn(
        context as unknown as Parameters<typeof metamaskSetup.fn>[0],
        page as unknown as Parameters<typeof metamaskSetup.fn>[1]
      );
      stage = "wallet-ready"; await checkpoint("running");
      await page.goto(`chrome-extension://${extensionId}/home.html`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("account-menu-icon").waitFor({ timeout: 30000 });
      for (const other of context.pages()) if (other !== page) await other.close();
      await checkpoint("pass");
      await fixtureUse(context);
    } catch (error) {
      failed = true;
      await writeWalletSetupDiagnostic(diagnosticOutput, { stage, result: "fail", ...safeRunnerError(error) });
      throw error;
    } finally {
      try {
        if (context) {
          if (!failed) { stage = "browser-close"; await checkpoint("running"); }
          try { await context.close(); }
          catch (error) {
            if (!failed) {
              failed = true;
              await writeWalletSetupDiagnostic(diagnosticOutput, { stage: "browser-close", result: "fail", ...safeRunnerError(error) });
              throw error;
            }
          }
          if (!failed) await checkpoint("pass");
        }
      } finally {
        try { if (profile) await rm(profile, { recursive: true, force: true }); }
        catch (error) {
          if (!failed) {
            await writeWalletSetupDiagnostic(diagnosticOutput, { stage: "profile", result: "fail", ...safeRunnerError(error) });
            throw error;
          }
        }
      }
    }
  }, { scope: "test", timeout: 180000 }],
  // Each suite persists its initial report before navigating to the App.
  // Synpress's inherited page fixture navigates to / before the body starts,
  // hiding navigation failures from that suite's own result handling.
  page: async ({ context }, fixtureUse) => {
    await fixtureUse(await context.newPage());
  },
  extensionId: async ({ context }, fixtureUse) => {
    await fixtureUse(new URL(context.serviceWorkers()[0].url()).host);
  },
  metamaskPage: async ({ context }, fixtureUse) => {
    await fixtureUse(context.pages().find(page => page.url().startsWith("chrome-extension://"))!);
  },
  metamask: async ({ context, metamaskPage, extensionId }, fixtureUse) => {
    const metamask = new MetaMask(
      context as unknown as MetaMaskConstructor[0],
      metamaskPage as unknown as MetaMaskConstructor[1],
      metamaskSetup.walletPassword,
      extensionId
    );

    await fixtureUse(metamask);
  },
});

export const expect = test.expect;
