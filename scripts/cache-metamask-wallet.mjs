// Use the same browser for wallet setup and tests. Profiles created by the
// older Synpress browser cannot reliably be opened by current Chromium on Linux.
import { chromium } from "@playwright/test";
import { prepareExtension } from "@synthetixio/synpress-cache";
import { existsSync } from "node:fs";
import { realpath, rm } from "node:fs/promises";
import { resolve } from "node:path";
import setup from "../wallet-setup/metamask.setup.ts";

const profile = resolve(".cache-synpress", setup.hash);
if (process.argv.includes("--force")) await rm(profile, { recursive: true, force: true });
if (existsSync(profile)) {
  console.log("Wallet cache already exists; use --force to refresh it.");
  process.exit(0);
}
const extension = await realpath(await prepareExtension());
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/home.html`, { waitUntil: "domcontentloaded" });
  await setup.fn(context, page);
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/home.html`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("account-menu-icon").waitFor({ timeout: 30000 });
} finally {
  await context.close();
}
