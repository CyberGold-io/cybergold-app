import assert from "node:assert/strict";
import test from "node:test";
import { createQuoteDisplayTiming, createQuoteStreamTiming, emitQuoteLatency, observeQuoteLongTasks, QUOTE_LATENCY_EVENT, type QuoteLatencyEvent } from "./quoteLatency.ts";
import { fetchQuoteStream } from "./quoteStream.ts";
import { retainDiagnosticReferences } from "./diagnosticReferences.ts";

const requestId = "eb3e691b-346d-4782-b93e-3cc674250007";
const nextId = "eb3e691b-346d-4782-b93e-3cc674250008";
function local() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window"), scope = new EventTarget(), events: QuoteLatencyEvent[] = [];
  const originalInfo = console.info, logs: string[] = [];
  console.info = value => { logs.push(String(value)); };
  Object.defineProperty(globalThis, "window", { configurable: true, value: scope });
  scope.addEventListener(QUOTE_LATENCY_EVENT, event => events.push((event as CustomEvent<QuoteLatencyEvent>).detail));
  return { scope, events, logs, restore() { console.info = originalInfo; if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); } };
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
    assert.equal(observer.events.some(event => event.phase === "selected"), false);
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

test("partial display and later full display retain one native edit clock and independent milestones", t => {
  const observer = local(); let now = 0;
  t.mock.method(performance, "now", () => now);
  try {
    const timing = createQuoteDisplayTiming();
    now = 10; timing.input();
    now = 100; timing.display(false, { requestId }, "stored", true);
    now = 200; timing.display(true, { requestId }, "stored");
    now = 250; timing.display(true, { requestId }, "stored");
    now = 400; timing.display(true, { requestId }, "search", true);
    now = 500; timing.display(true, { requestId }, "search", true);
    const displayed = observer.events.filter(event => event.phase === "display" || event.phase === "display-full");
    assert.deepEqual(displayed.map(event => [event.phase, event.elapsedMs, event.limited, event.editId]), [
      ["display", 190, true, 1], ["display-full", 390, false, 1],
    ]);
    now = 600; timing.input();
    now = 700; timing.display(true, { requestId: nextId }, "search", true);
    assert.deepEqual(observer.events.slice(-2).map(event => [event.phase, event.elapsedMs, event.limited, event.editId]), [
      ["display", 100, false, 2], ["display-full", 100, false, 2],
    ]);
  } finally { observer.restore(); }
});

test("every selected frame has closed amount evidence without retaining provider payloads", t => {
  const observer = local(); let now = 10;
  t.mock.method(performance, "now", () => now);
  try {
    const timing = createQuoteStreamTiming(nextId);
    const quote = { inputs: [{ currency: "private-address", amount: "9" }], request: { inputs: [{ currency: "private-address", amount: "10" }] },
      observation: { source: "stored", secret: "private-provider" }, reuseSample: { inputLimitObserved: false }, quotedOutput: "7",
      metrics: { totalMs: 4, firstQualifiedMs: 1, selectionMs: 2, canonicalCompletedMs: 3, timeToFirstWholePlanMs: 1.5, privateMetric: "private-provider" },
      requestId, wallet: "private-wallet", plan: { body: "private-ABI" } };
    retainDiagnosticReferences(quote, { correlationId: nextId });
    now = 20; const readAtMs = timing.now();
    now = 25; const parsedAtMs = timing.now();
    now = 30; timing.selected(quote, "qualified", { readAtMs, parsedAtMs });
    now = 40; timing.selected({ ...quote, inputs: [{ amount: "10" }], observation: { source: "search" } }, "qualified");
    now = 50; timing.selected(null, "complete");
    const selected = observer.events.filter(event => event.phase === "selected");
    assert.equal(selected.length, 3);
    assert.deepEqual(selected.map(event => event.selectionSequence), [1, 2, 3]);
    assert.deepEqual(selected[0], { attemptId: nextId, requestId, correlationId: nextId, phase: "selected", eventType: "qualified", selectionSequence: 1,
      atMs: 30, elapsedMs: 20, origin: "stream", selectedInputAmounts: ["9"], requestedInputAmounts: ["10"],
      quotedOutput: "7", source: "stored", producerMetrics: { totalMs: 4, firstQualifiedMs: 1, selectionMs: 2, canonicalCompletedMs: 3, timeToFirstWholePlanMs: 1.5 },
      inputLimitObserved: false, readAtMs: 20, parsedAtMs: 25 });
    assert.deepEqual(selected[1].selectedInputAmounts, ["10"]);
    assert.equal(selected[2].selectedInputAmounts, undefined);
    assert.equal(JSON.stringify([selected, observer.logs]).includes("private-"), false);
    quote.inputs[0].amount = "99";
    assert.deepEqual(selected[0].selectedInputAmounts, ["9"]);
    timing.selected({ inputs: [{ amount: "9\n" }], request: { inputs: [{ amount: "-1" }] }, quotedOutput: "7\n",
      metrics: { totalMs: NaN, firstQualifiedMs: Infinity, selectionMs: "2", canonicalCompletedMs: null, timeToFirstWholePlanMs: 0 } }, "qualified");
    assert.equal(observer.events.at(-1)?.selectedInputAmounts, undefined);
    assert.equal(observer.events.at(-1)?.requestedInputAmounts, undefined);
    assert.equal(observer.events.at(-1)?.quotedOutput, undefined);
    assert.deepEqual(observer.events.at(-1)?.producerMetrics, { timeToFirstWholePlanMs: 0 });
    timing.mark("first-selected"); timing.mark("first-selected");
    assert.equal(observer.events.filter(event => event.phase === "first-selected").length, 1);
  } finally { observer.restore(); }
});

