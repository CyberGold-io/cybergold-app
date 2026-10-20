"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { toast } from "sonner";
import { encodeFunctionData, getAddress, isAddress, type Address } from "viem";
import { CORE_DIAMOND_ABI } from "@/app/contracts/generated/coreDiamond";
import { buildGovernanceDeploymentAddressBook, getGovernanceAddressLabel } from "@/app/utils/governanceAddressBook";
import { governanceRoleHash } from "@/app/utils/governanceRoleHash";
import type { GovernanceActionEligibility } from "@/app/utils/governanceActionEligibility";
import type { GovernanceRoleSpec, GovernanceActionSpec } from "../_lib/governanceSurfaces";
import type { GovernanceRoleMembersState } from "../_hooks/useGovernanceRoleMembers";
import type { useDiamondGovernanceActions } from "../_hooks/useDiamondGovernanceActions";

const ACTION_CONFIG = {
  "grant-role": {
    functionName: "grantRole",
    mode: "grant",
  },
  "revoke-role": {
    functionName: "revokeRole",
    mode: "revoke",
  },
} as const;

type RoleActionId = keyof typeof ACTION_CONFIG;

function isRoleActionId(actionId: string): actionId is RoleActionId {
  return actionId in ACTION_CONFIG;
}

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function CoreRoleManagementActionCard({
  action,
  eligibility,
  governanceActions,
  requiredRoleLabel,
  roleSpecs,
  roleMembersById,
  ownerAliasesByOwner,
}: {
  action: GovernanceActionSpec;
  eligibility: GovernanceActionEligibility;
  governanceActions: ReturnType<typeof useDiamondGovernanceActions>;
  requiredRoleLabel: string;
  roleSpecs: readonly GovernanceRoleSpec[];
  roleMembersById: Record<string, GovernanceRoleMembersState>;
  ownerAliasesByOwner: Map<string, string>;
}) {
  const t = useTranslations("Governance");
  const { addresses } = useProtocolConfiguration();
  const [selectedRoleInput, setSelectedRoleInput] = useState("");
  const [accountInput, setAccountInput] = useState("");
  const config = isRoleActionId(action.id) ? ACTION_CONFIG[action.id] : undefined;
  const selectableRoles = useMemo(
    () =>
      roleSpecs.filter(
        (role) =>
          role.id !== "DEFAULT_ADMIN_ROLE" &&
          (role.kind === "access-control" || role.kind === "timelock")
      ),
    [roleSpecs]
  );
  const selectedRole =
    selectableRoles.find((role) => role.id === selectedRoleInput) ??
    selectableRoles[0];
  const roleState = selectedRole ? roleMembersById[selectedRole.id] : undefined;
  const currentMembers = roleState?.members ?? [];
  const normalizedAccount = useMemo(() => {
    const trimmed = accountInput.trim();
    return isAddress(trimmed) ? getAddress(trimmed) : undefined;
  }, [accountInput]);
  const addressBook = useMemo(() => {
    const entries = buildGovernanceDeploymentAddressBook(addresses);
    return new Map(entries.map((entry) => [entry.address.toLowerCase(), entry.label]));
  }, [addresses]);

  const validationError = useMemo(() => {
    if (!selectedRole) {
      return t("roleFormRoleRequiredError");
    }
    if (!normalizedAccount) {
      return t("roleFormAccountRequiredError");
    }
    return undefined;
  }, [normalizedAccount, selectedRole, t]);

  const accountAlreadyMember =
    !!normalizedAccount && currentMembers.some((member) => member.toLowerCase() === normalizedAccount.toLowerCase());
  const directBusy = governanceActions.busyActionKey === governanceActions.directBusyKey(action.id);
  const hasSubmitOption = eligibility.canDirectCall || eligibility.eligibleSafes.length > 0;

  if (!config) {
    return null;
  }

  const submitDirect = async () => {
    if (!selectedRole || !normalizedAccount || validationError) {
      toast.error(t("roleFormValidationToast"));
      return;
    }

    await governanceActions.submitDirectContractAction({
      action,
      abi: CORE_DIAMOND_ABI,
      functionName: config.functionName,
      args: [governanceRoleHash(selectedRole.id), normalizedAccount],
    });
  };

  const submitSafe = async (safeAddress: Address) => {
    if (!selectedRole || !normalizedAccount || validationError) {
      toast.error(t("roleFormValidationToast"));
      return;
    }

    await governanceActions.submitSafeContractAction({
      action,
      safeAddress,
      data: encodeFunctionData({
        abi: CORE_DIAMOND_ABI,
        functionName: config.functionName,
        args: [governanceRoleHash(selectedRole.id), normalizedAccount],
      }),
    });
  };

  return (
    <div className="rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--text-input)]">{action.label}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-[var(--swap-container-border)] bg-[var(--background-input)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
            {requiredRoleLabel}
          </span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
            {t("diamondActionAvailableBadge")}
          </span>
        </div>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{action.description}</p>
      <p className="mt-2 font-mono text-[11px] text-[var(--text-muted)]">{action.functionSignature}</p>

      <div className="mt-3 rounded-md border border-gold-cg/20 bg-gold-cg/5 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {t("roleFormCurrentTitle")}
        </p>
        {!selectedRole ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("roleFormUnavailable")}</p>
        ) : (
          <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
            <p>
              {t("roleFormCurrentRoleLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)]">{selectedRole.label}</span>
            </p>
            <p>
              {t("roleFormCurrentHashLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)] break-all">
                {governanceRoleHash(selectedRole.id)}
              </span>
            </p>
            {roleState?.isUnavailable ? (
              <p>{t("roleFormMembersUnavailable")}</p>
            ) : currentMembers.length === 0 ? (
              <p>{t("roleFormNoMembers")}</p>
            ) : (
              <div className="pt-1">
                <p className="mb-1">{t("roleFormCurrentMembersLabel")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {currentMembers.map((member) => {
                    const alias =
                      ownerAliasesByOwner.get(member.toLowerCase()) ?? getGovernanceAddressLabel(addressBook, member);
                    return (
                      <button
                        key={`${selectedRole.id}:${member}`}
                        type="button"
                        onClick={() => setAccountInput(member)}
                        className="rounded-full border border-[var(--swap-container-border)] bg-[var(--background-input)] px-2 py-1 text-[10px] text-[var(--text-input)] hover:bg-black/5"
                        title={member}
                      >
                        {alias ? `${alias} ` : ""}
                        {shortAddress(member)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-3">
        <p className="text-sm font-semibold text-[var(--text-input)]">{t("roleFormEditTitle")}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{t("roleFormEditSubtitle")}</p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-xs text-[var(--text-muted)]">
            <span className="mb-1 block">{t("roleFormRoleLabel")}</span>
            <select data-page-draft-key={`${action.id}:role`}
              value={selectedRole?.id ?? ""}
              onChange={(event) => setSelectedRoleInput(event.target.value)}
              className="w-full rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-2 text-[var(--text-input)]"
            >
              {selectableRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)]">
            <span className="mb-1 block">{t("roleFormAccountLabel")}</span>
            <input data-page-draft-key={`${action.id}:account`}
              type="text"
              value={accountInput}
              onChange={(event) => setAccountInput(event.target.value)}
              placeholder="0x..."
              className="w-full rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-2 font-mono text-[var(--text-input)]"
            />
          </label>
        </div>
        <div className="mt-3 space-y-1 text-xs">
          {validationError ? (
            <p className="text-rose-700 dark:text-rose-300">{validationError}</p>
          ) : (
            <p className="text-emerald-700 dark:text-emerald-300">{t("roleFormValidationOk")}</p>
          )}
          {!validationError && normalizedAccount && config.mode === "grant" && accountAlreadyMember && (
            <p className="text-[var(--text-muted)]">{t("roleFormAlreadyMemberHint")}</p>
          )}
          {!validationError && normalizedAccount && config.mode === "revoke" && !accountAlreadyMember && (
            <p className="text-[var(--text-muted)]">{t("roleFormNotCurrentMemberHint")}</p>
          )}
          <p className="text-[11px] text-[var(--text-muted)]">{t("roleFormExecutionHint")}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {eligibility.canDirectCall && (
          <button
            type="button"
            onClick={() => void submitDirect()}
            disabled={directBusy || !!validationError}
            className="rounded-full bg-gold-cg px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {directBusy ? t("diamondDirectActionInProgressButton") : t("diamondDirectActionButton")}
          </button>
        )}
        {eligibility.eligibleSafes.map((safe) => {
          const safeBusy = governanceActions.busyActionKey === governanceActions.safeBusyKey(action.id, safe.address);
          return (
            <button
              key={`${action.id}:${safe.address}`}
              type="button"
              onClick={() => void submitSafe(safe.address)}
              disabled={safeBusy || !!validationError}
              className="rounded-full border border-[var(--swap-container-border)] px-4 py-2 text-xs font-semibold text-[var(--text-input)] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
              title={safe.address}
            >
              {safeBusy
                ? t("diamondSafeActionInProgressButton")
                : `${t("diamondSafeActionButton")} ${safe.address.slice(0, 6)}...${safe.address.slice(-4)}`}
            </button>
          );
        })}
        {!hasSubmitOption && (
          <span className="text-xs text-[var(--text-muted)]">{t("diamondActionNoPermissionHint")}</span>
        )}
      </div>
    </div>
  );
}
