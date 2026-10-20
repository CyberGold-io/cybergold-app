"use client";

import { useGovernanceObservationText } from "../_hooks/useGovernanceObservationText";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { encodeFunctionData, getAddress, isAddress, zeroAddress, type Address } from "viem";
import { HELPERS_DIAMOND_ABI } from "@/app/contracts/generated/helpersDiamond";
import { useIsAdapterApproved } from "@/app/hooks/cybergold-helpers/useIsAdapterApproved";
import type { GovernanceActionEligibility } from "@/app/utils/governanceActionEligibility";
import type { GovernanceActionSpec } from "../_lib/governanceSurfaces";
import type { useDiamondGovernanceActions } from "../_hooks/useDiamondGovernanceActions";
import { useHelpersRouterConfig } from "../_hooks/useHelpersRouterConfig";

export function HelpersAdapterApprovalActionCard({
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
  const [adapterInput, setAdapterInput] = useState("");
  const [approved, setApproved] = useState(true);
  const helpersConfig = useHelpersRouterConfig();
  const normalizedAdapter = useMemo(() => {
    const trimmed = adapterInput.trim();
    return isAddress(trimmed) && trimmed !== zeroAddress ? getAddress(trimmed) : undefined;
  }, [adapterInput]);
  const adapterList = useGovernanceObservationText(action.id, { adapters: helpersConfig.data ? JSON.stringify(helpersConfig.data.approvedAdapters) : undefined });
  const approvedAdapters = useMemo(() => {
    try {
      const parsed = JSON.parse(adapterList.adapters ?? "[]");
      return Array.isArray(parsed) && parsed.every(entry => typeof entry === "string" && isAddress(entry)) ? parsed as Address[] : [];
    } catch { return []; }
  }, [adapterList.adapters]);
  const approvalQuery = useIsAdapterApproved(normalizedAdapter);
  const validationError = normalizedAdapter ? undefined : t("helpersAdapterFormInvalidAddressError");
  const hasCurrentApproval = typeof approvalQuery.data === "boolean";
  const currentApprovalUnavailable =
    !!normalizedAdapter &&
    (approvalQuery.isLoading || approvalQuery.isError || !hasCurrentApproval);
  const display = useGovernanceObservationText(`${action.id}:${normalizedAdapter?.toLowerCase() ?? "none"}`, {
    approval: typeof approvalQuery.data === "boolean" ? approvalQuery.data ? t("helpersAdapterFormApprovedValue") : t("helpersAdapterFormRejectedValue") : undefined,
  });
  const directBusy = governanceActions.busyActionKey === governanceActions.directBusyKey(action.id);
  const hasSubmitOption = eligibility.canDirectCall || eligibility.eligibleSafes.length > 0;

  const submitDirect = async () => {
    if (!normalizedAdapter || typeof approvalQuery.data !== "boolean") {
      toast.error(t("helpersAdapterFormValidationToast"));
      return;
    }

    await governanceActions.submitDirectContractAction({
      action,
      abi: HELPERS_DIAMOND_ABI,
      functionName: "setAdapterApproval",
      args: [normalizedAdapter, approvalQuery.data, approved],
    });
  };

  const submitSafe = async (safeAddress: Address) => {
    if (!normalizedAdapter || typeof approvalQuery.data !== "boolean") {
      toast.error(t("helpersAdapterFormValidationToast"));
      return;
    }

    await governanceActions.submitSafeContractAction({
      action,
      safeAddress,
      data: encodeFunctionData({
        abi: HELPERS_DIAMOND_ABI,
        functionName: "setAdapterApproval",
        args: [normalizedAdapter, approvalQuery.data, approved],
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
          {t("helpersAdapterFormCurrentTitle")}
        </p>
        <div className="mt-2">
          <p className="text-xs text-[var(--text-muted)]">{t("helpersAdapterFormApprovedListLabel")}</p>
          {helpersConfig.isLoading && adapterList.adapters === undefined ? (
            <p data-page-display-pending="true" className="mt-1 text-xs text-[var(--text-muted)]">{t("helpersAdapterFormLoadingApprovedList")}</p>
          ) : approvedAdapters.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {approvedAdapters.map((adapterAddress) => {
                const isSelected = normalizedAdapter?.toLowerCase() === adapterAddress.toLowerCase();
                return (
                  <button
                    key={adapterAddress}
                    type="button"
                    onClick={() => setAdapterInput(adapterAddress)}
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                      isSelected
                        ? "border-gold-cg bg-gold-cg/15 text-gold-cg"
                        : "border-[var(--swap-container-border)] bg-[var(--background-input)] text-[var(--text-input)] hover:bg-black/5"
                    }`}
                    title={adapterAddress}
                  >
                    <span className="break-all">{adapterAddress}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-1 text-xs text-[var(--text-muted)]">{t("helpersAdapterFormNoApprovedAdapters")}</p>
          )}
        </div>
        {!normalizedAdapter ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("helpersAdapterFormLookupHint")}</p>
        ) : approvalQuery.isLoading && display.approval === undefined ? (
          <p data-page-display-pending="true" className="mt-2 text-xs text-[var(--text-muted)]">{t("helpersAdapterFormLoadingCurrent")}</p>
        ) : (approvalQuery.isError || !hasCurrentApproval) && display.approval === undefined ? (
          <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">
            {t("helpersAdapterFormCurrentReadError")}
          </p>
        ) : (
          <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
            <p>
              {t("helpersAdapterFormCurrentAddressLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)] break-all">{normalizedAdapter}</span>
            </p>
            <p>
              {t("helpersAdapterFormCurrentApprovalLabel")}:{" "}
              <span className="font-semibold text-[var(--text-input)]">
                {display.approval}
              </span>
            </p>
          </div>
        )}
        {display.approval !== undefined && approvalQuery.isError && (
          <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{t("helpersAdapterFormCurrentReadError")}</p>
        )}
      </div>

      <div className="mt-3 rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-3">
        <p className="text-sm font-semibold text-[var(--text-input)]">{t("helpersAdapterFormEditTitle")}</p>
        <label className="mt-3 block text-xs text-[var(--text-muted)]">
          <span className="mb-1 block">{t("helpersAdapterFormAddressLabel")}</span>
          <input data-page-draft-key={`${action.id}:adapter`}
            type="text"
            value={adapterInput}
            onChange={(event) => setAdapterInput(event.target.value)}
            placeholder="0x..."
            className="w-full rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-2 font-mono text-[var(--text-input)]"
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-xs text-[var(--text-input)]">
          <input data-page-draft-key={`${action.id}:approved`}
            type="checkbox"
            checked={approved}
            onChange={(event) => setApproved(event.target.checked)}
            className="h-4 w-4 rounded border-[var(--swap-container-border)]"
          />
          <span>{t("helpersAdapterFormApprovedToggle")}</span>
        </label>
        <div className="mt-3 space-y-1 text-xs">
          {validationError ? (
            <p className="text-rose-700 dark:text-rose-300">{validationError}</p>
          ) : (
            <p className={currentApprovalUnavailable
              ? "text-rose-700 dark:text-rose-300"
              : "text-emerald-700 dark:text-emerald-300"}
            >
              {currentApprovalUnavailable
                ? t("helpersAdapterFormCurrentReadError")
                : t("helpersAdapterFormValidationOk")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {eligibility.canDirectCall && (
          <button
            type="button"
            onClick={() => void submitDirect()}
            disabled={directBusy || !!validationError || currentApprovalUnavailable}
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
              disabled={safeBusy || !!validationError || currentApprovalUnavailable}
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
