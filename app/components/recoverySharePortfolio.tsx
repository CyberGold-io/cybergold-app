"use client";

import { useMemo, useRef, useState } from "react";
import { waitForAppTransactionReceipt } from "@/app/utils/receiptWait";
import { formatUnits, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";

import { Spinner } from "@/components/ui/spinner";
import { useRecoveryShareSettlement } from "@/app/hooks/cybergold/useRecoveryShareSettlement";
import { useRecoverySharePortfolio } from "@/app/hooks/cybergold/useRecoverySharePortfolio";
import { applySlippageFloor } from "@/app/utils/swapPolicy";
import { EXPECTED_CHAIN_ID } from "@/app/utils/expectedChain";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { getLocaleDecimalSeparator } from "@/app/utils/formatting";
import { useWalletDisplayCache } from "@/app/hooks/useWalletDisplayCache";
import { parseWalletRecoveryDisplay, walletDisplayCacheKey, type WalletRecoveryDisplay } from "@/app/utils/walletDisplayCache";
import { WalletRecoveryPresentation } from "./walletRecoveryPresentation";

function shorten(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function RecoverySharePortfolio({ holder }: { holder?: Address }) {
  const { displayTokens } = useProtocolConfiguration();
  const t = useTranslations("RecoveryShares");
  const locale = useLocale();
  const format = useMemo(() => (value: bigint, decimals: number) => formatUnits(value, decimals).replace(".", getLocaleDecimalSeparator(locale)), [locale]);
  const portfolio = useRecoverySharePortfolio(holder);
  const settlement = useRecoveryShareSettlement(holder);
  const publicClient = usePublicClient({ chainId: EXPECTED_CHAIN_ID });
  const holderKey = holder?.toLowerCase();
  const activeHolder = useRef(holderKey);
  activeHolder.current = holderKey;
  const [pendingByHolder, setPendingByHolder] = useState<Record<string, { shareId: string }>>({});
  const pendingShareId = holderKey ? pendingByHolder[holderKey]?.shareId : undefined;
  const [settlementProblem, setSettlementProblem] = useState<{ holder: string; shareId: string; message: string }>();

  const balances = useMemo(
    () =>
      portfolio.data.balances.map((balance) => {
        const shares = BigInt(balance.balanceRaw);
        const expectedPayoutRaw = balance.payoutRaw === null ? undefined : BigInt(balance.payoutRaw);
        return { ...balance, shares, expectedPayoutRaw };
      }),
    [portfolio.data.balances]
  );
  const observedDisplay = useMemo<WalletRecoveryDisplay | undefined>(() => {
    if (portfolio.isLoading || portfolio.error || (!portfolio.data.complete && portfolio.data.status !== "not-configured")) return;
    return {
      notConfigured: portfolio.data.status === "not-configured", corePaused: Boolean(portfolio.data.corePaused),
      rows: balances.map(entry => {
        const token = displayTokens.find(token => token.type === "erc20" && token.address.toLowerCase() === entry.pool?.asset.toLowerCase());
        return {
          shareId: entry.shareId,
          assetLabel: token?.symbol ?? (entry.pool ? shorten(entry.pool.asset) : t("unknownAsset")),
          balance: t("balance", { amount: format(entry.shares, entry.pool.shareDecimals) }),
          payout: entry.expectedPayoutRaw !== undefined
            ? `${format(entry.expectedPayoutRaw, entry.pool.shareDecimals)} ${token?.symbol ?? t("underlyingTokens")}`
            : t("payoutUnavailable"),
          ...(entry.fundOffer?.available ? { fundOffer: entry.fundOffer.governancePaused ? t("fundPaused") : t("fundOffer", {
            shares: format(BigInt(entry.fundOffer.acceptedShares), entry.pool.shareDecimals),
            amount: format(BigInt(entry.fundOffer.cygldAmount), 18),
          }) } : {}),
          ...(entry.pool && !portfolio.data.corePaused && !portfolio.isStale && entry.pool.custody.liveBalanceAvailable
            && entry.shares > 0n && entry.expectedPayoutRaw !== undefined && entry.expectedPayoutRaw > 0n ? { redeemLabel: t("redeem") } : {}),
          zeroPayout: entry.shares > 0n && entry.expectedPayoutRaw === 0n,
        };
      }),
    };
  }, [portfolio.isLoading, portfolio.error, portfolio.data, portfolio.isStale, balances, displayTokens, format, t]);
  const display = useWalletDisplayCache(walletDisplayCacheKey(EXPECTED_CHAIN_ID, holder, `recovery:${locale}`),
    parseWalletRecoveryDisplay, observedDisplay);

  if (!holder) return null;
  if ((portfolio.isLoading || (portfolio.error && !portfolio.data.complete)) && display) {
    if (display.notConfigured) return <WalletRecoveryPresentation display={display} stale={Boolean(portfolio.error)} />;
    if (!display.rows.length) return portfolio.error
      ? <p role="status" className="mt-4 text-xs text-text-amber">{t("unavailable")}</p> : null;
    // Cached text has no pool, transaction inputs, or redemption action. A live
    // portfolio independently restores its ordinary settlement controls.
    return <WalletRecoveryPresentation display={display} refreshing={portfolio.isRefreshing} stale={Boolean(portfolio.error)} />;
  }
  if (portfolio.isLoading) return (
    <section className="mt-4" aria-busy="true" aria-label={t("title")}>
      <span className="sr-only" role="status">{t("loading")}</span>
      <div aria-hidden="true" className="h-14 animate-pulse rounded-xl bg-background-input" />
    </section>
  );
  if (portfolio.error && !portfolio.data.complete) return (
    <p role="status" className="mt-4 text-xs text-text-amber">{t("unavailable")}</p>
  );
  if (portfolio.data.status === "not-configured") return (
    <p className="mt-4 text-xs text-text-muted">{t("notConfigured")}</p>
  );
  if (balances.length === 0 && !portfolio.isStale) return null;

  const settle = async (entry: (typeof balances)[number]) => {
    if (
      !holder ||
      !holderKey ||
      pendingByHolder[holderKey] ||
      !entry.pool ||
      !publicClient ||
      entry.expectedPayoutRaw === undefined
    ) return;
    // Preserve each wallet's pending operation across A -> B -> A switches.
    // An old completion must not clear another operation or notify its holder.
    const operation = { shareId: entry.shareId };
    setPendingByHolder((current) => ({ ...current, [holderKey]: operation }));
    setSettlementProblem(undefined);
    let submitted = false;
    let reverted = false;
    try {
      if (entry.expectedPayoutRaw === 0n) return;
      const hash = await settlement.redeem({
        asset: entry.pool.asset,
        shares: entry.shares,
        minRawOut: applySlippageFloor(entry.expectedPayoutRaw),
      });
      submitted = true;
      const receipt = await waitForAppTransactionReceipt(publicClient, { hash });
      if (receipt.status !== "success") {
        reverted = true;
        throw new Error("Settlement transaction reverted");
      }
      if (activeHolder.current !== holderKey) return;
      await portfolio.refetch();
      if (activeHolder.current !== holderKey) return;
      toast.success(t("redeemed"));
    } catch (cause) {
      if (activeHolder.current !== holderKey) return;
      console.error("Recovery-share redemption failed", cause);
      const message = t(reverted ? "revertedDescription" : submitted ? "unconfirmedDescription" : "failedDescription");
      setSettlementProblem({ holder: holder.toLowerCase(), shareId: entry.shareId, message });
      toast.error(t(reverted ? "reverted" : submitted ? "unconfirmed" : "failed"), { description: message });
    } finally {
      setPendingByHolder((current) => {
        if (current[holderKey] !== operation) return current;
        const remaining = { ...current };
        delete remaining[holderKey];
        return remaining;
      });
    }
  };

  return (
    <section className="mt-4 border-t border-swap-container-border pt-4 text-xs text-text-muted">
      <h3 className="font-semibold text-text-input">{t("title")}</h3>
      {portfolio.isStale && <p role="status" className="mt-2 text-text-amber">{t("stale")}</p>}
      {portfolio.data.corePaused && <p className="mt-2 text-text-amber">{t("paused")}</p>}
      <p className="mt-1">{t("description")}</p>
      <div className="mt-3 space-y-3">
        {balances.map((entry) => {
          const pool = entry.pool;
          const fundOffer = entry.fundOffer;
          const token = displayTokens.find(token => token.type === "erc20" && token.address.toLowerCase() === pool?.asset.toLowerCase());
          const assetLabel = token?.symbol ?? (pool ? shorten(pool.asset) : t("unknownAsset"));
          const canSettle =
            pool !== null &&
            !portfolio.data.corePaused &&
            !portfolio.isStale &&
            pool.custody.liveBalanceAvailable &&
            entry.shares > 0n &&
            entry.expectedPayoutRaw !== undefined &&
            entry.expectedPayoutRaw > 0n;
          return (
            <div key={entry.shareId} className="rounded-xl border border-swap-container-border bg-background-input p-3">
              <p className="font-semibold text-text-input">{assetLabel}</p>
              <p className="mt-1 text-text-input">{t("balance", { amount: format(entry.shares, pool.shareDecimals) })}</p>
              <div className="mt-2 flex justify-between gap-3">
                <span>{t("payout")}</span>
                <span className="font-medium text-text-input">
                  {entry.expectedPayoutRaw !== undefined
                    ? `${format(entry.expectedPayoutRaw, pool.shareDecimals)} ${token?.symbol ?? t("underlyingTokens")}`
                    : t("payoutUnavailable")}
                </span>
              </div>
              {fundOffer?.available && (
                <p className="mt-2">{fundOffer.governancePaused ? t("fundPaused") : t("fundOffer", {
                  shares: format(BigInt(fundOffer.acceptedShares), pool.shareDecimals),
                  amount: format(BigInt(fundOffer.cygldAmount), 18),
                })}</p>
              )}
              {canSettle && (
                <button type="button"
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gold-cg px-3 py-2 font-semibold text-black disabled:opacity-60"
                  disabled={pendingShareId !== undefined} aria-busy={pendingShareId === entry.shareId}
                  onClick={() => void settle(entry)}>
                  {pendingShareId === entry.shareId && <Spinner aria-hidden="true" role={undefined} aria-label={undefined} className="size-3" />}
                  {t("redeem")}
                </button>
              )}
              {settlementProblem?.holder === holder.toLowerCase() && settlementProblem.shareId === entry.shareId && (
                <p role="status" className="mt-2 text-text-amber">{settlementProblem.message}</p>
              )}
              {pool && entry.shares > 0n && entry.expectedPayoutRaw === 0n && (
                <p className="mt-2">{t("zeroPayout")}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
