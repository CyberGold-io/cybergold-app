import type { QueryClient } from "@tanstack/react-query";
import { fetchEconomicQuoteStream, type EconomicQuote, type EconomicQuoteEvent, type EconomicRequest } from "./economicQuotes.ts";
import { diagnosticReferences, retainDiagnosticReferences } from "./diagnosticReferences.ts";
import { QuotePreviewError } from "./quoteErrors.ts";

type Key = readonly unknown[];
type Context = EconomicQuote["context"];
type Snapshot = { value?: EconomicQuote; error?: Error; optimizing: boolean; invalidated: boolean };
/** Internal display policy, bound to the existing request/configuration/generation key. */
export type UpperEstimateDisplayPolicy = { requestKey: string; quotedOutput: bigint };
const sameContext = (left: Context, right: Context) => left.chainId === right.chainId &&
  left.blockHash.toLowerCase() === right.blockHash.toLowerCase();

/** One hook/request owner. Ready values also live in the ordinary economic cache. */
export function createEconomicQuoteSearch(client: QueryClient, key: Key) {
  const listeners = new Set<() => void>();
  let owner = 0;
  const cached = client.getQueryData<EconomicQuote | null>(key);
  let accepted = cached ?? undefined;
  let snapshot: Snapshot = { value: accepted, optimizing: false, invalidated: cached === null };
  let active: { owner: number; prior?: EconomicQuote; best?: EconomicQuote; disproved?: Context;
    upper?: bigint; upperSettled: boolean; reconsider?: () => void; signal: AbortSignal } | undefined;
  const requestKey = JSON.stringify(key);
  const matchingUpper = (value?: UpperEstimateDisplayPolicy) => value?.requestKey === requestKey ? value : undefined;
  const setUpperEstimate = (value?: UpperEstimateDisplayPolicy) => {
    if (!accepted && active && !active.upperSettled) {
      // Follow the one displayed matching estimate while no quote is visible.
      // Once accepted, a late model can never retract that visible selection.
      active.upper = matchingUpper(value)?.quotedOutput;
      active.reconsider?.();
    }
  };
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
    setUpperEstimate,
    stop,
    async run(request: EconomicRequest, signal: AbortSignal, refresh = false, fetchImpl: typeof fetch = fetch, upperEstimate?: UpperEstimateDisplayPolicy) {
      // A known disproof is an existing concrete fact, not an age/head rule.
      // Re-entering this empty slot must reprice rather than retrieve the same
      // historical stored tuple that this caller has already disproved.
      const reprice = refresh || client.getQueryData(key) === null;
      const upper = matchingUpper(upperEstimate);
      const attempt = { owner: ++owner, prior: accepted, signal, upperSettled: false,
        upper: accepted ? undefined : upper?.quotedOutput } as NonNullable<typeof active>;
      active = attempt;
      notify({ error: undefined, optimizing: true });
      const owns = () => active === attempt && owner === attempt.owner && !signal.aborted;
      const publish = (value: EconomicQuote) => {
        if (!owns() || attempt.disproved) return;
        accepted = value;
        client.setQueryData<EconomicQuote | null>(key, accepted);
        notify({ invalidated: false });
      };
      const release = () => { if (attempt.best) publish(attempt.best); };
      const reconsider = () => {
        if (attempt.best && (accepted || attempt.upperSettled || attempt.upper === undefined || BigInt(attempt.best.quotedOutput) > attempt.upper))
          release();
      };
      attempt.reconsider = reconsider;
      const receive = (value: EconomicQuote) => {
        if (!owns() || attempt.disproved) return;
        // Qualified frames already use the producer's output/funding ranking.
        // Hidden candidates stay out of query data, nearby reuse and click capture.
        const candidate = structuredClone(value); retainDiagnosticReferences(candidate, diagnosticReferences(value));
        attempt.best = candidate;
        if (value.observation?.source === "stored") attempt.upperSettled = true;
        reconsider();
      };
      const onEvent = (event: Extract<EconomicQuoteEvent, { type: "qualified" | "invalidated" | "upper-replay-settled" }>) => {
        if (!owns()) return;
        if (event.type === "qualified") receive(event.value);
        else if (event.type === "upper-replay-settled") {
          attempt.upperSettled = true; release();
        } else if (event.type === "invalidated") {
          attempt.disproved = event.context;
          if (attempt.best && sameContext(attempt.best.context, event.context)) attempt.best = undefined;
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
        if (!attempt.best) receive(completed);
        attempt.upperSettled = true; release();
        return accepted!;
      } catch (error) {
        if (owns()) {
          if (!attempt.disproved) { attempt.upperSettled = true; release(); }
          notify({ error: error instanceof Error ? error : new Error("Quote stream failed.") });
        }
        throw error;
      } finally {
        if (active === attempt && owner === attempt.owner) {
          active = undefined; notify({ optimizing: false });
        }
      }
    },
  };
}
