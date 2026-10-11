import { expect, test, type Page } from "./fixtures/app-test";
import { encodeFunctionData } from "viem";
import { CORE_DIAMOND_ABI } from "../../app/contracts/generated/coreDiamond";
import type { GovernanceRoles } from "../../app/utils/governanceRoles";

const owner = "0x00000000000000000000000000000000000000a1";
const safe = "0x00000000000000000000000000000000000000b2";
const success = <T,>(value: T) => ({ status: "success" as const, value });
const context = { chainId: 31337, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, blockTimestamp: "1790800000", observedAt: "2026-10-01T00:00:00Z" };
const selectors = [
  encodeFunctionData({ abi: CORE_DIAMOND_ABI, functionName: "getRoleMemberCount", args: [`0x${"0".repeat(64)}`] }),
  encodeFunctionData({ abi: CORE_DIAMOND_ABI, functionName: "getRoleMember", args: [`0x${"0".repeat(64)}`, 0n] }),
  encodeFunctionData({ abi: CORE_DIAMOND_ABI, functionName: "paused" }),
  encodeFunctionData({ abi: CORE_DIAMOND_ABI, functionName: "safeWallet" }),
  encodeFunctionData({ abi: CORE_DIAMOND_ABI, functionName: "canPause", args: [owner] }),
  encodeFunctionData({ abi: CORE_DIAMOND_ABI, functionName: "canUnpause", args: [owner] }),
].map(data => data.slice(2, 10));

async function install(page: Page, mode: "normal" | "partial" | "outage") {
  await page.addInitScript(({ account, chain }) => {
    const provider = { isMetaMask: true, selectedAddress: account,
      request: async ({ method }: { method: string }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [account];
        if (method === "eth_chainId") return chain;
        if (method === "net_version") return String(BigInt(chain));
        if (method === "eth_getBalance") return "0x0";
        throw new Error(`Synthetic wallet rejects ${method}`);
      }, on: () => {}, removeListener: () => {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "895ce7d1-9b18-4e2f-90d5-e6cefa9a044e", name: "MetaMask", rdns: "io.metamask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { account: owner, chain: `0x${Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337).toString(16)}` });
  const roles: GovernanceRoles = { context, surface: "core", address: owner, memberDisplayLimit: 50,
    roles: [
      { id: "DEFAULT_ADMIN_ROLE", count: success("1"), members: [success(owner)] },
      { id: "UPGRADER_ROLE", count: success("0"), members: [] },
    ] };
  if (mode === "partial") roles.roles[0].members = [{ status: "failure", error: "contract-read-failed" }];
  let count = 0;
  const calls: string[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/protocol/config") { await route.fallback(); return; }
    if (path === "/api/governance/roles") {
      count++;
      expect(new URL(route.request().url()).searchParams.get("surface")).toBe("core");
      expect(route.request().headers().authorization).toBeUndefined();
      await route.fulfill(mode === "outage" ? { status: 503, json: { error: "Governance role observations are temporarily unavailable." } } : { json: roles });
    } else if (path === "/api/governance/core-facts") {
      await route.fulfill({ json: { context, core: owner, configuration: { safeWallet: success(safe) } } });
    } else if (path === "/api/governance/authority") {
      await route.fulfill(mode === "outage" ? { status: 503, json: { error: "Governance authority observations are temporarily unavailable." } }
        : { json: { context, surface: "core", address: owner, account: owner, safeWallet: success(safe),
          paused: mode === "partial" ? { status: "failure", error: "contract-read-failed" } : success(true),
          accountCanPause: success(true), accountCanUnpause: success(false), safeCanUnpause: success(true) } });
    } else if (path === "/api/governance/safe-principal") {
      await route.fulfill({ json: { context, address: new URL(route.request().url()).searchParams.get("address"),
        code: success("0x6000"), owners: success([owner]), threshold: success("1") } });
    } else if (path === "/api/rpc") {
      expect(path).not.toBe("/api/rpc");
      await route.continue();
    } else await route.fulfill({ status: 503, json: { error: "Unrelated fixture data unavailable" } });
  });
  return { count: () => count, calls };
}

for (const mode of ["normal", "partial", "outage"] as const) {
  test(`Core role rosters distinguish empty and unavailable observations through ${mode}`, async ({ page }) => {
    const observed = await install(page, mode);
    await page.goto("/en/governance/core");
    await expect(page.getByRole("heading", { name: "Core Diamond", exact: true })).toBeVisible();
    await expect.poll(observed.count).toBeGreaterThanOrEqual(1);
    if (mode === "normal") {
      await expect(page.getByText("Threshold: 1 / 1", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("No members", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Paused", { exact: true }).first()).toBeVisible();
    } else {
      await expect(page.getByText("Members unavailable on this deployment", { exact: true }).first()).toBeVisible();
      if (mode === "outage") await expect(page.getByText("No members", { exact: true })).toHaveCount(0);
    }
    // Include nested Multicall calldata: failures must never reactivate the
    // browser's retired role-enumeration RPC reads.
    expect(observed.calls.filter(data => selectors.some(selector => data.includes(selector)))).toEqual([]);
  });
}
