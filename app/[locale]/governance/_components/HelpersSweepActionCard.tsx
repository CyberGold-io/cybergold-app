"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { encodeFunctionData, getAddress, isAddress, zeroAddress, type Address } from "viem";
import { HELPERS_DIAMOND_ABI } from "@/app/contracts/generated/helpersDiamond";
import type { GovernanceActionEligibility } from "@/app/utils/governanceActionEligibility";
import type { GovernanceActionSpec } from "../_lib/governanceSurfaces";
import type { useDiamondGovernanceActions } from "../_hooks/useDiamondGovernanceActions";
import { useHelpersRouterConfig } from "../_hooks/useHelpersRouterConfig";

export function HelpersSweepActionCard({
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
  const helpersConfig = useHelpersRouterConfig();
  const [tokenInput, setTokenInput] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const normalizedToken = useMemo(() => {
    const trimmed = tokenInput.trim();
    return isAddress(trimmed) && trimmed !== zeroAddress ? getAddress(trimmed) : undefined;
  }, [tokenInput]);
  const normalizedRecipient = useMemo(() => {
    const trimmed = recipientInput.trim();
    return isAddress(trimmed) && trimmed !== zeroAddress ? getAddress(trimmed) : undefined;
  }, [recipientInput]);
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!normalizedToken) errors.push(t("helpersSweepFormInvalidTokenError"));
    if (!normalizedRecipient) errors.push(t("helpersSweepFormInvalidRecipientError"));
    return errors;
  }, [normalizedRecipient, normalizedToken, t]);
  const directBusy = governanceActions.busyActionKey === governanceActions.directBusyKey(action.id);
  const hasSubmitOption = eligibility.canDirectCall || eligibility.eligibleSafes.length > 0;

  const submitDirect = async () => {
    if (!normalizedToken || !normalizedRecipient || validationErrors.length > 0) {
      toast.error(t("helpersSweepFormValidationToast"));
      return;
    }

    await governanceActions.submitDirectContractAction({
      action,
      abi: HELPERS_DIAMOND_ABI,
      functionName: "sweep",
      args: [normalizedToken, normalizedRecipient],
    });
  };

  const submitSafe = async (safeAddress: Address) => {
    if (!normalizedToken || !normalizedRecipient || validationErrors.length > 0) {
      toast.error(t("helpersSweepFormValidationToast"));
      return;
    }

    await governanceActions.submitSafeContractAction({
      action,
      safeAddress,
      data: encodeFunctionData({
        abi: HELPERS_DIAMOND_ABI,
        functionName: "sweep",
        args: [normalizedToken, normalizedRecipient],
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

      <div className="mt-3 rounded-md border border-gold-cg/20 bg-gold-cg/5 px-3 py-2 text-xs text-[var(--text-muted)]">
        <p className="font-semibold uppercase tracking-wide">{t("helpersSweepFormCurrentTitle")}</p>
        <p className="mt-2">
          {t("helpersSweepFormPausedLabel")}:{" "}
          <span className="font-semibold text-[var(--text-input)]">
            {helpersConfig.data?.paused === undefined
              ? t("notAvailable")
              : helpersConfig.data.paused
                ? t("helpersSweepFormPausedValue")
                : t("helpersSweepFormUnpausedValue")}
          </span>
        </p>
        <p className="mt-1">{t("helpersSweepFormBehaviorHint")}</p>
      </div>

      <div className="mt-3 rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-3">
        <p className="text-sm font-semibold text-[var(--text-input)]">{t("helpersSweepFormEditTitle")}</p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-xs text-[var(--text-muted)]">
            <span className="mb-1 block">{t("helpersSweepFormTokenLabel")}</span>
            <input data-page-draft-key={`${action.id}:token`}
              type="text"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="0x..."
              className="w-full rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-2 font-mono text-[var(--text-input)]"
            />
          </label>
          <label className="text-xs text-[var(--text-muted)]">
            <span className="mb-1 block">{t("helpersSweepFormRecipientLabel")}</span>
            <input data-page-draft-key={`${action.id}:recipient`}
              type="text"
              value={recipientInput}
              onChange={(event) => setRecipientInput(event.target.value)}
              placeholder="0x..."
              className="w-full rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-2 font-mono text-[var(--text-input)]"
            />
          </label>
        </div>
        <div className="mt-3 space-y-1 text-xs">
          {validationErrors.length === 0 ? (
            <p className="text-emerald-700 dark:text-emerald-300">{t("helpersSweepFormValidationOk")}</p>
          ) : (
            <div className="space-y-1 text-rose-700 dark:text-rose-300">
              {validationErrors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          )}
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
        {!hasSubmitOption && (
          <span className="text-xs text-[var(--text-muted)]">{t("diamondActionNoPermissionHint")}</span>
        )}
      </div>
    </div>
  );
}
