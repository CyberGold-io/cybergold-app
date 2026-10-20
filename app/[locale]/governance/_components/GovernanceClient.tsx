"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { waitForAppTransactionReceipt } from "@/app/utils/receiptWait";
import { fetchGovernanceTargetCodes } from "@/app/utils/governanceTargetCode";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { IoCheckmark, IoCopyOutline } from "react-icons/io5";
import {
  useChainId,
  usePublicClient,
  useSignMessage,
  useSignTypedData,
  useWalletClient,
  useWriteContract,
} from "wagmi";
import { useObservedWalletAccount } from "@/app/hooks/useObservedWalletAccount";
import { useGovernanceSafe } from "@/app/hooks/useGovernanceSafe";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import {
  deleteGovernanceOwnerAlias,
  upsertGovernanceOwnerAlias,
  useGovernanceOwnerAliases,
} from "@/app/hooks/useGovernanceOwnerAliases";
import { buildGovernanceOwnerAliasAuthMessage } from "@/app/utils/governanceOwnerAliasesAuth";
import {
  callSafeApi,
  fetchSafePendingTransactions,
  type SafeServicePendingTx,
  useSafeExecutionStatuses,
  useSafeExecutedTransactions,
  useSafePendingTransactions,
  useSafeServiceInfo,
} from "@/app/hooks/useSafeTransactionService";
import {
  buildExecutedSafeTxHashSet,
  filterPendingSafeTransactions,
  localSafeExecutionStorageKey,
  localSafeNonceStorageKey,
  parseStoredSafeNonce,
  shouldResetLocalExecutionCache,
} from "@/app/utils/governanceSafeTx";
import {
  buildGovernanceDeploymentAddressBook,
  extendGovernanceAddressBook,
  getGovernanceAddressLabel,
} from "@/app/utils/governanceAddressBook";
import {
  finalHistoryStatusFromLocalState,
  isLocalSafeExecutionState,
  type LocalSafeExecutionState,
  resolveLocalSafeExecutionState,
  type SafeReplacementReason,
} from "@/app/utils/governanceSafeExecutionState";
import {
  buildSafeRejectionPayload,
  formatTimestamp,
  type HistoryStatus,
  isSafeRejectionTransaction,
  pauseControlAction,
  SAFE_ABI,
  type SafeTxPayload,
  SAFE_TX_TYPES,
  statusFromSafeExecutionLogs,
  toSafeTxPayload,
} from "@/app/utils/governanceSafeContracts";
import {
  buildPendingSafeTxRows,
  countExecutableSignatures,
  type PendingSafeTxRow,
  sortAndConcatSignatures,
  uniqueConfirmedOwners,
} from "@/app/utils/governanceSafeTxViewModel";
import { decodeGovernanceCallData } from "@/app/utils/governanceCallData";
import { fetchPendingTransactionNonce } from "@/app/utils/transactionNonce";
import { fetchSafeNonce, fetchSafeTransactionHash } from "@/app/utils/safeTransactionFacts";
import { simulateSafeExecution } from "@/app/utils/safeExecutionSimulation";
import { useSafeNonce } from "@/app/hooks/useSafeNonce";
import { fetchTransactionReceipt } from "@/app/utils/transactionReceipt";
import { isGovernanceTargetMissingCode } from "@/app/utils/governanceTargetCode";
import {
  EXPECTED_CHAIN_ID,
  assertWalletOnExpectedChain,
} from "@/app/utils/expectedChain";
import { useCoreControllerConfig } from "../_hooks/useCoreControllerConfig";
import { GovernanceAccessGate } from "./GovernanceAccessGate";
import { RetainedPageDisplay } from "@/app/components/retainedPageDisplay";
import { useSessionPagePreference } from "@/app/hooks/useSessionPagePreference";
import { GovernanceSurfaceNav } from "./GovernanceSurfaceNav";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { canPersistForkExecution } from "@/app/utils/sandboxForkState";

type GovernanceTabId = "pending-confirm" | "pending-execute" | "history";
type PendingGovernanceCard = {
  primaryRow: PendingSafeTxRow;
  rejectionRow?: PendingSafeTxRow;
  queueKind: "confirm" | "execute";
};
type ConnectedDecision = "confirmed" | "rejected" | "pending" | "none";
type LocalSafeExecution = SafeServicePendingTx & {
  localExecutionHash: Hex;
  localExecutionState: LocalSafeExecutionState;
  localExecutionUpdatedAt: string;
  localReplacementReason?: SafeReplacementReason;
  transactionHash?: Hex;
};

