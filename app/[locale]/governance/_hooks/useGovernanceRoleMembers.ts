"use client";

import { useQuery } from "@tanstack/react-query";
import { useHelpersRouterFacts } from "@/app/hooks/useHelpersRouterFacts";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { targetChainId } from "@/app/config/chain";
import {
  fetchGovernanceRoles, governanceRoleMembers, normalizeRoleAddress,
  type GovernanceRolesSurface, type GovernanceRoleMembersState,
} from "@/app/utils/governanceRoles";
import type { GovernanceSurfaceSpec } from "../_lib/governanceSurfaces";

export type { GovernanceRoleMembersState } from "@/app/utils/governanceRoles";

export function useGovernanceRoleMembers(surface: GovernanceSurfaceSpec) {
  const surfaceAddress = normalizeRoleAddress(surface.address);
  const enumerableRoles = surface.roles.filter(role => role.kind === "access-control" || role.kind === "timelock");
  const ownerRoles = surface.roles.filter(role => role.kind === "owner");
  const generation = useSandboxForkGeneration();
  const rolesQuery = useQuery({
    queryKey: ["governance-role-members", targetChainId, surface.id, surfaceAddress, generation],
    queryFn: ({ signal }) => fetchGovernanceRoles(surface.id as GovernanceRolesSurface, signal),
    enabled: !!surfaceAddress && enumerableRoles.length > 0,
    staleTime: 30_000,
    retry: false,
  });
  const helpersOwnerQuery = useHelpersRouterFacts(facts => facts.configuration.owner,
    { enabled: surface.id === "helpers" && !!surfaceAddress && ownerRoles.length > 0 });
  const byRoleId: Record<string, GovernanceRoleMembersState> = governanceRoleMembers(
    rolesQuery.data, enumerableRoles.map(role => role.id), rolesQuery.isLoading,
    !surfaceAddress || (!!rolesQuery.error && !rolesQuery.isLoading));

  // Helpers already has its fixed owner observation; no duplicate owner read.
  for (const role of ownerRoles) {
    const field = surface.id === "helpers" ? helpersOwnerQuery.data : undefined;
    const owner = field?.status === "success" ? normalizeRoleAddress(field.value) : undefined;
    byRoleId[role.id] = {
      members: owner ? [owner] : [], expectedCount: owner ? 1 : undefined,
      isLoading: surface.id === "helpers" && helpersOwnerQuery.isLoading,
      isUnavailable: !surfaceAddress || (field !== undefined && field.status !== "success"),
    };
  }
  return {
    byRoleId,
    isLoading: rolesQuery.isLoading || (surface.id === "helpers" && helpersOwnerQuery.isLoading),
    error: rolesQuery.error ?? (surface.id === "helpers" ? helpersOwnerQuery.error : null),
  };
}
