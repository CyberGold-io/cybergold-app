import type { Page, Request } from "@playwright/test";

/** Only already-mined receipts from this owner's submission interval contribute gas. */
export function ownedReceiptGas(value: unknown, owner: string): { hash: string; paid: bigint } | undefined {
  if (!value || typeof value !== "object") return;
  const receipt = (value as { receipt?: unknown }).receipt;
  if (!receipt || typeof receipt !== "object") return;
  const row = receipt as Record<string, unknown>;
  if (typeof row.from !== "string" || row.from.toLowerCase() !== owner.toLowerCase()
    || typeof row.transactionHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(row.transactionHash)
    || !["0x1", "0x0", "success", "reverted"].includes(String(row.status))) return;
  const quantity = (value: unknown) => typeof value === "string" && /^(?:0x[0-9a-f]+|0|[1-9][0-9]*)$/i.test(value) ? BigInt(value) : undefined;
  const gas = quantity(row.gasUsed), price = quantity(row.effectiveGasPrice);
  if (gas === undefined || price === undefined) return;
  return { hash: row.transactionHash.toLowerCase(), paid: gas * price };
}

/** Observe ordinary App receipt reads; requests, responses and wallet calls are unchanged. */
export function observeUiGas(page: Page, owner: string) {
  let epoch = 0, collecting = false;
  const requests = new WeakMap<Request, number>(), entries = new Map<string, bigint>();
  const pending = new Set<Promise<void>>();
  const record = (value: unknown) => { const gas = ownedReceiptGas(value, owner); if (gas) entries.set(gas.hash, gas.paid); };
  page.on("request", request => {
    if (collecting && new URL(request.url()).pathname === "/api/transaction/wait/receipt") requests.set(request, epoch);
  });
  page.on("response", response => {
    const requestedEpoch = requests.get(response.request());
    if (requestedEpoch !== epoch || requestedEpoch === undefined || !response.ok()) return;
    const task = response.json().then(value => { if (requestedEpoch === epoch) record(value); }).catch(() => { /* Missing evidence cannot fabricate zero gas. */ });
    pending.add(task); void task.finally(() => pending.delete(task));
  });
  return {
    begin() { epoch++; entries.clear(); collecting = true; },
    record,
    async finish() {
      collecting = false; await Promise.allSettled([...pending]);
      return { paid: [...entries.values()].reduce((sum, value) => sum + value, 0n), hashes: [...entries.keys()] };
    },
  };
}
