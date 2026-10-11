import { expect, test, type Page } from "./fixtures/app-test";
import { encodeFunctionData } from "viem";
import { CORE_DIAMOND_ABI } from "../../app/contracts/generated/coreDiamond";
import type { GovernanceCoreFacts } from "../../app/utils/governanceCoreFacts";

const functions = ["treasury", "basketConfigHash", "issuanceFeePpm", "redemptionFeePpm", "MAX_FEE_PPM", "maxTotalSupply", "totalSupply", "safeWallet"] as const;
const selectors = functions.map(functionName => encodeFunctionData({ abi: CORE_DIAMOND_ABI, functionName }).slice(2, 10));
const success = <T,>(value: T) => ({ status: "success" as const, value });
const facts: GovernanceCoreFacts = {
  context: { chainId: 31337, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, blockTimestamp: "1790800000", observedAt: "2026-10-01T00:00:00Z" },
  core: "0x00000000000000000000000000000000000000a1",
  configuration: { treasury: success("0x00000000000000000000000000000000000000b2"), basketConfigHash: success(`0x${"b".repeat(64)}`),
    issuanceFeePpm: success("1000"), redemptionFeePpm: success("1000"), maxFeePpm: success("10000"),
    maxTotalSupply: success(String(2n ** 255n)), totalSupply: success("0"), safeWallet: success("0x00000000000000000000000000000000000000b2") },
};

async function install(page: Page, unavailable = false) {
  let count = 0;
  const calls: string[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/protocol/config") { await route.fallback(); return; }
    if (path === "/api/governance/core-facts") {
      count++;
      await route.fulfill(unavailable ? { status: 503, json: { error: "Core governance facts are temporarily unavailable." } } : { json: facts });
    } else if (path === "/api/rpc") {
      expect(path).not.toBe("/api/rpc");
      await route.continue();
    } else await route.fulfill({ status: 503, json: { error: "Unrelated fixture data unavailable" } });
  });
  return { count: () => count, calls };
}

for (const unavailable of [false, true]) {
  test(`governance configuration uses its focused API${unavailable ? " through an outage" : ""}`, async ({ page }) => {
    const observed = await install(page, unavailable);
    await page.goto("/en/governance");
    await expect(page.getByText("Wallet not connected", { exact: true }).first()).toBeVisible();
    await expect.poll(observed.count).toBeGreaterThanOrEqual(1);
    // Development Strict Mode can cancel the first mount; mounted consumers
    // share the query. Inspect complete calldata, including nested Multicall.
    expect(observed.count()).toBeLessThanOrEqual(2);
    expect(observed.calls.filter(data => selectors.some(selector => data.includes(selector)))).toEqual([]);
    await page.getByRole("button", { name: "Connect Wallet", exact: true }).first().click();
    await expect(page.getByText("Connect a Wallet", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  });
}
