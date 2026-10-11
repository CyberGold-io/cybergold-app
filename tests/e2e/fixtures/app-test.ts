import { test as base } from "@playwright/test";
import { protocolConfigurationFixture } from "../../fixtures/protocol-configuration";
export * from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, run) => {
    await page.route("**/api/protocol/config", route => route.fulfill({ json: protocolConfigurationFixture }));
    await run(page);
  },
});
