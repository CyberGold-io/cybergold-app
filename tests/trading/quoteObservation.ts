import type { Page } from "@playwright/test";

export type QuoteObservation = {
  path: string; request: Record<string, unknown>; status: number;
  requestId?: string; backendRevision?: string;
  frames?: Record<string, unknown>[]; terminal?: Record<string, unknown>; interrupted?: boolean; aborted?: boolean;
};
type ObservationWindow = Window & typeof globalThis & { __cybergoldTradeObservations?: QuoteObservation[] };

/** Observe the original fetch without changing its request or returned response.
 * The App cancels its stream reader after a terminal frame, so DevTools cannot
 * reliably retrieve that response body. A clone sees the same emitted frames.
 */
export function installQuoteObservation(scope: ObservationWindow = window) {
  const originalFetch = scope.fetch;
  scope.__cybergoldTradeObservations = [];
  scope.fetch = async (...args: Parameters<typeof fetch>) => {
    const operation = originalFetch.apply(scope, args);
    const [input, init] = args;
    const path = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, scope.location.href).pathname;
    if (path !== "/api/quotes/trade/stream" && path !== "/api/quotes/basket-preview") return operation;
    // These App producers submit JSON with RequestInit.body. Other fetches are
    // left untouched, including any wallet, signature or transaction traffic.
    if (typeof init?.body !== "string") return operation;
    let request: Record<string, unknown>;
    try { request = JSON.parse(init.body); } catch { return operation; }
    // Record dispatch order before headers arrive, so an active replacement
    // takes precedence over an interrupted request it superseded.
    const observation: QuoteObservation = { path, request, status: 0 };
    scope.__cybergoldTradeObservations!.push(observation);
    const interrupted = () => {
      observation.interrupted = true;
      observation.aborted = init.signal?.aborted === true;
    };
    let response: Response;
    try { response = await operation; }
    catch (error) { interrupted(); throw error; }
    observation.status = response.status;
    observation.requestId = response.headers.get("X-CyberGold-Request-Id") ?? undefined;
    observation.backendRevision = response.headers.get("X-CyberGold-Backend-Revision") ?? undefined;
    const clone = response.clone();
    void (async () => {
      if (path === "/api/quotes/basket-preview" || !response.ok) {
        const value = await clone.json();
        observation.terminal = response.ok ? { type: "complete", value } : { type: "error", ...value };
        return;
      }
      if (!clone.body) { interrupted(); return; }
      const reader = clone.body.getReader(), decoder = new TextDecoder();
      let pending = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          pending += decoder.decode(value, { stream: !done });
          const lines = pending.split("\n"); pending = lines.pop()!;
          if (done && pending.trim()) { lines.push(pending); pending = ""; }
          for (const line of lines) {
            if (!line.trim()) continue;
            const frame = JSON.parse(line);
            if (["provider-qualified", "provider-assessment", "qualified", "invalidated"].includes(frame.type)) (observation.frames ??= []).push(frame);
            if (frame.type === "complete" || frame.type === "error") {
              observation.terminal = frame; return;
            }
          }
          if (done) { interrupted(); return; }
        }
      } finally {
        // Cancelling this clone after the terminal preserves the App's own
        // producer cancellation; the observer never holds it open for a retry.
        void reader.cancel().catch(() => {}); reader.releaseLock();
      }
    })().catch(interrupted);
    return response;
  };
}

export async function quoteObservations(page: Page): Promise<QuoteObservation[]> {
  return page.evaluate(() => (window as ObservationWindow).__cybergoldTradeObservations ?? []);
}
