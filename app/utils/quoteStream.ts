import { knownQuoteError, QuotePreviewError, quoteResponseError } from "./quoteErrors.ts";
import { diagnosticAttemptId, diagnosticReferences, quoteDiagnostics, retainDiagnosticReferences } from "./diagnosticReferences.ts";
import { createQuoteStreamTiming } from "./quoteLatency.ts";

type Terminal<Value> = { type: "complete"; value: Value } | { type: "error"; code?: string; error?: string };

/** Core and market streams share transport, while their plans remain distinct. */
export async function fetchQuoteStream<Value, Event extends { type: string }>(
  path: string, request: unknown, signal: AbortSignal, onEvent: (event: Event) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<Value> {
  const attemptId = diagnosticAttemptId();
  const timing = path === "/api/economic-quotes/stream" ? createQuoteStreamTiming(attemptId) : undefined;
  timing?.mark("dispatch");
  const metadata = { attemptId, requestId: undefined as string | undefined };
  const response = await fetchImpl(path, {
    method: "POST", headers: { "Content-Type": "application/json", ...(attemptId ? { "X-CyberGold-Attempt-Id": attemptId } : {}) }, cache: "no-store", signal,
    body: JSON.stringify(request),
  }).catch(error => {
    timing?.mark("finished", { outcome: signal.aborted ? "cancelled" : "failed" });
    if (signal.aborted) throw error;
    throw new QuotePreviewError("quote-service-unavailable", "Quote service connection failed.", metadata);
  });
  metadata.requestId = response.headers.get("X-CyberGold-Request-Id") ?? undefined;
  timing?.headers(response);
  if (!response.ok) {
    timing?.mark("finished", { outcome: "failed" });
    const error = await quoteResponseError(response);
    retainDiagnosticReferences(error, metadata); throw error;
  }
  if (!response.body) { timing?.mark("finished", { outcome: "failed" }); throw new QuotePreviewError("quote-stream-interrupted", "Quote stream interrupted.", metadata); }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "";
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      const readAtMs = timing?.now();
      if (value?.byteLength) timing?.mark("first-body");
      signal.throwIfAborted();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop()!;
      if (done && pending.trim()) { lines.push(pending); pending = ""; }
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as Terminal<Value> | Event;
        const parsedAtMs = timing?.now();
        timing?.mark("first-frame");
        retainDiagnosticReferences(event, { ...metadata, ...diagnosticReferences(event) });
        if (event.type === "error") throw knownQuoteError(event)
          ?? new QuotePreviewError("quote-unavailable", "Quote service failed.", diagnosticReferences(event), quoteDiagnostics(event));
        if ("value" in event) retainDiagnosticReferences(event.value, diagnosticReferences(event));
        if (event.type === "qualified" || event.type === "complete") {
          timing?.mark("first-selected");
          if ("value" in event) timing?.selected(event.value, event.type, { readAtMs, parsedAtMs });
        }
        if (event.type === "complete") { timing?.mark("finished", { outcome: "succeeded" }); return (event as { value: Value }).value; }
        onEvent(event as Event);
        signal.throwIfAborted();
      }
      if (done) throw new QuotePreviewError("quote-stream-interrupted", "Quote stream interrupted.", metadata);
    }
  } catch (error) {
    timing?.mark("finished", { outcome: signal.aborted ? "cancelled" : "failed" });
    if (signal.aborted || error instanceof QuotePreviewError) throw error;
    throw new QuotePreviewError("quote-stream-interrupted", "Quote stream interrupted.", metadata);
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
