import assert from "node:assert/strict";
import test from "node:test";
import { createQuoteDisplayTiming, QUOTE_LATENCY_EVENT, type QuoteLatencyEvent } from "./quoteLatency.ts";
import { fetchQuoteStream } from "./quoteStream.ts";

const requestId = "eb3e691b-346d-4782-b93e-3cc674250007";
const nextId = "eb3e691b-346d-4782-b93e-3cc674250008";
function local() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window"), scope = new EventTarget(), events: QuoteLatencyEvent[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: scope });
  scope.addEventListener(QUOTE_LATENCY_EVENT, event => events.push((event as CustomEvent<QuoteLatencyEvent>).detail));
  return { scope, events, restore() { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); } };
}

test("stream milestones distinguish bytes, a complete selected frame and terminal completion without extra fetches", async t => {
  const observer = local(); let now = 0, calls = 0;
  t.mock.method(performance, "now", () => now);
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const received: unknown[] = [];
  try {
    const pending = fetchQuoteStream("/api/economic-quotes/stream", {}, new AbortController().signal, event => received.push(event), (async () => {
      calls++; now = 20;
      return new Response(new ReadableStream({ start(controller) { writer = controller; } }), { headers: { "X-CyberGold-Request-Id": requestId } });
    }) as typeof fetch);
    await Promise.resolve(); await Promise.resolve();
    now = 80; writer.enqueue(new TextEncoder().encode('{"type":"qualified",'));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(observer.events.find(event => event.phase === "first-body")?.elapsedMs, 80);
    assert.equal(observer.events.some(event => event.phase === "first-selected"), false);
    now = 100; writer.enqueue(new TextEncoder().encode('"value":{"output":"7"}}\n'));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(observer.events.find(event => event.phase === "first-selected")?.elapsedMs, 100);
    assert.equal(observer.events.find(event => event.phase === "first-selected")?.requestId, requestId);
    assert.equal(received.length, 1);
    assert.equal(observer.events.some(event => event.phase === "finished"), false);
    now = 900; writer.enqueue(new TextEncoder().encode('{"type":"complete","value":{"output":"9"}}\n')); writer.close();
    assert.deepEqual(await pending, { output: "9" });
    assert.equal(observer.events.filter(event => event.phase === "first-selected").length, 1);
    assert.equal(observer.events.at(-1)?.outcome, "succeeded"); assert.equal(calls, 1);
  } finally { observer.restore(); }
});

test("display clock includes debounce, excludes estimate overlays, retains the final edit and waits for the refreshed owner", t => {
  const observer = local(); let now = 0;
  t.mock.method(performance, "now", () => now);
  try {
    const timing = createQuoteDisplayTiming();
    now = 100; timing.input();
    now = 150; timing.input();
    now = 300; timing.display(false, { requestId }, "stored"); // An arithmetic overlay is visible.
    assert.equal(observer.events.filter(event => event.phase === "display").length, 0);
    now = 450; timing.display(true, { requestId }, "search");
    assert.equal(observer.events.at(-1)?.elapsedMs, 300);
    assert.equal(observer.events.at(-1)?.origin, "input");
    now = 600; timing.display(true, { requestId }, "search");
    assert.equal(observer.events.filter(event => event.phase === "display").length, 1);
    now = 700; timing.input(true);
    now = 720; timing.display(true, { requestId }, "search");
    assert.equal(observer.events.filter(event => event.phase === "display").length, 1);
    now = 800; timing.display(true, { requestId: nextId }, "stored");
    assert.equal(observer.events.at(-1)?.elapsedMs, 100); assert.equal(observer.events.at(-1)?.origin, "refresh");
  } finally { observer.restore(); }
});

test("a broken diagnostic clock or local listener cannot interrupt the original selected stream", async t => {
  const observer = local();
  t.mock.method(performance, "now", () => { throw new Error("clock unavailable"); });
  Object.defineProperty(observer.scope, "dispatchEvent", { value() { throw new Error("listener unavailable"); } });
  try {
    const value = await fetchQuoteStream("/api/economic-quotes/stream", {}, new AbortController().signal, () => {},
      (async () => new Response('{"type":"complete","value":{"output":"7"}}\n')) as typeof fetch);
    assert.deepEqual(value, { output: "7" });
  } finally { observer.restore(); }
});

test("Refresh waits for its replacement after an automatic visible-owner change", t => {
  const observer = local(); let now = 0;
  const refreshedId = "eb3e691b-346d-4782-b93e-3cc674250009";
  t.mock.method(performance, "now", () => now);
  try {
    const timing = createQuoteDisplayTiming();
    now = 100; timing.input();
    now = 200; timing.display(true, { requestId }, "search");
    now = 300; timing.display(true, { requestId: nextId }, "search"); // Visibility resumed the unfinished stream.
    assert.equal(observer.events.filter(event => event.phase === "display").length, 1);
    now = 400; timing.input(true);
    now = 401; timing.display(true, { requestId: nextId }, "search"); // Retained while the replacement is pending.
    assert.equal(observer.events.filter(event => event.phase === "display").length, 1);
    now = 700; timing.display(true, { requestId: refreshedId }, "stored");
    const displayed = observer.events.filter(event => event.phase === "display");
    assert.equal(displayed.length, 2);
    assert.equal(displayed[1].requestId, refreshedId);
    assert.equal(displayed[1].origin, "refresh"); assert.equal(displayed[1].elapsedMs, 300);
  } finally { observer.restore(); }
});
