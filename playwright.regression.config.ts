import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./tests/metamask", testMatch: ["fixed-api-roundtrips.spec.ts", "regression-execution.spec.ts"], timeout: 3_600_000,
  retries: 0, workers: 1, fullyParallel: false, reporter: "list",
  outputDir: join(tmpdir(), "cybergold-trade-regression-playwright"),
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL, trace: "off", screenshot: "off", video: "off" },
  projects: [{ name: "metamask", use: { ...devices["Desktop Chrome"], channel: "chromium", headless: false } }],
});
