import { diagnosticReferences, safeDiagnosticReferences, type DiagnosticReferences } from "./diagnosticReferences.ts";
import { backendHttpMetadata } from "./httpObservation.ts";

export const QUOTE_LATENCY_EVENT = "cybergold:quote-latency";
type Phase = "input" | "dispatch" | "headers" | "first-body" | "first-frame" | "first-selected" | "selected" | "finished" | "display" | "display-full" | "long-task" | "long-task-coverage";
export type QuoteLatencyEvent = DiagnosticReferences & {
  phase: Phase; atMs: number; elapsedMs: number; origin: "stream" | "input" | "refresh" | "navigation" | "browser";
  outcome?: "succeeded" | "cancelled" | "failed"; source?: "stored" | "search";
  backendRevision?: string; serverTiming?: ReturnType<typeof backendHttpMetadata>["serverTiming"];
  editId?: number; limited?: boolean; selectionSequence?: number; eventType?: "qualified" | "complete";
  selectedInputAmounts?: string[]; requestedInputAmounts?: string[]; quotedOutput?: string;
  producerMetrics?: Partial<Record<"totalMs" | "firstQualifiedMs" | "selectionMs" | "canonicalCompletedMs" | "timeToFirstWholePlanMs", number>>;
  inputLimitObserved?: boolean; readAtMs?: number; parsedAtMs?: number;
  supported?: boolean; startMs?: number; endMs?: number; durationMs?: number;
};

/** Page-local timing only. It neither sends telemetry nor changes quote state. */
export function emitQuoteLatency(event: QuoteLatencyEvent) {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(QUOTE_LATENCY_EVENT, { detail: structuredClone(event) }));
  } catch { /* Observation cannot interrupt dispatch, parsing or rendering. */ }
  try {
    if (typeof window !== "undefined") console.info(`${QUOTE_LATENCY_EVENT} ${JSON.stringify(event)}`);
  } catch { /* Console and local event observers fail independently. */ }
}

