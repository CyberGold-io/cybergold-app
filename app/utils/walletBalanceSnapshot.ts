import type { Address } from "viem";
import type { components } from "../contracts/backend/http";

export type WalletBalancesSnapshot = components["schemas"]["WalletBalances"];
type TokenMetadata = { id: string; symbol: string; name: string; decimals: number };

export async function fetchWalletBalances(holder: Address, signal?: AbortSignal, fetchImpl: typeof fetch = fetch, purpose: "display" | "swap-preflight" = "display"): Promise<WalletBalancesSnapshot> {
  const params = new URLSearchParams({ holder, purpose });
  const response = await fetchImpl(`/api/account/wallet-balances?${params}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Wallet balances are temporarily unavailable.");
  return response.json();
}

export function walletBalanceQuery(holder: Address | undefined, chain: number, core: Address | undefined, generation: string | null | undefined) {
  return { queryKey: ["wallet-balances", chain, core, holder, generation],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchWalletBalances(holder!, signal),
    enabled: Boolean(holder), staleTime: 5_000, retry: false as const };
}

export function walletBalanceRows(value: WalletBalancesSnapshot | undefined, tokens: readonly TokenMetadata[]) {
  if (!value) return [];
  return tokens.flatMap(token => {
    const read = token.id === "eth" ? value.native : value.tokens.find(row => row.id === token.id)?.balance;
    return read?.status === "success" ? [{ ...token, balance: BigInt(read.value) }] : [];
  });
}

export function checkSwapWalletBalances(snapshot: Pick<WalletBalancesSnapshot, "native"> & {
  tokens: readonly { id: string; balance: WalletBalancesSnapshot["native"] }[];
},
  required: readonly { tokenId: string; amount: bigint }[]
): { reason: "unavailable" | "insufficient"; tokenId: string } | undefined {
  for (const { tokenId, amount } of required) {
    if (amount <= 0n) continue;
    const read = tokenId === "eth" ? snapshot.native : snapshot.tokens.find(row => row.id === tokenId)?.balance;
    if (read?.status !== "success") return { reason: "unavailable", tokenId };
    if (amount > BigInt(read.value)) return { reason: "insufficient", tokenId };
  }
}
