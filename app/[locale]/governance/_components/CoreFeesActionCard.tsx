"use client";

import { useGovernanceObservationText } from "../_hooks/useGovernanceObservationText";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { encodeFunctionData, type Address } from "viem";
import { CORE_DIAMOND_ABI } from "@/app/contracts/generated/coreDiamond";
import type { GovernanceActionEligibility } from "@/app/utils/governanceActionEligibility";
import type { GovernanceActionSpec } from "../_lib/governanceSurfaces";
import type { useDiamondGovernanceActions } from "../_hooks/useDiamondGovernanceActions";
import { useCoreControllerConfig } from "../_hooks/useCoreControllerConfig";

const DEFAULT_MAX_FEE_PPM = 10_000n;

const ACTION_CONFIG = {
  "set-issuance-fee": {
    currentField: "issuanceFeePpm",
    functionName: "setIssuanceFeePpm",
    inputLabel: "feesFormIssuanceLabel",
    invalidError: "feesFormInvalidIssuanceError",
    capError: "feesFormIssuanceCapError",
  },
  "set-redemption-fee": {
    currentField: "redemptionFeePpm",
    functionName: "setRedemptionFeePpm",
    inputLabel: "feesFormRedemptionLabel",
    invalidError: "feesFormInvalidRedemptionError",
    capError: "feesFormRedemptionCapError",
  },
} as const;

type FeeActionId = keyof typeof ACTION_CONFIG;

function isFeeActionId(actionId: string): actionId is FeeActionId {
  return actionId in ACTION_CONFIG;
}

function parsePpmInput(value: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  return BigInt(trimmed);
}

export function CoreFeesActionCard({
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
  const [feeInput, setFeeInput] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const config = isFeeActionId(action.id) ? ACTION_CONFIG[action.id] : undefined;
  const currentFee = config ? controllerConfig.data?.[config.currentField] : undefined;
  const draftFee = isDirty ? feeInput : currentFee?.toString() ?? feeInput;
  const maxFeePpm = controllerConfig.data?.maxFeePpm ?? DEFAULT_MAX_FEE_PPM;
  const parsedFee = parsePpmInput(draftFee);
  const display = useGovernanceObservationText(action.id, { issuance: controllerConfig.data?.issuanceFeePpm?.toString(),
    redemption: controllerConfig.data?.redemptionFeePpm?.toString(), maximum: controllerConfig.data?.maxFeePpm?.toString() });

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!config || currentFee === undefined || parsedFee === undefined) {
      errors.push(t(config?.invalidError ?? "feesFormInvalidIssuanceError"));
    } else if (parsedFee > maxFeePpm) {
      errors.push(t(config.capError, { max: maxFeePpm.toString() }));
    }

    return errors;
  }, [config, currentFee, maxFeePpm, parsedFee, t]);

  const directBusy = governanceActions.busyActionKey === governanceActions.directBusyKey(action.id);
  const hasSubmitOption = eligibility.canDirectCall || eligibility.eligibleSafes.length > 0;

  if (!config) {
    return null;
  }

  const submitDirect = async () => {
    if (currentFee === undefined || parsedFee === undefined || validationErrors.length > 0) {
      toast.error(t("feesFormValidationToast"));
      return;
    }

    await governanceActions.submitDirectContractAction({
      action,
      abi: CORE_DIAMOND_ABI,
      functionName: config.functionName,
      args: [currentFee, parsedFee],
    });
  };

  const submitSafe = async (safeAddress: Address) => {
    if (currentFee === undefined || parsedFee === undefined || validationErrors.length > 0) {
      toast.error(t("feesFormValidationToast"));
      return;
    }

    await governanceActions.submitSafeContractAction({
      action,
      safeAddress,
      data: encodeFunctionData({
        abi: CORE_DIAMOND_ABI,
        functionName: config.functionName,
        args: [currentFee, parsedFee],
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
          {t("feesFormCurrentTitle")}
        </p>
        {controllerConfig.isLoading && display.issuance === undefined ? (
          <p data-page-display-pending="true" className="mt-2 text-xs text-[var(--text-muted)]">{t("feesFormLoadingCurrent")}</p>
        ) : display.issuance !== undefined || display.redemption !== undefined ? (
          <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
            <p>
              {t("feesFormCurrentIssuanceLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)]">{display.issuance ?? t("notAvailable")}</span>
            </p>
            <p>
              {t("feesFormCurrentRedemptionLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)]">{display.redemption ?? t("notAvailable")}</span>
            </p>
            <p>
              {t("feesFormMaxLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)]">{display.maximum ?? t("notAvailable")}</span>
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("feesFormCurrentUnavailable")}</p>
        )}
      </div>

      <div className="mt-3 rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-3">
        <p className="text-sm font-semibold text-[var(--text-input)]">{t("feesFormEditTitle")}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{t("feesFormEditSubtitle")}</p>
        <div className="mt-3">
          <label className="text-xs text-[var(--text-muted)]">
            <span className="mb-1 block">{t(config.inputLabel)}</span>
            <input data-page-draft-key={`${action.id}:fee`}
              type="text"
              inputMode="numeric"
              value={draftFee}
              onChange={(event) => {
                setFeeInput(event.target.value);
                setIsDirty(true);
              }}
              className="w-full rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-2 font-mono text-[var(--text-input)]"
            />
          </label>
        </div>
        <div className="mt-3 space-y-1 text-xs">
          {validationErrors.length === 0 ? (
            <p className="text-emerald-700 dark:text-emerald-300">{t("feesFormValidationOk")}</p>
          ) : (
            <div className="space-y-1 text-rose-700 dark:text-rose-300">
              {validationErrors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          )}
          <p className="text-[11px] text-[var(--text-muted)]">{t("feesFormCapHint")}</p>
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
