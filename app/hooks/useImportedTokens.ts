"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useProtocolConfiguration } from "../context/protocolConfigurationContext";
import type { Address } from "viem";
import { targetChainId } from "../config/chain";
import type { erc20Token } from "../config/tokens";
import { fetchTokenMetadata, importedTokenFromMetadata, readImportedTokens, rememberImportedToken } from "../utils/importedTokens";

const empty: erc20Token[] = [];
let current: erc20Token[] | undefined;
const listeners = new Set<() => void>();
function subscribe(changed: () => void) {
  listeners.add(changed);
  return () => { listeners.delete(changed); };
}
function snapshot() { return current ??= readImportedTokens(targetChainId); }

export function useImportedTokens() {
  const { tokens } = useProtocolConfiguration();
  const storedTokens = useSyncExternalStore(subscribe, snapshot, () => empty);
  const importedTokens = useMemo(() => storedTokens.filter(imported => !tokens.some(token => token.type === "erc20"
    && token.address.toLowerCase() === imported.address.toLowerCase())), [storedTokens, tokens]);
  const importToken = useCallback(async (address: Address, holder?: Address, signal?: AbortSignal) => {
    const observation = await fetchTokenMetadata(address, holder, signal);
    signal?.throwIfAborted();
    const token = importedTokenFromMetadata(observation, tokens);
    if (token?.imported) {
      rememberImportedToken(observation);
      current = [...snapshot().filter(entry => entry.id !== token.id), token];
      listeners.forEach(changed => changed());
    }
    return { token, observation };
  }, [tokens]);
  return { importedTokens, importToken };
}
