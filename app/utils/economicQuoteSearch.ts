import type { QueryClient } from "@tanstack/react-query";
import { fetchEconomicQuoteStream, type EconomicQuote, type EconomicQuoteEvent, type EconomicRequest } from "./economicQuotes.ts";
import { diagnosticReferences, retainDiagnosticReferences } from "./diagnosticReferences.ts";
import { QuotePreviewError } from "./quoteErrors.ts";

type Key = readonly unknown[];
type Context = EconomicQuote["context"];
type Snapshot = { value?: EconomicQuote; error?: Error; optimizing: boolean; invalidated: boolean };
const sameContext = (left: Context, right: Context) => left.chainId === right.chainId &&
  left.blockHash.toLowerCase() === right.blockHash.toLowerCase();

/** One hook/request owner. Ready values also live in the ordinary economic cache. */
export function createEconomicQuoteSearch(client: QueryClient, key: Key) {
  const listeners = new Set<() => void>();
  let owner = 0;
  const cached = client.getQueryData<EconomicQuote | null>(key);
  let accepted = cached ?? undefined;
  let snapshot: Snapshot = { value: accepted, optimizing: false, invalidated: cached === null };
  let active: { owner: number; prior?: EconomicQuote; value?: EconomicQuote; disproved?: Context; signal: AbortSignal } | undefined;
  const notify = (changes: Partial<Snapshot>) => {
    snapshot = { ...snapshot, ...changes, value: accepted };
    listeners.forEach(listener => listener());
  };
  const restore = () => {
    // null clears a disproved value. setQueryData(undefined) is deliberately a
    // no-op in QueryClient, and resetQueries would start another search.
    if (accepted || snapshot.invalidated) client.setQueryData<EconomicQuote | null>(key, accepted ?? null);
  };
  const stop = () => {
    ++owner; active = undefined;
    notify({ optimizing: false });
    // Advance ownership before abort: a queued frame cannot replace a click's
    // captured selection. Explicit restoration also owns cancellation rollback.
    void client.cancelQueries({ queryKey: key, exact: true });
    restore();
  };
  return {
    subscribe: (changed: () => void) => { listeners.add(changed); return () => { listeners.delete(changed); }; },
    snapshot: () => snapshot,
    current: () => accepted,
    stop,
    async run(request: EconomicRequest, signal: AbortSignal, refresh = false, fetchImpl: typeof fetch = fetch) {
      // A known disproof is an existing concrete fact, not an age/head rule.
      // Re-entering this empty slot must reprice rather than retrieve the same
      // historical stored tuple that this caller has already disproved.
      const reprice = refresh || client.getQueryData(key) === null;
      const attempt = { owner: ++owner, prior: accepted, signal } as NonNullable<typeof active>;
      active = attempt;
      notify({ error: undefined, optimizing: true });
      const owns = () => active === attempt && owner === attempt.owner && !signal.aborted;
      const publish = (value: EconomicQuote) => {
        if (!owns() || attempt.disproved) return;
        accepted = structuredClone(value); retainDiagnosticReferences(accepted, diagnosticReferences(value)); attempt.value = accepted;
        client.setQueryData<EconomicQuote | null>(key, accepted);
        notify({ invalidated: false });
      };
      const onEvent = (event: Extract<EconomicQuoteEvent, { type: "qualified" | "invalidated" }>) => {
        if (!owns()) return;
        if (event.type === "qualified") publish(event.value);
        else if (event.type === "invalidated") {
          attempt.disproved = event.context;
          if (accepted && sameContext(accepted.context, event.context)) {
            accepted = attempt.prior && !sameContext(attempt.prior.context, event.context) ? attempt.prior : undefined;
          }
          notify({ invalidated: true }); restore();
        }
      };
      try {
        const completed = await fetchEconomicQuoteStream(request, signal, onEvent, reprice, fetchImpl);
        if (!owns()) throw new DOMException("Search stopped", "AbortError");
        if (attempt.disproved) throw new QuotePreviewError("quote-unavailable", "Quote context was disproved.");
        // The Backend emits a qualified frame for terminal reconstruction too.
        // A duplicate/older complete frame cannot replace the ready incumbent.
        if (!attempt.value) publish(completed);
        return accepted ?? completed;
      } catch (error) {
        if (owns()) notify({ error: error instanceof Error ? error : new Error("Quote stream failed.") });
        throw error;
      } finally {
        if (active === attempt && owner === attempt.owner) {
          active = undefined; notify({ optimizing: false });
        }
      }
    },
  };
}
