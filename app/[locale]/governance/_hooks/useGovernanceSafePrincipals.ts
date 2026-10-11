"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { type Address, getAddress, isAddress } from "viem";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { safePrincipalQueryOptions } from "@/app/hooks/useGovernanceSafePrincipal";
import { safePrincipalOwners, safePrincipalThreshold, type GovernanceSafePrincipal } from "@/app/utils/governanceSafePrincipal";
import type { GovernanceActionPrincipal } from "@/app/utils/governanceActionEligibility";
import type { GovernanceRoleMembersState } from "./useGovernanceRoleMembers";

export type GovernanceRolePrincipal = GovernanceActionPrincipal & {
  owners: Address[];
  threshold?: number;
  isCheckingSafe: boolean;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function normalizeAddress(value: unknown): Address | undefined {
  if (typeof value !== "string" || !isAddress(value)) return undefined;
  const normalized = getAddress(value);
  return normalized === ZERO_ADDRESS ? undefined : normalized;
}

function uniqueAddresses(addresses: Address[]) {
  return Array.from(new Map(addresses.map((address) => [address.toLowerCase(), address])).values()).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
}

export function useGovernanceSafePrincipals(
  roleMembersById: Record<string, GovernanceRoleMembersState>,
  connectedAddress?: Address
) {
  const generation = useSandboxForkGeneration();
  const roleMemberAddresses = useMemo(() => {
    return uniqueAddresses(Object.values(roleMembersById).flatMap((state) => state.members));
  }, [roleMembersById]);

  const safeDetectionQueries = useQueries({
    queries: roleMemberAddresses.map((address) => ({
      ...safePrincipalQueryOptions(address, generation),
      staleTime: 5 * 60_000,
      select: (facts: GovernanceSafePrincipal) => {
        const rawOwners = safePrincipalOwners(facts);
        const rawThreshold = safePrincipalThreshold(facts);
        const owners = uniqueAddresses(
          rawOwners.map((owner) => normalizeAddress(owner)).filter((owner): owner is Address => !!owner)
        );
        return {
          owners,
          threshold: Number(rawThreshold),
        };
      },
    })),
  });

  const principalsByAddress = useMemo(() => {
    const map = new Map<string, GovernanceRolePrincipal>();
    const connectedKey = connectedAddress?.toLowerCase();

    roleMemberAddresses.forEach((address, index) => {
      const query = safeDetectionQueries[index];
      const owners = query?.data?.owners ?? [];
      const threshold = query?.data?.threshold;
      const isSafe = owners.length > 0 && threshold !== undefined;

      map.set(address.toLowerCase(), {
        address,
        kind: isSafe ? "safe" : "address",
        owners,
        threshold,
        connectedIsOwner: !!connectedKey && owners.some((owner) => owner.toLowerCase() === connectedKey),
        isCheckingSafe: query?.isLoading ?? false,
      });
    });

    return map;
  }, [connectedAddress, roleMemberAddresses, safeDetectionQueries]);

  const safeOwnerAddresses = useMemo(() => {
    return uniqueAddresses(
      [...principalsByAddress.values()].flatMap((principal) =>
        principal.kind === "safe" ? principal.owners : []
      )
    );
  }, [principalsByAddress]);

  return {
    principalsByAddress,
    safeOwnerAddresses,
    isLoading: safeDetectionQueries.some((query) => query.isLoading),
    error: safeDetectionQueries.find((query) => query.error)?.error ?? null,
  };
}
