import { parseSignature, type Address, type Hex } from "viem";
import type { components } from "../contracts/backend/http";
import type { WalletTypedData } from "./walletBatch.ts";
import { WalletSignatureBatchStoppedError } from "./metaMaskRequestBatch.ts";

export type TokenPermitContext = components["schemas"]["TokenPermitContext"];

export function tokenPermitTypedData(owner: Address, spender: Address, value: bigint, deadline: bigint,
  domain: NonNullable<TokenPermitContext["authorization"]["domain"]>, nonce: bigint): WalletTypedData {
  return { account: owner, domain: { ...domain,
    chainId: typeof domain.chainId === "string" ? BigInt(domain.chainId) : domain.chainId,
    verifyingContract: domain.verifyingContract as Address | undefined, salt: domain.salt as Hex | undefined },
    types: { EIP712Domain: tokenPermitDomainTypes(domain), Permit: [
      { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] }, primaryType: "Permit", message: { owner, spender, value, nonce, deadline } };
}

export function signedTokenPermit(value: bigint, deadline: bigint, signature: Hex) {
  const parsed = parseSignature(signature);
  return { value, deadline, r: parsed.r, s: parsed.s, v: Number(parsed.v ?? BigInt(parsed.yParity + 27)) };
}

/** Preserve present empty name/version fields; wallet-library inference omits them. */
export function tokenPermitDomainTypes(domain: NonNullable<TokenPermitContext["authorization"]["domain"]>) {
  return ([
    { name: "name", type: "string" }, { name: "version", type: "string" },
    { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
    { name: "salt", type: "bytes32" },
  ] as const).filter(field => Object.hasOwn(domain, field.name));
}

export async function fetchTokenPermit(token: Address, owner: Address, fetchImpl: typeof fetch = fetch): Promise<TokenPermitContext> {
  const response = await fetchImpl(`/api/account/token-permit?${new URLSearchParams({ token, owner })}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Token permit context is temporarily unavailable.");
  return response.json();
}

/** A context failure remains a read error. Only qualified standard permits are signed. */
export function tokenPurchaseAuthorization(context: TokenPermitContext, maximumInputAmount: bigint, permitInstalled: boolean) {
  if (context.allowance.status !== "success") throw new Error("Token allowance is temporarily unavailable.");
  const allowance = BigInt(context.allowance.value);
  if (allowance >= maximumInputAmount) return { kind: "allowance" as const, allowance };
  if (context.authorization.kind === "unavailable") throw new Error("Token permit context is temporarily unavailable.");
  if (permitInstalled && context.authorization.kind === "erc2612" && context.authorization.confidence === "qualified" && context.authorization.domain) {
    if (context.nonce.status !== "success") throw new Error("Token permit nonce is temporarily unavailable.");
    return { kind: "permit" as const, allowance, domain: context.authorization.domain, nonce: BigInt(context.nonce.value) };
  }
  return { kind: "approval" as const, allowance };
}

/** USDT requires its existing nonzero allowance to be cleared before replacement. */
export function tokenPurchaseApprovalAmounts(token: Address, allowance: bigint, maximumInputAmount: bigint, resetAllowanceToken?: Address) {
  if (allowance >= maximumInputAmount) return [];
  return resetAllowanceToken !== undefined && token.toLowerCase() === resetAllowanceToken.toLowerCase() && allowance > 0n
    ? [0n, maximumInputAmount] : [maximumInputAmount];
}

/** Unsupported typed data can use approval; user rejection always ends the attempt. */
export function walletTypedDataUnavailable(error: unknown): boolean {
  if (error instanceof WalletSignatureBatchStoppedError && error.completedSignatures > 0) return false;
  const codes: number[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const value = current as { code?: number; name?: string; cause?: unknown };
    if (value.name === "UserRejectedRequestError" || value.code === 4001) return false;
    if (typeof value.code === "number") codes.push(value.code);
    current = value.cause;
  }
  return codes.some(code => code === 4200 || code === -32601);
}

export async function tokenApprovalGasLimit(owner: Address, token: Address, amount: bigint,
  fetchImpl: typeof fetch = fetch): Promise<bigint> {
  try {
    const response = await fetchImpl("/api/transaction/token-approval-gas", {
      method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, token, amount: amount.toString() }),
    });
    if (!response.ok) throw new Error("Token approval gas estimation is unavailable.");
    const result: components["schemas"]["TokenApprovalGas"] = await response.json();
    return BigInt(result.gas) * 12n / 10n;
  } catch {
    // Preserve the existing approval flow's bounded gas fallback.
    return 100_000n;
  }
}
