import type { Address } from "viem";
import type { components } from "../contracts/backend/http";

type ApprovalGas = components["schemas"]["Permit2ApprovalGas"];

export async function permit2ApprovalGasLimit(owner: Address, token: Address,
  fetchImpl: typeof fetch = fetch): Promise<bigint> {
  // Preserve the existing approval flow's padding and ordinary estimation
  // fallback. The wallet still approves its independently verified spender.
  try {
    const response = await fetchImpl("/api/transaction/permit2-approval-gas", {
      method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, token }),
    });
    if (!response.ok) throw new Error("Permit2 approval gas estimation is unavailable.");
    const facts: ApprovalGas = await response.json();
    return BigInt(facts.gas) * 12n / 10n;
  } catch {
    return 100_000n;
  }
}
