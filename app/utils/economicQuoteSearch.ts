import type { QueryClient } from "@tanstack/react-query";
import { fetchEconomicQuoteStream, type EconomicQuote, type EconomicQuoteEvent, type EconomicRequest } from "./economicQuotes.ts";
import { diagnosticReferences, retainDiagnosticReferences } from "./diagnosticReferences.ts";

type Key = readonly unknown[];
type Context = EconomicQuote["context"];
type Snapshot = { value?: EconomicQuote; error?: Error; optimizing: boolean; invalidated: boolean; historical: boolean; stopped: boolean; settled: boolean };
const sameContext = (left: Context, right: Context) => left.chainId === right.chainId &&
  (left.blockHash !== null && right.blockHash !== null
    ? left.blockHash.toLowerCase() === right.blockHash.toLowerCase()
    : left.blockHash === right.blockHash && left.observedAt === right.observedAt);

/** The Backend selects quotes; this owner retains only its current display/capture. */
export function createEconomicQuoteSearch(client: QueryClient, key: Key) {
  const listeners = new Set<() => void>();
  let accepted: EconomicQuote | undefined;
  let snapshot: Snapshot = { optimizing: false, invalidated: false, historical: false, stopped: false, settled: false };
  let active: object | undefined;
  const notify = (changes: Partial<Snapshot>) => {
    snapshot = { ...snapshot, ...changes, value: accepted };
    listeners.forEach(listener => listener());
  };
  const stop = (keepStopped = false) => {
    active = undefined;
    notify({ optimizing: false, ...(keepStopped ? { stopped: true } : {}) });
    // Advance ownership before abort: a queued frame cannot replace a click's
    // captured selection. QueryClient rollback cannot change this owner's tuple.
    void client.cancelQueries({ queryKey: key, exact: true });
  };
  return {
    subscribe: (changed: () => void) => { listeners.add(changed); return () => { listeners.delete(changed); }; },
    snapshot: () => snapshot,
    current: () => accepted,
    stop,
    async run(request: EconomicRequest, signal: AbortSignal, refresh = false, fetchImpl: typeof fetch = fetch) {
      const attempt = {};
      active = attempt;
      notify({ error: undefined, optimizing: true, stopped: false, settled: false });
      const owns = () => active === attempt && !signal.aborted;
      const receive = (value: EconomicQuote) => {
        if (!owns()) return;
        // The Backend has selected the complete tuple already.
        accepted = structuredClone(value); retainDiagnosticReferences(accepted, diagnosticReferences(value));
        notify({ invalidated: false, historical: value.observation?.source === "stored" });
      };
      const onEvent = (event: Extract<EconomicQuoteEvent, { type: "qualified" | "invalidated" | "upper-replay-settled" }>) => {
        if (!owns()) return;
        if (event.type === "qualified") receive(event.value);
        else if (event.type === "invalidated") {
          if (accepted && sameContext(accepted.context, event.context)) {
            accepted = undefined;
          }
          if (!accepted) notify({ invalidated: true });
        }
      };
      try {
        const completed = await fetchEconomicQuoteStream(request, signal, onEvent, refresh, fetchImpl);
        if (!owns()) throw new DOMException("Search stopped", "AbortError");
        // The terminal selection is authoritative too, including metadata-only
        // changes. Avoid notifying twice for an identical terminal snapshot.
        if (!accepted || JSON.stringify(completed) !== JSON.stringify(accepted) ||
          JSON.stringify(diagnosticReferences(completed)) !== JSON.stringify(diagnosticReferences(accepted))) receive(completed);
        return accepted!;
      } catch (error) {
        if (owns()) {
          notify({ error: error instanceof Error ? error : new Error("Quote stream failed.") });
        }
        throw error;
      } finally {
        if (active === attempt) {
          active = undefined; notify({ optimizing: false, settled: true });
        }
      }
    },
  };
}
