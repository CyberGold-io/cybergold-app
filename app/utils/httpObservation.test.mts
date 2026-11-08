import assert from "node:assert/strict";
import test from "node:test";
import { backendHttpMetadata, backendHttpObservation, CLIENT_TRANSPORT_DIAGNOSTIC_EVENT, type BackendHttpObservation } from "./httpObservation.ts";
import { diagnosticReferences } from "./diagnosticReferences.ts";
import { fetchTradeModel, type TradeModelRequest, type TradeQuoteModelPacket } from "./tradeQuote.ts";

const intent: TradeModelRequest = { side: "buy", mode: "exact-in", counterToken: "0x0000000000000000000000000000000000000000", native: true, amount: "500", slippageBps: 100 };
const packet: TradeQuoteModelPacket = { namespace: "trade", intent, models: [], estimate: { strategy: "market", amount: "42" } };
const requestId = "eb3e691b-346d-4782-b93e-3cc674250007", attemptId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e", revision = "a".repeat(40);

function localObservation() {
  const scope = new EventTarget() as unknown as Window, events: BackendHttpObservation[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: scope });
  scope.addEventListener(CLIENT_TRANSPORT_DIAGNOSTIC_EVENT, event => events.push((event as CustomEvent<BackendHttpObservation>).detail));
  return { scope, events, restore() {
    if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
  } };
}

test("model HTTP evidence keeps actual request/revision/timings page-local, preserves packet, and adds no telemetry requests", async t => {
  const local = localObservation();
  let now = 0; t.mock.method(performance, "now", () => now);
  let writer!: ReadableStreamDefaultController<Uint8Array>, calls = 0;
  const headers = { "X-CyberGold-Request-Id": requestId, "X-CyberGold-Backend-Revision": revision,
    "Server-Timing": 'cg_backend_headers;dur=24;desc="private internal URL, pretend;dur=999", cg_sum_cache;dur=3.5' };
  try {
    local.scope.addEventListener(CLIENT_TRANSPORT_DIAGNOSTIC_EVENT, event => {
      (event as CustomEvent<BackendHttpObservation>).detail.requestId = "listener-mutation";
    });
    const pending = fetchTradeModel(intent, undefined, (async (url, init) => {
      calls++; assert.equal(url, "/api/economic-estimates"); assert.deepEqual(JSON.parse(String(init?.body)), intent);
      assert.equal(new Headers(init?.headers).get("X-CyberGold-Attempt-Id"), attemptId);
      now = 25; return new Response(new ReadableStream({ start(controller) { writer = controller; } }), { headers });
    }) as typeof fetch, attemptId);
    await Promise.resolve(); assert.equal(local.events.length, 0, "local completion observation must not delay or invent readiness");
    now = 80; writer.enqueue(new TextEncoder().encode(JSON.stringify(packet))); writer.close();
    const value = await pending;
    assert.deepEqual(value, packet); assert.equal(calls, 1);
    assert.deepEqual(diagnosticReferences(value), { attemptId, requestId });
    const evidence = backendHttpObservation(value)!;
    assert.equal(evidence.operation, "economic-estimates"); assert.equal(evidence.outcome, "succeeded");
    assert.equal(evidence.elapsedMs, 80); assert.equal(evidence.headersMs, 25); assert.equal(evidence.bodyMs, 55);
    assert.equal(evidence.backendRevision, revision); assert.equal(evidence.requestId, requestId); assert.equal(evidence.httpStatus, 200);
    assert.deepEqual(evidence.serverTiming, [{ name: "cg_backend_headers", durationMs: 24 }, { name: "cg_sum_cache", durationMs: 3.5 }]);
    assert.equal(local.events.length, 1); assert.equal(local.events[0].requestId, "listener-mutation");
    assert.doesNotMatch(JSON.stringify(evidence), /private|internal URL|counterToken|amount|slippage|intent/);
    assert.equal(JSON.stringify(value), JSON.stringify(packet), "metadata must not modify the producer JSON or query identity");
  } finally { local.restore(); }
});

for (const scenario of ["http", "body", "transport", "cancel"] as const) test(`model ${scenario} failures retain optional local evidence without changing their ordinary error`, async () => {
  const local = localObservation(), abort = new AbortController();
  const failure = new Error("private provider URL and payload");
  let calls = 0;
  try {
    let thrown: unknown;
    try {
      await fetchTradeModel(intent, abort.signal, (async () => {
        calls++;
        if (scenario === "cancel") { abort.abort(); throw abort.signal.reason; }
        if (scenario === "transport") throw failure;
        return new Response(scenario === "body" ? "invalid JSON" : "private response body", {
          status: scenario === "http" ? 503 : 200, headers: { "X-CyberGold-Request-Id": requestId, "X-CyberGold-Backend-Revision": revision },
        });
      }) as typeof fetch, attemptId);
    } catch (error) { thrown = error; }
    assert.equal(calls, 1); assert.ok(thrown);
    if (scenario === "http") assert.equal((thrown as Error).message, "Trading estimates are temporarily unavailable.");
    if (scenario === "transport") assert.equal(thrown, failure);
    if (scenario === "cancel") assert.equal(thrown, abort.signal.reason);
    const evidence = backendHttpObservation(thrown)!;
    assert.equal(evidence.outcome, scenario === "cancel" ? "cancelled" : "failed");
    assert.equal(evidence.attemptId, attemptId); assert.equal(local.events.length, 1);
    assert.equal(evidence.requestId, ["http", "body"].includes(scenario) ? requestId : undefined);
    assert.doesNotMatch(JSON.stringify(evidence), /private|provider|payload|response body|invalid JSON/);
  } finally { local.restore(); }
});

test("missing or malformed HTTP metadata never prevents estimates, and a broken local observer stays optional", async () => {
  const local = localObservation();
  try {
    Object.defineProperty(local.scope, "dispatchEvent", { value() { throw new Error("local observer unavailable"); } });
    const value = await fetchTradeModel(intent, undefined, (async () => Response.json(packet, { headers: {
      "X-CyberGold-Request-Id": "private-not-a-reference", "X-CyberGold-Backend-Revision": "private-revision",
      "Server-Timing": 'private/url;dur=3, invalid;dur=NaN;desc="private-token"',
    } })) as typeof fetch);
    assert.deepEqual(value, packet); assert.equal(backendHttpObservation(value)!.outcome, "succeeded");
    assert.match(diagnosticReferences(value).attemptId!, /^[0-9a-f-]{36}$/);
    assert.equal(diagnosticReferences(value).requestId, undefined);
    assert.equal(backendHttpObservation(value)!.backendRevision, undefined);
    assert.equal(backendHttpObservation(value)!.serverTiming, undefined);
  } finally { local.restore(); }
  assert.deepEqual(backendHttpMetadata(new Headers()), {});
});
