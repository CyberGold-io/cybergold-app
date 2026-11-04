import assert from "node:assert/strict";
import test from "node:test";
import { backendRoute } from "../server/backend-client.ts";
import { withEnvironment } from "../../tests/fixtures/environment.mts";

type Event = Record<string, unknown>;
const requestId = "eb3e691b-346d-4782-b93e-3cc674250007", attemptId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e";
const revision = "a".repeat(40);

test("proxy timing separates held headers/body, passes early chunks without prefetch and preserves safe Backend evidence", async t => {
  const events: Event[] = [];
  t.mock.method(console, "info", (line: string) => events.push(JSON.parse(line)));
  let now = 0;
  t.mock.method(performance, "now", () => now);
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://private:secret@backend.invalid", CYBERGOLD_BACKEND_BEARER_TOKEN: "private-token" }, async () => {
    let releaseHeaders!: (value: Response) => void, writer!: ReadableStreamDefaultController<Uint8Array>, pulls = 0;
    const upstream = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; }, pull() { pulls++; } }, { highWaterMark: 0 });
    const route = backendRoute("/api/economic-quotes/stream", (async () => new Promise<Response>(resolve => { releaseHeaders = resolve; })) as typeof fetch);
    let returned = false;
    const pending = route(new Request("https://app.invalid/api/economic-quotes/stream?private=query", {
      method: "POST", body: '{"private":"payload"}', headers: { "X-CyberGold-Attempt-Id": attemptId },
    })).then(response => { returned = true; return response; });
    await Promise.resolve(); assert.equal(returned, false);
    now = 25;
    const timing = 'cache;dur=12.5;desc="private-token, pretend;dur=999", resolve;dur=2';
    releaseHeaders(new Response(upstream, { headers: { "Content-Type": "application/x-ndjson", "X-CyberGold-Request-Id": requestId,
      "X-CyberGold-Backend-Revision": revision, "Server-Timing": timing } }));
    const response = await pending;
    assert.equal(returned, true); assert.equal(pulls, 0, "observing the body must not prefetch before downstream demand");
    assert.equal(response.headers.get("server-timing"), timing);
    const handoff = events.find(event => event.phase === "downstream-handoff")!;
    assert.equal(handoff.elapsedMs, 25); assert.equal(handoff.requestId, requestId); assert.equal(handoff.attemptId, attemptId);
    assert.equal(handoff.backendRevision, revision);
    assert.deepEqual(handoff.serverTiming, [{ name: "cache", durationMs: 12.5 }, { name: "resolve", durationMs: 2 }]);
    assert.equal(events.some(event => event.phase === "finished"), false);
    const reader = response.body!.getReader(), first = reader.read();
    now = 80;
    const bytes = new TextEncoder().encode('{"type":"qualified","value":{}}\n'); writer.enqueue(bytes);
    assert.equal((await first).value, bytes, "forward the original chunk without decoding or copying");
    assert.equal(pulls, 1); assert.equal(events.find(event => event.phase === "first-body-chunk")!.elapsedMs, 80);
    assert.equal(events.some(event => event.phase === "finished"), false, "first quote delivery does not wait for completion");
    now = 200; writer.close(); assert.equal((await reader.read()).done, true);
    const final = events.filter(event => event.phase === "finished");
    assert.equal(final.length, 1);
    assert.equal(final[0].outcome, "completed"); assert.equal(final[0].upstreamHeadersMs, 25);
    assert.equal(final[0].firstBodyMs, 55); assert.equal(final[0].bodyMs, 175); assert.equal(final[0].bytes, bytes.length);
    assert.equal(final[0].chunks, 1);
    assert.doesNotMatch(JSON.stringify(events), /private|secret|Bearer|Authorization|payload|query/);
  });
});

