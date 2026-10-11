"use client";

import { reserveLifecycleLabel } from "@/app/utils/recovery";
import { formatUnits } from "viem";
import type { components } from "@/app/contracts/backend/http";
type RecoveryFundSnapshot = components["schemas"]["RecoveryFundSnapshot"];
type PortfolioPool = components["schemas"]["PortfolioPool"];

export type RecoveryOverview = {
  collection: string;
  pools: PortfolioPool[];
  reserveLifecycles: Array<{
    asset: string;
    lifecycle: number;
    exitEntitlementRaw: string;
  }>;
  fund: RecoveryFundSnapshot;
};

function shorten(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function shares(raw: string, pool: PortfolioPool) {
  return pool.shareDecimals === undefined ? `${raw} raw shares` : `${formatUnits(BigInt(raw), pool.shareDecimals)} shares`;
}

function fundShares(raw: string, asset: string, pools: PortfolioPool[]) {
  const pool = pools.find((entry) => entry.asset.toLowerCase() === asset.toLowerCase());
  return pool ? shares(raw, pool) : `${raw} raw shares`;
}

export function RecoveryOverviewPanel({
  recovery,
  t,
}: {
  recovery: RecoveryOverview | null;
  t: (key: string) => string;
}) {
  if (!recovery) {
    return (
      <section className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
        <h3 className="font-semibold">{t("recoveryStateUnavailableTitle")}</h3>
        <p className="mt-1">{t("recoveryStateUnavailableDescription")}</p>
      </section>
    );
  }

  const relevantLifecycles = recovery.reserveLifecycles.filter(
    (reserve) => reserve.lifecycle !== 1
  );
  if (
    recovery.pools.length === 0 &&
    relevantLifecycles.length === 0 &&
    !recovery.fund.configured
  ) {
    return null;
  }

  return (
    <section className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
      <div>
        <h3 className="font-semibold">{t("pooledRecoveryOverview")}</h3>
        <p className="mt-1 max-w-3xl text-xs">{t("pooledRecoveryRiskDisclosure")}</p>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-2 text-xs">
        <div>
          <dt>{t("recoveryShareCollection")}</dt>
          <dd className="font-mono font-semibold" title={recovery.collection}>
            {shorten(recovery.collection)}
          </dd>
        </div>
      </dl>

      {recovery.pools.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {recovery.pools.map((pool) => (
            <article
              key={pool.asset}
              className="rounded-lg border border-current/20 bg-white/50 p-3 dark:bg-black/10"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-semibold">
                  {t("recoveryPool")} · {shorten(pool.asset)}
                </h4>
                <span className="text-right text-xs">
                  {pool.impaired ? "Impaired · live capped payout" : "Rehabilitated · reserved payout"} · {reserveLifecycleLabel(pool.lifecycle.lifecycle)}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                <div>
                  <dt className="inline">{t("totalPoolShares")}: </dt>
                  <dd className="inline font-mono font-semibold">{shares(pool.totalShares, pool)}</dd>
                </div>
                <div>
                  <dt className="inline">{t("coreAttachedShares")}: </dt>
                  <dd className="inline font-mono font-semibold">{shares(pool.coreAttachedShares, pool)}</dd>
                </div>
                <div>
                  <dt className="inline">{t("externalShares")}: </dt>
                  <dd className="inline font-mono font-semibold">{shares(pool.externalShares, pool)}</dd>
                </div>
                <div>
                  <dt className="inline">{t("poolLiabilityRaw")}: </dt>
                  <dd className="inline font-mono font-semibold">{pool.impaired ? "Dynamic custody allocation; no fixed reservation" : pool.redeemableRaw}</dd>
                </div>
                <div>
                  <dt className="inline">{t("liveCustodyRaw")}: </dt>
                  <dd className="inline font-mono font-semibold">
                    {pool.custody.liveBalanceAvailable
                      ? pool.custody.liveRawCustody
                      : t("custodyUnavailable")}
                  </dd>
                </div>
                <div>
                  <dt className="inline">{t("activeAvailableRaw")}: </dt>
                  <dd className="inline font-mono font-semibold">
                    {pool.lifecycle.lifecycle === 1
                      ? pool.custody.liveBalanceAvailable ? pool.custody.activeAvailableRaw : t("custodyUnavailable")
                      : t("notActive")}
                  </dd>
                </div>
                <div>
                  <dt className="inline">{t("custodyDeficit")}: </dt>
                  <dd className="inline font-mono font-semibold">{pool.custody.poolRawDeficit}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : null}

      {relevantLifecycles.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-xs font-semibold">{t("reserveLifecycleStates")}</h4>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {relevantLifecycles.map((reserve) => (
              <span
                key={reserve.asset}
                className="rounded-full border border-current/30 px-2.5 py-1 font-mono"
                title={reserve.asset}
              >
                {shorten(reserve.asset)} · {reserveLifecycleLabel(reserve.lifecycle)} · exit {reserve.exitEntitlementRaw}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {recovery.pools.length > 0 || recovery.fund.configured ? (
        <div className="mt-4 border-t border-current/20 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="font-semibold">{t("recoveryFundTitle")}</h4>
              <p className="mt-1 max-w-3xl text-xs">{t("recoveryFundDisclosure")}</p>
            </div>
            {recovery.fund.available ? (
              <span className="rounded-full border border-current px-2.5 py-1 text-xs font-semibold">
                {recovery.fund.governancePaused
                  ? t("recoveryFundGovernancePaused")
                  : t("recoveryFundGovernanceUnpaused")}
              </span>
            ) : null}
          </div>

          {!recovery.fund.available ? (
            <div className="mt-3 rounded-lg border border-red-400/60 bg-red-50/80 p-3 text-xs text-red-900 dark:bg-red-950/20 dark:text-red-100">
              <p className="font-semibold">
                {recovery.fund.reason === "not-configured"
                  ? t("recoveryFundNotConfigured")
                  : t("recoveryFundUnavailable")}
              </p>
              {recovery.fund.problem ? (
                <p className="mt-1 break-words font-mono">{recovery.fund.problem}</p>
              ) : null}
            </div>
          ) : (
            <>
              {recovery.fund.treasury ? (
                <dl className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-current/20 bg-white/50 p-3 text-xs sm:grid-cols-3 dark:bg-black/10">
                  <div>
                    <dt>CYGLD balance / allowance exposure</dt>
                    <dd className="font-mono font-semibold">
                      {recovery.fund.treasury.balance} / {recovery.fund.treasury.allowanceExposure}
                    </dd>
                  </div>
                  <div>
                    <dt>Current commitments / free CYGLD</dt>
                    <dd className="font-mono font-semibold">
                      {recovery.fund.treasury.aggregateCommitment} / {recovery.fund.treasury.available}
                    </dd>
                  </div>
                  <div>
                    <dt>Commitment deficit</dt>
                    <dd className="font-mono font-semibold">{recovery.fund.treasury.deficit}</dd>
                  </div>
                </dl>
              ) : null}

              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {recovery.fund.funds.map((fund) => (
                  <article
                    key={fund.impairedAsset}
                    className="rounded-lg border border-current/20 bg-white/50 p-3 dark:bg-black/10"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h5 className="font-semibold">{shorten(fund.impairedAsset)}</h5>
                      <span>Generation {fund.generation} · {fund.active ? "Active" : "Inactive"}</span>
                    </div>
                    <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="inline">Coverage / purchased / remaining: </dt>
                        <dd className="inline font-mono font-semibold">
                          {fundShares(fund.coverageShares, fund.impairedAsset, recovery.pools)} / {fundShares(fund.purchasedShares, fund.impairedAsset, recovery.pools)} / {fundShares(fund.remainingCoverageShares, fund.impairedAsset, recovery.pools)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline">Initial / paid / remaining CYGLD base units: </dt>
                        <dd className="inline font-mono font-semibold">
                          {fund.initialCygldCommitment} / {fund.paidCygld} / {fund.remainingCygldCommitment}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline">Governance live acquired inventory: </dt>
                        <dd className="inline font-mono font-semibold">
                          {fundShares(fund.acquiredShares, fund.impairedAsset, recovery.pools)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline">Uncovered / currently unfunded: </dt>
                        <dd className="inline font-mono font-semibold">
                          {fundShares(fund.uncoveredInterest, fund.impairedAsset, recovery.pools)} / {fundShares(fund.currentlyUnfundedInterest, fund.impairedAsset, recovery.pools)}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs">
                      Current remaining-capacity preview: {fund.purchasePreview
                        ? `${fundShares(fund.purchasePreview.shares, fund.impairedAsset, recovery.pools)} → ${fund.purchasePreview.cygldAmount} CYGLD base units`
                        : "not currently available"}.
                    </p>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
