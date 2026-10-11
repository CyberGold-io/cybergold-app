import type { components } from "../contracts/backend/http";

export type ChainHead = components["schemas"]["ReceiptWaitHead"];
export const HEAD_REFRESH_QUERIES = ["protocol-facts", "basket-preview", "token-preview", "transaction-fees", "core-recovery-assets"];

/** Slot time schedules a read; only the returned hash establishes a change. */
export function createHeadSchedule(chainId: number) {
  let hash: string | undefined, boundary = 0, attempts = 0;
  return (head: ChainHead | undefined, now = Date.now()) => {
    if (chainId !== 1) return 1_000; // Fork automining has no Mainnet slot clock.
    if (head && head.blockHash !== hash) {
      hash = head.blockHash;
      boundary = Number(head.blockTimestamp) * 1_000 + 12_000 + 250;
      attempts = 0;
      if (boundary > now) return Math.min(12_000, boundary - now);
    }
    attempts++;
    if (attempts < 4) return 1_000;
    attempts = 0;
    boundary = boundary ? boundary + 12_000 : now + 12_000;
    while (boundary <= now) boundary += 12_000;
    return Math.min(12_000, boundary - now);
  };
}

export async function fetchChainHead(signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ChainHead> {
  const response = await fetchImpl("/api/transaction/wait/head", { cache: "no-store", signal });
  if (!response.ok) throw new Error("Chain head observation is temporarily unavailable.");
  return response.json();
}

type Listener = (head: ChainHead, previous?: ChainHead) => void;

export function createHeadWatcher(chainId: number, fetchImpl: typeof fetch = fetch) {
  const listeners = new Set<Listener>();
  let head: ChainHead | undefined, failed = false, running = false;
  let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let schedule = createHeadSchedule(chainId);

  async function probe() {
    if (!running) return;
    const current = new AbortController();
    controller = current;
    try {
      const value = await fetchChainHead(AbortSignal.any([current.signal, AbortSignal.timeout(20_000)]), fetchImpl);
      if (current.signal.aborted) return;
      failed = false;
      const previous = head;
      head = value;
      if (previous?.blockHash !== value.blockHash) {
        for (const listener of listeners) listener(value, previous);
      }
    } catch {
      if (current.signal.aborted) return;
      failed = true;
    }
    if (running) timer = setTimeout(() => { void probe(); }, schedule(head));
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    controller?.abort();
  }

  function resume() {
    stop();
    if (!listeners.size || (typeof document !== "undefined" && document.hidden)) return;
    schedule = createHeadSchedule(chainId);
    running = true;
    void probe();
  }

  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", resume);
        if (typeof window !== "undefined") window.addEventListener("pageshow", resume);
        resume();
      }
      if (head) listener(head);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          stop();
          if (typeof document !== "undefined") document.removeEventListener("visibilitychange", resume);
          if (typeof window !== "undefined") window.removeEventListener("pageshow", resume);
        }
      };
    },
    // The standard receipt waiter can consume the active observation instead
    // of issuing its own duplicate head read. Inactive/error paths read fresh.
    read: (signal?: AbortSignal) => running && !failed && head ? Promise.resolve(head) :
      fetchChainHead(signal ?? AbortSignal.timeout(20_000), fetchImpl),
  };
}

const watchers = new WeakMap<typeof fetch, Map<number, ReturnType<typeof createHeadWatcher>>>();
export function getHeadWatcher(chainId: number, fetchImpl: typeof fetch = fetch) {
  let byChain = watchers.get(fetchImpl);
  if (!byChain) { byChain = new Map(); watchers.set(fetchImpl, byChain); }
  let watcher = byChain.get(chainId);
  if (!watcher) { watcher = createHeadWatcher(chainId, fetchImpl); byChain.set(chainId, watcher); }
  return watcher;
}
