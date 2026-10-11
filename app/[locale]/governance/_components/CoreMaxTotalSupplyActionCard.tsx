"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { encodeFunctionData, type Address } from "viem";
import { CORE_DIAMOND_ABI } from "@/app/contracts/generated/coreDiamond";
import type { GovernanceActionEligibility } from "@/app/utils/governanceActionEligibility";
import type { GovernanceActionSpec } from "../_lib/governanceSurfaces";
import type { useDiamondGovernanceActions } from "../_hooks/useDiamondGovernanceActions";
import { useCoreControllerConfig } from "../_hooks/useCoreControllerConfig";

function parseUintInput(value: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  return BigInt(trimmed);
}

export function CoreMaxTotalSupplyActionCard({
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
  const controllerConfig = useCoreControllerConfig();
  const [newCapInput, setNewCapInput] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const currentCap = controllerConfig.data?.maxTotalSupply;
  const currentSupply = controllerConfig.data?.totalSupply;
  const currentCapText = currentCap?.toString() ?? "";
  const currentSupplyText = currentSupply?.toString() ?? "";
  const remainingSupply =
    currentCap !== undefined && currentSupply !== undefined && currentCap > currentSupply
      ? currentCap - currentSupply
      : 0n;
  const draftNewCap = isDirty ? newCapInput : currentCapText || newCapInput;
  const parsedNewCap = parseUintInput(draftNewCap);

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (currentCap === undefined) {
      errors.push(t("maxSupplyFormCurrentUnavailable"));
    }
    if (parsedNewCap === undefined) {
      errors.push(t("maxSupplyFormInvalidNewCapError"));
    } else if (parsedNewCap === 0n) {
      errors.push(t("maxSupplyFormZeroNewCapError"));
    } else if (currentSupply !== undefined && parsedNewCap < currentSupply) {
      errors.push(t("maxSupplyFormBelowSupplyError", { supply: currentSupply.toString() }));
    }
    return errors;
  }, [currentCap, currentSupply, parsedNewCap, t]);

  const directBusy = governanceActions.busyActionKey === governanceActions.directBusyKey(action.id);
  const hasSubmitOption = eligibility.canDirectCall || eligibility.eligibleSafes.length > 0;

  const submitDirect = async () => {
    if (currentCap === undefined || parsedNewCap === undefined || validationErrors.length > 0) {
      toast.error(t("maxSupplyFormValidationToast"));
      return;
    }

    await governanceActions.submitDirectContractAction({
      action,
      abi: CORE_DIAMOND_ABI,
      functionName: "setMaxTotalSupply",
      args: [currentCap, parsedNewCap],
    });
  };

  const submitSafe = async (safeAddress: Address) => {
    if (currentCap === undefined || parsedNewCap === undefined || validationErrors.length > 0) {
      toast.error(t("maxSupplyFormValidationToast"));
      return;
    }

    await governanceActions.submitSafeContractAction({
      action,
      safeAddress,
      data: encodeFunctionData({
        abi: CORE_DIAMOND_ABI,
        functionName: "setMaxTotalSupply",
        args: [currentCap, parsedNewCap],
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
          {t("maxSupplyFormCurrentTitle")}
        </p>
        {controllerConfig.isLoading ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("maxSupplyFormLoadingCurrent")}</p>
        ) : currentCap !== undefined ? (
          <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
            <p>
              {t("maxSupplyFormCurrentCapLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)]">{currentCapText}</span>
            </p>
            <p>
              {t("maxSupplyFormCurrentSupplyLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)]">
                {currentSupplyText || t("notAvailable")}
              </span>
            </p>
            <p>
              {t("maxSupplyFormRemainingLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)]">{remainingSupply.toString()}</span>
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("maxSupplyFormCurrentUnavailable")}</p>
        )}
      </div>

      <div className="mt-3 rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-3">
        <p className="text-sm font-semibold text-[var(--text-input)]">{t("maxSupplyFormEditTitle")}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{t("maxSupplyFormEditSubtitle")}</p>
        <label className="mt-3 block text-xs text-[var(--text-muted)]">
          <span className="mb-1 block">{t("maxSupplyFormNewCapLabel")}</span>
          <input
            type="text"
            inputMode="numeric"
            value={draftNewCap}
            onChange={(event) => {
              setNewCapInput(event.target.value);
              setIsDirty(true);
            }}
            className="w-full rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-2 font-mono text-[var(--text-input)]"
          />
        </label>
        <div className="mt-3 space-y-1 text-xs">
          {validationErrors.length === 0 ? (
            <p className="text-emerald-700 dark:text-emerald-300">{t("maxSupplyFormValidationOk")}</p>
          ) : (
            <div className="space-y-1 text-rose-700 dark:text-rose-300">
              {validationErrors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          )}
          <p className="text-[11px] text-[var(--text-muted)]">{t("maxSupplyFormExpectedCapHint")}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {eligibility.canDirectCall && (
          <button
            type="button"
            onClick={() => void submitDirect()}
            disabled={directBusy || validationErrors.length > 0}
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
              disabled={safeBusy || validationErrors.length > 0}
              className="rounded-full border border-[var(--swap-container-border)] px-4 py-2 text-xs font-semibold text-[var(--text-input)] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
              title={safe.address}
            >
              {safeBusy
                ? t("diamondSafeActionInProgressButton")
                : `${t("diamondSafeActionButton")} ${safe.address.slice(0, 6)}...${safe.address.slice(-4)}`}
            </button>
          );
        })}
        {!hasSubmitOption && <span className="text-xs text-[var(--text-muted)]">{t("diamondActionNoPermissionHint")}</span>}
      </div>
    </div>
  );
}
