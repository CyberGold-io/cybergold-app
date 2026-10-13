// Use the same browser for wallet setup and tests. Profiles created by the
// older Synpress browser cannot reliably be opened by current Chromium on Linux.
import { chromium } from "@playwright/test";
import { prepareExtension } from "@synthetixio/synpress-cache";
import { existsSync } from "node:fs";
import { realpath, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { observeWalletOnboarding, safeRunnerError, walletOnboardingStep, writeWalletSetupDiagnostic } from "../tests/trading/runnerDiagnostics.ts";

let stage = "setup-import";
let context;
let failed = false;
let onboarding;
const observations = () => onboarding ? { onboarding: onboarding.snapshot() } : {};
const checkpoint = result => writeWalletSetupDiagnostic(process.env.TRADE_REGRESSION_WALLET_SETUP_OUTPUT,
  { stage, result, ...observations() });
try {
  await checkpoint("running");
  const { default: setup } = await import("../wallet-setup/metamask.setup.ts");
  stage = "profile"; await checkpoint("running");
  const profile = resolve(".cache-synpress", setup.hash);
  if (process.argv.includes("--force")) await rm(profile, { recursive: true, force: true });
  if (existsSync(profile)) {
    console.log("Wallet cache already exists; use --force to refresh it.");
    stage = "wallet-ready"; await checkpoint("pass");
  } else {
    stage = "extension"; await checkpoint("running");
    const extension = await realpath(await prepareExtension());
    stage = "browser-launch"; await checkpoint("running");
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: false,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    stage = "extension-worker"; await checkpoint("running");
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    onboarding = observeWalletOnboarding(context);
    stage = "wallet-onboarding"; await checkpoint("running");
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/home.html`, { waitUntil: "domcontentloaded" });
    walletOnboardingStep(context, "setup-callback");
    await setup.fn(context, page);
    onboarding.stop();
    stage = "wallet-ready"; await checkpoint("running");
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/home.html`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("account-menu-icon").waitFor({ timeout: 30000 });
    await checkpoint("pass");
  }
} catch (error) {
  failed = true;
  onboarding?.stop();
  await writeWalletSetupDiagnostic(process.env.TRADE_REGRESSION_WALLET_SETUP_OUTPUT,
    { stage, result: "fail", ...safeRunnerError(error), ...observations() });
  throw error;
} finally {
  if (context) {
    try { await context.close(); }
    catch (error) {
      if (!failed) {
        await writeWalletSetupDiagnostic(process.env.TRADE_REGRESSION_WALLET_SETUP_OUTPUT,
          { stage: "browser-close", result: "fail", ...safeRunnerError(error), ...observations() });
        throw error;
      }
    }
  }
}
