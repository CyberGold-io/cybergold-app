import { knownQuoteError, QuotePreviewError, quoteResponseError } from "./quoteErrors.ts";

type Terminal<Value> = { type: "complete"; value: Value } | { type: "error"; code?: string; error?: string };

/** Core and market streams share transport, while their plans remain distinct. */
export async function fetchQuoteStream<Value, Event extends { type: string }>(
  path: string, request: unknown, signal: AbortSignal, onEvent: (event: Event) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<Value> {
  const response = await fetchImpl(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal,
    body: JSON.stringify(request),
  }).catch(error => {
    if (signal.aborted) throw error;
    throw new QuotePreviewError("quote-service-unavailable", "Quote service connection failed.");
  });
  if (!response.ok) throw await quoteResponseError(response);
  if (!response.body) throw new QuotePreviewError("quote-stream-interrupted", "Quote stream interrupted.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "";
  const cancel = () => { void reader.cancel(signal.reason); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop()!;
      if (done && pending.trim()) { lines.push(pending); pending = ""; }
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as Terminal<Value> | Event;
        if (event.type === "error") throw knownQuoteError(event)
          ?? new QuotePreviewError("quote-unavailable", "Quote service failed.");
        if (event.type === "complete") return (event as { value: Value }).value;
        onEvent(event as Event);
        signal.throwIfAborted();
      }
      if (done) throw new QuotePreviewError("quote-stream-interrupted", "Quote stream interrupted.");
    }
  } catch (error) {
    if (signal.aborted || error instanceof QuotePreviewError) throw error;
    throw new QuotePreviewError("quote-stream-interrupted", "Quote stream interrupted.");
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
