import type { components } from "../contracts/backend/http";
import type { QuoteMode, QuoteTarget, RouteQuoteCandidate, RouteSearchProgress } from "../types";

type RouteSearchEvent = components["schemas"]["RouteSearchEvent"];
type RouteSearch = components["schemas"]["RouteSearch"];

type RouteOptions = {
  targets: readonly QuoteTarget[];
  mode: QuoteMode;
  adapter?: string;
  scope?: string;
  signal?: AbortSignal;
  onProgress?: (index: number, progress: RouteSearchProgress) => void;
  onCandidates?: (candidates: (RouteQuoteCandidate | undefined)[]) => void;
  fetchImpl?: typeof fetch;
};
type Values = (RouteQuoteCandidate | undefined)[];
type Subscriber = Pick<RouteOptions, "onProgress" | "onCandidates">;
type Observation = {
  controller: AbortController; subscribers: Set<Subscriber>;
  promise: Promise<Values>; values?: Values; finishedAt?: number;
  candidates?: Values; progress: Map<number, RouteSearchProgress>;
};
const observations = new WeakMap<typeof fetch, Map<string, Observation>>();
let observationEpoch = 0;
export function clearRouteObservations() { observationEpoch++; }
const copyValues = (values: Values) => values.map(value => value ? { ...value } : undefined);

/** Reuse observations independently of adapter calldata/deadline encoding. */
export async function fetchRouteQuotes(options: RouteOptions): Promise<Values> {
  const { scope, signal, fetchImpl = fetch } = options;
  signal?.throwIfAborted();
  if (!scope || options.targets.length === 0) return loadRouteQuotes(options);
  let cache = observations.get(fetchImpl);
  if (!cache) { cache = new Map(); observations.set(fetchImpl, cache); }
  const key = JSON.stringify([observationEpoch, scope, options.mode, options.adapter?.toLowerCase(), !!options.onCandidates, options.targets.map(target =>
    [target.inputAsset.toLowerCase(), target.outputAsset.toLowerCase(), String(target.amount)])]);
  let entry = cache.get(key);
  if (entry?.finishedAt !== undefined && performance.now() - entry.finishedAt >= 10_000) {
    cache.delete(key); entry = undefined;
  }
  if (entry?.values) {
    entry.progress.forEach((value, index) => { signal?.throwIfAborted(); options.onProgress?.(index, value); });
    signal?.throwIfAborted();
    options.onCandidates?.(copyValues(entry.values));
    signal?.throwIfAborted();
    return copyValues(entry.values);
  }
  if (!entry) {
    const controller = new AbortController();
    const record: Observation = { controller, subscribers: new Set(), progress: new Map(), promise: Promise.resolve([]) };
    entry = record;
    cache.set(key, record);
    while (cache.size > 64) cache.delete(cache.keys().next().value!);
    let receivedHash: string | undefined;
    record.promise = Promise.resolve().then(() => loadRouteQuotes({ ...options, signal: controller.signal,
      onCandidates: options.onCandidates ? values => {
        record.candidates = copyValues(values);
        record.subscribers.forEach(subscriber => subscriber.onCandidates?.(copyValues(values)));
      } : undefined,
      onProgress: (index, value) => {
        record.progress.set(index, value);
        record.subscribers.forEach(subscriber => subscriber.onProgress?.(index, value));
      },
    }, hash => { receivedHash = hash; })).then(values => {
      // A quote started at the next head is still a valid fresh result, but
      // cannot be retained under the browser's previous observation identity.
      if (receivedHash?.toLowerCase() === scope.split(":").at(-1)?.toLowerCase()) {
        record.values = copyValues(values); record.finishedAt = performance.now();
      } else if (cache.get(key) === record) cache.delete(key);
      return values;
    }, error => { if (cache.get(key) === record) cache.delete(key); throw error; });
  }
  const record = entry;
  const subscriber: Subscriber = { onProgress: options.onProgress, onCandidates: options.onCandidates };
  record.progress.forEach((value, index) => subscriber.onProgress?.(index, value));
  if (record.candidates) subscriber.onCandidates?.(copyValues(record.candidates));
  record.subscribers.add(subscriber);
  return new Promise<Values>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      record.subscribers.delete(subscriber);
      if (!record.subscribers.size && record.finishedAt === undefined) {
        if (cache.get(key) === record) cache.delete(key);
        record.controller.abort();
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    record.promise.then(values => { cleanup(); resolve(copyValues(values)); }, error => { cleanup(); reject(error); });
  });
}

/** One complete basket search; response order follows the requested targets. */
async function loadRouteQuotes({
  targets, mode, adapter, signal, onProgress, onCandidates, fetchImpl = fetch,
}: RouteOptions, onHash?: (hash: string) => void): Promise<Values> {
  signal?.throwIfAborted();
  if (targets.length === 0) return [];
  const response = await fetchImpl(onCandidates ? "/api/quotes/routes/stream" : "/api/quotes/routes", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal,
    body: JSON.stringify({ mode, ...(adapter === undefined ? {} : { adapter }),
      targets: targets.map(target => ({ ...target, amount: String(target.amount) })) }),
  });
  if (!response.ok) throw new Error("Route search is temporarily unavailable.");
  const value: RouteSearch = onCandidates
    ? await readRouteStream(response, signal, onCandidates, onProgress)
    : await response.json();
  signal?.throwIfAborted();
  onHash?.(value.context?.blockHash);
  return value.results.map((row, index) => {
    onProgress?.(index, { completed: row.attempted, total: row.attempted, percent: 100 });
    return row.best ? { ...row.best, path: row.best.path as `0x${string}`, quote: BigInt(row.best.quote) } : undefined;
  });
}


function candidatesFromRows(rows: RouteSearch["results"]): (RouteQuoteCandidate | undefined)[] {
  return rows.map(row => row.best
    ? { ...row.best, path: row.best.path as `0x${string}`, quote: BigInt(row.best.quote) }
    : undefined);
}

async function readRouteStream(
  response: Response, signal: AbortSignal | undefined,
  onCandidates: (candidates: (RouteQuoteCandidate | undefined)[]) => void,
  onProgress?: (index: number, progress: RouteSearchProgress) => void,
): Promise<RouteSearch> {
  if (!response.body) throw new Error("Route search is temporarily unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "", previous = "";
  const cancel = () => { void reader.cancel(signal?.reason); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      pending += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        signal?.throwIfAborted();
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line.trim()) continue;
        let event: RouteSearchEvent;
        try { event = JSON.parse(line); }
        catch { throw new Error("Route search is temporarily unavailable."); }
        if (event.type === "error") throw new Error("Route search is temporarily unavailable.");
        if (event.type === "complete") return event.value;
        if (event.type === "progress") {
          event.results.forEach((row, index) => onProgress?.(index, {
            completed: row.attempted, total: row.total,
            percent: row.total === 0 ? 100 : Math.round(100 * row.attempted / row.total),
          }));
          signal?.throwIfAborted();
          const identity = JSON.stringify(event.results.map(row => row.best));
          if (identity !== previous) {
            previous = identity;
            onCandidates(candidatesFromRows(event.results));
          }
        }
      }
      if (done) throw new Error("Route search is temporarily unavailable.");
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
