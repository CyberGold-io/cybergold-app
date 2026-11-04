import "server-only";
import { backendHttpMetadata } from "../utils/httpObservation.ts";
import { diagnosticAttemptId, safeDiagnosticReferences } from "../utils/diagnosticReferences.ts";

type Outcome = "completed" | "cancelled" | "failed";

/** Observe the fixed proxy hop, never its URL, payload, credentials or error text.
 * Body times include downstream consumption/backpressure, not just Backend work.
 */
export function backendTransportObservation(operation: string, method: string, signal: AbortSignal, attemptId?: string) {
  const started = performance.now(), flowId = diagnosticAttemptId();
  let dispatched: number | undefined, headersAt: number | undefined, firstBodyAt: number | undefined;
  let bytes = 0, chunks = 0, finished = false, status: number | undefined;
  let metadata: Record<string, unknown> = {};
  const elapsed = (now: number, since = started) => Math.round((now - since) * 1000) / 1000;
  const log = (phase: string, extra: Record<string, unknown> = {}) => {
    try { console.info(JSON.stringify({ event: "quote_proxy_flow", component: "app", operation, method, flowId, attemptId, ...metadata, phase,
      elapsedMs: elapsed(performance.now()), ...(status !== undefined ? { httpStatus: status } : {}), ...extra })); }
    catch { /* Diagnostics cannot alter response delivery. */ }
  };
  const finish = (outcome: Outcome) => {
    if (finished) return;
    finished = true;
    signal.removeEventListener("abort", aborted);
    const now = performance.now();
    log("finished", { outcome, bytes, chunks,
      ...(dispatched !== undefined ? { dispatchMs: elapsed(dispatched), upstreamHeadersMs: elapsed(headersAt ?? now, dispatched) } : {}),
      ...(headersAt !== undefined ? { bodyMs: elapsed(now, headersAt) } : {}),
      ...(firstBodyAt !== undefined && headersAt !== undefined ? { firstBodyMs: elapsed(firstBodyAt, headersAt) } : {}) });
  };
  const aborted = () => finish("cancelled");
  signal.addEventListener("abort", aborted, { once: true });
  const chunk = (value: Uint8Array) => {
    bytes += value.byteLength; chunks++;
    if (firstBodyAt === undefined) { firstBodyAt = performance.now(); log("first-body-chunk", { bytes: value.byteLength }); }
  };
  return {
    get flowId() { return flowId; },
    dispatch() { dispatched = performance.now(); log("dispatch"); },
    headers(response: Response) {
      headersAt = performance.now(); status = response.status;
      metadata = { ...safeDiagnosticReferences({ requestId: response.headers.get("X-CyberGold-Request-Id") }), ...backendHttpMetadata(response.headers) };
      log("upstream-headers", { upstreamHeadersMs: elapsed(headersAt, dispatched ?? started) });
    },
    handoff() { log("downstream-handoff"); },
    finish,
    buffered(value: ArrayBuffer) { bytes = value.byteLength; log("upstream-body-buffered", { bytes }); },
    stream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
      const reader = body.getReader();
      let cancelled = false;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = await reader.read();
            if (cancelled) return;
            if (result.done) { finish("completed"); controller.close(); reader.releaseLock(); }
            else { chunk(result.value); controller.enqueue(result.value); }
          } catch (error) {
            if (cancelled) return;
            finish(signal.aborted ? "cancelled" : "failed"); controller.error(error); reader.releaseLock();
          }
        },
        async cancel(reason) {
          cancelled = true; finish("cancelled");
          try { await reader.cancel(reason); } finally { reader.releaseLock(); }
        },
      }, { highWaterMark: 0 });
    },
  };
}
