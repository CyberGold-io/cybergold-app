import { expect, test, type Page } from "./fixtures/app-test";
import { encodeFunctionData } from "viem";
import { HELPERS_DIAMOND_ABI } from "../../app/contracts/generated/helpersDiamond";
import { SAFE_ABI } from "../../app/utils/governanceSafeContracts";
import type { HelpersRouterFacts } from "../../app/utils/helpersRouterFacts";

const functions = ["helperFeePpm", "permit2", "wrappedNative", "owner", "approvedAdapters", "paused"] as const;
const selectors = functions.map(functionName => encodeFunctionData({ abi: HELPERS_DIAMOND_ABI, functionName }).slice(2, 10));
selectors.push(...["getOwners", "getThreshold"].map(functionName => encodeFunctionData({ abi: SAFE_ABI, functionName: functionName as "getOwners" | "getThreshold" }).slice(2, 10)));
selectors.push(encodeFunctionData({ abi: HELPERS_DIAMOND_ABI, functionName: "isAdapterApproved", args: ["0x00000000000000000000000000000000000000a1"] }).slice(2, 10));
const success = <T,>(value: T) => ({ status: "success" as const, value });
const owner = "0x00000000000000000000000000000000000000a1";
const chainHex = `0x${Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337).toString(16)}`;
const facts: HelpersRouterFacts = {
  context: { chainId: 31337, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, blockTimestamp: "1790800000", observedAt: "2026-10-01T00:00:00Z" },
  helpers: "0x00000000000000000000000000000000000000a1",
  configuration: { helperFeePpm: success("0"), permit2: success("0x00000000000000000000000000000000000000b2"),
    wrappedNative: success("0x00000000000000000000000000000000000000b3"), owner: success(owner),
    approvedAdapters: success([]), paused: success(false) },
};

type PrincipalMode = "safe" | "eoa" | "code-failure" | "threshold-failure" | "outage";
async function install(page: Page, mode: "normal" | "partial" | "outage", principalMode: PrincipalMode = "safe") {
  await page.addInitScript(({ account, chainHex }) => {
    const provider = { isMetaMask: true, selectedAddress: account,
      request: async ({ method }: { method: string }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [account];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [account] }] }];
        if (method === "eth_chainId") return chainHex;
        if (method === "net_version") return String(BigInt(chainHex));
        if (method === "eth_getBalance") return "0x0";
        throw new Error(`Synthetic wallet rejects ${method}`);
      }, on: () => {}, removeListener: () => {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "MetaMask", rdns: "io.metamask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { account: owner, chainHex });
  let count = 0, principalCount = 0;
  const codeCalls: string[] = [];
  const calls: string[] = [];
  const payload = structuredClone(facts);
  if (mode === "partial") payload.configuration.approvedAdapters = { status: "failure", error: "contract-read-failed" };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/protocol/config") { await route.fallback(); return; }
    if (path === "/api/governance/helpers-facts") {
      count++;
      await route.fulfill(mode === "outage" ? { status: 503, json: { error: "Helpers configuration is temporarily unavailable." } } : { json: payload });
    } else if (path === "/api/governance/safe-principal") {
      principalCount++;
      const failure = { status: "failure", error: "contract-read-failed" };
      await route.fulfill(principalMode === "outage" ? { status: 503, json: { error: "Safe principal facts are temporarily unavailable." } }
        : { json: { context: facts.context,
          address: new URL(route.request().url()).searchParams.get("address"),
          code: principalMode === "code-failure" ? failure : success(principalMode === "eoa" ? "0x" : "0x6000"),
          owners: principalMode === "eoa" ? failure : success([owner]),
          threshold: ["eoa", "threshold-failure"].includes(principalMode) ? failure : success("1") } });
    } else if (path === "/api/rpc") {
      expect(path).not.toBe("/api/rpc");
      await route.continue();
    } else await route.fulfill({ status: 503, json: { error: "Unrelated fixture data unavailable" } });
  });
  return { count: () => count, principalCount: () => principalCount, calls, codeCalls };
}

for (const mode of ["normal", "partial", "outage"] as const) {
  test(`Swap and governance share the Helpers API through ${mode} observations`, async ({ page }) => {
    const observed = await install(page, mode);
    await page.goto("/en");
    await expect.poll(observed.count).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
    const countBefore = observed.count();
    await page.goto("/en/governance/helpers");
    await expect(page.getByRole("heading", { name: "Helpers Diamond", exact: true })).toBeVisible();
    await expect.poll(observed.count).toBeGreaterThan(countBefore);
    if (mode !== "outage") {
      await expect(page.getByLabel("Helper fee ppm", { exact: true })).toHaveValue("0");
      await page.getByLabel("Adapter address", { exact: true }).fill("0x00000000000000000000000000000000000000c3");
      if (mode === "partial") await expect(page.getByText("Could not read the current adapter approval. Try again before submitting.", { exact: true }).first()).toBeVisible();
      else await expect(page.getByText("Not approved", { exact: true })).toBeVisible();
    }
    // Include nested Multicall calldata; none of the migrated passive reads
    // fall back to RPC when the typed observation is partial or unavailable.
    expect(observed.calls.filter(data => selectors.some(selector => data.includes(selector)))).toEqual([]);
  });
}

for (const mode of ["safe", "eoa", "code-failure", "threshold-failure", "outage"] as const) {
  test(`Helpers authority uses fixed Safe principal facts through ${mode}`, async ({ page }) => {
    const observed = await install(page, "normal", mode);
    await page.goto("/en/governance/helpers");
    await expect(page.getByRole("heading", { name: "Helpers Diamond", exact: true })).toBeVisible();
    await expect.poll(observed.principalCount).toBeGreaterThanOrEqual(1);
    if (mode === "safe") await expect(page.getByText("Threshold: 1 / 1", { exact: true }).first()).toBeVisible();
    else if (mode === "eoa") await expect(page.getByLabel("Helper fee ppm", { exact: true })).toHaveValue("0");
    else await expect(page.getByText(mode === "code-failure" ? "The owner authority bytecode probe failed."
      : mode === "threshold-failure" ? "Safe threshold is temporarily unavailable."
      : "Safe principal facts are temporarily unavailable.", { exact: true })).toBeVisible();
    expect(observed.calls.filter(data => selectors.some(selector => data.includes(selector)))).toEqual([]);
    expect(observed.codeCalls.filter(address => address === owner)).toEqual([]);
  });
}
