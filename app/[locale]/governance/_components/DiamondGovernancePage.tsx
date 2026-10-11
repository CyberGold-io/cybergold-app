"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { getAddress, isAddress, type Address } from "viem";
import { IoCheckmark, IoCopyOutline } from "react-icons/io5";
import { useObservedWalletAccount } from "@/app/hooks/useObservedWalletAccount";
import { useHelpersRouterFacts } from "@/app/hooks/useHelpersRouterFacts";
import { useGovernanceAuthorityFacts } from "@/app/hooks/useGovernanceAuthorityFacts";
import { governanceAuthorityFlag } from "@/app/utils/governanceAuthorityFacts";
import { useGovernanceSafe } from "@/app/hooks/useGovernanceSafe";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useGovernanceOwnerAliases } from "@/app/hooks/useGovernanceOwnerAliases";
import {
  governanceActionEligibility,
  governancePauseActionEligibility,
} from "@/app/utils/governanceActionEligibility";
import { resolveDiamondGovernanceAuthority } from "@/app/utils/governanceAuthority";
import { GovernanceAccessGate } from "./GovernanceAccessGate";
import { GovernanceSurfaceNav } from "./GovernanceSurfaceNav";
import {
  getGovernanceSurface,
  type GovernanceRoleSpec,
  type GovernanceSectionSpec,
  type GovernanceSurfaceSpec,
  type GovernanceSurfaceId,
} from "../_lib/governanceSurfaces";
import { useGovernanceRoleMembers, type GovernanceRoleMembersState } from "../_hooks/useGovernanceRoleMembers";
import { useGovernanceSafePrincipals, type GovernanceRolePrincipal } from "../_hooks/useGovernanceSafePrincipals";
import { useDiamondGovernanceActions } from "../_hooks/useDiamondGovernanceActions";
import { CoreBasketTargetsActionCard } from "./CoreBasketTargetsActionCard";
import { CoreFeesActionCard } from "./CoreFeesActionCard";
import { CoreLinkedContractActionCard } from "./CoreLinkedContractActionCard";
import { CoreMaxTotalSupplyActionCard } from "./CoreMaxTotalSupplyActionCard";
import { CoreRoleManagementActionCard } from "./CoreRoleManagementActionCard";
import { HelpersAdapterApprovalActionCard } from "./HelpersAdapterApprovalActionCard";
import { HelpersFeeActionCard } from "./HelpersFeeActionCard";
import { HelpersSweepActionCard } from "./HelpersSweepActionCard";

type DiamondGovernancePageProps = {
  surfaceId: Exclude<GovernanceSurfaceId, "safe">;
};

function roleKindLabel(kind: "access-control" | "timelock" | "owner") {
  if (kind === "access-control") return "AccessControl";
  if (kind === "timelock") return "Timelock";
  return "Owner";
}

function statusBadgeClass(status: "active" | "inactive" | "unknown") {
  if (status === "active") return "border-emerald-300 bg-emerald-100 text-emerald-900";
  if (status === "inactive") return "border-zinc-300 bg-zinc-100 text-zinc-700";
  return "border-amber-300 bg-amber-100 text-amber-900";
}

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document !== "undefined") {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "absolute";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textArea);
    if (ok) return;
  }

  throw new Error("Clipboard unavailable.");
}

function roleBadge(role?: GovernanceRoleSpec) {
  if (!role) return null;
  return (
    <span className="rounded-full border border-[var(--swap-container-border)] bg-[var(--background-input)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
      {role.label}
    </span>
  );
}

function authorityBadge(label: string) {
  return (
    <span className="rounded-full border border-[var(--swap-container-border)] bg-[var(--background-input)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
      {label}
    </span>
  );
}