test("console and CustomEvent evidence fail independently", () => {
  const observer = local();
  const event: QuoteLatencyEvent = { phase: "input", atMs: 10, elapsedMs: 0, origin: "input" };
  try {
    Object.defineProperty(observer.scope, "dispatchEvent", { configurable: true, value() { throw new Error("listener unavailable"); } });
    assert.doesNotThrow(() => emitQuoteLatency(event));
    assert.deepEqual(JSON.parse(observer.logs[0].slice(`${QUOTE_LATENCY_EVENT} `.length)), event);
    Reflect.deleteProperty(observer.scope, "dispatchEvent");
    console.info = () => { throw new Error("console unavailable"); };
    assert.doesNotThrow(() => emitQuoteLatency(event));
    assert.deepEqual(observer.events, [event]);
  } finally { observer.restore(); }
});

test("long-task observation reports actual entry intervals, omits attribution and disconnects", t => {
  const observer = local(), previous = Object.getOwnPropertyDescriptor(globalThis, "PerformanceObserver");
  let callback!: (list: { getEntries(): unknown[] }) => void, options: unknown, disconnected = 0;
  t.mock.method(performance, "now", () => 900);
  class PassiveObserver {
    static supportedEntryTypes = ["longtask"];
    constructor(receive: typeof callback) { callback = receive; }
    observe(value: unknown) { options = value; }
    disconnect() { disconnected++; }
  }
  Object.defineProperty(globalThis, "PerformanceObserver", { configurable: true, value: PassiveObserver });
  try {
    const stop = observeQuoteLongTasks();
    assert.deepEqual(options, { type: "longtask", buffered: true });
    callback({ getEntries: () => [{ entryType: "longtask", startTime: 100, duration: 80, attribution: [{ containerSrc: "private-url" }], name: "private-name" }] });
    assert.equal(observer.events[0].supported, true);
    assert.deepEqual(observer.events[1], { phase: "long-task", atMs: 900, elapsedMs: 80, origin: "browser", startMs: 100, endMs: 180, durationMs: 80 });
    assert.equal(observer.logs.join().includes("private-"), false);
    stop(); assert.equal(disconnected, 1);
  } finally { if (previous) Object.defineProperty(globalThis, "PerformanceObserver", previous); else Reflect.deleteProperty(globalThis, "PerformanceObserver"); observer.restore(); }
});

test("missing or failing long-task observer remains optional coverage, not an operation failure", () => {
  const observer = local(), previous = Object.getOwnPropertyDescriptor(globalThis, "PerformanceObserver");
  try {
    Object.defineProperty(globalThis, "PerformanceObserver", { configurable: true, value: undefined });
    assert.doesNotThrow(() => observeQuoteLongTasks()());
    Object.defineProperty(globalThis, "PerformanceObserver", { configurable: true, value: class {
      static supportedEntryTypes = ["longtask"];
      observe() { throw new Error("unsupported observer options"); }
      disconnect() {}
    } });
    assert.doesNotThrow(() => observeQuoteLongTasks()());
    assert.deepEqual(observer.events.map(event => [event.phase, event.supported]), [["long-task-coverage", false], ["long-task-coverage", false]]);
  } finally { if (previous) Object.defineProperty(globalThis, "PerformanceObserver", previous); else Reflect.deleteProperty(globalThis, "PerformanceObserver"); observer.restore(); }
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
