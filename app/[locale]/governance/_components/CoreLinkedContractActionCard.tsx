"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { toast } from "sonner";
import { encodeFunctionData, getAddress, isAddress, zeroAddress, type Address } from "viem";
import { CORE_DIAMOND_ABI } from "@/app/contracts/generated/coreDiamond";
import { buildGovernanceDeploymentAddressBook, getGovernanceAddressLabel } from "@/app/utils/governanceAddressBook";
import type { GovernanceActionEligibility } from "@/app/utils/governanceActionEligibility";
import type { GovernanceActionSpec } from "../_lib/governanceSurfaces";
import type { useDiamondGovernanceActions } from "../_hooks/useDiamondGovernanceActions";
import { useCoreControllerConfig } from "../_hooks/useCoreControllerConfig";

const ACTION_CONFIG = {
  "set-treasury": {
    currentField: "treasury",
    functionName: "setTreasury",
  },
} as const;

type LinkedActionId = keyof typeof ACTION_CONFIG;

function isLinkedActionId(actionId: string): actionId is LinkedActionId {
  return actionId in ACTION_CONFIG;
}

export function CoreLinkedContractActionCard({
  action,
  eligibility,
  governanceActions,
  requiredRoleLabel,
}: {
  action: GovernanceActionSpec;
  eligibility: GovernanceActionEligibility;
  governanceActions: ReturnType<typeof useDiamondGovernanceActions>;
  requiredRoleLabel: string;
}) {
  const t = useTranslations("Governance");
  const { addresses } = useProtocolConfiguration();
  const controllerConfig = useCoreControllerConfig();
  const [newAddress, setNewAddress] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const config = isLinkedActionId(action.id) ? ACTION_CONFIG[action.id] : undefined;
  const currentAddress = config ? controllerConfig.data?.[config.currentField] : undefined;
  const addressBook = useMemo(() => {
    const entries = buildGovernanceDeploymentAddressBook(addresses);
    return new Map(entries.map((entry) => [entry.address.toLowerCase(), entry.label]));
  }, [addresses]);
  const currentAlias = getGovernanceAddressLabel(addressBook, currentAddress);
  const draftAddress = isDirty ? newAddress : currentAddress ?? newAddress;

  const normalizedNextAddress = useMemo(() => {
    const candidate = draftAddress.trim();
    return isAddress(candidate) && candidate !== zeroAddress ? getAddress(candidate) : undefined;
  }, [draftAddress]);

  const validationError =
    normalizedNextAddress === undefined ? t("linkedContractFormAddressError") : undefined;
  const directBusy = governanceActions.busyActionKey === governanceActions.directBusyKey(action.id);
  const hasSubmitOption = eligibility.canDirectCall || eligibility.eligibleSafes.length > 0;

  if (!config) {
    return null;
  }

  const submitDirect = async () => {
    if (!currentAddress || !normalizedNextAddress) {
      toast.error(t("linkedContractFormValidationToast"));
      return;
    }

    await governanceActions.submitDirectContractAction({
      action,
      abi: CORE_DIAMOND_ABI,
      functionName: config.functionName,
      args: [currentAddress, normalizedNextAddress],
    });
  };

  const submitSafe = async (safeAddress: Address) => {
    if (!currentAddress || !normalizedNextAddress) {
      toast.error(t("linkedContractFormValidationToast"));
      return;
    }

    await governanceActions.submitSafeContractAction({
      action,
      safeAddress,
      data: encodeFunctionData({
        abi: CORE_DIAMOND_ABI,
        functionName: config.functionName,
        args: [currentAddress, normalizedNextAddress],
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
          {t("linkedContractFormCurrentTitle")}
        </p>
        {controllerConfig.isLoading ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("linkedContractFormLoadingCurrent")}</p>
        ) : currentAddress ? (
          <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
            {currentAlias && (
              <p>
                {t("linkedContractFormCurrentAliasLabel")}:{" "}
                <span className="font-semibold text-[var(--text-input)]">{currentAlias}</span>
              </p>
            )}
            <p>
              {t("linkedContractFormCurrentAddressLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)] break-all">{currentAddress}</span>
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("linkedContractFormCurrentUnavailable")}</p>
        )}
      </div>

      <div className="mt-3 rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-3">
        <p className="text-sm font-semibold text-[var(--text-input)]">{t("linkedContractFormEditTitle")}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{t("linkedContractFormEditSubtitle")}</p>
        <label className="mt-3 block text-xs text-[var(--text-muted)]">
          <span className="mb-1 block">{t("linkedContractFormAddressLabel")}</span>
          <input
            type="text"
            value={draftAddress}
            onChange={(event) => {
              setNewAddress(event.target.value);
              setIsDirty(true);
            }}
            placeholder="0x..."
            className="w-full rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-2 font-mono text-[var(--text-input)]"
          />
        </label>
        <div className="mt-3 space-y-1 text-xs">
          {validationError ? (
            <p className="text-rose-700 dark:text-rose-300">{validationError}</p>
          ) : (
            <p className="text-emerald-700 dark:text-emerald-300">{t("linkedContractFormValidationOk")}</p>
          )}
          <p className="text-[11px] text-[var(--text-muted)]">{t("linkedContractFormNonZeroHint")}</p>
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
