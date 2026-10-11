"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";

import { useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { type erc20Token } from "../config/tokens";
import { targetChainId } from "../config/chain";

import { useSandboxForkGeneration } from "../context/sandboxForkContext";
import { fetchWalletBalances, walletBalanceQuery, walletBalanceRows } from "../utils/walletBalanceSnapshot";
import { useObservedWalletAccount } from "./useObservedWalletAccount";
import { fetchTokenMetadata, type TokenMetadata } from "../utils/importedTokens";
import { usePageVisible } from "./usePageVisible";

const noImports: readonly erc20Token[] = [];
function combineImportedReads(reads: UseQueryResult<TokenMetadata>[]) {
  return { observations: reads.map(read => read.data), isLoading: reads.some(read => read.isLoading),
    isFetching: reads.some(read => read.isFetching), error: reads.find(read => read.error)?.error ?? null };
}

export function useTokenWalletBalances(importedTokens: readonly erc20Token[] = noImports) {
  const { core: CORE_DIAMOND_ADDRESS } = useProtocolConfiguration().addresses;
  const { tokens } = useProtocolConfiguration();
  const spendable = useMemo(() => tokens.filter(token => token.type !== "basket"), [tokens]);
  const client = useQueryClient();
  const { address, isConnected } = useObservedWalletAccount();
  const generation = useSandboxForkGeneration();
  const visible = usePageVisible();
  const options = walletBalanceQuery(isConnected ? address : undefined, targetChainId, CORE_DIAMOND_ADDRESS, generation);
  const query = useQuery({ ...options, enabled: options.enabled && Boolean(CORE_DIAMOND_ADDRESS) });
  const importedOptions = importedTokens.map(token => ({
    queryKey: ["selected-token", targetChainId, token.address, address, generation],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchTokenMetadata(token.address, address, signal, fetch, "balance"),
    enabled: Boolean(isConnected && address && visible), staleTime: 30_000, retry: false as const,
  }));
  const importedReads = useQueries({ queries: importedOptions, combine: combineImportedReads });
  const importedBalances = useMemo(() => importedTokens.flatMap((token, index) => {
    const read = importedReads.observations[index]?.balance;
    return isConnected && read?.status === "success" ? [{ ...token, balance: BigInt(read.value) }] : [];
  }), [importedTokens, importedReads.observations, isConnected]);
  // The backend reads every balance in one Multicall3 snapshot. Keep successful
  // rows visible during refresh or a transport outage; failed entries are unknown.
  const balances = useMemo(() => [...(isConnected ? walletBalanceRows(query.data, spendable) : []), ...importedBalances],
    [isConnected, query.data, spendable, importedBalances]);
  const partialError = useMemo(() => query.data &&
    (query.data.native.status === "failure" || query.data.tokens.some(row => row.balance.status === "failure"))
      ? new Error("Some wallet balances are temporarily unavailable.") : null, [query.data]);
  const importedError = useMemo(() => importedReads.error ??
    (importedReads.observations.some(read => read?.balance?.status === "failure") ? new Error("Some wallet balances are temporarily unavailable.") : null),
    [importedReads.error, importedReads.observations]);
  const error = isConnected ? query.error ?? partialError ?? importedError : null;
  const nonZeroBalances = useMemo(() => balances.filter(row => row.balance > 0n || row.id === "cygld"), [balances]);
  return { balances, nonZeroBalances, isLoading: query.isLoading || importedReads.isLoading,
    isRefreshing: query.isFetching || importedReads.isFetching, isError: Boolean(error), error,
    rpcUnavailable: Boolean(error), refreshWalletBalances: async () => { await Promise.all([query.refetch(), ...importedOptions.map(options => client.fetchQuery({ ...options, staleTime: 0 }))]); },
    // Submission needs the result of a completed read, rather than a cached
    // observer result that can be restored when an account's query is cancelled.
    readWalletBalancesForSwap: async (requiredTokenIds: readonly string[] = []) => {
      const [snapshot, selected] = await Promise.all([
        fetchWalletBalances(address!, undefined, fetch, "swap-preflight"),
        Promise.all(importedTokens.filter(token => requiredTokenIds.includes(token.id)).map(async token => ({
          token, observation: await fetchTokenMetadata(token.address, address, undefined, fetch, "balance"),
        }))),
      ]);
      client.setQueryData(options.queryKey, snapshot);
      return { ...snapshot, tokens: [...snapshot.tokens, ...selected.flatMap(({ token, observation }) => observation.balance
        ? [{ id: token.id, address: token.address, balance: observation.balance }] : [])] };
    } };
}
