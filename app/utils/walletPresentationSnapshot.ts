/** Last rendered text only. No connector, authorization, live reads or transaction inputs. */
export type WalletPresentationSnapshot = {
  scopeKey: string;
  address: string;
  label: string;
  networkName: string;
  networkSwitchLabel?: string;
  showFullAddress?: boolean;
  scrollTop?: number;
  rows: { tokenId: string; name: string; symbol: string; amount: string; value: string; importLabel?: string; importState?: "import" | "importing" | "imported" }[];
  liquidity?: { expanded: boolean; values: Record<string, string> };
};

export const walletPresentationStorageKey = (chainId: number, locale: string) =>
  `cybergold:wallet-presentation:v1:${chainId}:${locale}`;

/** Self-contained because the same parser runs before hydration. */
export function parseWalletPresentationSnapshot(value: unknown): WalletPresentationSnapshot | undefined {
  if (!value || typeof value !== "object") return;
  const data = value as WalletPresentationSnapshot;
  if (typeof data.scopeKey !== "string" || typeof data.address !== "string" || typeof data.label !== "string"
    || typeof data.networkName !== "string" || !Array.isArray(data.rows)) return;
  const rows: WalletPresentationSnapshot["rows"] = [];
  for (const row of data.rows) {
    if (!row || [row.tokenId, row.name, row.symbol, row.amount, row.value].some(value => typeof value !== "string")) return;
    rows.push({ tokenId: row.tokenId, name: row.name, symbol: row.symbol, amount: row.amount, value: row.value,
      ...(typeof row.importLabel === "string" ? { importLabel: row.importLabel } : {}),
      ...(["import", "importing", "imported"].includes(row.importState ?? "") ? { importState: row.importState } : {}) });
  }
  let liquidity: WalletPresentationSnapshot["liquidity"];
  if (data.liquidity) {
    if (typeof data.liquidity.expanded !== "boolean" || !data.liquidity.values || typeof data.liquidity.values !== "object"
      || Object.values(data.liquidity.values).some(value => typeof value !== "string")) return;
    liquidity = { expanded: data.liquidity.expanded, values: { ...data.liquidity.values } };
  }
  return { scopeKey: data.scopeKey, address: data.address, label: data.label, networkName: data.networkName, rows,
    ...(typeof data.networkSwitchLabel === "string" ? { networkSwitchLabel: data.networkSwitchLabel } : {}),
    showFullAddress: data.showFullAddress === true,
    scrollTop: typeof data.scrollTop === "number" && Number.isFinite(data.scrollTop) && data.scrollTop >= 0 ? data.scrollTop : 0,
    ...(liquidity ? { liquidity } : {}) };
}
