export const SANDBOX_FORK_GENERATION_KEY = "cybergold:sandbox-fork-generation:31338";

type ForkStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** Each tab keeps its own last observation; another tab's write cannot hide a reset. */
export function createSandboxForkTracker(storage: ForkStorage) {
  let previous: string | null;
  try { previous = storage.getItem(SANDBOX_FORK_GENERATION_KEY); }
  catch { previous = null; }
  return async (generation: string | null | undefined, reset: () => Promise<void>) => {
    // An absent field (retained backend) or a failed request proves no change.
    if (!generation || generation === previous) return false;
    previous = generation;
    try {
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) {
        if (key?.startsWith("cybergold:governance-safe-executions:31338:") ||
            key?.startsWith("cybergold:governance-safe-nonce:31338:")) storage.removeItem(key);
      }
      storage.setItem(SANDBOX_FORK_GENERATION_KEY, generation);
    } finally {
      await reset();
    }
    return true;
  };
}

/** An old async wallet callback must not restore state after a fork reset. */
export function canPersistForkExecution(chainId: number, generation: string | null | undefined, storage: Pick<Storage, "getItem">) {
  return chainId !== 31338 || (generation ?? null) === storage.getItem(SANDBOX_FORK_GENERATION_KEY);
}

export async function resetSandboxQueries(client: QueryClient) {
  const oldState = { predicate: (entry: { queryKey: readonly unknown[] }) => entry.queryKey[0] !== "sandbox-fork-generation" };
  await client.cancelQueries(oldState);
  client.removeQueries(oldState);
  client.getMutationCache().clear();
}
import type { QueryClient } from "@tanstack/react-query";
