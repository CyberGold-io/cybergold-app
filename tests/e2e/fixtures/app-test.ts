import { test as base } from "@playwright/test";
import { protocolAddresses, protocolConfigurationFixture } from "../../fixtures/protocol-configuration";
import { installEconomicApiFixtures } from './economic-api';
export * from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, run) => {
    await installEconomicApiFixtures(page);
    await page.route("**/api/protocol/config", route => route.fulfill({ json: { ...protocolConfigurationFixture, universalExactInput: { adapter: protocolAddresses.adapter, encoding: "uniswap-routing-v1", settlementPolicy: "protocol-retained-input" } } }));
    await run(page);
  },
});