function now(): number | undefined {
  try { const value = performance.now(); return Number.isFinite(value) ? value : undefined; }
  catch { return undefined; }
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function amount(value: unknown): string | undefined {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.exec(value)?.[0] === value && BigInt(value) < 2n ** 256n ? value : undefined;
}
function amounts(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return;
  const rows = value.map(row => amount(record(row)?.amount));
  return rows.every((row): row is string => row !== undefined) ? rows : undefined;
}
function producerMetrics(value: unknown): QuoteLatencyEvent["producerMetrics"] {
  const source = record(value), result: NonNullable<QuoteLatencyEvent["producerMetrics"]> = {};
  for (const name of ["totalMs", "firstQualifiedMs", "selectionMs", "canonicalCompletedMs", "timeToFirstWholePlanMs"] as const) {
    const metric = source?.[name];
    if (typeof metric === "number" && Number.isFinite(metric)) result[name] = metric;
  }
  return Object.keys(result).length ? result : undefined;
}

export function createQuoteStreamTiming(attemptId?: string) {
  const started = now();
  let selectionSequence = 0;
  const seen = new Set<Phase>();
  let metadata: DiagnosticReferences & ReturnType<typeof backendHttpMetadata> = safeDiagnosticReferences({ attemptId });
  const mark = (phase: Phase, extra: Partial<QuoteLatencyEvent> = {}) => {
    try {
      if (started === undefined) return;
      if (seen.has(phase)) return;
      seen.add(phase);
      const now = performance.now();
      emitQuoteLatency({ ...metadata, ...extra, phase, atMs: now, elapsedMs: now - started, origin: "stream" });
    } catch { /* Optional diagnostic clock/observer. */ }
  };
  return {
    mark, now,
    selected(value: unknown, eventType: "qualified" | "complete", transport: { readAtMs?: number; parsedAtMs?: number } = {}) {
      try {
        const atMs = now();
        if (started === undefined || atMs === undefined) return;
        const quote = record(value), observation = record(quote?.observation), sample = record(quote?.reuseSample);
        const selectedInputAmounts = amounts(quote?.inputs), requestedInputAmounts = amounts(record(quote?.request)?.inputs);
        const quotedOutput = amount(quote?.quotedOutput), metrics = producerMetrics(quote?.metrics);
        const source = observation?.source === "stored" || observation?.source === "search" ? observation.source : undefined;
        emitQuoteLatency({ ...metadata, ...diagnosticReferences(value), phase: "selected", eventType,
          selectionSequence: ++selectionSequence, atMs, elapsedMs: atMs - started, origin: "stream",
          ...(selectedInputAmounts ? { selectedInputAmounts } : {}), ...(requestedInputAmounts ? { requestedInputAmounts } : {}),
          ...(quotedOutput !== undefined ? { quotedOutput } : {}), ...(source ? { source } : {}),
          ...(metrics ? { producerMetrics: metrics } : {}),
          ...(typeof sample?.inputLimitObserved === "boolean" ? { inputLimitObserved: sample.inputLimitObserved } : {}),
          ...(typeof transport.readAtMs === "number" && Number.isFinite(transport.readAtMs) ? { readAtMs: transport.readAtMs } : {}),
          ...(typeof transport.parsedAtMs === "number" && Number.isFinite(transport.parsedAtMs) ? { parsedAtMs: transport.parsedAtMs } : {}) });
      } catch { /* Malformed optional metadata cannot change the selected frame. */ }
    },
    headers(response: Response) {
      try {
        metadata = { ...metadata, ...safeDiagnosticReferences({ requestId: response.headers.get("X-CyberGold-Request-Id") }),
          ...backendHttpMetadata(response.headers) };
        mark("headers");
      } catch { /* Optional transport metadata. */ }
    },
  };
}

/** One input clock, independent of debounce and later result enrichment. */
export function createQuoteDisplayTiming() {
  let started = 0, origin: QuoteLatencyEvent["origin"] = "navigation", displayed = "";
  let displayedFull = false, editId = 0;
  let priorRequest: string | undefined, awaitingRefresh = false;
  return {
    input(refresh = false) {
      try {
        started = performance.now(); origin = refresh ? "refresh" : "input"; displayed = ""; displayedFull = false; editId++;
        awaitingRefresh = refresh;
        emitQuoteLatency({ phase: "input", atMs: started, elapsedMs: 0, origin, editId });
      } catch { /* Optional diagnostic clock. */ }
    },
    display(visible: boolean, references?: DiagnosticReferences, source?: "stored" | "search", full = false) {
      try {
        if (!visible) return;
        const metadata = safeDiagnosticReferences(references);
        if (awaitingRefresh && metadata.requestId === priorRequest) return;
        // A visibility resume can replace the visible request without another
        // edit. Refresh must compare against that current visible owner.
        priorRequest = metadata.requestId;
        const identity = JSON.stringify([metadata, source]);
        if (displayed && (!full || displayedFull)) return;
        awaitingRefresh = false;
        const now = performance.now();
        const event = { ...metadata, source, atMs: now, elapsedMs: now - started, origin, editId, limited: !full };
        if (!displayed) { displayed = identity; emitQuoteLatency({ ...event, phase: "display" }); }
        if (full && !displayedFull) { displayedFull = true; emitQuoteLatency({ ...event, phase: "display-full" }); }
      } catch { /* Optional timing cannot change presentation. */ }
    },
  };
}

/** Passive browser scheduling evidence only, never a quote readiness condition. */
export function observeQuoteLongTasks(): () => void {
  let observer: PerformanceObserver | undefined;
  const coverage = (supported: boolean) => {
    const atMs = now();
    if (atMs !== undefined) emitQuoteLatency({ phase: "long-task-coverage", atMs, elapsedMs: 0, origin: "browser", supported });
  };
  try {
    if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      coverage(false); return () => {};
    }
    observer = new PerformanceObserver(list => {
      try {
        for (const entry of list.getEntries()) {
          const atMs = now(), startMs = entry.startTime, durationMs = entry.duration;
          if (entry.entryType !== "longtask" || atMs === undefined || !Number.isFinite(startMs) || !Number.isFinite(durationMs)) continue;
          emitQuoteLatency({ phase: "long-task", atMs, elapsedMs: durationMs, origin: "browser",
            startMs, endMs: startMs + durationMs, durationMs });
        }
      } catch { /* Observer delivery cannot interrupt page work. */ }
    });
    observer.observe({ type: "longtask", buffered: true }); coverage(true);
  } catch { try { observer?.disconnect(); } catch { /* Optional cleanup. */ } coverage(false); }
  return () => { try { observer?.disconnect(); } catch { /* Optional cleanup. */ } };
}
