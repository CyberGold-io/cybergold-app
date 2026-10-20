export type TokenPickerRow = { id: string; name: string; symbol: string; detail: string; address: string; basket: boolean };
export type TokenPickerSnapshot = { query: string; scrollTop: number; selectedId?: string; rows: TokenPickerRow[]; pendingId?: string };
export const tokenPickerOpenStorageKey = "cg:token-picker-open:v1";
export function tokenPickerSnapshotKey(path: string, side: string) { return `cg:token-picker-view:v1:${path}:${side}`; }
/** Primitive presentation only; token eligibility and metadata remain live. */
export function parseTokenPickerSnapshot(value: unknown): TokenPickerSnapshot | undefined {
  if (!value || typeof value !== "object") return;
  const data = value as TokenPickerSnapshot;
  if (typeof data.query !== "string" || !Array.isArray(data.rows)) return;
  const rows: TokenPickerRow[] = [];
  for (const row of data.rows) {
    if (!row || [row.id, row.name, row.symbol, row.detail, row.address].some(value => typeof value !== "string") || typeof row.basket !== "boolean") return;
    rows.push({ id: row.id, name: row.name, symbol: row.symbol, detail: row.detail, address: row.address, basket: row.basket });
  }
  return { query: data.query, rows,
    scrollTop: typeof data.scrollTop === "number" && Number.isFinite(data.scrollTop) && data.scrollTop >= 0 ? data.scrollTop : 0,
    ...(typeof data.selectedId === "string" ? { selectedId: data.selectedId } : {}),
    ...(typeof data.pendingId === "string" ? { pendingId: data.pendingId } : {}) };
}
export function readTokenPickerSnapshot(side: string) {
  try { return parseTokenPickerSnapshot(JSON.parse(sessionStorage.getItem(tokenPickerSnapshotKey(location.pathname, side)) ?? "null")); }
  catch { return undefined; }
}
export function writeTokenPickerSnapshot(side: string, value: TokenPickerSnapshot) {
  try { sessionStorage.setItem(tokenPickerSnapshotKey(location.pathname, side), JSON.stringify(value)); } catch { /* optional presentation */ }
}
