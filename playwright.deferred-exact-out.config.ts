import { defineConfig } from "@playwright/test";
import active from "./playwright.config";

/** Retained journeys require a future App with output entry restored. */
export default defineConfig({
  ...active,
  testDir: "./tests/deferred-exact-out",
  testIgnore: [],
});
