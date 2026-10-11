import {
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";

export type GovernanceAuthorityKind = "emergency-authority" | "owner";
export type GovernanceAuthoritySource =
  | "emergency-authority"
  | "owner-safe"
  | "owner-direct"
  | "unknown";

type DiamondGovernanceSurfaceId =
  | "safe"
  | "core"
  | "staking"
  | "governance-diamond"
  | "helpers";

type OwnerAuthorityProbeStatus = "idle" | "loading" | "error" | "success";

type OwnerAuthorityResolution = {
  source: GovernanceAuthoritySource;
  owners: Address[];
  safeAddress?: Address;
  threshold?: number;
  failure?:
    | "authority-code-probe-failed"
    | "safe-probe-failed"
    | "safe-probe-incompatible";
};

export const OWNER_ABI = [
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

export function normalizeGovernanceAddress(
  value: unknown
): Address | undefined {
  if (typeof value !== "string" || !isAddress(value)) return undefined;
  const normalized = getAddress(value);
  return normalized === "0x0000000000000000000000000000000000000000"
    ? undefined
    : normalized;
}

export function resolveDiamondGovernanceAuthority(
  surfaceId: DiamondGovernanceSurfaceId,
  surfaceAddress: unknown,
  helpersOwner: unknown
): {
  authorityKind: GovernanceAuthorityKind;
  authorityAddress?: Address;
} {
  if (surfaceId === "helpers") {
    return {
      authorityKind: "owner",
      authorityAddress: normalizeGovernanceAddress(helpersOwner),
    };
  }

  return {
    authorityKind: "emergency-authority",
    authorityAddress:
      surfaceId === "core" ||
      surfaceId === "staking" ||
      surfaceId === "governance-diamond"
        ? normalizeGovernanceAddress(surfaceAddress)
        : undefined,
  };
}

export function resolveOwnerAuthorityProbe(params: {
  authorityAddress?: Address;
  bytecode?: Hex;
  codeProbeStatus: OwnerAuthorityProbeStatus;
  safeOwners: Address[];
  safeThreshold?: number;
  safeProbeStatus: OwnerAuthorityProbeStatus;
}): OwnerAuthorityResolution {
  const {
    authorityAddress,
    bytecode,
    codeProbeStatus,
    safeOwners,
    safeThreshold,
    safeProbeStatus,
  } = params;
  if (!authorityAddress) {
    return { source: "unknown", owners: [] };
  }
  if (codeProbeStatus === "error") {
    return {
      source: "unknown",
      owners: [],
      failure: "authority-code-probe-failed",
    };
  }
  if (codeProbeStatus !== "success") {
    return { source: "unknown", owners: [] };
  }

  if (bytecode === undefined || bytecode === "0x") {
    return {
      source: "owner-direct",
      owners: [authorityAddress],
      threshold: 1,
    };
  }

  if (safeProbeStatus === "error") {
    return {
      source: "unknown",
      owners: [],
      failure: "safe-probe-failed",
    };
  }
  if (safeProbeStatus !== "success") {
    return { source: "unknown", owners: [] };
  }

  const isSafeCompatible =
    safeOwners.length > 0 &&
    safeThreshold !== undefined &&
    safeThreshold > 0 &&
    safeThreshold <= safeOwners.length;
  if (!isSafeCompatible) {
    return {
      source: "unknown",
      owners: [],
      failure: "safe-probe-incompatible",
    };
  }

  return {
    source: "owner-safe",
    owners: safeOwners,
    safeAddress: authorityAddress,
    threshold: safeThreshold,
  };
}

export function hasGovernanceNavigationAccess(
  candidate: Address | undefined,
  authorityOwnerGroups: readonly (readonly Address[])[]
) {
  if (!candidate) return false;
  const candidateKey = candidate.toLowerCase();
  return authorityOwnerGroups.some((owners) =>
    owners.some((owner) => owner.toLowerCase() === candidateKey)
  );
}
