import { existsSync } from "node:fs";
import nextEnv from "@next/env";
import { defineConfig, devices } from "@playwright/test";

nextEnv.loadEnvConfig(process.cwd());
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";

const browserSmokeParallelRequested = (() => {
  const value = process.env.PLAYWRIGHT_BROWSER_SMOKE_PARALLEL;
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error("PLAYWRIGHT_BROWSER_SMOKE_PARALLEL must be 0 or 1");
})();

const browserSmokeParallel = (() => {
  if (!browserSmokeParallelRequested) return false;
  // Playwright reloads this config in worker processes whose argv no longer
  // retains the original test-directory argument. npm preserves the lifecycle
  // event, and the test:e2e script itself pins the command to tests/e2e.
  const targetsBrowserSmoke = process.env.npm_lifecycle_event === "test:e2e";
  if (!targetsBrowserSmoke) {
    throw new Error("PLAYWRIGHT_BROWSER_SMOKE_PARALLEL is restricted to the tests/e2e suite");
  }
  return true;
})();

const browserSmokeWorkers = (() => {
  if (!browserSmokeParallel) return 1;
  const value = Number(process.env.PLAYWRIGHT_BROWSER_SMOKE_WORKERS ?? "2");
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("PLAYWRIGHT_BROWSER_SMOKE_WORKERS must be a positive integer");
  }
  return value;
})();

const hasChrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    : undefined,
]
  .filter(isDefined)
  .some((path) => existsSync(path));

const hasEdge = [
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`
    : undefined,
]
  .filter(isDefined)
  .some((path) => existsSync(path));

const browserProjects = [
  hasChrome
    ? {
        name: "chrome",
        testMatch: "**/e2e/**/*.spec.ts",
        use: {
          ...devices["Desktop Chrome"],
          channel: "chrome" as const,
        },
      }
    : undefined,
  hasEdge
    ? {
        name: "msedge",
        testMatch: "**/e2e/**/*.spec.ts",
        use: {
          ...devices["Desktop Edge"],
          channel: "msedge" as const,
        },
      }
    : undefined,
].filter((project): project is NonNullable<typeof project> => Boolean(project));

const fallbackBrowserProject = {
  name: "chromium",
  testMatch: "**/e2e/**/*.spec.ts",
  use: {
    ...devices["Desktop Chrome"],
  },
};

const metamaskProject = !isWindows
  ? [
      {
        name: "metamask",
        testMatch: "**/metamask/**/*.spec.ts",
        use: {
          ...devices["Desktop Chrome"],
          browserName: "chromium" as const,
          channel: "chromium" as const,
          headless: false,
        },
      },
    ]
  : [];

export default defineConfig({
  testDir: "./tests",
  testIgnore: ["**/deferred-exact-out/**"],
  timeout: 120 * 1000,
  fullyParallel: browserSmokeParallel,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: browserSmokeWorkers,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    headless: true,
  },
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1" ? undefined : {
    command: `${npmCommand} run dev`,
    url: `${baseURL}/en`,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
  projects: [
    ...(browserProjects.length > 0 ? browserProjects : [fallbackBrowserProject]),
    ...metamaskProject,
  ],
});
