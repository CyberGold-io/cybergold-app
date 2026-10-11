import type { Address } from "viem";
import { fetchPermit2Context } from "./permit2/context.ts";

export async function getTokensNeedingPermit2Approval(params: {
  owner: Address;
  permitted: { token: Address; amount: bigint }[];
  fetchImpl?: typeof fetch;
}) {
  const { owner, permitted, fetchImpl } = params;
  const positivePermissions = permitted.filter(({ amount }) => amount > 0n);
  if (!positivePermissions.length) return [];
  const context = await fetchPermit2Context({ mode: "allowances", owner,
    tokens: positivePermissions.map(({ token }) => token) }, fetchImpl);
  return positivePermissions.map((permission, i) => ({ ...permission,
    allowance: BigInt(context.result.allowances[i].value) })).filter(({ amount, allowance }) => allowance < amount);
}
