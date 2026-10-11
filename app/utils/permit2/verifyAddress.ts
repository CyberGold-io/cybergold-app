import { isAddress, zeroAddress, type Address } from "viem";
import { fetchPermit2Context } from "./context.ts";

export function requirePermit2ContractAddress(value: unknown): Address {
  if (value === undefined || value === null || value === "") {
    throw new Error("Permit2 address is unavailable");
  }
  if (typeof value !== "string" || !isAddress(value) || value === zeroAddress) {
    throw new Error("Permit2 address is invalid");
  }
  return value;
}

// Recheck the router before wallet prompts so a cached address cannot authorize
// a contract that the router no longer uses.
export async function verifyPermit2ContractAddress({
  expectedPermit2Address,
  fetchImpl,
}: {
  expectedPermit2Address: Address;
  fetchImpl?: typeof fetch;
}): Promise<Address> {
  const expectedAddress = requirePermit2ContractAddress(expectedPermit2Address);
  const context = await fetchPermit2Context({ mode: "verify" }, fetchImpl);
  const currentAddress = requirePermit2ContractAddress(context.permit2);
  if (currentAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error("Permit2 address changed. Refresh the page before continuing.");
  }

  const code = context.result.code;
  if (!code || code === "0x") {
    throw new Error("Permit2 address has no deployed contract");
  }
  return currentAddress;
}
