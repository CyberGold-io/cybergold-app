import type { Address } from "viem";
import { ScenarioUnavailableError } from "./scenarios.ts";
import { faucetResponseError, type FaucetRequestError } from "../../app/utils/faucetErrors.ts";
import { retainDiagnosticReferences } from "../../app/utils/diagnosticReferences.ts";

export class SandboxFundingError extends ScenarioUnavailableError {
  readonly reason: NonNullable<FaucetRequestError["code"]> | `HTTP_${number}`;
  constructor(response: Response, payload: unknown) {
    super("sandbox-wallet-funding-unavailable");
    const observed = faucetResponseError(response, payload);
    this.reason = observed.code ?? `HTTP_${observed.status}`;
    retainDiagnosticReferences(this, { correlationId: observed.correlationId,
      requestId: response.headers.get("X-CyberGold-Request-Id") ?? undefined });
  }
}

/** The same idempotency identity is shared by both serial wallet suites. */
export async function fundSandboxWallet(owner: Address, fetcher: typeof fetch) {
  if (process.env.TRADE_REGRESSION_MODE !== "sandbox-execution") return;
  const requestId = process.env.TRADE_REGRESSION_FAUCET_REQUEST_ID!;
  const response = await fetcher("/api/faucet", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: owner, requestId }) });
  if (!response.ok) throw new SandboxFundingError(response, await response.json().catch(() => null));
}