function CopyAddressButton({
  address,
  copiedAddress,
  onCopy,
  copyLabel,
  copiedLabel,
}: {
  address: Address;
  copiedAddress: string | null;
  onCopy: (address: Address) => void;
  copyLabel: string;
  copiedLabel: string;
}) {
  const isCopied = copiedAddress === address.toLowerCase();
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCopy(address);
      }}
      aria-label={isCopied ? copiedLabel : copyLabel}
      title={isCopied ? copiedLabel : copyLabel}
      className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
        isCopied
          ? "border-emerald-300 bg-emerald-100 text-emerald-700"
          : "border-[var(--swap-container-border)] text-[var(--text-input)] hover:bg-black/5"
      }`}
    >
      {isCopied ? <IoCheckmark className="text-xs" /> : <IoCopyOutline className="text-xs" />}
    </button>
  );
}

function AddressLine({
  address,
  alias,
  isConnected,
  copiedAddress,
  onCopy,
  labels,
}: {
  address: Address;
  alias?: string;
  isConnected: boolean;
  copiedAddress: string | null;
  onCopy: (address: Address) => void;
  labels: RoleMemberLabels;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-2 py-0.5 text-[10px] text-[var(--text-input)]">
      {alias && <span className="font-semibold">{alias}</span>}
      <span className="font-mono" title={address}>
        {shortAddress(address)}
      </span>
      <CopyAddressButton
        address={address}
        copiedAddress={copiedAddress}
        onCopy={onCopy}
        copyLabel={labels.copyAddress}
        copiedLabel={labels.addressCopied}
      />
      {isConnected && (
        <span className="rounded-full bg-gold-cg/20 px-1.5 py-0.5 font-semibold text-gold-cg">
          {labels.connected}
        </span>
      )}
    </span>
  );
}

type RoleMemberLabels = {
  addressCopied: string;
  checkingSafe: string;
  connected: string;
  copyAddress: string;
  safeLabel: string;
  safeOwners: string;
  threshold: string;
};

type ActionLabels = {
  available: string;
  direct: string;
  directInProgress: string;
  formPlanned: string;
  formRequired: string;
  noPermission: string;
  safe: string;
  safeInProgress: string;
};

type PauseStatusLabels = {
  active: string;
  contract: string;
  currentStatus: string;
  notConfigured: string;
  paused: string;
  unknown: string;
};

function PauseControlActions({
  surface,
  section,
  roleById,
  roleMembersById,
  principalsByAddress,
  connectedAddress,
  actionLabels,
  pauseStatusLabels,
  targetAddress,
  governanceSafeAddress,
  connectedIsGovernanceSafeOwner,
  governanceActions,
}: {
  surface: GovernanceSurfaceSpec;
  section: GovernanceSectionSpec;
  roleById: Map<string, GovernanceRoleSpec>;
  roleMembersById: Record<string, GovernanceRoleMembersState>;
  principalsByAddress: Map<string, GovernanceRolePrincipal>;
  connectedAddress?: Address;
  actionLabels: ActionLabels;
  pauseStatusLabels: PauseStatusLabels;
  targetAddress?: Address;
  governanceSafeAddress?: Address;
  connectedIsGovernanceSafeOwner: boolean;
  governanceActions: ReturnType<typeof useDiamondGovernanceActions>;
}) {
  const resolvedTargetAddress = useMemo(() => {
    if (targetAddress) return targetAddress;
    if (!surface.address || !isAddress(surface.address)) return undefined;
    return getAddress(surface.address);
  }, [surface.address, targetAddress]);

  const helpersPaused = useHelpersRouterFacts(facts => facts.configuration.paused.status === "success"
    ? facts.configuration.paused.value : undefined, { enabled: surface.id === "helpers" && !!resolvedTargetAddress });
  const authoritySurface = surface.id === "core" || surface.id === "staking" || surface.id === "governance-diamond"
    ? surface.id : undefined;
  const authority = useGovernanceAuthorityFacts(authoritySurface, {
    account: connectedAddress, enabled: !!resolvedTargetAddress,
  });
  const pausedData = surface.id === "helpers" ? helpersPaused.data : governanceAuthorityFlag(authority.data, "paused");
  const pausedState = typeof pausedData === "boolean" ? pausedData : undefined;
  const pausedStatus = pausedState === true ? "active" : pausedState === false ? "inactive" : "unknown";
  const isDynamicSafePauseSection = section.id === "pause" && authoritySurface !== undefined;
  const governanceAuthorityLoading = isDynamicSafePauseSection && authority.isLoading;

  return (
    <div className="mt-3 space-y-2">
      <div className="rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--text-muted)]">{pauseStatusLabels.currentStatus}</p>
            <span
              className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                pausedStatus
              )}`}
            >
              {pausedState === true
                ? pauseStatusLabels.paused
                : pausedState === false
                  ? pauseStatusLabels.active
                  : pauseStatusLabels.unknown}
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs text-[var(--text-muted)]">{pauseStatusLabels.contract}</p>
            <p className="mt-1 text-xs font-mono break-all text-[var(--text-input)]">
              {resolvedTargetAddress ?? pauseStatusLabels.notConfigured}
            </p>
          </div>
        </div>
      </div>

      {section.actions.map((action) => {
        const roleMembers = roleMembersById[action.requiredRoleId]?.members ?? [];
        const eligibility = isDynamicSafePauseSection
          ? governancePauseActionEligibility(action.functionSignature, {
              connectedCanPause: governanceAuthorityFlag(authority.data, "accountCanPause") === true,
              connectedCanUnpause: governanceAuthorityFlag(authority.data, "accountCanUnpause") === true,
              configuredSafe: governanceSafeAddress,
              configuredSafeCanUnpause:
                governanceAuthorityFlag(authority.data, "safeCanUnpause") === true,
              connectedIsConfiguredSafeOwner:
                connectedIsGovernanceSafeOwner,
            })
          : governanceActionEligibility({
              functionSignature: action.functionSignature,
              roleMembers,
              principalsByAddress,
              connectedAddress,
            });
        const directBusy = governanceActions.busyActionKey === governanceActions.directBusyKey(action.id);
        const hasSubmitOption =
          eligibility.supportsDirectSubmit &&
          (eligibility.canDirectCall || eligibility.eligibleSafes.length > 0);
        const directButtonClass = action.id.startsWith("pause-")
          ? "bg-red-600 hover:bg-red-700"
          : action.id.startsWith("unpause-")
            ? "bg-emerald-600 hover:bg-emerald-700"
            : "bg-gold-cg hover:opacity-90";

        return (
          <div
            key={action.id}
            className="rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-[var(--text-input)]">{action.label}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {isDynamicSafePauseSection
                  ? authorityBadge(
                      action.functionSignature === "pause()"
                        ? "Current Safe owner"
                        : "Configured Safe wallet"
                    )
                  : roleBadge(roleById.get(action.requiredRoleId))}
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    eligibility.supportsDirectSubmit ? "bg-emerald-100 text-emerald-800" : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {eligibility.supportsDirectSubmit ? actionLabels.available : actionLabels.formPlanned}
                </span>
              </div>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{action.description}</p>
            <p className="mt-2 font-mono text-[11px] text-[var(--text-muted)]">{action.functionSignature}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!eligibility.supportsDirectSubmit && (
                <span className="text-xs text-[var(--text-muted)]">{actionLabels.formRequired}</span>
              )}
              {eligibility.supportsDirectSubmit && eligibility.canDirectCall && (
                <button
                  type="button"
                  onClick={() => void governanceActions.submitDirectAction(action, resolvedTargetAddress)}
                  disabled={directBusy}
                  className={`rounded-full px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${directButtonClass}`}
                >
                  {directBusy ? actionLabels.directInProgress : actionLabels.direct}
                </button>
              )}
              {eligibility.supportsDirectSubmit &&
                eligibility.eligibleSafes.map((safe) => {
                  const safeBusy =
                    governanceActions.busyActionKey === governanceActions.safeBusyKey(action.id, safe.address);
                  return (
                    <button
                      key={`${action.id}:${safe.address}`}
                      type="button"
                      onClick={() => void governanceActions.submitSafeAction(action, safe.address, resolvedTargetAddress)}
                      disabled={safeBusy}
                      className="rounded-full border border-[var(--swap-container-border)] px-4 py-2 text-xs font-semibold text-[var(--text-input)] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
                      title={safe.address}
                    >
                      {safeBusy ? actionLabels.safeInProgress : `${actionLabels.safe} ${shortAddress(safe.address)}`}
                    </button>
                  );
                })}
              {eligibility.supportsDirectSubmit &&
                !hasSubmitOption &&
                !governanceAuthorityLoading && (
                <span className="text-xs text-[var(--text-muted)]">{actionLabels.noPermission}</span>
                )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RolePrincipalCard({
  member,
  principal,
  ownerAliasesByOwner,
  connectedAddress,
  copiedAddress,
  onCopy,
  labels,
}: {
  member: Address;
  principal?: GovernanceRolePrincipal;
  ownerAliasesByOwner: Map<string, string>;
  connectedAddress?: Address;
  copiedAddress: string | null;
  onCopy: (address: Address) => void;
  labels: RoleMemberLabels;
}) {
  const connectedKey = connectedAddress?.toLowerCase();
  const resolvedPrincipal =
    principal ??
    ({
      address: member,
      kind: "address",
      owners: [],
      connectedIsOwner: false,
      isCheckingSafe: false,
    } satisfies GovernanceRolePrincipal);

  if (resolvedPrincipal.kind !== "safe") {
    return (
      <AddressLine
        address={member}
        alias={ownerAliasesByOwner.get(member.toLowerCase())}
        isConnected={!!connectedKey && member.toLowerCase() === connectedKey}
        copiedAddress={copiedAddress}
        onCopy={onCopy}
        labels={labels}
      />
    );
  }

  return (
    <details className="w-full rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-2 py-1.5">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-input)] marker:hidden">
        <span className="rounded-full bg-gold-cg/15 px-2 py-0.5 font-semibold text-gold-cg">{labels.safeLabel}</span>
        <span className="font-mono" title={member}>
          {shortAddress(member)}
        </span>
        <CopyAddressButton
          address={member}
          copiedAddress={copiedAddress}
          onCopy={onCopy}
          copyLabel={labels.copyAddress}
          copiedLabel={labels.addressCopied}
        />
        <span className="rounded-full border border-[var(--swap-container-border)] px-2 py-0.5 text-[var(--text-muted)]">
          {labels.threshold}: {resolvedPrincipal.threshold ?? "?"} / {resolvedPrincipal.owners.length || "?"}
        </span>
        <span className="text-[var(--text-muted)] underline decoration-dotted">{labels.safeOwners}</span>
        {resolvedPrincipal.connectedIsOwner && (
          <span className="rounded-full bg-gold-cg/20 px-2 py-0.5 font-semibold text-gold-cg">
            {labels.connected}
          </span>
        )}
      </summary>
      <div className="mt-2 border-t border-[var(--swap-container-border)] pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {labels.safeOwners}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {resolvedPrincipal.owners.map((owner) => (
            <AddressLine
              key={owner}
              address={owner}
              alias={ownerAliasesByOwner.get(owner.toLowerCase())}
              isConnected={!!connectedKey && owner.toLowerCase() === connectedKey}
              copiedAddress={copiedAddress}
              onCopy={onCopy}
              labels={labels}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function RoleMembers({
  state,
  principalsByAddress,
  ownerAliasesByOwner,
  connectedAddress,
  copiedAddress,
  onCopy,
  labels,
}: {
  state?: GovernanceRoleMembersState;
  principalsByAddress: Map<string, GovernanceRolePrincipal>;
  ownerAliasesByOwner: Map<string, string>;
  connectedAddress?: Address;
  copiedAddress: string | null;
  onCopy: (address: Address) => void;
  labels: RoleMemberLabels;
}) {
  if (!state) {
    return <span className="text-xs text-[var(--text-muted)]">Not configured</span>;
  }
  if (state.isLoading) {
    return <span className="text-xs text-[var(--text-muted)]">Loading members...</span>;
  }
  if (state.isUnavailable) {
    return <span className="text-xs text-[var(--text-muted)]">Members unavailable on this deployment</span>;
  }
  if (state.members.length === 0) {
    return <span className="text-xs text-[var(--text-muted)]">No members</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {state.members.map((member) => {
        const principal = principalsByAddress.get(member.toLowerCase());
        return (
          <RolePrincipalCard
            key={member}
            member={member}
            principal={principal}
            ownerAliasesByOwner={ownerAliasesByOwner}
            connectedAddress={connectedAddress}
            copiedAddress={copiedAddress}
            onCopy={onCopy}
            labels={labels}
          />
        );
      })}
      {state.expectedCount !== undefined && state.expectedCount > state.members.length && (
        <span className="rounded-full border border-[var(--swap-container-border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
          +{state.expectedCount - state.members.length} more
        </span>
      )}
      {state.members.some((member) => principalsByAddress.get(member.toLowerCase())?.isCheckingSafe) && (
        <span className="rounded-full border border-[var(--swap-container-border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
          {labels.checkingSafe}
        </span>
      )}
    </div>
  );
}

function SectionCard({
  surface,
  section,
  roleById,
  roleMembersById,
  principalsByAddress,
  ownerAliasesByOwner,
  connectedAddress,
  copiedAddress,
  onCopy,
  roleMemberLabels,
  actionLabels,
  pauseStatusLabels,
  governanceSafeAddress,
  connectedIsGovernanceSafeOwner,
  governanceActions,
}: {
  surface: GovernanceSurfaceSpec;
  section: GovernanceSectionSpec;
  roleById: Map<string, GovernanceRoleSpec>;
  roleMembersById: Record<string, GovernanceRoleMembersState>;
  principalsByAddress: Map<string, GovernanceRolePrincipal>;
  ownerAliasesByOwner: Map<string, string>;
  connectedAddress?: Address;
  copiedAddress: string | null;
  onCopy: (address: Address) => void;
  roleMemberLabels: RoleMemberLabels;
  actionLabels: ActionLabels;
  pauseStatusLabels: PauseStatusLabels;
  governanceSafeAddress?: Address;
  connectedIsGovernanceSafeOwner: boolean;
  governanceActions: ReturnType<typeof useDiamondGovernanceActions>;
}) {
  const requiredRoleLabel = (actionRoleId: string) => roleById.get(actionRoleId)?.label ?? actionRoleId;

  return (
    <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-input)] px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-input)]">{section.label}</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{section.description}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {section.requiredRoleIds.map((roleId) => (
            <span key={roleId}>{roleBadge(roleById.get(roleId))}</span>
          ))}
        </div>
      </div>

      {section.requiredRoleIds.length > 0 && (
        <div className="mt-3 rounded-md border border-gold-cg/20 bg-gold-cg/5 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Role members</p>
          <div className="mt-2 space-y-2">
            {section.requiredRoleIds.map((roleId) => {
              const role = roleById.get(roleId);
              return (
                <div key={roleId} className="grid grid-cols-1 gap-1 text-xs md:grid-cols-[180px_1fr]">
                  <span className="font-mono text-[var(--text-input)]">{role?.label ?? roleId}</span>
                  <RoleMembers
                    state={roleMembersById[roleId]}
                    principalsByAddress={principalsByAddress}
                    ownerAliasesByOwner={ownerAliasesByOwner}
                    connectedAddress={connectedAddress}
                    copiedAddress={copiedAddress}
                    onCopy={onCopy}
                    labels={roleMemberLabels}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {section.actions.length > 0 && section.id === "pause" ? (
        <PauseControlActions
          surface={surface}
          section={section}
          roleById={roleById}
          roleMembersById={roleMembersById}
          principalsByAddress={principalsByAddress}
          connectedAddress={connectedAddress}
          actionLabels={actionLabels}
          pauseStatusLabels={pauseStatusLabels}
          governanceSafeAddress={governanceSafeAddress}
          connectedIsGovernanceSafeOwner={connectedIsGovernanceSafeOwner}
          governanceActions={governanceActions}
        />
      ) : section.actions.length > 0 && (
        <div className="mt-3 space-y-2">
          {section.actions.map((action) => {
            const roleMembers = roleMembersById[action.requiredRoleId]?.members ?? [];
            const eligibility = governanceActionEligibility({
              functionSignature: action.functionSignature,
              roleMembers,
              principalsByAddress,
              connectedAddress,
            });
            const directBusy = governanceActions.busyActionKey === governanceActions.directBusyKey(action.id);
            const hasSubmitOption =
              eligibility.supportsDirectSubmit &&
              (eligibility.canDirectCall || eligibility.eligibleSafes.length > 0);

            return (
              surface.id === "core" && action.id === "set-basket" ? (
                <CoreBasketTargetsActionCard
                  key={action.id}
                  action={action}
                  eligibility={eligibility}
                  governanceActions={governanceActions}
                  requiredRoleLabel={requiredRoleLabel(action.requiredRoleId)}
                />
              ) : surface.id === "core" &&
                (action.id === "set-issuance-fee" || action.id === "set-redemption-fee") ? (
                <CoreFeesActionCard
                  key={action.id}
                  action={action}
                  eligibility={eligibility}
                  governanceActions={governanceActions}
                  requiredRoleLabel={requiredRoleLabel(action.requiredRoleId)}
                />
              ) : surface.id === "core" && action.id === "set-max-total-supply" ? (
                <CoreMaxTotalSupplyActionCard
                  key={action.id}
                  action={action}
                  eligibility={eligibility}
                  governanceActions={governanceActions}
                  requiredRoleLabel={requiredRoleLabel(action.requiredRoleId)}
                />
              ) : surface.id === "core" && action.id === "set-treasury" ? (
                <CoreLinkedContractActionCard
                  key={action.id}
                  action={action}
                  eligibility={eligibility}
                  governanceActions={governanceActions}
                  requiredRoleLabel={requiredRoleLabel(action.requiredRoleId)}
                />
              ) : surface.id === "core" && (action.id === "grant-role" || action.id === "revoke-role") ? (
                <CoreRoleManagementActionCard
                  key={action.id}
                  action={action}
                  eligibility={eligibility}
                  governanceActions={governanceActions}
                  requiredRoleLabel={requiredRoleLabel(action.requiredRoleId)}
                  roleSpecs={Array.from(roleById.values())}
                  roleMembersById={roleMembersById}
                  ownerAliasesByOwner={ownerAliasesByOwner}
                />
              ) : surface.id === "helpers" && action.id === "set-adapter-approval" ? (
                <HelpersAdapterApprovalActionCard
                  key={action.id}
                  action={action}
                  eligibility={eligibility}
                  governanceActions={governanceActions}
                  requiredRoleLabel={requiredRoleLabel(action.requiredRoleId)}
                />
              ) : surface.id === "helpers" && action.id === "set-helper-fee" ? (
                <HelpersFeeActionCard
                  key={action.id}
                  action={action}
                  eligibility={eligibility}
                  governanceActions={governanceActions}
                  requiredRoleLabel={requiredRoleLabel(action.requiredRoleId)}
                />
              ) : surface.id === "helpers" && action.id === "sweep-token" ? (
                <HelpersSweepActionCard
                  key={action.id}
                  action={action}
                  eligibility={eligibility}
                  governanceActions={governanceActions}
                  requiredRoleLabel={requiredRoleLabel(action.requiredRoleId)}
                />
              ) : (
                <div
                  key={action.id}
                  className="rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--text-input)]">{action.label}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {roleBadge(roleById.get(action.requiredRoleId))}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          eligibility.supportsDirectSubmit
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {eligibility.supportsDirectSubmit ? actionLabels.available : actionLabels.formPlanned}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{action.description}</p>
                  <p className="mt-2 font-mono text-[11px] text-[var(--text-muted)]">{action.functionSignature}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!eligibility.supportsDirectSubmit && (
                      <span className="text-xs text-[var(--text-muted)]">{actionLabels.formRequired}</span>
                    )}
                    {eligibility.supportsDirectSubmit && eligibility.canDirectCall && (
                      <button
                        type="button"
                        onClick={() => void governanceActions.submitDirectAction(action)}
                        disabled={directBusy}
                        className="rounded-full bg-gold-cg px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {directBusy ? actionLabels.directInProgress : actionLabels.direct}
                      </button>
                    )}
                    {eligibility.supportsDirectSubmit &&
                      eligibility.eligibleSafes.map((safe) => {
                        const safeBusy =
                          governanceActions.busyActionKey === governanceActions.safeBusyKey(action.id, safe.address);
                        return (
                          <button
                            key={`${action.id}:${safe.address}`}
                            type="button"
                            onClick={() => void governanceActions.submitSafeAction(action, safe.address)}
                            disabled={safeBusy}
                            className="rounded-full border border-[var(--swap-container-border)] px-4 py-2 text-xs font-semibold text-[var(--text-input)] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
                            title={safe.address}
                          >
                            {safeBusy
                              ? actionLabels.safeInProgress
                              : `${actionLabels.safe} ${shortAddress(safe.address)}`}
                          </button>
                        );
                      })}
                    {eligibility.supportsDirectSubmit && !hasSubmitOption && (
                      <span className="text-xs text-[var(--text-muted)]">{actionLabels.noPermission}</span>
                    )}
                  </div>
                </div>
              )
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DiamondGovernancePage({ surfaceId }: DiamondGovernancePageProps) {
  const t = useTranslations("Governance");
  const { address, isConnected } = useObservedWalletAccount();
  const { addresses } = useProtocolConfiguration();
  const surface = useMemo(() => getGovernanceSurface(surfaceId, addresses), [surfaceId, addresses]);
  const {
    byRoleId: roleMembersById,
    isLoading: roleMembersLoading,
    error: roleMembersError,
  } = useGovernanceRoleMembers(surface);
  const {
    authorityKind,
    authorityAddress: governanceAuthorityAddress,
  } = resolveDiamondGovernanceAuthority(
    surface.id,
    surface.address,
    roleMembersById.DIAMOND_OWNER?.members[0]
  );
  const {
    safeAddress: governanceSafeAddress,
    isLoading: governanceAuthorityLoading,
    error: governanceAuthorityError,
    isSafeOwner,
  } = useGovernanceSafe({
    authorityAddress: governanceAuthorityAddress,
    authorityKind,
    enabled: governanceAuthorityAddress !== undefined,
  });
  const safeLoading =
    governanceAuthorityLoading ||
    (surface.id === "helpers" && roleMembersLoading);
  const helpersOwnerState = roleMembersById.DIAMOND_OWNER;
  const helpersOwnerReadError =
    surface.id === "helpers" &&
    !roleMembersLoading &&
    helpersOwnerState?.isUnavailable
      ? new Error("The Helpers owner could not be read from the Helpers diamond.")
      : null;
  const safeError =
    governanceAuthorityError ??
    helpersOwnerReadError ??
    (surface.id === "helpers" ? roleMembersError : null);
  const { principalsByAddress, safeOwnerAddresses } = useGovernanceSafePrincipals(roleMembersById, address);
  const ownerAliasesQuery = useGovernanceOwnerAliases(address, safeOwnerAddresses, isConnected && safeOwnerAddresses.length > 0);
  const governanceActions = useDiamondGovernanceActions(surface);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const roleById = useMemo(() => new Map(surface.roles.map((role) => [role.id, role])), [surface.roles]);
  const ownerAliasesByOwner = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of ownerAliasesQuery.data ?? []) {
      map.set(row.ownerAddress.toLowerCase(), row.alias);
    }
    return map;
  }, [ownerAliasesQuery.data]);
  const roleMemberLabels = useMemo<RoleMemberLabels>(
    () => ({
      addressCopied: t("addressCopied"),
      checkingSafe: t("diamondCheckingSafeOwners"),
      connected: t("connectedBadge"),
      copyAddress: t("copyAddressButton"),
      safeLabel: t("diamondSafePrincipalLabel"),
      safeOwners: t("diamondSafeOwnersLabel"),
      threshold: t("thresholdLabel"),
    }),
    [t]
  );
  const actionLabels = useMemo<ActionLabels>(
    () => ({
      available: t("diamondActionAvailableBadge"),
      direct: t("diamondDirectActionButton"),
      directInProgress: t("diamondDirectActionInProgressButton"),
      formPlanned: t("diamondActionFormPlannedBadge"),
      formRequired: t("diamondActionFormRequiredHint"),
      noPermission: t("diamondActionNoPermissionHint"),
      safe: t("diamondSafeActionButton"),
      safeInProgress: t("diamondSafeActionInProgressButton"),
    }),
    [t]
  );
  const pauseStatusLabels = useMemo<PauseStatusLabels>(
    () => ({
      active: t("statusActive"),
      contract: t("diamondAddressLabel"),
      currentStatus: t("pausedStatusLabel"),
      notConfigured: t("notAvailable"),
      paused: t("statusPaused"),
      unknown: t("statusUnknown"),
    }),
    [t]
  );
  const hasAccess = isConnected && isSafeOwner(address);

  useEffect(() => {
    if (!copiedAddress) return;
    const timeout = window.setTimeout(() => setCopiedAddress(null), 1400);
    return () => window.clearTimeout(timeout);
  }, [copiedAddress]);

  const copyAddress = async (addressToCopy: Address) => {
    try {
      await copyTextToClipboard(addressToCopy);
      setCopiedAddress(addressToCopy.toLowerCase());
    } catch (error) {
      setCopiedAddress(null);
      toast.error(t("addressCopyFailed"), {
        description: error instanceof Error ? error.message : "Unexpected error.",
      });
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-background font-sans">
      <div className="mx-auto flex w-full max-w-6xl flex-col p-3">
        <section className="mt-4 flex w-full max-w-6xl items-center justify-between pt-4 text-[var(--text-input)]">
          <div>
            <h1 className="text-3xl font-semibold">{surface.label}</h1>
            <p className="hidden text-sm text-[var(--text-muted)] md:block">{surface.description}</p>
          </div>
        </section>
        <GovernanceSurfaceNav activeSurfaceId={surface.id} />

        {safeError && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-semibold">{t("dataWarningTitle")}</p>
            <p className="mt-1 break-all">{safeError instanceof Error ? safeError.message : String(safeError)}</p>
          </div>
        )}

        <section className="mt-4">
          <GovernanceAccessGate isLoading={safeLoading} isConnected={isConnected} hasAccess={hasAccess}>
            <>
              <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-4 py-4">
                  <h2 className="text-lg font-semibold text-[var(--text-input)]">{t("diamondSummaryTitle")}</h2>
                  <div className="mt-3 space-y-2 text-sm text-[var(--text-muted)]">
                    <p>
                      <span className="font-medium text-[var(--text-input)]">{t("diamondPackageLabel")}:</span>{" "}
                      <span className="font-mono break-all">{surface.packageName}</span>
                    </p>
                    <p>
                      <span className="font-medium text-[var(--text-input)]">{t("diamondAddressLabel")}:</span>{" "}
                      <span className="font-mono break-all">{surface.address ?? t("notAvailable")}</span>
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-4 py-4">
                  <h2 className="text-lg font-semibold text-[var(--text-input)]">{t("diamondSpecialRolesTitle")}</h2>
                  <div className="mt-3 space-y-2">
                    {surface.roles.map((role) => (
                      <div
                        key={role.id}
                        className="rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-mono text-sm font-semibold text-[var(--text-input)]">{role.label}</p>
                          <span className="rounded-full border border-[var(--swap-container-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
                            {roleKindLabel(role.kind)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">{role.description}</p>
                        <div className="mt-2">
                          <RoleMembers
                            state={roleMembersById[role.id]}
                            principalsByAddress={principalsByAddress}
                            ownerAliasesByOwner={ownerAliasesByOwner}
                            connectedAddress={address}
                            copiedAddress={copiedAddress}
                            onCopy={(addressToCopy) => void copyAddress(addressToCopy)}
                            labels={roleMemberLabels}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="mt-4 rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-4 py-4">
                <h2 className="text-lg font-semibold text-[var(--text-input)]">{t("diamondNextSectionsTitle")}</h2>
                <div className="mt-3 grid grid-cols-1 gap-3">
                  {surface.sections.map((section) => (
                    <SectionCard
                      key={section.id}
                      surface={surface}
                      section={section}
                      roleById={roleById}
                      roleMembersById={roleMembersById}
                      principalsByAddress={principalsByAddress}
                      ownerAliasesByOwner={ownerAliasesByOwner}
                      connectedAddress={address}
                      copiedAddress={copiedAddress}
                      onCopy={(addressToCopy) => void copyAddress(addressToCopy)}
                      roleMemberLabels={roleMemberLabels}
                      actionLabels={actionLabels}
                      pauseStatusLabels={pauseStatusLabels}
                      governanceSafeAddress={governanceSafeAddress}
                      connectedIsGovernanceSafeOwner={isSafeOwner(address)}
                      governanceActions={governanceActions}
                    />
                  ))}
                </div>
              </section>
            </>
          </GovernanceAccessGate>
        </section>
      </div>
    </div>
  );
}