const MAX_OWNER_ALIAS_LENGTH = 64;

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function CopyButton({
  isCopied,
  onClick,
  ariaLabel,
}: {
  isCopied: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-colors ${
        isCopied
          ? "border-emerald-300 bg-emerald-100 text-emerald-700"
          : "border-[var(--swap-container-border)] text-[var(--text-input)] hover:bg-black/5"
      }`}
    >
      {isCopied ? <IoCheckmark className="text-sm" /> : <IoCopyOutline className="text-sm" />}
    </button>
  );
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
    if (ok) {
      return;
    }
  }

  throw new Error("Clipboard unavailable.");
}

function normalizeLocalSafeExecution(value: unknown): LocalSafeExecution | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<LocalSafeExecution> & { localExecutionStatus?: HistoryStatus };
  const localExecutionState = isLocalSafeExecutionState(row.localExecutionState)
    ? row.localExecutionState
    : row.localExecutionStatus === "executed" || row.localExecutionStatus === "failed"
      ? row.localExecutionStatus
      : undefined;
  if (
    typeof row.safeTxHash !== "string" ||
    typeof row.localExecutionHash !== "string" ||
    !row.safeTxHash.startsWith("0x") ||
    !row.localExecutionHash.startsWith("0x") ||
    !localExecutionState
  ) {
    return undefined;
  }
  return {
    ...(row as LocalSafeExecution),
    localExecutionState,
  };
}

function readLocalSafeExecutions(storageKey?: string) {
  if (!storageKey || typeof window === "undefined") return [] as LocalSafeExecution[];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.map(normalizeLocalSafeExecution).filter((entry): entry is LocalSafeExecution => !!entry)
      : [];
  } catch {
    return [];
  }
}

export function GovernanceClient() {
  const forkGeneration = useSandboxForkGeneration();
  const t = useTranslations("Governance");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const connectedChainId = useChainId();
  const publicClient = usePublicClient({ chainId: EXPECTED_CHAIN_ID });
  const { data: walletClient } = useWalletClient();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const { address, isConnected, hasObservedProviderAccounts, status: walletStatus } = useObservedWalletAccount();
  const { addresses, configuration, error: configurationError } = useProtocolConfiguration();
  const [activeTab, setActiveTab] = useSessionPagePreference<GovernanceTabId>(`cg:governance-tab:v1:${EXPECTED_CHAIN_ID}:${address?.toLowerCase() ?? "disconnected"}`, "pending-confirm", ["pending-confirm", "pending-execute", "history"]);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);
  const [localSafeExecutions, setLocalSafeExecutions] = useState<LocalSafeExecution[]>([]);
  const [savedAliasEditor, saveAliasEditor] = useSessionPagePreference<string>(`cg:governance-alias-owner:v1:${EXPECTED_CHAIN_ID}:${address?.toLowerCase() ?? "disconnected"}`, "");
  const aliasEditorOwner = isAddress(savedAliasEditor) ? savedAliasEditor as Address : null;
  const setAliasEditorOwner = (owner: Address | null) => saveAliasEditor(owner ?? "");
  const [aliasDraft, setAliasDraft] = useSessionPagePreference<string>(`cg:governance-alias-draft:v1:${EXPECTED_CHAIN_ID}:${address?.toLowerCase() ?? "disconnected"}`, "");
  const [aliasActionOwner, setAliasActionOwner] = useState<Address | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [lastSeenSafeNonce, setLastSeenSafeNonce] = useState<number | undefined>(undefined);

  const {
    safeAddress,
    source,
    owners,
    threshold,
    isLoading: safeLoading,
    error: safeError,
    isSafeOwner,
  } = useGovernanceSafe();
  const coreControllerConfig = useCoreControllerConfig();
  const hasAccess =
    isConnected &&
    connectedChainId === EXPECTED_CHAIN_ID &&
    isSafeOwner(address);
  const connectedIsSafeOwner = isSafeOwner(address);
  const activeChainId = EXPECTED_CHAIN_ID;
  const localExecutionStorageKey = useMemo(
    () => (safeAddress ? localSafeExecutionStorageKey(activeChainId, safeAddress) : undefined),
    [activeChainId, safeAddress]
  );
  const safeNonceStorageKey = useMemo(
    () => (safeAddress ? localSafeNonceStorageKey(activeChainId, safeAddress) : undefined),
    [activeChainId, safeAddress]
  );

  useEffect(() => {
    setLocalSafeExecutions(readLocalSafeExecutions(localExecutionStorageKey));
  }, [localExecutionStorageKey]);

  useEffect(() => {
    if (!safeNonceStorageKey || typeof window === "undefined") {
      setLastSeenSafeNonce(undefined);
      return;
    }
    setLastSeenSafeNonce(parseStoredSafeNonce(window.localStorage.getItem(safeNonceStorageKey)));
  }, [safeNonceStorageKey]);

  useEffect(() => {
    if (!copiedAddress) return;
    const timeout = window.setTimeout(() => setCopiedAddress(null), 1400);
    return () => window.clearTimeout(timeout);
  }, [copiedAddress]);

  const safeServiceInfoQuery = useSafeServiceInfo(safeAddress, hasAccess);
  const safePendingQuery = useSafePendingTransactions(safeAddress, hasAccess);
  const safeExecutedQuery = useSafeExecutedTransactions(safeAddress, hasAccess);
  const safeNonceQuery = useSafeNonce(safeAddress, hasAccess);
  const liveSafeThreshold = safeServiceInfoQuery.data?.threshold ?? threshold;
  const liveSafeNonce =
    typeof safeNonceQuery.data === "bigint" ? Number(safeNonceQuery.data) : safeServiceInfoQuery.data?.nonce;

  const isLoading = safeLoading;
  const error = safeError;
  const safeServiceBaseError = safeServiceInfoQuery.error ?? safePendingQuery.error ?? safeExecutedQuery.error;
  const ownerAliasesQuery = useGovernanceOwnerAliases(address, owners, hasAccess && !!address);
  const treasuryAddress = coreControllerConfig.data?.treasury;

  useEffect(() => {
    if (!safeNonceStorageKey || typeof window === "undefined" || liveSafeNonce === undefined) return;

    if (shouldResetLocalExecutionCache(lastSeenSafeNonce, liveSafeNonce)) {
      if (localExecutionStorageKey) {
        window.localStorage.removeItem(localExecutionStorageKey);
      }
      setLocalSafeExecutions([]);
      void queryClient.invalidateQueries({ queryKey: ["safe-pending-transactions", safeAddress] });
      void queryClient.invalidateQueries({ queryKey: ["safe-executed-transactions", safeAddress] });
      void queryClient.invalidateQueries({ queryKey: ["safe-execution-statuses", safeAddress] });
      void queryClient.invalidateQueries({ queryKey: ["safe-local-execution-receipts", safeAddress] });
      void queryClient.invalidateQueries({ queryKey: ["safe-execution-receipts", safeAddress] });
    }

    if (lastSeenSafeNonce !== liveSafeNonce) {
      window.localStorage.setItem(safeNonceStorageKey, String(liveSafeNonce));
      setLastSeenSafeNonce(liveSafeNonce);
    }
  }, [
    safeNonceStorageKey,
    localExecutionStorageKey,
    liveSafeNonce,
    lastSeenSafeNonce,
    queryClient,
    safeAddress,
  ]);

  const sourceLabel =
    source === "emergency-authority"
      ? t("sourceEmergencyAuthority")
      : t("sourceUnknown");
  const ownerAliasesByOwner = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of ownerAliasesQuery.data ?? []) {
      map.set(row.ownerAddress.toLowerCase(), row.alias);
    }
    return map;
  }, [ownerAliasesQuery.data]);

  const addressBook = useMemo(
    () =>
      extendGovernanceAddressBook(buildGovernanceDeploymentAddressBook(addresses), [
        safeAddress ? { address: safeAddress, label: "Governance Safe" } : undefined,
        treasuryAddress ? { address: treasuryAddress, label: t("pauserSectionTreasury") } : undefined,
      ]),
    [addresses, safeAddress, t, treasuryAddress]
  );

  const addressAlias = (addressValue?: Address) => getGovernanceAddressLabel(addressBook, addressValue);
  const transactionLabel = (tx: SafeServicePendingTx) => {
    if (safeAddress && isSafeRejectionTransaction(tx, safeAddress)) {
      return t("pendingActionReject", { nonce: tx.nonce });
    }
    const action = pauseControlAction(tx);
    const txLabel = addressAlias(tx.to) ?? shortenAddress(tx.to);
    return action === "pause"
      ? t("pendingActionPause", { contract: txLabel })
      : action === "unpause"
        ? t("pendingActionUnpause", { contract: txLabel })
        : t("pendingActionGeneric", { contract: txLabel });
  };
  const localExecutionStateHint = (tx: SafeServicePendingTx) => {
    const state = localExecutionBySafeTxHash.get(tx.safeTxHash.toLowerCase())?.localExecutionState;
    if (state === "submitted") return t("localExecutionSubmittedHint");
    if (state === "repriced") return t("localExecutionRepricedHint");
    if (state === "replaced") return t("localExecutionReplacedHint");
    if (state === "cancelled") return t("localExecutionCancelledHint");
    if (state === "unknown") return t("localExecutionUnknownHint");
    return undefined;
  };
  const ownerPositionLists = (card: PendingGovernanceCard) => {
    const primaryIsRejection = !!safeAddress && isSafeRejectionTransaction(card.primaryRow.tx, safeAddress);
    const signedByOwners = primaryIsRejection ? [] : card.primaryRow.signedByOwners;
    const rejectedByOwners = primaryIsRejection ? card.primaryRow.signedByOwners : card.rejectionRow?.signedByOwners ?? [];
    const signedSet = new Set(signedByOwners.map((owner) => owner.toLowerCase()));
    const rejectedSet = new Set(rejectedByOwners.map((owner) => owner.toLowerCase()));
    const unpositionedOwners = owners.filter((owner) => {
      const ownerKey = owner.toLowerCase();
      return !signedSet.has(ownerKey) && !rejectedSet.has(ownerKey);
    });
    return { signedByOwners, rejectedByOwners, unpositionedOwners };
  };
  const renderOwnerBadge = (safeTxHash: Hex, owner: Address, tone?: "amber" | "emerald") => {
    const ownerAlias = ownerAliasesByOwner.get(owner.toLowerCase());
    const isConnectedOwner = !!address && owner.toLowerCase() === address.toLowerCase();
    return (
      <span
        key={`${safeTxHash}:${owner}:${tone ?? "default"}`}
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${
          tone === "amber"
            ? "border-amber-300 bg-amber-50 text-amber-900"
            : tone === "emerald"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : isConnectedOwner
                ? "border-gold-cg/60 bg-gold-cg/10 text-[var(--text-input)]"
                : "border-[var(--swap-container-border)] text-[var(--text-input)]"
        }`}
      >
        {ownerAlias ? `${ownerAlias} (${shortenAddress(owner)})` : shortenAddress(owner)}
        {isConnectedOwner ? <span className="ml-1 text-[9px] font-semibold uppercase tracking-wide">{t("youBadge")}</span> : null}
      </span>
    );
  };

  const connectedDecisionForCard = (card: PendingGovernanceCard): ConnectedDecision => {
    if (!address || !connectedIsSafeOwner) return "none";
    const primaryIsRejection = !!safeAddress && isSafeRejectionTransaction(card.primaryRow.tx, safeAddress);
    if (primaryIsRejection && card.primaryRow.signerConfirmed) return "rejected";
    if (card.primaryRow.signerConfirmed) return "confirmed";
    if (card.rejectionRow?.signerConfirmed) return "rejected";
    return "pending";
  };

  const transactionDetailsByHash = useMemo(() => {
    const map = new Map<string, ReturnType<typeof decodeGovernanceCallData>>();
    const allTransactions = [
      ...localSafeExecutions,
      ...(safePendingQuery.data ?? []),
      ...(safeExecutedQuery.data ?? []),
    ];
    for (const tx of allTransactions) {
      map.set(tx.safeTxHash.toLowerCase(), decodeGovernanceCallData(tx.data));
    }
    return map;
  }, [localSafeExecutions, safeExecutedQuery.data, safePendingQuery.data]);

  const renderCallArgumentValue = (value: unknown, depth = 0): ReactNode => {
    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-[var(--text-muted)]">[]</span>;
      return (
        <div className={`space-y-1 ${depth > 0 ? "pl-3" : ""}`}>
          {value.map((item, index) => (
            <div key={`${depth}:${index}`}>{renderCallArgumentValue(item, depth + 1)}</div>
          ))}
        </div>
      );
    }

    if (typeof value === "bigint") {
      return <span className="font-mono break-all text-[var(--text-input)]">{value.toString()}</span>;
    }

    if (typeof value === "boolean") {
      return <span className="font-mono text-[var(--text-input)]">{value ? "true" : "false"}</span>;
    }

    if (typeof value === "string") {
      if (isAddress(value)) {
        const normalizedAddress = getAddress(value);
        const alias = addressAlias(normalizedAddress);
        return (
          <span className="break-all text-[var(--text-input)]">
            {alias ? `${alias} (${normalizedAddress})` : normalizedAddress}
          </span>
        );
      }
      return <span className="font-mono break-all text-[var(--text-input)]">{value}</span>;
    }

    if (typeof value === "number") {
      return <span className="font-mono break-all text-[var(--text-input)]">{String(value)}</span>;
    }

    if (value && typeof value === "object") {
      return <span className="font-mono break-all text-[var(--text-input)]">{JSON.stringify(value)}</span>;
    }

    return <span className="text-[var(--text-input)]">{String(value)}</span>;
  };

  const renderDecodedCallDetails = (tx: SafeServicePendingTx, mode: "proposal" | "rejection" | "history") => {
    if (mode === "rejection") {
      return (
        <div className="space-y-2">
          <div>
            <p className="text-[11px] text-[var(--text-muted)]">{t("pendingFunctionLabel")}</p>
            <p className="mt-1 font-mono text-[var(--text-input)]">{t("rejectButton")}</p>
          </div>
          <div>
            <p className="text-[11px] text-[var(--text-muted)]">{t("pendingArgumentsLabel")}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{t("rejectionCallArguments", { nonce: tx.nonce })}</p>
          </div>
        </div>
      );
    }

    const decoded = transactionDetailsByHash.get(tx.safeTxHash.toLowerCase()) ?? decodeGovernanceCallData(tx.data);
    if (decoded.kind === "decoded") {
      return (
        <div className="space-y-2">
          <div>
            <p className="text-[11px] text-[var(--text-muted)]">{t("pendingFunctionLabel")}</p>
            <p className="mt-1 font-mono break-all text-[var(--text-input)]">{decoded.functionSignature}</p>
          </div>
          <div>
            <p className="text-[11px] text-[var(--text-muted)]">{t("pendingArgumentsLabel")}</p>
            {decoded.args.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t("pendingArgumentsNone")}</p>
            ) : (
              <div className="mt-1 space-y-2">
                {decoded.args.map((arg) => (
                  <div key={`${tx.safeTxHash}:${arg.name}`} className="rounded-md border border-[var(--swap-container-border)] bg-black/5 px-3 py-2 dark:bg-white/5">
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {arg.name} <span className="font-mono">({arg.type})</span>
                    </p>
                    <div className="mt-1 text-xs">{renderCallArgumentValue(arg.value)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (decoded.kind === "empty") {
      return (
        <div className="space-y-2">
          <div>
            <p className="text-[11px] text-[var(--text-muted)]">{t("pendingFunctionLabel")}</p>
            <p className="mt-1 font-mono break-all text-[var(--text-input)]">{t("emptyCalldataLabel")}</p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <div>
          <p className="text-[11px] text-[var(--text-muted)]">{t("pendingFunctionLabel")}</p>
          <p className="mt-1 font-mono break-all text-[var(--text-input)]">
            {t("unknownFunctionLabel", { selector: decoded.selector ?? "0x" })}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--text-muted)]">{t("rawCalldataLabel")}</p>
          <p className="mt-1 font-mono break-all text-[var(--text-input)]">{decoded.rawData}</p>
        </div>
      </div>
    );
  };

  const pendingCandidateTransactions = useMemo(
    () =>
      filterPendingSafeTransactions(safePendingQuery.data ?? [], {
        liveSafeNonce,
      }),
    [safePendingQuery.data, liveSafeNonce]
  );

  const rawHistoryTransactions = useMemo(() => {
    const byHash = new Map<string, SafeServicePendingTx & { historyStatus?: HistoryStatus }>();

    for (const tx of localSafeExecutions) {
      const localHistoryStatus = finalHistoryStatusFromLocalState(tx.localExecutionState);
      if (!localHistoryStatus) continue;
      byHash.set(tx.safeTxHash.toLowerCase(), {
        ...tx,
        transactionHash: tx.transactionHash ?? tx.localExecutionHash,
        historyStatus: localHistoryStatus,
      });
    }

    for (const tx of safeExecutedQuery.data ?? []) {
      byHash.set(tx.safeTxHash.toLowerCase(), {
        ...tx,
        historyStatus: tx.isSuccessful === false ? "failed" : "executed",
      });
    }

    for (const tx of safePendingQuery.data ?? []) {
      if (tx.isExecuted) {
        byHash.set(tx.safeTxHash.toLowerCase(), {
          ...tx,
          historyStatus: tx.isSuccessful === false ? "failed" : "executed",
        });
        continue;
      }
      if (liveSafeNonce !== undefined && tx.nonce < liveSafeNonce) {
        const localExecution = byHash.get(tx.safeTxHash.toLowerCase()) as LocalSafeExecution | undefined;
        byHash.set(tx.safeTxHash.toLowerCase(), {
          ...tx,
          transactionHash: tx.transactionHash ?? localExecution?.transactionHash ?? localExecution?.localExecutionHash,
          historyStatus: finalHistoryStatusFromLocalState(localExecution?.localExecutionState) ?? "cancelled",
        });
      }
    }

    return [...byHash.values()]
      .sort((a, b) => {
        const aDate = new Date(a.executionDate ?? a.submissionDate ?? 0).getTime();
        const bDate = new Date(b.executionDate ?? b.submissionDate ?? 0).getTime();
        if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) return bDate - aDate;
        return b.nonce - a.nonce;
      })
      .slice(0, 10);
  }, [localSafeExecutions, safeExecutedQuery.data, safePendingQuery.data, liveSafeNonce]);

  const historyReceiptKeys = useMemo(
    () =>
      rawHistoryTransactions
        .filter((tx) => tx.transactionHash)
        .map((tx) => `${tx.safeTxHash.toLowerCase()}:${tx.transactionHash?.toLowerCase()}`)
        .sort(),
    [rawHistoryTransactions]
  );
  const historyTxHashes = useMemo(
    () => rawHistoryTransactions.map((tx) => tx.safeTxHash.toLowerCase()).sort(),
    [rawHistoryTransactions]
  );
  const pendingTxHashes = useMemo(
    () => pendingCandidateTransactions.map((tx) => tx.safeTxHash.toLowerCase()).sort(),
    [pendingCandidateTransactions]
  );
  const localExecutionBySafeTxHash = useMemo(() => {
    const map = new Map<string, LocalSafeExecution>();
    for (const execution of localSafeExecutions) {
      map.set(execution.safeTxHash.toLowerCase(), execution);
    }
    return map;
  }, [localSafeExecutions]);
  const localExecutionReceiptKeys = useMemo(
    () =>
      localSafeExecutions
        .map((execution) => `${execution.safeTxHash.toLowerCase()}:${execution.localExecutionHash.toLowerCase()}`)
        .sort(),
    [localSafeExecutions]
  );

  const safeExecutionStatusesQuery = useSafeExecutionStatuses(safeAddress, historyTxHashes, hasAccess);
  const pendingExecutionStatusesQuery = useSafeExecutionStatuses(safeAddress, pendingTxHashes, hasAccess);
  const indexedExecutionBySafeTxHash = useMemo(() => {
    const map = new Map<string, { status: HistoryStatus; transactionHash: Hex; executionDate: string }>();
    for (const row of safeExecutionStatusesQuery.data ?? []) {
      map.set(row.safeTxHash.toLowerCase(), {
        status: row.status,
        transactionHash: row.transactionHash,
        executionDate: row.executionDate,
      });
    }
    return map;
  }, [safeExecutionStatusesQuery.data]);

  const localExecutionReceiptsQuery = useQuery({
    queryKey: ["safe-local-execution-receipts", safeAddress, EXPECTED_CHAIN_ID, forkGeneration, localExecutionReceiptKeys],
    enabled: hasAccess && !!safeAddress && localExecutionReceiptKeys.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const statusUpdates: Array<{
        safeTxHash: Hex;
        localExecutionHash: Hex;
        historyStatus: HistoryStatus;
        transactionHash: Hex;
      }> = [];

      await Promise.all(
        localSafeExecutions.map(async (execution) => {
          if (finalHistoryStatusFromLocalState(execution.localExecutionState)) {
            return;
          }
          try {
            const receipt = await fetchTransactionReceipt(execution.localExecutionHash, signal);
            if (!receipt) return;
            const statusFromLogs = statusFromSafeExecutionLogs(
              receipt.logs.map((log) => ({
                address: log.address,
                data: log.data,
                topics: log.topics,
              })),
              safeAddress!,
              execution.safeTxHash
            );
            if (!statusFromLogs) return;
            statusUpdates.push({
              safeTxHash: execution.safeTxHash,
              localExecutionHash: execution.localExecutionHash,
              historyStatus: statusFromLogs,
              transactionHash: receipt.transactionHash,
            });
          } catch {
            // Retain the existing local observation behavior: failed reads
            // cannot turn an unconfirmed execution into a final status.
          }
        })
      );

      return { statusUpdates };
    },
  });

  const safeExecutionReceiptsQuery = useQuery({
    queryKey: ["safe-execution-receipts", safeAddress, EXPECTED_CHAIN_ID, forkGeneration, historyReceiptKeys],
    enabled: hasAccess && !!safeAddress && historyReceiptKeys.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const statuses = new Map<string, HistoryStatus>();

      await Promise.all(
        rawHistoryTransactions.map(async (tx) => {
          if (!tx.transactionHash) return;
          const receipt = await fetchTransactionReceipt(tx.transactionHash, signal);
          if (!receipt) return;
          const status = statusFromSafeExecutionLogs(
            receipt.logs.map((log) => ({
              address: log.address,
              data: log.data,
              topics: log.topics,
            })),
            safeAddress!,
            tx.safeTxHash
          );
          if (status) {
            statuses.set(tx.safeTxHash.toLowerCase(), status);
          }
        })
      );

      return statuses;
    },
  });

  useEffect(() => {
    const statusUpdates = localExecutionReceiptsQuery.data?.statusUpdates;
    if (!statusUpdates || statusUpdates.length === 0) return;

    setLocalSafeExecutions((current) => {
      let changed = false;
      const updatesBySafeTxHash = new Map(
        statusUpdates.map((entry) => [entry.safeTxHash.toLowerCase(), entry] as const)
      );
      const next = current.map((entry) => {
        const update = updatesBySafeTxHash.get(entry.safeTxHash.toLowerCase());
        if (!update) return entry;
        if (
          entry.localExecutionState === update.historyStatus &&
          entry.transactionHash?.toLowerCase() === update.transactionHash.toLowerCase()
        ) {
          return entry;
        }
        changed = true;
        return {
          ...entry,
          localExecutionHash: update.localExecutionHash,
          localExecutionState: update.historyStatus,
          transactionHash: update.transactionHash,
          localExecutionUpdatedAt: new Date().toISOString(),
        };
      });

      if (!changed) return current;
      if (localExecutionStorageKey && typeof window !== "undefined") {
        window.localStorage.setItem(localExecutionStorageKey, JSON.stringify(next));
      }
      return next;
    });
  }, [localExecutionReceiptsQuery.data, localExecutionStorageKey]);

  const executedSafeTxHashes = useMemo(
    () =>
      buildExecutedSafeTxHashSet([
        safeExecutedQuery.data?.map((tx) => tx.safeTxHash),
        safeExecutionStatusesQuery.data?.map((row) => row.safeTxHash),
        pendingExecutionStatusesQuery.data?.map((row) => row.safeTxHash),
        localSafeExecutions
          .filter((execution) => !!finalHistoryStatusFromLocalState(execution.localExecutionState))
          .map((execution) => execution.safeTxHash),
        localExecutionReceiptsQuery.data?.statusUpdates.map((update) => update.safeTxHash),
      ]),
    [
      safeExecutedQuery.data,
      safeExecutionStatusesQuery.data,
      pendingExecutionStatusesQuery.data,
      localSafeExecutions,
      localExecutionReceiptsQuery.data,
    ]
  );

  const pendingTransactions = useMemo(
    () =>
      filterPendingSafeTransactions(pendingCandidateTransactions, {
        liveSafeNonce,
        executedSafeTxHashes,
      }),
    [pendingCandidateTransactions, liveSafeNonce, executedSafeTxHashes]
  );
  const pendingRows = useMemo(() => {
    return buildPendingSafeTxRows({
      transactions: pendingTransactions,
      liveSafeThreshold,
      connectedAddress: address,
      liveSafeNonce,
    });
  }, [pendingTransactions, liveSafeThreshold, address, liveSafeNonce]);
  const pendingGovernanceCards = useMemo<PendingGovernanceCard[]>(() => {
    if (!safeAddress) {
      return pendingRows.map((row) => ({ primaryRow: row, queueKind: row.queueKind }));
    }

    const rejectionRowsByNonce = new Map<number, PendingSafeTxRow>();
    const standardRows: PendingSafeTxRow[] = [];

    for (const row of pendingRows) {
      if (isSafeRejectionTransaction(row.tx, safeAddress)) {
        rejectionRowsByNonce.set(row.tx.nonce, row);
      } else {
        standardRows.push(row);
      }
    }

    const cards: PendingGovernanceCard[] = [];
    const attachedRejectionNonces = new Set<number>();

    for (const row of standardRows) {
      const rejectionRow = rejectionRowsByNonce.get(row.tx.nonce);
      if (rejectionRow) attachedRejectionNonces.add(row.tx.nonce);
      cards.push({
        primaryRow: row,
        rejectionRow,
        queueKind:
          row.queueKind === "execute" || rejectionRow?.queueKind === "execute" ? "execute" : "confirm",
      });
    }

    for (const [nonce, rejectionRow] of rejectionRowsByNonce.entries()) {
      if (attachedRejectionNonces.has(nonce)) continue;
      cards.push({
        primaryRow: rejectionRow,
        queueKind: rejectionRow.queueKind,
      });
    }

    return cards;
  }, [pendingRows, safeAddress]);
  const pendingConfirmCards = useMemo(
    () => pendingGovernanceCards.filter((card) => card.queueKind === "confirm"),
    [pendingGovernanceCards]
  );
  const pendingExecuteCards = useMemo(
    () => pendingGovernanceCards.filter((card) => card.queueKind === "execute"),
    [pendingGovernanceCards]
  );
  const pendingConfirmNeedsDecisionCards = useMemo(
    () =>
      pendingConfirmCards.filter((card) => {
        if (!address || !connectedIsSafeOwner) return false;
        const primaryIsRejection = !!safeAddress && isSafeRejectionTransaction(card.primaryRow.tx, safeAddress);
        if (primaryIsRejection) {
          return !card.primaryRow.signerConfirmed;
        }
        return !card.primaryRow.signerConfirmed && !card.rejectionRow?.signerConfirmed;
      }),
    [pendingConfirmCards, address, connectedIsSafeOwner, safeAddress]
  );
  const pendingConfirmWaitingCards = useMemo(
    () =>
      pendingConfirmCards.filter((card) => {
        if (!address || !connectedIsSafeOwner) return true;
        const primaryIsRejection = !!safeAddress && isSafeRejectionTransaction(card.primaryRow.tx, safeAddress);
        if (primaryIsRejection) {
          return card.primaryRow.signerConfirmed;
        }
        return card.primaryRow.signerConfirmed || !!card.rejectionRow?.signerConfirmed;
      }),
    [pendingConfirmCards, address, connectedIsSafeOwner, safeAddress]
  );
  const safeServiceError =
    safeServiceBaseError ??
    pendingExecutionStatusesQuery.error ??
    safeExecutionStatusesQuery.error ??
    safeExecutionReceiptsQuery.error ??
    localExecutionReceiptsQuery.error;
  const governanceTargetAddresses = useMemo(
    () =>
      [...new Set([...pendingTransactions, ...rawHistoryTransactions].map((tx) => tx.to.toLowerCase()))].sort(),
    [pendingTransactions, rawHistoryTransactions]
  );
  const governanceTargetCodeQuery = useQuery({
    queryKey: ["governance-target-code", activeChainId, governanceTargetAddresses],
    enabled: !!publicClient && governanceTargetAddresses.length > 0,
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) => fetchGovernanceTargetCodes(governanceTargetAddresses, signal),
  });
  const governanceTargetHasCode = governanceTargetCodeQuery.data ?? new Map<string, boolean>();

  const historyTransactions = useMemo(
    () =>
      rawHistoryTransactions.map((tx) => ({
        ...tx,
        historyStatus:
          localExecutionReceiptsQuery.data?.statusUpdates.find(
            (update) => update.safeTxHash.toLowerCase() === tx.safeTxHash.toLowerCase()
          )?.historyStatus ??
          indexedExecutionBySafeTxHash.get(tx.safeTxHash.toLowerCase())?.status ??
          finalHistoryStatusFromLocalState(localExecutionBySafeTxHash.get(tx.safeTxHash.toLowerCase())?.localExecutionState) ??
          safeExecutionReceiptsQuery.data?.get(tx.safeTxHash.toLowerCase()) ??
          tx.historyStatus ??
          "cancelled",
      })),
    [
      rawHistoryTransactions,
      localExecutionReceiptsQuery.data,
      indexedExecutionBySafeTxHash,
      localExecutionBySafeTxHash,
      safeExecutionReceiptsQuery.data,
    ]
  );

  const safeServiceReady = !!safeAddress && safeServiceInfoQuery.isSuccess;
  const getConfirmationsRequired = (tx: SafeServicePendingTx) =>
    Math.max(liveSafeThreshold ?? 0, tx.confirmationsRequired ?? 0);

  const runBusyAction = async (key: string, action: () => Promise<void>) => {
    if (busyActionKey) return;
    setBusyActionKey(key);
    try {
      await action();
    } finally {
      setBusyActionKey(null);
    }
  };

  const resetAliasEditor = () => {
    setAliasEditorOwner(null);
    setAliasDraft("");
  };

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

  const startAliasEditor = (owner: Address) => {
    setAliasEditorOwner(owner);
    setAliasDraft(ownerAliasesByOwner.get(owner.toLowerCase()) ?? "");
  };

  const saveOwnerAlias = async (owner: Address) => {
    if (!address) {
      toast.error(t("connectTitle"));
      return;
    }

    if (aliasActionOwner) return;

    const trimmedAlias = aliasDraft.trim();
    if (trimmedAlias.length > MAX_OWNER_ALIAS_LENGTH) {
      toast.error(
        t("ownerAliasTooLongError", {
          max: MAX_OWNER_ALIAS_LENGTH,
        })
      );
      return;
    }

    setAliasActionOwner(owner);
    try {
      await assertWalletOnExpectedChain(walletClient);
      const action = trimmedAlias.length === 0 ? "delete" : "upsert";
      const issuedAt = new Date().toISOString();
      const nonce =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const signature = (await signMessageAsync({
        message: buildGovernanceOwnerAliasAuthMessage({
          action,
          editorAddress: address,
          ownerAddress: owner,
          alias: action === "upsert" ? trimmedAlias : "",
          nonce,
          issuedAt,
        }),
      })) as `0x${string}`;
      const auth = {
        nonce,
        issuedAt,
        signature,
      } as const;

      if (action === "delete") {
        await deleteGovernanceOwnerAlias({
          editorAddress: address,
          ownerAddress: owner,
          auth,
        });
        toast.success(t("ownerAliasRemoved"));
      } else {
        await upsertGovernanceOwnerAlias({
          editorAddress: address,
          ownerAddress: owner,
          alias: trimmedAlias,
          auth,
        });
        toast.success(t("ownerAliasSaved"));
      }

      await ownerAliasesQuery.refetch();
      resetAliasEditor();
    } catch (error) {
      toast.error(t("ownerAliasSaveError"), {
        description: error instanceof Error ? error.message : "Unexpected error.",
      });
    } finally {
      setAliasActionOwner(null);
    }
  };

  const saveLocalSafeExecution = (execution: LocalSafeExecution) => {
    if (!canPersistForkExecution(activeChainId, forkGeneration, window.localStorage)) return;
    setLocalSafeExecutions((current) => {
      const next = [
        execution,
        ...current.filter((entry) => entry.safeTxHash.toLowerCase() !== execution.safeTxHash.toLowerCase()),
      ].slice(0, 25);

      if (localExecutionStorageKey && typeof window !== "undefined") {
        window.localStorage.setItem(localExecutionStorageKey, JSON.stringify(next));
      }

      return next;
    });
  };

  const invalidateSafeQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["safe-pending-transactions", safeAddress] }),
      queryClient.invalidateQueries({ queryKey: ["safe-executed-transactions", safeAddress] }),
      queryClient.invalidateQueries({ queryKey: ["safe-local-execution-receipts", safeAddress] }),
      queryClient.invalidateQueries({ queryKey: ["safe-execution-receipts", safeAddress] }),
      queryClient.invalidateQueries({ queryKey: ["safe-execution-statuses", safeAddress] }),
      queryClient.invalidateQueries({ queryKey: ["safe-service-info", safeAddress] }),
      safeNonceQuery.refetch(),
    ]);
  };

  const getSafeTransactionHash = async (payload: SafeTxPayload) => {
    if (!safeAddress) throw new Error("Safe address unavailable.");
    return await fetchSafeTransactionHash(safeAddress, payload);
  };

  const getVerifiedSafeTxPayload = async (tx: SafeServicePendingTx) => {
    const payload = toSafeTxPayload(tx);
    const onchainHash = await getSafeTransactionHash(payload);
    if (onchainHash.toLowerCase() !== tx.safeTxHash.toLowerCase()) {
      throw new Error(t("safeTxHashMismatchError"));
    }
    return payload;
  };

  const signSafeTransaction = async (payload: SafeTxPayload) => {
    if (!safeAddress) throw new Error("Safe address unavailable.");
    await assertWalletOnExpectedChain(walletClient);
    return (await signTypedDataAsync({
      domain: {
        chainId: activeChainId,
        verifyingContract: safeAddress,
      },
      types: SAFE_TX_TYPES,
      primaryType: "SafeTx",
      message: {
        to: payload.to,
        value: payload.value,
        data: payload.data,
        operation: payload.operation,
        safeTxGas: payload.safeTxGas,
        baseGas: payload.baseGas,
        gasPrice: payload.gasPrice,
        gasToken: payload.gasToken,
        refundReceiver: payload.refundReceiver,
        nonce: payload.nonce,
      },
    })) as Hex;
  };

  const handleConfirmTransaction = async (tx: SafeServicePendingTx) => {
    if (!address) {
      toast.error(t("pauseConnectWalletError"));
      return;
    }
    if (!connectedIsSafeOwner) {
      toast.error(t("safeOwnerRequiredError"));
      return;
    }
    if (!safeServiceReady) {
      toast.error(t("safeServiceUnavailable"));
      return;
    }
    if (!publicClient) {
      toast.error(t("publicClientUnavailable"));
      return;
    }

    await runBusyAction(`confirm:${tx.safeTxHash}`, async () => {
      try {
        const payload = await getVerifiedSafeTxPayload(tx);
        const signature = await signSafeTransaction(payload);
        await callSafeApi("confirm-transaction", {
          safeTxHash: tx.safeTxHash,
          payload: { signature },
        });
        await invalidateSafeQueries();
        toast.success(t("confirmSuccessToast"));
      } catch (actionError) {
        const message = actionError instanceof Error ? actionError.message : String(actionError);
        toast.error(t("confirmErrorToast"), { description: message });
      }
    });
  };

  const handleRejectTransaction = async (tx: SafeServicePendingTx) => {
    if (!address) {
      toast.error(t("pauseConnectWalletError"));
      return;
    }
    if (!safeAddress) {
      toast.error(t("safeUnavailableError"));
      return;
    }
    if (!connectedIsSafeOwner) {
      toast.error(t("safeOwnerRequiredError"));
      return;
    }
    if (!safeServiceReady) {
      toast.error(t("safeServiceUnavailable"));
      return;
    }
    if (!publicClient) {
      toast.error(t("publicClientUnavailable"));
      return;
    }
    if (isSafeRejectionTransaction(tx, safeAddress)) {
      toast.message(t("rejectAlreadyPendingToast", { nonce: tx.nonce }));
      return;
    }

    await runBusyAction(`reject:${tx.safeTxHash}`, async () => {
      try {
        const currentSafeNonce = await fetchSafeNonce(safeAddress);
        if (BigInt(tx.nonce) < currentSafeNonce) {
          await invalidateSafeQueries();
          throw new Error(
            t("safeTxStaleNonceError", {
              txNonce: tx.nonce,
              safeNonce: currentSafeNonce.toString(),
            })
          );
        }

        const rejectionPayload = buildSafeRejectionPayload(safeAddress, BigInt(tx.nonce));
        const rejectionSafeTxHash = await getSafeTransactionHash(rejectionPayload);
        const pendingTransactions = await fetchSafePendingTransactions(safeAddress);
        const existingRejectionTx = pendingTransactions.find(
          (candidate) =>
            !candidate.isExecuted && candidate.safeTxHash.toLowerCase() === rejectionSafeTxHash.toLowerCase()
        );

        if (existingRejectionTx) {
          const signerAlreadyConfirmed = existingRejectionTx.confirmations.some(
            (confirmation) => confirmation.owner.toLowerCase() === address.toLowerCase()
          );
          if (signerAlreadyConfirmed) {
            setActiveTab("pending-confirm");
            toast.message(t("rejectAlreadyPendingToast", { nonce: tx.nonce }));
            return;
          }

          const verifiedPayload = await getVerifiedSafeTxPayload(existingRejectionTx);
          const signature = await signSafeTransaction(verifiedPayload);
          await callSafeApi("confirm-transaction", {
            safeTxHash: existingRejectionTx.safeTxHash,
            payload: { signature },
          });
          await invalidateSafeQueries();
          setActiveTab("pending-confirm");
          toast.success(t("rejectConfirmSuccessToast", { nonce: tx.nonce }));
          return;
        }

        const signature = await signSafeTransaction(rejectionPayload);
        await callSafeApi("propose-transaction", {
          safeAddress,
          payload: {
            to: rejectionPayload.to,
            value: rejectionPayload.value.toString(),
            data: rejectionPayload.data,
            operation: rejectionPayload.operation,
            safeTxGas: rejectionPayload.safeTxGas.toString(),
            baseGas: rejectionPayload.baseGas.toString(),
            gasPrice: rejectionPayload.gasPrice.toString(),
            gasToken: rejectionPayload.gasToken,
            refundReceiver: rejectionPayload.refundReceiver,
            nonce: Number(rejectionPayload.nonce),
            contractTransactionHash: rejectionSafeTxHash,
            sender: address,
            signature,
            origin: `CyberGold Governance · Reject nonce ${tx.nonce}`,
          },
        });
        await invalidateSafeQueries();
        setActiveTab("pending-confirm");
        toast.success(t("rejectProposeSuccessToast", { nonce: tx.nonce }));
      } catch (actionError) {
        const message = actionError instanceof Error ? actionError.message : String(actionError);
        toast.error(t("rejectErrorToast"), { description: message });
      }
    });
  };

  const handleExecuteTransaction = async (tx: SafeServicePendingTx) => {
    if (!address) {
      toast.error(t("pauseConnectWalletError"));
      return;
    }
    if (!safeAddress) {
      toast.error(t("safeUnavailableError"));
      return;
    }
    if (!publicClient) {
      toast.error(t("publicClientUnavailable"));
      return;
    }

    await runBusyAction(`execute:${tx.safeTxHash}`, async () => {
      try {
        await assertWalletOnExpectedChain(walletClient);
        const payload = await getVerifiedSafeTxPayload(tx);
        const currentSafeNonce = await fetchSafeNonce(safeAddress);
        if (BigInt(tx.nonce) < currentSafeNonce) {
          await invalidateSafeQueries();
          throw new Error(
            t("safeTxStaleNonceError", {
              txNonce: tx.nonce,
              safeNonce: currentSafeNonce.toString(),
            })
          );
        }
        const confirmationsRequired = getConfirmationsRequired(tx);
        const executableSignatureCount = countExecutableSignatures(tx.confirmations);
        if (confirmationsRequired > 0 && executableSignatureCount < confirmationsRequired) {
          throw new Error(
            t("insufficientExecutableSignaturesError", {
              count: executableSignatureCount,
              threshold: confirmationsRequired,
            })
          );
        }

        const signatures = sortAndConcatSignatures(tx.confirmations);
        if (signatures === "0x") {
          throw new Error("No executable signatures are available.");
        }

        const args = [
          payload.to,
          payload.value,
          payload.data,
          payload.operation,
          payload.safeTxGas,
          payload.baseGas,
          payload.gasPrice,
          payload.gasToken,
          payload.refundReceiver,
          signatures,
        ] as const;
        const walletExecutionNonce = await fetchPendingTransactionNonce(address);

        const simulation = await simulateSafeExecution(
          safeAddress, payload, address, walletExecutionNonce, signatures
        );
        if (simulation !== true) {
          throw new Error(t("safeExecutionSimulationFailedError"));
        }

        const hash = await writeContractAsync({
          chainId: EXPECTED_CHAIN_ID,
          account: address,
          address: safeAddress,
          abi: SAFE_ABI,
          functionName: "execTransaction",
          args,
          nonce: walletExecutionNonce,
        });
        const localSubmittedAt = new Date().toISOString();
        saveLocalSafeExecution({
          ...tx,
          localExecutionHash: hash,
          localExecutionState: "submitted",
          localExecutionUpdatedAt: localSubmittedAt,
        });
        let replacementReason: SafeReplacementReason | undefined;
        let executionHash = hash;
        const receipt = await waitForAppTransactionReceipt(publicClient, {
          hash,
          onReplaced: ({ reason, transaction }) => {
            replacementReason = reason;
            executionHash = transaction.hash;
            saveLocalSafeExecution({
              ...tx,
              localExecutionHash: transaction.hash,
              localExecutionState: reason,
              localReplacementReason: reason,
              localExecutionUpdatedAt: new Date().toISOString(),
            });
          },
        });
        const executionStatus =
          statusFromSafeExecutionLogs(
            receipt.logs.map((log) => ({
              address: log.address,
              data: log.data,
              topics: log.topics,
            })),
            safeAddress,
            tx.safeTxHash
          );
        const localExecutionState = resolveLocalSafeExecutionState({
          safeEventStatus: executionStatus,
          replacementReason,
        });
        saveLocalSafeExecution({
          ...tx,
          transactionHash: receipt.transactionHash,
          localExecutionHash: executionHash,
          localExecutionState,
          localReplacementReason: replacementReason,
          localExecutionUpdatedAt: new Date().toISOString(),
        });
        await invalidateSafeQueries();
        if (executionStatus === "executed") {
          toast.success(t("executeSuccessToast"));
          return;
        }
        if (executionStatus === "failed") {
          throw new Error(t("safeExecutionRevertedError"));
        }
        if (replacementReason === "cancelled") {
          throw new Error(t("safeExecutionCancelledBeforeMatchError"));
        }
        if (replacementReason === "replaced") {
          throw new Error(t("safeExecutionReplacedBeforeMatchError"));
        }
        throw new Error(t("safeExecutionUnknownReceiptError"));
      } catch (actionError) {
        const message = actionError instanceof Error ? actionError.message : String(actionError);
        const normalizedMessage = message.toLowerCase();
        if (normalizedMessage.includes("nonce too low")) {
          toast.error(t("walletNonceTooLowError"), { description: message });
          return;
        }
        toast.error(t("executeErrorToast"), { description: message });
      }
    });
  };

  const showPendingConfirmTab = activeTab === "pending-confirm";
  const showHistoryTab = activeTab === "history";
  const pendingTabCards = showPendingConfirmTab ? pendingConfirmCards : pendingExecuteCards;
  const pendingTabTitle = showPendingConfirmTab ? t("tabPendingConfirmations") : t("tabPendingExecutions");
  const pendingTabSubtitle = showPendingConfirmTab
    ? t("pendingConfirmQueueSubtitle")
    : t("pendingExecuteQueueSubtitle");

  const renderPendingGovernanceCard = (card: PendingGovernanceCard, queueMode: "confirm" | "execute") => {
    const tx = card.primaryRow.tx;
    const primaryIsRejection = !!safeAddress && isSafeRejectionTransaction(tx, safeAddress);
    const proposalRow = primaryIsRejection ? undefined : card.primaryRow;
    const rejectionRow = primaryIsRejection ? card.primaryRow : card.rejectionRow;
    const targetTx = proposalRow?.tx ?? rejectionRow?.tx ?? tx;
    const targetAlias = addressAlias(targetTx.to);
    const proposalMissingCode = !!proposalRow && isGovernanceTargetMissingCode({
      tx: proposalRow.tx,
      hasCode: governanceTargetHasCode.get(proposalRow.tx.to.toLowerCase()),
      safeAddress,
    });
    const proposalAtThreshold = proposalRow?.hasEnoughExecutableSignatures ?? false;
    const rejectionAtThreshold = rejectionRow?.hasEnoughExecutableSignatures ?? false;
    const signerRejected = rejectionRow?.signerConfirmed ?? false;
    const canConfirm =
      queueMode === "confirm" &&
      !!proposalRow &&
      !proposalMissingCode &&
      connectedIsSafeOwner &&
      !proposalRow.signerConfirmed &&
      !signerRejected &&
      !tx.isExecuted &&
      !proposalAtThreshold &&
      !rejectionAtThreshold;
    const canReject =
      queueMode === "confirm" &&
      connectedIsSafeOwner &&
      !signerRejected &&
      !tx.isExecuted &&
      !rejectionAtThreshold &&
      (!proposalRow || (!proposalRow.signerConfirmed && !proposalAtThreshold));
    const canExecuteProposal =
      queueMode === "execute" &&
      !!proposalRow &&
      !proposalMissingCode &&
      proposalRow.isExecutableNow &&
      proposalRow.hasEnoughExecutableSignatures &&
      !proposalRow.tx.isExecuted;
    const canExecuteRejection =
      queueMode === "execute" &&
      !!rejectionRow &&
      rejectionRow.isExecutableNow &&
      rejectionRow.hasEnoughExecutableSignatures &&
      !rejectionRow.tx.isExecuted;
    const isConfirmBusy = busyActionKey === `confirm:${tx.safeTxHash}`;
    const isRejectBusy = busyActionKey === `reject:${tx.safeTxHash}`;
    const isExecuteBusy = proposalRow && busyActionKey === `execute:${proposalRow.tx.safeTxHash}`;
    const isExecuteRejectionBusy = rejectionRow && busyActionKey === `execute:${rejectionRow.tx.safeTxHash}`;
    const nextExecutableNonce =
      proposalRow?.nextExecutableNonce ?? rejectionRow?.nextExecutableNonce ?? tx.nonce;
    const showQueuedHint =
      queueMode === "execute" &&
      !canExecuteProposal &&
      !canExecuteRejection &&
      (proposalRow?.isQueuedByNonce || rejectionRow?.isQueuedByNonce);
    const hasNonceConflict = !!proposalRow?.hasNonceConflict || !!rejectionRow?.hasNonceConflict;
    const localHint = localExecutionStateHint(canExecuteRejection && rejectionRow ? rejectionRow.tx : tx);
    const { signedByOwners, rejectedByOwners, unpositionedOwners } = ownerPositionLists(card);
    const connectedDecision = connectedDecisionForCard(card);

    return (
      <div
        key={`${card.queueKind}:${tx.safeTxHash}`}
        className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-input)] p-4"
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-[var(--text-input)]">{transactionLabel(targetTx)}</h4>
            {connectedDecision === "confirmed" ? (
              <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-900">
                {t("youConfirmedBadge")}
              </span>
            ) : connectedDecision === "rejected" ? (
              <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                {t("youRejectedBadge")}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {queueMode === "execute" && (
              <>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    proposalRow?.isExecutableNow || rejectionRow?.isExecutableNow
                      ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                      : "border-zinc-300 bg-zinc-100 text-zinc-700"
                  }`}
                >
                  {proposalRow?.isExecutableNow || rejectionRow?.isExecutableNow
                    ? t("executeStateReadyBadge")
                    : t("executeStateQueuedBadge")}
                </span>
                {hasNonceConflict && (
                  <span className="inline-flex rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                    {t("executeStateConflictBadge")}
                  </span>
                )}
              </>
            )}
            <p className="text-xs text-[var(--text-muted)]">{formatTimestamp(targetTx.submissionDate, locale)}</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
          <div>
            <p className="text-[var(--text-muted)]">{t("pendingTargetLabel")}</p>
            {targetAlias && <p className="mt-1 font-semibold text-[var(--text-input)]">{targetAlias}</p>}
            <div className="mt-1 flex items-start gap-2">
              <p className="font-mono break-all text-[var(--text-input)]">{targetTx.to}</p>
              <CopyButton
                isCopied={copiedAddress === targetTx.to.toLowerCase()}
                onClick={() => void copyAddress(targetTx.to)}
                ariaLabel={copiedAddress === targetTx.to.toLowerCase() ? t("addressCopied") : t("copyAddressButton")}
              />
            </div>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">{t("pendingNonceLabel")}</p>
            <p className="mt-1 font-mono text-[var(--text-input)]">{targetTx.nonce}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">{t("safeHistoryDateLabel")}</p>
            <p className="mt-1 text-[var(--text-input)]">{formatTimestamp(targetTx.submissionDate, locale)}</p>
          </div>
        </div>

        {queueMode === "execute" && showQueuedHint && (
          <p className="mt-3 text-xs text-[var(--text-muted)]">{t("executeStateQueuedHint", { nonce: nextExecutableNonce })}</p>
        )}
        {queueMode === "execute" && hasNonceConflict && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t("executeStateConflictHint", { nonce: targetTx.nonce })}</p>
        )}
        {proposalMissingCode && (
          <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
            {t("targetMissingCodeWarning")}
          </div>
        )}

        {proposalRow && (
          <div className="mt-4 rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] p-3">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <h5 className="text-sm font-semibold text-[var(--text-input)]">{t("proposalLaneTitle")}</h5>
              <p className="font-mono text-xs text-[var(--text-input)]">
                {proposalRow.confirmationsCount} / {proposalRow.confirmationsRequired || "?"}
              </p>
            </div>
            <div className="mt-3">{renderDecodedCallDetails(proposalRow.tx, "proposal")}</div>
            <div className="mt-3">
              <p className="text-[11px] text-[var(--text-muted)]">{t("pendingSafeTxHashLabel")}</p>
              <p className="mt-1 text-[11px] font-mono break-all text-[var(--text-input)]">{proposalRow.tx.safeTxHash}</p>
            </div>
          </div>
        )}

        {rejectionRow && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <h5 className="text-sm font-semibold text-[var(--text-input)]">{t("rejectionLaneTitle")}</h5>
              <p className="font-mono text-xs text-[var(--text-input)]">
                {rejectionRow.confirmationsCount} / {rejectionRow.confirmationsRequired || "?"}
              </p>
            </div>
            <div className="mt-3">{renderDecodedCallDetails(rejectionRow.tx, "rejection")}</div>
            <div className="mt-3">
              <p className="text-[11px] text-[var(--text-muted)]">{t("pendingRejectionSafeTxHashLabel")}</p>
              <p className="mt-1 text-[11px] font-mono break-all text-[var(--text-input)]">{rejectionRow.tx.safeTxHash}</p>
            </div>
          </div>
        )}

        <div className="mt-3">
          <p className="text-[11px] text-[var(--text-muted)]">{t("signedByLabel")}</p>
          {signedByOwners.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">{t("signedByNone")}</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1">
              {signedByOwners.map((owner) => renderOwnerBadge(targetTx.safeTxHash, owner, owner.toLowerCase() === address?.toLowerCase() ? "emerald" : undefined))}
            </div>
          )}
        </div>

        <div className="mt-3">
          <p className="text-[11px] text-[var(--text-muted)]">{t("rejectedByLabel")}</p>
          {rejectedByOwners.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">{t("rejectedByNone")}</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1">
              {rejectedByOwners.map((owner) =>
                renderOwnerBadge(
                  rejectionRow?.tx.safeTxHash ?? targetTx.safeTxHash,
                  owner,
                  owner.toLowerCase() === address?.toLowerCase() ? "amber" : "amber"
                )
              )}
            </div>
          )}
        </div>

        <div className="mt-3">
          <p className="text-[11px] text-[var(--text-muted)]">{t("noPositionLabel")}</p>
          {unpositionedOwners.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">{t("noPositionNone")}</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1">
              {unpositionedOwners.map((owner) => renderOwnerBadge(targetTx.safeTxHash, owner))}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {canConfirm && proposalRow && (
            <button
              type="button"
              onClick={() => void handleConfirmTransaction(proposalRow.tx)}
              disabled={isConfirmBusy || !safeServiceReady}
              className="rounded-full border border-emerald-300 px-4 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isConfirmBusy ? t("confirmInProgressButton") : t("confirmButton")}
            </button>
          )}
          {canReject && (proposalRow || rejectionRow) && (
            <button
              type="button"
              onClick={() => void handleRejectTransaction(proposalRow?.tx ?? rejectionRow!.tx)}
              disabled={isRejectBusy || !safeServiceReady}
              className="rounded-full border border-amber-300 px-4 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRejectBusy ? t("rejectInProgressButton") : rejectionRow ? t("rejectConfirmButton") : t("rejectButton")}
            </button>
          )}
          {canExecuteProposal && proposalRow && (
            <button
              type="button"
              onClick={() => void handleExecuteTransaction(proposalRow.tx)}
              disabled={!!isExecuteBusy}
              className="rounded-full bg-gold-cg px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExecuteBusy ? t("executeInProgressButton") : t("executeProposalButton")}
            </button>
          )}
          {canExecuteRejection && rejectionRow && (
            <button
              type="button"
              onClick={() => void handleExecuteTransaction(rejectionRow.tx)}
              disabled={!!isExecuteRejectionBusy}
              className="rounded-full border border-amber-300 px-4 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExecuteRejectionBusy ? t("executeInProgressButton") : t("executeRejectionButton")}
            </button>
          )}
          {!canConfirm && !canReject && !canExecuteProposal && !canExecuteRejection && (
            <span className="text-xs text-[var(--text-muted)]">
              {queueMode === "execute" && showQueuedHint
                ? t("executeQueuedNoActionHint")
                : targetTx.isExecuted
                  ? t("txAlreadyExecutedHint")
                  : t("noActionAvailableHint")}
            </span>
          )}
        </div>

        {localHint && <p className="mt-3 text-xs text-[var(--text-muted)]">{localHint}</p>}
      </div>
    );
  };

  const observedDisconnect = hasObservedProviderAccounts && !isConnected && walletStatus !== "connecting" && walletStatus !== "reconnecting";
  const deniedAccess = !!configuration && hasObservedProviderAccounts && !isLoading && !error && !hasAccess;
  const restoredContent = hasAccess && !isLoading && !safeServiceInfoQuery.isLoading && !safeNonceQuery.isLoading
    && !ownerAliasesQuery.isLoading && !safePendingQuery.isLoading && !safeExecutedQuery.isLoading
    && !localExecutionReceiptsQuery.isLoading && !safeExecutionReceiptsQuery.isLoading
    && !safeExecutionStatusesQuery.isLoading && !pendingExecutionStatusesQuery.isLoading && !governanceTargetCodeQuery.isLoading;

  return (
    <RetainedPageDisplay page="governance-safe" privatePage account={address ?? null}
      ready={restoredContent || !!busyActionKey || observedDisconnect || deniedAccess || !!configurationError}
      discard={observedDisconnect || deniedAccess}>
    <div className="flex flex-1 flex-col items-center bg-background font-sans">
      <div className="flex flex-col max-w-6xl w-full mx-auto p-3">
        <section className="flex max-w-6xl w-full justify-between pt-4 mt-4 items-center text-[var(--text-input)]">
          <div>
            <h1 className="text-3xl font-semibold">{t("title")}</h1>
            <p className="text-sm hidden md:block">{t("subtitle")}</p>
          </div>
        </section>
        <GovernanceSurfaceNav activeSurfaceId="safe" />

        {error && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-semibold">{t("dataWarningTitle")}</p>
            <p className="mt-1 break-all">{error instanceof Error ? error.message : String(error)}</p>
          </div>
        )}

        {safeServiceError && (
          <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <p className="font-semibold">{t("safeServiceUnavailableTitle")}</p>
            <p className="mt-1 break-all">
              {safeServiceError instanceof Error ? safeServiceError.message : String(safeServiceError)}
            </p>
          </div>
        )}

        <section className="mt-4">
          <GovernanceAccessGate isLoading={isLoading} isConnected={isConnected} hasAccess={hasAccess}>
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4">
                  <h2 className="text-lg font-semibold text-[var(--text-input)]">{t("safeConfigurationTitle")}</h2>
                  <div className="mt-3 space-y-2 text-sm text-[var(--text-muted)]">
                    <p>
                      <span className="font-medium text-[var(--text-input)]">{t("safeAddressLabel")}:</span>{" "}
                      <span className="font-mono break-all">{safeAddress ?? t("notAvailable")}</span>
                    </p>
                    <p>
                      <span className="font-medium text-[var(--text-input)]">{t("sourceLabel")}:</span>{" "}
                      {sourceLabel}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--text-input)]">{t("thresholdLabel")}:</span>{" "}
                      {threshold !== undefined ? threshold : t("notAvailable")}
                      {owners.length > 0 ? ` / ${owners.length}` : ""}
                    </p>
                  </div>
                </div>

                <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4">
                  <h2 className="text-lg font-semibold text-[var(--text-input)]">{t("ownersTitle")}</h2>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{t("ownerAliasHint")}</p>
                  {ownerAliasesQuery.isLoading && (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">{t("ownerAliasesLoading")}</p>
                  )}
                  {ownerAliasesQuery.error && (
                    <p className="mt-2 text-xs text-rose-700 break-words">
                      {t("ownerAliasesError")}:{" "}
                      {ownerAliasesQuery.error instanceof Error
                        ? ownerAliasesQuery.error.message
                        : String(ownerAliasesQuery.error)}
                    </p>
                  )}
                  {owners.length === 0 ? (
                    <p className="mt-3 text-sm text-[var(--text-muted)]">{t("noOwners")}</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {owners.map((owner, index) => {
                        const ownerKey = owner.toLowerCase();
                        const ownerAlias = ownerAliasesByOwner.get(ownerKey) ?? "";
                        const isEditingAlias =
                          !!aliasEditorOwner && aliasEditorOwner.toLowerCase() === ownerKey;
                        const isAliasBusy =
                          !!aliasActionOwner && aliasActionOwner.toLowerCase() === ownerKey;
                        const isConnectedOwner = !!address && owner.toLowerCase() === address.toLowerCase();
                        const isCopiedOwner = copiedAddress === ownerKey;
                        return (
                          <li
                            key={owner}
                            className="flex items-center justify-between gap-3 rounded-md border border-[var(--swap-container-border)] bg-[var(--background-input)] px-3 py-2"
                          >
                            <span className="text-sm text-[var(--text-input)]">
                              {t("ownerIndex", { index: index + 1 })}
                            </span>
                            <div className="flex items-center gap-2 flex-wrap justify-end">
                              {isEditingAlias ? (
                                <div className="flex items-center gap-1 flex-wrap justify-end">
                                  <input
                                    data-page-draft-key={`owner-alias:${owner.toLowerCase()}`}
                                    value={aliasDraft}
                                    onChange={(event) => setAliasDraft(event.target.value)}
                                    placeholder={t("ownerAliasPlaceholder")}
                                    maxLength={MAX_OWNER_ALIAS_LENGTH}
                                    className="h-8 min-w-32 rounded border border-[var(--swap-container-border)] bg-white px-2 text-xs text-[var(--text-input)] outline-none focus:ring-2 focus:ring-gold-cg/40"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void saveOwnerAlias(owner)}
                                    disabled={isAliasBusy}
                                    className="h-8 rounded border border-gold-cg px-2 text-xs font-semibold text-gold-cg disabled:opacity-60"
                                  >
                                    {isAliasBusy ? t("ownerAliasSavingButton") : t("ownerAliasSaveButton")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={resetAliasEditor}
                                    disabled={isAliasBusy}
                                    className="h-8 rounded border border-[var(--swap-container-border)] px-2 text-xs text-[var(--text-muted)] disabled:opacity-60"
                                  >
                                    {t("ownerAliasCancelButton")}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startAliasEditor(owner)}
                                  className="rounded border border-[var(--swap-container-border)] px-2 py-1 text-xs text-[var(--text-input)] hover:bg-black/5"
                                >
                                  {ownerAlias ? t("ownerAliasEditButton") : t("ownerAliasSetButton")}
                                </button>
                              )}
                              {ownerAlias && (
                                <span className="text-xs font-semibold text-[var(--text-input)]">{ownerAlias}</span>
                              )}
                              <span className="text-xs font-mono text-[var(--text-muted)]">
                                {shortenAddress(owner)}
                              </span>
                              <CopyButton
                                isCopied={isCopiedOwner}
                                onClick={() => void copyAddress(owner)}
                                ariaLabel={isCopiedOwner ? t("addressCopied") : t("copyAddressButton")}
                              />
                              {isConnectedOwner && (
                                <span className="rounded-full bg-gold-cg/20 px-2 py-0.5 text-[10px] font-semibold text-gold-cg">
                                  {t("connectedBadge")}
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <section className="w-full mt-6">
                <nav
                  role="tablist"
                  aria-label={t("title")}
                  className="flex items-center gap-2 overflow-x-auto rounded-full border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] p-1"
                >
                  <button
                    id="governance-tab-pending-confirm"
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "pending-confirm"}
                    aria-controls="governance-panel-pending-confirm"
                    onClick={() => setActiveTab("pending-confirm")}
                    className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                      activeTab === "pending-confirm"
                        ? "bg-gold-cg text-white shadow-md"
                        : "text-[var(--text-muted)] hover:text-[var(--text-input)] hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                  >
                    {t("tabPendingConfirmations")} ({pendingConfirmCards.length})
                  </button>
                  <button
                    id="governance-tab-pending-execute"
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "pending-execute"}
                    aria-controls="governance-panel-pending-execute"
                    onClick={() => setActiveTab("pending-execute")}
                    className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                      activeTab === "pending-execute"
                        ? "bg-gold-cg text-white shadow-md"
                        : "text-[var(--text-muted)] hover:text-[var(--text-input)] hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                  >
                    {t("tabPendingExecutions")} ({pendingExecuteCards.length})
                  </button>
                  <button
                    id="governance-tab-history"
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "history"}
                    aria-controls="governance-panel-history"
                    onClick={() => setActiveTab("history")}
                    className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                      activeTab === "history"
                        ? "bg-gold-cg text-white shadow-md"
                        : "text-[var(--text-muted)] hover:text-[var(--text-input)] hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                  >
                    {t("tabHistory")} ({historyTransactions.length})
                  </button>
                </nav>
              </section>

              {(activeTab === "pending-confirm" || activeTab === "pending-execute") && (
                <div
                  id={showPendingConfirmTab ? "governance-panel-pending-confirm" : "governance-panel-pending-execute"}
                  role="tabpanel"
                  aria-labelledby={showPendingConfirmTab ? "governance-tab-pending-confirm" : "governance-tab-pending-execute"}
                  className="mt-4 rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] p-4"
                >
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-[var(--text-input)]">{pendingTabTitle}</h2>
                    <p className="text-sm text-[var(--text-muted)] mt-1">{pendingTabSubtitle}</p>
                  </div>

                  {safePendingQuery.isLoading ? (
                    <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-input)] p-4 text-sm text-[var(--text-muted)]">
                      {t("loadingPendingSignatures")}
                    </div>
                  ) : pendingTabCards.length === 0 ? (
                    <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-input)] p-4 text-sm text-[var(--text-muted)]">
                      {showPendingConfirmTab ? t("pendingConfirmQueueEmpty") : t("pendingExecuteQueueEmpty")}
                    </div>
                  ) : (
                    showPendingConfirmTab ? (
                      <div className="space-y-6">
                        <div>
                          <div className="mb-3">
                            <h3 className="text-base font-semibold text-[var(--text-input)]">
                              {t("pendingNeedsYourDecisionTitle")} ({pendingConfirmNeedsDecisionCards.length})
                            </h3>
                            <p className="mt-1 text-sm text-[var(--text-muted)]">{t("pendingNeedsYourDecisionSubtitle")}</p>
                          </div>
                          {pendingConfirmNeedsDecisionCards.length === 0 ? (
                            <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-input)] p-4 text-sm text-[var(--text-muted)]">
                              {t("pendingNeedsYourDecisionEmpty")}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {pendingConfirmNeedsDecisionCards.map((card) => renderPendingGovernanceCard(card, "confirm"))}
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="mb-3">
                            <h3 className="text-base font-semibold text-[var(--text-input)]">
                              {t("pendingWaitingForOthersTitle")} ({pendingConfirmWaitingCards.length})
                            </h3>
                            <p className="mt-1 text-sm text-[var(--text-muted)]">{t("pendingWaitingForOthersSubtitle")}</p>
                          </div>
                          {pendingConfirmWaitingCards.length === 0 ? (
                            <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-input)] p-4 text-sm text-[var(--text-muted)]">
                              {t("pendingWaitingForOthersEmpty")}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {pendingConfirmWaitingCards.map((card) => renderPendingGovernanceCard(card, "confirm"))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {pendingExecuteCards.map((card) => renderPendingGovernanceCard(card, "execute"))}
                      </div>
                    )
                  )}
                </div>
              )}

              {showHistoryTab && (
                <div
                  id="governance-panel-history"
                  role="tabpanel"
                  aria-labelledby="governance-tab-history"
                  className="mt-4 rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] p-4"
                >
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-[var(--text-input)]">{t("safeHistoryTitle")}</h2>
                    <p className="text-sm text-[var(--text-muted)] mt-1">{t("safeHistorySubtitle")}</p>
                  </div>

                  {historyTransactions.length === 0 &&
                  (safeExecutedQuery.isLoading ||
                    localExecutionReceiptsQuery.isLoading ||
                    safeExecutionReceiptsQuery.isLoading ||
                    safeExecutionStatusesQuery.isLoading) ? (
                    <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-input)] p-4 text-sm text-[var(--text-muted)]">
                      {t("loadingSafeHistory")}
                    </div>
                  ) : historyTransactions.length === 0 ? (
                    <div className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-input)] p-4 text-sm text-[var(--text-muted)]">
                      {t("noSafeHistory")}
                    </div>
                  ) : (
                      <div className="space-y-3">
                        {historyTransactions.map((tx) => {
                          const targetAlias = addressAlias(tx.to);
                          const localExecution = localExecutionBySafeTxHash.get(tx.safeTxHash.toLowerCase());
                          const indexedExecution = indexedExecutionBySafeTxHash.get(tx.safeTxHash.toLowerCase());
                          const missingTargetCode = isGovernanceTargetMissingCode({
                            tx,
                            hasCode: governanceTargetHasCode.get(tx.to.toLowerCase()),
                            safeAddress,
                          });
                          const executionTxHash =
                            tx.transactionHash ?? indexedExecution?.transactionHash ?? localExecution?.localExecutionHash;
                          const effectiveHistoryStatus =
                            tx.historyStatus === "executed" && missingTargetCode ? "failed" : tx.historyStatus;
                          const statusLabel =
                            effectiveHistoryStatus === "executed"
                              ? t("safeHistoryExecuted")
                              : effectiveHistoryStatus === "failed"
                                ? t("safeHistoryFailed")
                                : t("safeHistoryCancelled");
                          const statusClass =
                            effectiveHistoryStatus === "executed"
                              ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                              : effectiveHistoryStatus === "failed"
                                ? "border-rose-300 bg-rose-100 text-rose-900"
                                : "border-zinc-300 bg-zinc-100 text-zinc-700";
                          const signedByOwners = uniqueConfirmedOwners(tx.confirmations);
                          return (
                          <div
                            key={`history:${tx.safeTxHash}`}
                            className="rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-input)] p-4"
                          >
                            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                              <h4 className="text-sm font-semibold text-[var(--text-input)]">{transactionLabel(tx)}</h4>
                              <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                                {statusLabel}
                              </span>
                            </div>
                            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                              <div>
                                <p className="text-[var(--text-muted)]">{t("pendingTargetLabel")}</p>
                                {targetAlias && <p className="mt-1 font-semibold text-[var(--text-input)]">{targetAlias}</p>}
                                <div className="mt-1 flex items-start gap-2">
                                  <p className="font-mono break-all text-[var(--text-input)]">{tx.to}</p>
                                  <CopyButton
                                    isCopied={copiedAddress === tx.to.toLowerCase()}
                                    onClick={() => void copyAddress(tx.to)}
                                    ariaLabel={copiedAddress === tx.to.toLowerCase() ? t("addressCopied") : t("copyAddressButton")}
                                  />
                                </div>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">{t("pendingNonceLabel")}</p>
                                <p className="mt-1 font-mono text-[var(--text-input)]">{tx.nonce}</p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">{t("safeHistoryDateLabel")}</p>
                                <p className="mt-1 text-[var(--text-input)]">
                                  {formatTimestamp(indexedExecution?.executionDate ?? tx.executionDate ?? tx.submissionDate, locale)}
                                </p>
                              </div>
                            </div>
                            <div className="mt-4 rounded-lg border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] p-3">
                              {renderDecodedCallDetails(tx, "history")}
                            </div>
                            {missingTargetCode && (
                              <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
                                {t("safeHistoryMissingCodeHint")}
                              </div>
                            )}
                            <div className="mt-3">
                              <p className="text-[11px] text-[var(--text-muted)]">{t("pendingSafeTxHashLabel")}</p>
                              <p className="mt-1 text-[11px] font-mono break-all text-[var(--text-input)]">
                                {tx.safeTxHash}
                              </p>
                            </div>
                            <div className="mt-3">
                              <p className="text-[11px] text-[var(--text-muted)]">{t("signedByLabel")}</p>
                              {signedByOwners.length === 0 ? (
                                <p className="mt-1 text-xs text-[var(--text-muted)]">{t("signedByNone")}</p>
                              ) : (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {signedByOwners.map((signer) => renderOwnerBadge(tx.safeTxHash, signer))}
                                </div>
                              )}
                            </div>
                            {executionTxHash ? (
                              <div className="mt-3">
                                <p className="text-[11px] text-[var(--text-muted)]">{t("executionTxHashLabel")}</p>
                                <p className="mt-1 text-[11px] font-mono break-all text-[var(--text-input)]">
                                  {executionTxHash}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          </GovernanceAccessGate>
        </section>
      </div>
    </div>
    </RetainedPageDisplay>
  );
}
