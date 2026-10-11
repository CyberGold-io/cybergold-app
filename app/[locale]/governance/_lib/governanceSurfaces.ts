import type { ProtocolAddresses } from "../../../utils/protocolConfiguration.ts";
export type GovernanceSurfaceId = "safe" | "core" | "staking" | "governance-diamond" | "helpers";

export type GovernanceRoleSpec = {
  id: string;
  label: string;
  kind: "access-control" | "timelock" | "owner";
  description: string;
};

export type GovernanceActionSpec = {
  id: string;
  label: string;
  description: string;
  functionSignature: string;
  requiredRoleId: string;
};

export type GovernanceSectionSpec = {
  id: string;
  label: string;
  description: string;
  requiredRoleIds: string[];
  actions: GovernanceActionSpec[];
};

export type GovernanceSurfaceSpec = {
  id: GovernanceSurfaceId;
  label: string;
  href: string;
  packageName: string;
  address?: string;
  description: string;
  roles: GovernanceRoleSpec[];
  sections: GovernanceSectionSpec[];
};

export const GOVERNANCE_SURFACES: GovernanceSurfaceSpec[] = [
  {
    id: "safe",
    label: "Safe Ops",
    href: "/governance",
    packageName: "Gnosis Safe",
    description: "Multisig owners, aliases, pending confirmations, executable transactions, and execution history.",
    roles: [
      {
        id: "safe-owner",
        label: "Safe owner",
        kind: "owner",
        description: "Can sign Safe transactions and confirm governance actions.",
      },
    ],
    sections: [
      {
        id: "owners",
        label: "Owners and aliases",
        description: "Safe owner list with editor-scoped aliases.",
        requiredRoleIds: ["safe-owner"],
        actions: [],
      },
      {
        id: "safe-queues",
        label: "Safe queues",
        description: "Transactions split between confirmation and execution queues.",
        requiredRoleIds: ["safe-owner"],
        actions: [],
      },
    ],
  },
  {
    id: "core",
    label: "Core Diamond",
    href: "/governance/core",
    packageName: "cybergold-protocol/packages/1_core",
    description: "CyberGold controller/token diamond for basket, issuance, redemption, fees, and linked targets.",
    roles: [
      {
        id: "DEFAULT_ADMIN_ROLE",
        label: "DEFAULT_ADMIN_ROLE",
        kind: "access-control",
        description: "Singleton admin for fees, basket configuration, linked contracts, and role administration; default-admin changes use the two-step ceremony.",
      },
      {
        id: "UPGRADER_ROLE",
        label: "UPGRADER_ROLE",
        kind: "access-control",
        description: "Can perform diamond cuts through the guarded cut facet.",
      },
    ],
    sections: [
      {
        id: "pause",
        label: "Pause control",
        description: "Current owners of the configured Safe may pause Core; only the configured Safe may unpause it.",
        requiredRoleIds: [],
        actions: [
          {
            id: "pause-core",
            label: "Pause core",
            description: "A current owner of the configured Safe stops pause-gated issuance, redemption, and rebalancing flows.",
            functionSignature: "pause()",
            requiredRoleId: "SAFE_OWNER",
          },
          {
            id: "unpause-core",
            label: "Unpause core",
            description: "The configured Safe restores pause-gated Core flows after review.",
            functionSignature: "unpause()",
            requiredRoleId: "SAFE_WALLET",
          },
        ],
      },
      {
        id: "basket",
        label: "Basket targets",
        description: "Future controls for basket assets, target ppm, and gold reference-driven conversions.",
        requiredRoleIds: ["DEFAULT_ADMIN_ROLE"],
        actions: [
          {
            id: "set-basket",
            label: "Set basket targets",
            description: "Updates basket assets, target weights, and gold reference values.",
            functionSignature: "setBasket(bytes32,address[],uint256[],uint256[])",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
        ],
      },
      {
        id: "fees",
        label: "Fees",
        description: "Admin controls for issuance and redemption fee parameters.",
        requiredRoleIds: ["DEFAULT_ADMIN_ROLE"],
        actions: [
          {
            id: "set-issuance-fee",
            label: "Set issuance fee",
            description: "Updates issuance fee ppm with an expected-current-value guard.",
            functionSignature: "setIssuanceFeePpm(uint256,uint256)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
          {
            id: "set-redemption-fee",
            label: "Set redemption fee",
            description: "Updates redemption fee ppm with an expected-current-value guard.",
            functionSignature: "setRedemptionFeePpm(uint256,uint256)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
        ],
      },
      {
        id: "launch-cap",
        label: "Launch cap",
        description: "Temporary max total supply control for the controlled launch period.",
        requiredRoleIds: ["DEFAULT_ADMIN_ROLE"],
        actions: [
          {
            id: "set-max-total-supply",
            label: "Set max total supply",
            description: "Updates the controlled-launch max CYGLD supply with an expected-current-cap guard.",
            functionSignature: "setMaxTotalSupply(uint256,uint256)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
        ],
      },
      {
        id: "links",
        label: "Linked contracts",
        description: "Admin control for the treasury address; Core and CYGLD self-addresses are invariants.",
        requiredRoleIds: ["DEFAULT_ADMIN_ROLE"],
        actions: [
          {
            id: "set-treasury",
            label: "Set treasury",
            description: "Updates the treasury with an expected-current-address guard.",
            functionSignature: "setTreasury(address,address)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
        ],
      },
      {
        id: "roles",
        label: "Role management",
        description: "Grant or revoke ordinary Core roles. DEFAULT_ADMIN_ROLE moves only through its two-step transfer ceremony.",
        requiredRoleIds: ["DEFAULT_ADMIN_ROLE", "UPGRADER_ROLE"],
        actions: [
          {
            id: "grant-role",
            label: "Grant role",
            description: "Grants an ordinary Core role to an address or Safe.",
            functionSignature: "grantRole(bytes32,address)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
          {
            id: "revoke-role",
            label: "Revoke role",
            description: "Revokes an ordinary Core role from an address or Safe.",
            functionSignature: "revokeRole(bytes32,address)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
        ],
      },
      {
        id: "upgrades",
        label: "Upgrades",
        description: "Read-only visibility for guarded diamond-cut authority. UI support for submitting upgrade payloads is not implemented yet.",
        requiredRoleIds: ["UPGRADER_ROLE"],
        actions: [],
      },
    ],
  },
  {
    id: "staking",
    label: "Staking Diamond",
    href: "/governance/staking",
    packageName: "cybergold-protocol/packages/3_staking",
    description: "Staking diamond for vault, queue, custody, fund manager, and sleeve operations.",
    roles: [
      {
        id: "DEFAULT_ADMIN_ROLE",
        label: "DEFAULT_ADMIN_ROLE",
        kind: "access-control",
        description: "Admin role for vault, queue, custody, sleeve, and fund manager configuration.",
      },
      {
        id: "UPGRADER_ROLE",
        label: "UPGRADER_ROLE",
        kind: "access-control",
        description: "Can perform guarded diamond cuts.",
      },
      {
        id: "ALLOCATOR_ROLE",
        label: "ALLOCATOR_ROLE",
        kind: "access-control",
        description: "Can allocate and deallocate sleeve funds through the fund manager.",
      },
      {
        id: "WITHDRAWER_ROLE",
        label: "WITHDRAWER_ROLE",
        kind: "access-control",
        description: "Can withdraw from staking custody.",
      },
    ],
    sections: [
      {
        id: "pause",
        label: "Pause control",
        description: "Current owners of the configured Safe may pause Staking; only the configured Safe may unpause it.",
        requiredRoleIds: [],
        actions: [
          {
            id: "pause-staking",
            label: "Pause staking",
            description: "A current owner of the configured Safe stops pause-gated staking flows such as deposits, queue processing, and sleeve allocation.",
            functionSignature: "pause()",
            requiredRoleId: "SAFE_OWNER",
          },
          {
            id: "unpause-staking",
            label: "Unpause staking",
            description: "The configured Safe restores Staking flows after review.",
            functionSignature: "unpause()",
            requiredRoleId: "SAFE_WALLET",
          },
        ],
      },
      {
        id: "queue",
        label: "Queue",
        description: "Future controls for claim expiry, head sweep limit, and auto processing.",
        requiredRoleIds: ["DEFAULT_ADMIN_ROLE"],
        actions: [
          {
            id: "set-claim-expiry",
            label: "Set claim expiry",
            description: "Updates how long fulfilled redemption claims remain claimable.",
            functionSignature: "setClaimExpiry(uint64)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
          {
            id: "set-auto-process",
            label: "Set auto process max",
            description: "Updates how many queued requests can be processed automatically.",
            functionSignature: "setAutoProcessMax(uint256)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
        ],
      },
      {
        id: "fund-manager",
        label: "Fund manager",
        description: "Future controls for performance fee, swap adapter, treasury custody, and sleeve allocation.",
        requiredRoleIds: ["DEFAULT_ADMIN_ROLE", "ALLOCATOR_ROLE"],
        actions: [
          {
            id: "set-performance-fee",
            label: "Set performance fee",
            description: "Updates the performance fee ppm with an expected-current-value guard.",
            functionSignature: "setPerformanceFee(uint256,uint256)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
          {
            id: "set-swap-adapter",
            label: "Set swap adapter",
            description: "Updates the adapter used by fund-manager swaps.",
            functionSignature: "setSwapAdapter(address)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
          {
            id: "allocate-sleeve",
            label: "Allocate sleeve",
            description: "Moves staking assets into a registered sleeve.",
            functionSignature: "allocate(address,uint256,bytes)",
            requiredRoleId: "ALLOCATOR_ROLE",
          },
        ],
      },
      {
        id: "custody",
        label: "Custody and sleeves",
        description: "Future controls for withdrawers, sleeve approvals, and operational limits.",
        requiredRoleIds: ["DEFAULT_ADMIN_ROLE", "WITHDRAWER_ROLE"],
        actions: [
          {
            id: "grant-withdrawer",
            label: "Grant withdrawer",
            description: "Adds an address authorized to pull assets from staking custody.",
            functionSignature: "grantRole(bytes32,address)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
          {
            id: "set-sleeve-approval",
            label: "Set sleeve approval",
            description: "Approves or disables a registered sleeve.",
            functionSignature: "setSleeveApproval(address,bool)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
        ],
      },
    ],
  },
  {
    id: "governance-diamond",
    label: "Governance Diamond",
    href: "/governance/governance-diamond",
    packageName: "cybergold-protocol/packages/2_governance",
    description: "Governor and timelock diamond for proposals, quorum, voting settings, and timelock roles.",
    roles: [
      {
        id: "DEFAULT_ADMIN_ROLE",
        label: "DEFAULT_ADMIN_ROLE",
        kind: "access-control",
        description: "Held solely by the Governance diamond; proposals execute administrative self-calls, including Treasury withdrawals.",
      },
      {
        id: "UPGRADER_ROLE",
        label: "UPGRADER_ROLE",
        kind: "access-control",
        description: "Held solely by the Governance diamond; upgrades execute through successful Governance self-calls.",
      },
      {
        id: "PROPOSER_ROLE",
        label: "PROPOSER_ROLE",
        kind: "timelock",
        description: "Can schedule timelock operations.",
      },
      {
        id: "EXECUTOR_ROLE",
        label: "EXECUTOR_ROLE",
        kind: "timelock",
        description: "Can execute ready timelock operations.",
      },
      {
        id: "CANCELLER_ROLE",
        label: "CANCELLER_ROLE",
        kind: "timelock",
        description: "Can cancel timelock operations.",
      },
    ],
    sections: [
      {
        id: "pause",
        label: "Pause control",
        description: "One emergency switch blocks CYGOV mint/burn, Governance treasury withdrawals, Recovery Fund activation, purchases, and redemption, protected CYGLD outflows, and allowance increases. Safe allowance reductions or revocations, holder transfers, delegation, proposals, voting, execution, role administration, and upgrades remain available. All Core recovery-share redemption, including Fund-owned inventory, remains governed by the Core pause.",
        requiredRoleIds: [],
        actions: [
          {
            id: "pause-governance",
            label: "Pause governance",
            description: "A current owner of the configured Safe activates the shared Governance emergency pause.",
            functionSignature: "pause()",
            requiredRoleId: "SAFE_OWNER",
          },
          {
            id: "unpause-governance",
            label: "Unpause governance",
            description: "The configured Safe wallet clears the shared Governance pause after review.",
            functionSignature: "unpause()",
            requiredRoleId: "SAFE_WALLET",
          },
        ],
      },
      {
        id: "proposals",
        label: "Proposals",
        description: "Future proposal lifecycle and voting state.",
        requiredRoleIds: ["PROPOSER_ROLE", "EXECUTOR_ROLE"],
        actions: [
          {
            id: "schedule-operation",
            label: "Schedule operation",
            description: "Schedules a timelock operation after proposal approval.",
            functionSignature: "schedule(address,uint256,bytes,bytes32,bytes32,uint256)",
            requiredRoleId: "PROPOSER_ROLE",
          },
          {
            id: "execute-operation",
            label: "Execute operation",
            description: "Executes a ready timelock operation.",
            functionSignature: "execute(address,uint256,bytes,bytes32,bytes32)",
            requiredRoleId: "EXECUTOR_ROLE",
          },
        ],
      },
      {
        id: "settings",
        label: "Governor settings",
        description: "Future controls for voting delay, period, proposal threshold, and quorum.",
        requiredRoleIds: ["DEFAULT_ADMIN_ROLE"],
        actions: [
          {
            id: "set-voting-delay",
            label: "Set voting delay",
            description: "Updates the delay before a proposal starts voting.",
            functionSignature: "setVotingDelay(uint48)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
          {
            id: "set-voting-period",
            label: "Set voting period",
            description: "Updates how long proposals remain open for voting.",
            functionSignature: "setVotingPeriod(uint32)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
          {
            id: "set-proposal-threshold",
            label: "Set proposal threshold",
            description: "Updates the voting power required to create proposals.",
            functionSignature: "setProposalThreshold(uint256)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
        ],
      },
      {
        id: "timelock",
        label: "Timelock",
        description: "Future controls for min delay and timelock roles.",
        requiredRoleIds: ["DEFAULT_ADMIN_ROLE", "CANCELLER_ROLE"],
        actions: [
          {
            id: "update-delay",
            label: "Update delay",
            description: "Updates the timelock minimum delay through a timelocked call.",
            functionSignature: "updateDelay(uint256)",
            requiredRoleId: "DEFAULT_ADMIN_ROLE",
          },
          {
            id: "cancel-operation",
            label: "Cancel operation",
            description: "Cancels a pending timelock operation.",
            functionSignature: "cancel(bytes32)",
            requiredRoleId: "CANCELLER_ROLE",
          },
        ],
      },
    ],
  },
  {
    id: "helpers",
    label: "Helpers Diamond",
    href: "/governance/helpers",
    packageName: "cybergold-helpers",
    description: "Router/helpers diamond with immutable Permit2 identity, adapter policy, helper fees, pause state, and sweeps.",
    roles: [
      {
        id: "DIAMOND_OWNER",
        label: "Diamond owner",
        kind: "owner",
        description: "Owns helper admin functions and owner-gated pause/unpause.",
      },
    ],
    sections: [
      {
        id: "adapters",
        label: "Adapter approvals",
        description: "Future controls for swap adapter approvals.",
        requiredRoleIds: ["DIAMOND_OWNER"],
        actions: [
          {
            id: "set-adapter-approval",
            label: "Set adapter approval",
            description: "Approves or disables a helper swap adapter.",
            functionSignature: "setAdapterApproval(address,bool,bool)",
            requiredRoleId: "DIAMOND_OWNER",
          },
        ],
      },
      {
        id: "router",
        label: "Router config",
        description: "Helper fee controls. Permit2 and wrapped native are immutable launch identities displayed read-only.",
        requiredRoleIds: ["DIAMOND_OWNER"],
        actions: [
          {
            id: "set-helper-fee",
            label: "Set helper fee",
            description: "Updates helper fee ppm.",
            functionSignature: "setHelperFeePpm(uint256,uint256)",
            requiredRoleId: "DIAMOND_OWNER",
          },
        ],
      },
      {
        id: "pause",
        label: "Pause control",
        description: "Owner-gated pause and unpause controls for helper flows.",
        requiredRoleIds: ["DIAMOND_OWNER"],
        actions: [
          {
            id: "pause-helpers",
            label: "Pause helpers",
            description: "Pauses helper flows.",
            functionSignature: "pause()",
            requiredRoleId: "DIAMOND_OWNER",
          },
          {
            id: "unpause-helpers",
            label: "Unpause helpers",
            description: "Restores helper flows after review.",
            functionSignature: "unpause()",
            requiredRoleId: "DIAMOND_OWNER",
          },
        ],
      },
      {
        id: "sweep",
        label: "Token sweep",
        description: "Owner-gated recovery of stranded helper tokens.",
        requiredRoleIds: ["DIAMOND_OWNER"],
        actions: [
          {
            id: "sweep-token",
            label: "Sweep token",
            description: "Moves stranded tokens from the helper diamond.",
            functionSignature: "sweep(address,address)",
            requiredRoleId: "DIAMOND_OWNER",
          },
        ],
      },
    ],
  },
];

export function createGovernanceSurfaces(addresses: ProtocolAddresses): GovernanceSurfaceSpec[] {
  return GOVERNANCE_SURFACES.map(surface => ({
    ...surface,
    address: surface.id === "safe" ? addresses.safe
      : surface.id === "governance-diamond" ? addresses.governance
      : addresses[surface.id],
  }));
}

export function getGovernanceSurface(
  id: GovernanceSurfaceId, addresses: ProtocolAddresses = {},
): GovernanceSurfaceSpec {
  const surface = createGovernanceSurfaces(addresses).find((candidate) => candidate.id === id);
  if (!surface) {
    throw new Error(`Unknown governance surface: ${id}`);
  }
  return surface;
}
