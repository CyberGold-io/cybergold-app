import { safeDiagnosticReferences, type DiagnosticReferences } from "./diagnosticReferences.ts";
import { backendHttpMetadata } from "./httpObservation.ts";

export const QUOTE_LATENCY_EVENT = "cybergold:quote-latency";
type Phase = "input" | "dispatch" | "headers" | "first-body" | "first-frame" | "first-selected" | "finished" | "display";
export type QuoteLatencyEvent = DiagnosticReferences & {
  phase: Phase; atMs: number; elapsedMs: number; origin: "stream" | "input" | "refresh" | "navigation";
  outcome?: "succeeded" | "cancelled" | "failed"; source?: "stored" | "search";
  backendRevision?: string; serverTiming?: ReturnType<typeof backendHttpMetadata>["serverTiming"];
};

/** Page-local timing only. It neither sends telemetry nor changes quote state. */
export function emitQuoteLatency(event: QuoteLatencyEvent) {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(QUOTE_LATENCY_EVENT, { detail: structuredClone(event) }));
  } catch { /* Observation cannot interrupt dispatch, parsing or rendering. */ }
}

export function createQuoteStreamTiming(attemptId?: string) {
  let started: number | undefined;
  try { started = performance.now(); } catch { /* Optional diagnostic clock. */ }
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
    mark,
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
  let priorRequest: string | undefined, awaitingRefresh = false;
  return {
    input(refresh = false) {
      try {
        started = performance.now(); origin = refresh ? "refresh" : "input"; displayed = "";
        awaitingRefresh = refresh;
        emitQuoteLatency({ phase: "input", atMs: started, elapsedMs: 0, origin });
      } catch { /* Optional diagnostic clock. */ }
    },
    display(visible: boolean, references?: DiagnosticReferences, source?: "stored" | "search") {
      try {
        if (!visible) return;
        const metadata = safeDiagnosticReferences(references);
        if (awaitingRefresh && metadata.requestId === priorRequest) return;
        const identity = JSON.stringify([metadata, source]);
        if (displayed) return; // First visible validated selection for this edit.
        displayed = identity; priorRequest = metadata.requestId; awaitingRefresh = false;
        const now = performance.now();
        emitQuoteLatency({ ...metadata, source, phase: "display", atMs: now, elapsedMs: now - started, origin });
      } catch { /* Optional timing cannot change presentation. */ }
    },
  };
}