test("proxy JSON buffering is measured without claiming its buffer arrival is a first stream byte", async t => {
  const events: Event[] = [];
  t.mock.method(console, "info", (line: string) => events.push(JSON.parse(line)));
  let now = 0; t.mock.method(performance, "now", () => now);
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://backend.invalid" }, async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    const route = backendRoute("/api/economic-estimates", (async () => {
      now = 20; return new Response(new ReadableStream({ start(controller) { writer = controller; } }));
    }) as typeof fetch);
    let returned = false;
    const pending = route(new Request("https://app.invalid/api/economic-estimates", { method: "POST", body: "{}" })).then(value => { returned = true; return value; });
    await Promise.resolve(); await Promise.resolve(); assert.equal(returned, false);
    now = 75; writer.enqueue(new TextEncoder().encode('{"models":[]}')); writer.close();
    assert.equal(await (await pending).text(), '{"models":[]}');
    assert.equal(events.some(event => event.phase === "first-body-chunk"), false);
    const final = events.find(event => event.phase === "finished")!;
    assert.equal(final.bodyMs, 55); assert.equal(final.bytes, 13); assert.equal(final.chunks, 0);
    assert.equal(final.firstBodyMs, undefined); assert.equal(final.outcome, "completed");
  });
});

for (const outcome of ["cancelled", "failed"] as const) test(`proxy stream reports ${outcome} once and preserves the original body outcome`, async t => {
  const events: Event[] = [];
  t.mock.method(console, "info", (line: string) => events.push(JSON.parse(line)));
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://backend.invalid" }, async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>, cancelled: unknown;
    const route = backendRoute("/api/economic-quotes/stream", (async () => new Response(new ReadableStream({
      start(controller) { writer = controller; }, cancel(reason) { cancelled = reason; },
    }))) as typeof fetch);
    const response = await route(new Request("https://app.invalid/api/economic-quotes/stream", { method: "POST", body: "{}" }));
    const reader = response.body!.getReader();
    if (outcome === "cancelled") { await reader.cancel("consumer-left"); assert.equal(cancelled, "consumer-left"); }
    else {
      const original = new Error("private upstream failure"); writer.error(original);
      await assert.rejects(reader.read(), error => error === original);
    }
    const final = events.filter(event => event.phase === "finished");
    assert.equal(final.length, 1); assert.equal(final[0].outcome, outcome);
    assert.doesNotMatch(JSON.stringify(events), /consumer-left|private upstream failure/);
  });
});

test("proxy cancellation before headers stays cancellation, and a broken timing logger cannot alter bytes/status", async t => {
  const events: Event[] = [];
  t.mock.method(console, "info", (line: string) => events.push(JSON.parse(line)));
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://backend.invalid" }, async () => {
    const abort = new AbortController();
    const route = backendRoute("/api/economic-estimates", (async () => { abort.abort(); throw abort.signal.reason; }) as typeof fetch);
    await assert.rejects(route(new Request("https://app.invalid/api/economic-estimates", { signal: abort.signal })), { name: "AbortError" });
    assert.equal(events.filter(event => event.phase === "finished").length, 1);
    assert.equal(events.at(-1)!.outcome, "cancelled");
    const failures: Event[] = [];
    t.mock.method(console, "error", (_message: string, event: Event) => failures.push(event));
    const failed = backendRoute("/api/economic-estimates", (async () => { throw new Error("private transport failure"); }) as typeof fetch);
    const errorResponse = await failed(new Request("https://app.invalid/api/economic-estimates"));
    assert.equal(errorResponse.status, 503);
    assert.equal(failures[0].requestId, errorResponse.headers.get("X-CyberGold-Request-Id"));
    assert.equal(failures[0].flowId, events.at(-1)!.flowId);
    assert.equal(events.at(-1)!.outcome, "failed");
    t.mock.method(console, "info", () => { throw new Error("collector unavailable"); });
    const passthrough = backendRoute("/api/economic-quotes/stream", (async () => new Response("unchanged\n", { status: 503 })) as typeof fetch);
    const response = await passthrough(new Request("https://app.invalid/api/economic-quotes/stream"));
    assert.equal(response.status, 503); assert.equal(await response.text(), "unchanged\n");
  });
});
