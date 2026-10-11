import type { Address } from "viem";
import type { components } from "../contracts/backend/http";

export type RecoveryRedemptionObservation = components["schemas"]["RecoveryRedemption"];

export async function simulateRecoveryRedemption(params: {
  holder: Address; asset: Address; shares: bigint; minRawOut: bigint;
}, fetchImpl: typeof fetch = fetch): Promise<RecoveryRedemptionObservation> {
  const response = await fetchImpl("/api/transaction/recovery-redemption", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ holder: params.holder, asset: params.asset,
      shares: params.shares.toString(), minRawOut: params.minRawOut.toString() }),
  });
  if (!response.ok) throw new Error("Recovery-share redemption simulation is unavailable.");
  return response.json();
}
