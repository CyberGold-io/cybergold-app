import { getAddress, isAddress, type Address } from "viem";
import type { components } from "../contracts/backend/http";

export type GovernanceRoles = components["schemas"]["GovernanceRoles"];
export type GovernanceRolesSurface = GovernanceRoles["surface"];
export type GovernanceRoleMembersState = {
  members: Address[];
  expectedCount?: number;
  isLoading: boolean;
  isUnavailable: boolean;
};

export function normalizeRoleAddress(value: unknown): Address | undefined {
  if (typeof value !== "string" || !isAddress(value)) return undefined;
  const normalized = getAddress(value);
  return normalized === "0x0000000000000000000000000000000000000000" ? undefined : normalized;
}

export function governanceRoleMembers(facts: GovernanceRoles | undefined, ids: string[], loading: boolean, unavailable: boolean) {
  const byRoleId: Record<string, GovernanceRoleMembersState> = {};
  for (const id of ids) {
    const row = facts?.roles.find(row => row.id === id);
    byRoleId[id] = {
      members: row?.members.flatMap(member => {
        const address = member.status === "success" ? normalizeRoleAddress(member.value) : undefined;
        return address ? [address] : [];
      }) ?? [],
      expectedCount: row?.count.status === "success" ? Number(BigInt(row.count.value)) : undefined,
      isLoading: loading,
      isUnavailable: unavailable || (facts !== undefined && (!facts.address || !row || row.count.status !== "success" || row.members.some(member => member.status !== "success"))),
    };
  }
  return byRoleId;
}

export async function fetchGovernanceRoles(surface: GovernanceRolesSurface, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<GovernanceRoles> {
  const response = await fetchImpl(`/api/governance/roles?${new URLSearchParams({ surface })}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Governance role observations are temporarily unavailable.");
  return response.json();
}
