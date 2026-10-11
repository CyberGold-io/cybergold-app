import type { Address } from "viem";
import { fetchPermit2Context } from "./context.ts";

// The backend traverses current bitmaps without reserving a nonce. The existing
// browser flow still owns its in-flight nonce floor and wallet signature.
export async function getPermit2Nonce(params: {
  owner: Address;
  fetchImpl?: typeof fetch;
}): Promise<bigint> {
  const context = await fetchPermit2Context({ mode: "nonce", owner: params.owner }, params.fetchImpl);
  return BigInt(context.result.nonce);
}
