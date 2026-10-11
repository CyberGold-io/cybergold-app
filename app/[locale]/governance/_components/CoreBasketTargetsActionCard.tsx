"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { useBasketData } from "@/app/hooks/cybergold/useBasketData";
import { CORE_DIAMOND_ABI } from "@/app/contracts/generated/coreDiamond";
import { buildBasketFromProtocolData } from "@/app/utils/buildBasketFromProtocolData";
import type { GovernanceActionEligibility } from "@/app/utils/governanceActionEligibility";
import type { GovernanceActionSpec } from "../_lib/governanceSurfaces";
import type { useDiamondGovernanceActions } from "../_hooks/useDiamondGovernanceActions";
import { useCoreControllerConfig } from "../_hooks/useCoreControllerConfig";

type BasketDraftRow = {
  id: string;
  asset: string;
  targetPpm: string;
  goldRefGrams: string;
  symbol?: string;
  name?: string;
};

function normalizeDecimalInput(value: string) {
  return value.trim().replace(",", ".");
}

function makeDraftRow(overrides: Partial<BasketDraftRow> = {}): BasketDraftRow {
  return {
    id: crypto.randomUUID(),
    asset: "",
    targetPpm: "0",
    goldRefGrams: "0",
    ...overrides,
  };
}

export function CoreBasketTargetsActionCard({
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
  const { basket, cygldRefGrams } = useBasketData();
  const controllerConfig = useCoreControllerConfig();
  const [rows, setRows] = useState<BasketDraftRow[]>([]);
  const [isDirty, setIsDirty] = useState(false);

  const currentProtocolBasket = basket.data;
  const currentBasketHash = controllerConfig.data?.basketConfigHash;
  const currentBasket = useMemo(
    () => (currentProtocolBasket ? buildBasketFromProtocolData(currentProtocolBasket) : null),
    [currentProtocolBasket]
  );
  const currentRows = useMemo<BasketDraftRow[]>(() => {
    if (!currentProtocolBasket || !currentBasket) return [];
    const [assets, targetsPpm, goldRefGramsFp18] = currentProtocolBasket;
    return assets.map((asset, index) =>
      makeDraftRow({
        asset,
        targetPpm: targetsPpm[index]?.toString() ?? "0",
        goldRefGrams: formatUnits(goldRefGramsFp18[index] ?? 0n, 18),
        symbol: currentBasket.components[index]?.token.symbol,
        name: currentBasket.components[index]?.token.name,
      })
    );
  }, [currentBasket, currentProtocolBasket]);

  const currentRowsKey = useMemo(
    () =>
      JSON.stringify(
        currentRows.map((row) => ({
          asset: row.asset.toLowerCase(),
          targetPpm: row.targetPpm,
          goldRefGrams: row.goldRefGrams,
          symbol: row.symbol,
          name: row.name,
        }))
      ),
    [currentRows]
  );

  useEffect(() => {
    if (currentRows.length === 0) return;
    if (!isDirty || rows.length === 0) {
      setRows(currentRows);
      setIsDirty(false);
    }
  }, [currentRows, currentRowsKey, isDirty, rows.length]);

  const totalTargetPpm = useMemo(
    () =>
      rows.reduce((sum, row) => {
        const value = Number.parseInt(row.targetPpm, 10);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0),
    [rows]
  );

  const validation = useMemo(() => {
    const errors: string[] = [];
    const normalizedAssets = new Set<string>();
    const assets: Address[] = [];
    const targetsPpm: bigint[] = [];
    const goldRefsFp18: bigint[] = [];

    if (rows.length === 0) {
      errors.push(t("basketFormEmptyError"));
      return { errors, assets, targetsPpm, goldRefsFp18 };
    }

    rows.forEach((row, index) => {
      const rowIndex = index + 1;
      if (!isAddress(row.asset) || row.asset === zeroAddress) {
        errors.push(t("basketFormInvalidAddressError", { row: rowIndex }));
      } else {
        const normalized = getAddress(row.asset);
        if (normalizedAssets.has(normalized.toLowerCase())) {
          errors.push(t("basketFormDuplicateAddressError", { row: rowIndex }));
        } else {
          normalizedAssets.add(normalized.toLowerCase());
          assets.push(normalized);
        }
      }

      if (!/^\d+$/.test(row.targetPpm.trim())) {
        errors.push(t("basketFormInvalidTargetPpmError", { row: rowIndex }));
      } else {
        targetsPpm.push(BigInt(row.targetPpm.trim()));
      }

      const normalizedDecimal = normalizeDecimalInput(row.goldRefGrams);
      try {
        const parsed = parseUnits(normalizedDecimal, 18);
        if (parsed <= 0n) {
          errors.push(t("basketFormInvalidGoldRefError", { row: rowIndex }));
        } else {
          goldRefsFp18.push(parsed);
        }
      } catch {
        errors.push(t("basketFormInvalidGoldRefError", { row: rowIndex }));
      }
    });

    const total = targetsPpm.reduce((sum, value) => sum + value, 0n);
    if (total !== 1_000_000n) {
      errors.push(t("basketFormTotalTargetError", { total: total.toString() }));
    }

    return { errors, assets, targetsPpm, goldRefsFp18 };
  }, [rows, t]);

  const directBusy = governanceActions.busyActionKey === governanceActions.directBusyKey(action.id);
  const hasSubmitOption = eligibility.canDirectCall || eligibility.eligibleSafes.length > 0;

  const updateRow = (rowId: string, patch: Partial<BasketDraftRow>) => {
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
    setIsDirty(true);
  };

  const addRow = () => {
    setRows((current) => [...current, makeDraftRow()]);
    setIsDirty(true);
  };

  const removeRow = (rowId: string) => {
    setRows((current) => current.filter((row) => row.id !== rowId));
    setIsDirty(true);
  };

  const resetToCurrent = () => {
    setRows(currentRows);
    setIsDirty(false);
  };

  const buildSafeData = () =>
    encodeFunctionData({
      abi: CORE_DIAMOND_ABI,
      functionName: "setBasket",
      args: [currentBasketHash!, validation.assets, validation.targetsPpm, validation.goldRefsFp18],
    });

  const submitDirect = async () => {
    if (validation.errors.length > 0 || !currentBasketHash) {
      toast.error(t("basketFormValidationToast"));
      return;
    }
    await governanceActions.submitDirectContractAction({
      action,
      abi: CORE_DIAMOND_ABI,
      functionName: "setBasket",
      args: [currentBasketHash, validation.assets, validation.targetsPpm, validation.goldRefsFp18],
    });
  };

  const submitSafe = async (safeAddress: Address) => {
    if (validation.errors.length > 0 || !currentBasketHash) {
      toast.error(t("basketFormValidationToast"));
      return;
    }
    await governanceActions.submitSafeContractAction({
      action,
      safeAddress,
      data: buildSafeData() as Hex,
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
          {t("basketFormCurrentTitle")}
        </p>
        {basket.isLoading || cygldRefGrams.isLoading ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("basketFormLoadingCurrent")}</p>
        ) : currentRows.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("basketFormCurrentUnavailable")}</p>
        ) : (
          <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
            <p>
              {t("basketFormCurrentCygldRefLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)]">
                {cygldRefGrams.data ? formatUnits(cygldRefGrams.data, 18) : t("notAvailable")}
              </span>
            </p>
            <p>
              {t("basketFormCurrentAssetCountLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)]">{currentRows.length}</span>
            </p>
            <p>
              {t("basketFormCurrentTotalLabel")}:{" "}
              <span className="font-mono text-[var(--text-input)]">
                {currentRows.reduce((sum, row) => sum + Number.parseInt(row.targetPpm, 10), 0)}
              </span>
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--swap-container-border)] px-3 py-2">
          <div>
            <p className="text-sm font-semibold text-[var(--text-input)]">{t("basketFormEditTitle")}</p>
            <p className="text-xs text-[var(--text-muted)]">{t("basketFormEditSubtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addRow}
              className="rounded-full border border-[var(--swap-container-border)] px-3 py-1 text-xs font-semibold text-[var(--text-input)] hover:bg-black/5"
            >
              {t("basketFormAddRowButton")}
            </button>
            <button
              type="button"
              onClick={resetToCurrent}
              disabled={currentRows.length === 0}
              className="rounded-full border border-[var(--swap-container-border)] px-3 py-1 text-xs font-semibold text-[var(--text-input)] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("basketFormResetButton")}
            </button>
          </div>
        </div>

        <div className="space-y-3 px-3 py-3">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="rounded-md border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] px-3 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-[var(--text-input)]">
                    {row.symbol ?? row.name ?? t("basketFormRowLabel", { row: index + 1 })}
                  </p>
                  {(row.name || row.symbol) && (
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {row.name ?? row.symbol}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={rows.length === 1}
                  className="rounded-full border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-900 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("basketFormRemoveRowButton")}
                </button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="text-xs text-[var(--text-muted)]">
                  <span className="mb-1 block">{t("basketFormAssetLabel")}</span>
                  <input
                    type="text"
                    value={row.asset}
                    onChange={(event) => updateRow(row.id, { asset: event.target.value })}
                    placeholder="0x..."
                    className="w-full rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-2 font-mono text-[var(--text-input)]"
                  />
                </label>

                <label className="text-xs text-[var(--text-muted)]">
                  <span className="mb-1 block">{t("basketFormTargetPpmLabel")}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={row.targetPpm}
                    onChange={(event) => updateRow(row.id, { targetPpm: event.target.value })}
                    className="w-full rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-2 font-mono text-[var(--text-input)]"
                  />
                </label>

                <label className="text-xs text-[var(--text-muted)]">
                  <span className="mb-1 block">{t("basketFormGoldRefLabel")}</span>
                  <input
                    type="text"
                    value={row.goldRefGrams}
                    onChange={(event) => updateRow(row.id, { goldRefGrams: event.target.value })}
                    className="w-full rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-2 font-mono text-[var(--text-input)]"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {t("basketFormValidationTitle")}
        </p>
        <div className="mt-2 space-y-1 text-xs">
          <p className="text-[var(--text-muted)]">
            {t("basketFormTargetTotalLabel")}:{" "}
            <span className="font-mono text-[var(--text-input)]">{totalTargetPpm}</span>
          </p>
          {validation.errors.length === 0 ? (
            <p className="text-emerald-700 dark:text-emerald-300">{t("basketFormValidationOk")}</p>
          ) : (
            <div className="space-y-1 text-rose-700 dark:text-rose-300">
              {validation.errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          )}
          <p className="pt-1 text-[11px] text-[var(--text-muted)]">{t("basketFormOnchainWarning")}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {eligibility.canDirectCall && (
          <button
            type="button"
            onClick={() => void submitDirect()}
            disabled={directBusy || validation.errors.length > 0}
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
              disabled={safeBusy || validation.errors.length > 0}
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
