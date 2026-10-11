import type { Address } from "viem";

export type GovernanceActionPrincipal = {
  address: Address;
  kind: "address" | "safe";
  connectedIsOwner: boolean;
};

export type GovernanceActionEligibility = {
  functionName?: string;
  supportsDirectSubmit: boolean;
  canDirectCall: boolean;
  eligibleSafes: GovernanceActionPrincipal[];
};

export type GovernancePauseAuthority = {
  connectedCanPause: boolean;
  connectedCanUnpause: boolean;
  configuredSafe?: Address;
  configuredSafeCanUnpause: boolean;
  connectedIsConfiguredSafeOwner: boolean;
};

export function noArgFunctionName(functionSignature: string) {
  const match = /^([A-Za-z_$][A-Za-z0-9_$]*)\(\)$/.exec(functionSignature.trim());
  return match?.[1];
}

export function governanceActionEligibility(params: {
  functionSignature: string;
  roleMembers: readonly Address[];
  principalsByAddress: ReadonlyMap<string, GovernanceActionPrincipal>;
  connectedAddress?: Address;
}): GovernanceActionEligibility {
  const functionName = noArgFunctionName(params.functionSignature);
  const connectedKey = params.connectedAddress?.toLowerCase();
  const canDirectCall = !!connectedKey && params.roleMembers.some((member) => member.toLowerCase() === connectedKey);
  const eligibleSafes = params.roleMembers
    .map((member) => params.principalsByAddress.get(member.toLowerCase()))
    .filter((principal): principal is GovernanceActionPrincipal => {
      return !!principal && principal.kind === "safe" && principal.connectedIsOwner;
    });

  return {
    functionName,
    supportsDirectSubmit: !!functionName,
    canDirectCall,
    eligibleSafes,
  };
}

export function governancePauseActionEligibility(
  functionSignature: string,
  authority: GovernancePauseAuthority
): GovernanceActionEligibility {
  const functionName = noArgFunctionName(functionSignature);
  const isPause = functionName === "pause";
  const isUnpause = functionName === "unpause";
  const configuredSafe = authority.configuredSafe;

  return {
    functionName,
    supportsDirectSubmit: isPause || isUnpause,
    canDirectCall: isPause
      ? authority.connectedCanPause
      : isUnpause
        ? authority.connectedCanUnpause
        : false,
    eligibleSafes:
      isUnpause &&
      configuredSafe &&
      authority.configuredSafeCanUnpause &&
      authority.connectedIsConfiguredSafeOwner
        ? [
            {
              address: configuredSafe,
              kind: "safe",
              connectedIsOwner: true,
            },
          ]
        : [],
  };
}
