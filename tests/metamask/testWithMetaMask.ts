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

type MetaMaskConstructor = ConstructorParameters<typeof MetaMask>;

export const test = testWithSynpress(metaMaskFixtures(metamaskSetup)).extend<{
  metamask: MetaMask;
}>({
  // Keep Synpress Anvil fixtures and load the extension in current Chromium.
  // Import the disposable wallet into each fresh context instead of copying
  // browser profile state whose lock/session restoration differs on Linux.
  // Hosted imports must not consume the session's behavior deadline. Native
  // actions retain their own timeouts; startup/import has a separate budget.
  context: [async ({}, fixtureUse) => {
    const profile = await mkdtemp(join(tmpdir(), "cybergold-wallet-profile-"));
    const extension = await realpath(resolve(".cache-synpress/metamask-chrome-13.13.1"));
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium", headless: false,
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      const extensionId = new URL(worker.url()).host;
      const home = `chrome-extension://${extensionId}/home.html`;
      const page = context.pages().find(candidate => candidate.url().startsWith(home)) ?? await context.newPage();
      await page.goto(home, { waitUntil: "domcontentloaded" });
      await page.bringToFront();
      for (const other of context.pages()) if (other !== page) await other.close();
      console.log("MetaMask fixture extension:", extensionId);
      await metamaskSetup.fn(
        context as unknown as Parameters<typeof metamaskSetup.fn>[0],
        page as unknown as Parameters<typeof metamaskSetup.fn>[1]
      );
      await page.goto(`chrome-extension://${extensionId}/home.html`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("account-menu-icon").waitFor({ timeout: 30000 });
      for (const other of context.pages()) if (other !== page) await other.close();
      await fixtureUse(context);
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true });
    }
  }, { scope: "test", timeout: 180000 }],
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
