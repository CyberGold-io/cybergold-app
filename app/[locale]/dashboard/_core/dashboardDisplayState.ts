import type { RecoveryOverview } from "./panels/RecoveryOverviewPanel";

export type DashboardOnchainSummary = {
    enabled: boolean;
    protocolLogicUpdate: { timestampMs: number; txHash: string | null } | null;
    protocolParameterUpdate: { timestampMs: number; txHash: string | null } | null;
    chainHeadBlock?: string | null;
    chainHeadTimestampMs?: number | null;
    snapshotBlock?: string | null;
    lastScannedBlock?: string | null;
    metrics?: {
        currentTotalSupplyCygld: number | null;
        netIssuance24hCygld: number | null;
        holderCount?: number | null;
        issuanceFeePercent: number | null;
        redemptionFeePercent: number | null;
        paused: boolean | null;
    };
    basket?: {
        reserveAddress: string | null;
        cygldRefGrams: number | null;
        cygldRefGramsFp18: string | null;
        withinBand: boolean | null;
        assets: Array<{
            address: string;
            symbol: string;
            targetPercent: number;
            actualPercent: number;
            driftPercent: number;
            decimals: number | null;
            reserveBalance: number | null;
            reserveBalanceRaw: string;
            totalSupply: number | null;
            totalSupplyRaw: string | null;
            goldRefGrams: number | null;
            cygldPerUnitFp18: string;
            cygldPerToken: number | null;
        }>;
    } | null;
    recovery?: RecoveryOverview | null;
    series?: Record<
        PegRange,
        Array<{
            bucketStartMs: number;
            mintCygld: number;
            redeemCygld: number;
            netCygld: number;
            supplyCygld: number;
            transferredCygld: number;
            transferTxCount: number;
        }>
    >;
};

type PegRange = "24H" | "7D" | "1M";

export const dashboardSummaryDisplayKey = (chainId: string) => `cg:dashboard-summary-display:v1:${chainId}`;
export const dashboardExpandedAssetKey = "cg:dashboard-expanded-asset:v1";

/** Public dashboard observations are presentation only; no action consumes this cache. */
export function parseDashboardDisplaySummary(value: unknown): DashboardOnchainSummary | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const summary = value as Partial<DashboardOnchainSummary>;
    if (typeof summary.enabled !== "boolean") return;
    if (summary.basket != null && !Array.isArray(summary.basket.assets)) return;
    if (summary.series != null && ["24H", "7D", "1M"].some(range => !Array.isArray(summary.series?.[range as PegRange]))) return;
    // Reject malformed storage before the display reaches chart/formatting code.
    const finiteJson = (entry: unknown): boolean => entry == null || typeof entry === "string" || typeof entry === "boolean"
        || (typeof entry === "number" && Number.isFinite(entry))
        || (Array.isArray(entry) ? entry.every(finiteJson)
            : typeof entry === "object" && Object.values(entry).every(finiteJson));
    return finiteJson(summary) ? summary as DashboardOnchainSummary : undefined;
}
