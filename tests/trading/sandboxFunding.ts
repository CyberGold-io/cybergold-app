import type { Address } from "viem";
import { ScenarioUnavailableError } from "./scenarios.ts";

/** The same idempotency identity is shared by both serial wallet suites. */
export async function fundSandboxWallet(owner: Address, fetcher: typeof fetch) {
  if (process.env.TRADE_REGRESSION_MODE !== "sandbox-execution") return;
  const requestId = process.env.TRADE_REGRESSION_FAUCET_REQUEST_ID!;
  const response = await fetcher("/api/faucet", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: owner, requestId }) });
  if (!response.ok) throw new ScenarioUnavailableError("sandbox-wallet-funding-unavailable");
}
