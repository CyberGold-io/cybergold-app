"use client";

import { useCallback, useMemo } from "react";
import { type Address } from "viem";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useGovernanceCoreFacts } from "@/app/hooks/useGovernanceCoreFacts";
import { coreSafeWalletFromFacts } from "@/app/utils/governanceCoreFacts";
import { useGovernanceAuthorityFacts } from "@/app/hooks/useGovernanceAuthorityFacts";
import { governanceSafeWallet } from "@/app/utils/governanceAuthorityFacts";
import { getGovernanceSurface } from "@/app/[locale]/governance/_lib/governanceSurfaces";
import { useGovernanceSafePrincipal } from "@/app/hooks/useGovernanceSafePrincipal";
import { safePrincipalCode, safePrincipalOwners, safePrincipalThreshold } from "@/app/utils/governanceSafePrincipal";
import {
  normalizeGovernanceAddress,
  resolveOwnerAuthorityProbe,
  type GovernanceAuthorityKind,
} from "@/app/utils/governanceAuthority";

type UseGovernanceSafeOptions = {
  enabled?: boolean;
  authorityAddress?: Address;
  authorityKind?: GovernanceAuthorityKind;
};

export function useGovernanceSafe(options?: UseGovernanceSafeOptions) {
  const { addresses } = useProtocolConfiguration();
  const coreAddress = addresses.core;
  const enabled = options?.enabled ?? true;
  const authorityKind = options?.authorityKind ?? "emergency-authority";
  const authorityAddress =
    options?.authorityAddress ??
    (authorityKind === "emergency-authority" ? coreAddress : undefined);

  const usesCoreFacts = coreAddress !== undefined && authorityAddress?.toLowerCase() === coreAddress.toLowerCase();
  const coreSafeAddressQuery = useGovernanceCoreFacts(coreSafeWalletFromFacts, {
      enabled:
        enabled &&
        authorityKind === "emergency-authority" &&
        usesCoreFacts,
  });
  const otherSurface = authorityAddress ? (["staking", "governance-diamond"] as const).find(id =>
    getGovernanceSurface(id, addresses).address?.toLowerCase() === authorityAddress.toLowerCase()) : undefined;
  const otherAuthorityQuery = useGovernanceAuthorityFacts(otherSurface, {
    enabled: enabled && authorityKind === "emergency-authority" && !usesCoreFacts,
  });
  const otherSafeAddressQuery = {
    ...otherAuthorityQuery,
    data: otherAuthorityQuery.data?.safeWallet.status === "success"
      ? governanceSafeWallet(otherAuthorityQuery.data) : undefined,
    error: otherAuthorityQuery.error ?? (otherAuthorityQuery.data?.safeWallet.status === "failure"
      ? new Error("Governance Safe authority is temporarily unavailable.") : null),
  };
  const safeAddressQuery = usesCoreFacts ? coreSafeAddressQuery : otherSafeAddressQuery;

  const authorityBytecodeQuery = useGovernanceSafePrincipal(
    authorityKind === "owner" ? authorityAddress : undefined, safePrincipalCode,
    { enabled: enabled && authorityKind === "owner" },
  );
  const codeProbeStatus =
    authorityKind !== "owner" || !enabled || !authorityAddress
      ? "idle"
      : authorityBytecodeQuery.isError
        ? "error"
        : authorityBytecodeQuery.isSuccess
          ? "success"
          : "loading";
  const ownerAuthorityHasCode =
    codeProbeStatus === "success" &&
    authorityBytecodeQuery.data !== undefined &&
    authorityBytecodeQuery.data !== "0x";
  const candidateSafeAddress =
    authorityKind === "owner"
      ? ownerAuthorityHasCode
        ? normalizeGovernanceAddress(authorityAddress)
        : undefined
      : normalizeGovernanceAddress(safeAddressQuery.data);

  const ownersQuery = useGovernanceSafePrincipal(candidateSafeAddress, safePrincipalOwners, { enabled });
  const thresholdQuery = useGovernanceSafePrincipal(candidateSafeAddress, safePrincipalThreshold, { enabled });

  const safeOwners = useMemo(() => {
    if (!ownersQuery.data || !Array.isArray(ownersQuery.data)) {
      return [] as Address[];
    }

    return ownersQuery.data
      .map((value) => normalizeGovernanceAddress(value))
      .filter((value): value is Address => value !== undefined);
  }, [ownersQuery.data]);

  const safeThreshold =
    typeof thresholdQuery.data === "bigint" ? Number(thresholdQuery.data) : undefined;
  const isSafeCompatible =
    safeOwners.length > 0 &&
    safeThreshold !== undefined &&
    safeThreshold > 0 &&
    safeThreshold <= safeOwners.length;
  const safeProbeStatus =
    !candidateSafeAddress || !enabled
      ? "idle"
      : ownersQuery.isError || thresholdQuery.isError
        ? "error"
        : ownersQuery.isSuccess && thresholdQuery.isSuccess
          ? "success"
          : "loading";
  const ownerResolution = resolveOwnerAuthorityProbe({
    authorityAddress:
      authorityKind === "owner"
        ? normalizeGovernanceAddress(authorityAddress)
        : undefined,
    bytecode: authorityBytecodeQuery.data,
    codeProbeStatus,
    safeOwners,
    safeThreshold,
    safeProbeStatus,
  });
  const source =
    authorityKind === "owner"
      ? ownerResolution.source
      : isSafeCompatible
        ? "emergency-authority"
        : "unknown";
  const owners =
    authorityKind === "owner" ? ownerResolution.owners : safeOwners;

  const ownerSet = useMemo(() => {
    return new Set(owners.map((owner) => owner.toLowerCase()));
  }, [owners]);

  const isSafeOwner = useCallback(
    (candidate?: Address) => {
      if (!candidate) return false;
      return ownerSet.has(candidate.toLowerCase());
    },
    [ownerSet]
  );

  const safeAddress =
    authorityKind === "owner"
      ? ownerResolution.safeAddress
      : isSafeCompatible
        ? candidateSafeAddress
        : undefined;
  const threshold =
    authorityKind === "owner"
      ? ownerResolution.threshold
      : isSafeCompatible
        ? safeThreshold
        : undefined;

  const isLoading =
    (authorityKind === "emergency-authority" && safeAddressQuery.isLoading) ||
    (authorityKind === "owner" && authorityBytecodeQuery.isLoading) ||
    ownersQuery.isLoading ||
    thresholdQuery.isLoading;
  const ownerProbeError =
    ownerResolution.failure === undefined
      ? null
      : new Error(
          ownerResolution.failure === "authority-code-probe-failed"
            ? "The owner authority bytecode probe failed."
            : ownerResolution.failure === "safe-probe-failed"
              ? "The owner authority Safe probe failed."
              : "The owner authority contract is not a compatible Safe."
        );
  const emergencyProbeError =
    authorityKind === "emergency-authority" &&
    candidateSafeAddress &&
    safeProbeStatus === "success" &&
    !isSafeCompatible
      ? new Error("The configured emergency authority is not a compatible Safe.")
      : null;
  const error =
    authorityKind === "emergency-authority"
      ? safeAddressQuery.error ??
        ownersQuery.error ??
        thresholdQuery.error ??
        emergencyProbeError
      : authorityBytecodeQuery.error ??
        ownersQuery.error ??
        thresholdQuery.error ??
        ownerProbeError;

  return {
    safeAddress,
    source,
    owners,
    threshold,
    isLoading,
    error,
    isSafeOwner,
  };
}
