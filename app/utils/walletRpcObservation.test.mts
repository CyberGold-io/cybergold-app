import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { test } from "node:test";
import { observeWalletRpc } from "../../tests/trading/walletRpcObservation.ts";

const endpoint = "http://127.0.0.1:12345";
function fixture() {
  const context = new EventEmitter();
  const observe = observeWalletRpc(context as never, endpoint)!;
  const request = (method: unknown, extra: Record<string, unknown> = {}) => ({
    url: () => endpoint+"/",
    postDataJSON: () => ({ jsonrpc: "2.0", id: 987654321, method,
      params: ["0x1111111111111111111111111111111111111111", "private-payload"] }),
    response: async () => ({ status: () => 200 }), failure: () => null, ...extra,
  });
  return { context, observe, request };
}

test("canonical endpoint and fixed methods exclude unrelated or private input", () => {
  const { context, observe, request } = fixture();
  context.emit("request", request("eth_getCode"));
  context.emit("request", request("eth_getCode", { url: () => endpoint+"/other" }));
  context.emit("request", request("private-method-http://secret.example"));
  const snapshot = observe.snapshot()!;
  assert.deepEqual(Object.keys(snapshot.methods), ["eth_getCode"]);
  assert.equal(snapshot.methods.eth_getCode!.started, 1);
  assert.equal(snapshot.methods.eth_getCode!.pending, 1);
  assert.ok(snapshot.methods.eth_getCode!.oldestPendingMs! >= 0);
  assert.doesNotMatch(JSON.stringify(snapshot), /http:|987654321|0x1111|private-|params|payload|endpoint|url|address/i);
  observe.stop();
});

test("batch method occurrences settle and retain HTTP metadata without response bodies", async () => {
  const { context, observe, request } = fixture();
  const batch = request(undefined, { postDataJSON: () => [
    { method: "eth_getCode", id: 1 }, { method: "eth_getCode", id: 2 }, { method: "eth_getBalance", id: 3 },
  ], response: async () => ({ status: () => 500 }) });
  context.emit("request", batch);
  assert.equal(observe.snapshot()!.methods.eth_getCode!.pending, 2);
  context.emit("requestfinished", batch); await Promise.resolve();
  const snapshot = observe.snapshot()!;
  assert.equal(snapshot.methods.eth_getCode!.started, 2);
  assert.equal(snapshot.methods.eth_getCode!.finished, 2);
  assert.equal(snapshot.methods.eth_getCode!.pending, 0);
  assert.equal(snapshot.methods.eth_getCode!.http["500"], 2);
  assert.equal(snapshot.methods.eth_getBalance!.http["500"], 1);
  snapshot.methods.eth_getCode!.http["500"] = 999;
  snapshot.methods.eth_getCode!.errors.private = 999;
  assert.equal(observe.snapshot()!.methods.eth_getCode!.http["500"], 2);
  assert.equal(observe.snapshot()!.methods.eth_getCode!.errors.private, undefined);
  observe.stop();
});

test("network failures expose fixed categories and malformed optional events stay independent", () => {
  const { context, observe, request } = fixture();
  for (const [text, category] of [["net::ERR_TIMED_OUT", "timeout"], ["net::ERR_ABORTED", "aborted"],
    ["net::ERR_NAME_NOT_RESOLVED", "connection"], ["private network detail", "network"]]) {
    const failed = request("eth_getCode", { failure: () => ({ errorText: text+" http://private.example/0x1111" }) });
    context.emit("request", failed); context.emit("requestfailed", failed);
    assert.equal(observe.snapshot()!.methods.eth_getCode!.errors[category], 1);
  }
  assert.equal(observe.snapshot()!.methods.eth_getCode!.failed, 4);
  assert.equal(observe.snapshot()!.methods.eth_getCode!.pending, 0);
  assert.doesNotMatch(JSON.stringify(observe.snapshot()), /http:|private|0x1111|ERR_/);
  for (const extra of [{ url: () => { throw Error("private URL"); } },
    { postDataJSON: () => { throw Error("private parse error"); } }, { postDataJSON: () => [null, 1, { method: {} }] }])
    assert.doesNotThrow(() => context.emit("request", request("eth_call", extra)));
  assert.equal(observe.snapshot()!.methods.eth_call, undefined);
  observe.stop();
});

test("stop freezes pending counts, detaches listeners and rejects late metadata mutations", async () => {
  const { context, observe, request } = fixture();
  const response = Promise.withResolvers<{ status(): number }>();
  const finished = request("eth_call", { response: () => response.promise });
  context.emit("request", finished); context.emit("requestfinished", finished);
  const pending = request("eth_getCode"); context.emit("request", pending);
  observe.stop(); observe.stop();
  const frozen = observe.snapshot()!;
  assert.equal(frozen.methods.eth_getCode!.pending, 1);
  assert.equal(frozen.methods.eth_call!.finished, 1);
  for (const event of ["request", "requestfinished", "requestfailed"]) assert.equal(context.listenerCount(event), 0);
  context.emit("requestfinished", pending); context.emit("request", request("eth_gasPrice"));
  response.resolve({ status: () => 200 }); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(observe.snapshot(), frozen);
  frozen.methods.eth_getCode!.started = 999;
  assert.equal(observe.snapshot()!.methods.eth_getCode!.started, 1);
});

test("partial listener registration rolls back without making optional configuration mandatory", () => {
  for (const endpoint of [undefined, "private invalid endpoint"]) {
    const context = new EventEmitter();
    assert.equal(observeWalletRpc(context as never, endpoint), undefined);
    assert.equal(context.eventNames().length, 0);
  }
  for (const failedEvent of ["request", "requestfinished", "requestfailed"]) {
    const context = new EventEmitter(); const original = context.on;
    context.on = ((name, listener) => {
      original.call(context, name, listener);
      if (name === failedEvent) throw Error("private listener registration failure");
      return context;
    }) as typeof context.on;
    assert.equal(observeWalletRpc(context as never, endpoint), undefined);
    assert.equal(context.eventNames().length, 0);
  }
});

test("unavailable or malformed response metadata never rejects event processing", async () => {
  const { context, observe, request } = fixture();
  for (const response of [() => { throw Error("private response access"); }, () => Promise.reject(Error("private response promise")),
    async () => null, async () => ({ status: () => 600 }), async () => ({ status: () => "private status" }),
    async () => ({ status: () => { throw Error("private status getter"); } })]) {
    const value = request("eth_call", { response });
    context.emit("request", value);
    assert.doesNotThrow(() => context.emit("requestfinished", value));
  }
  await Promise.resolve(); await Promise.resolve();
  assert.equal(observe.snapshot()!.methods.eth_call!.finished, 6);
  assert.deepEqual(observe.snapshot()!.methods.eth_call!.http, {});
  observe.stop();
});

test("failure accounting survives unavailable failure metadata", () => {
  const { context, observe, request } = fixture();
  const value = request("eth_getCode", { failure: () => { throw Error("private failure metadata"); } });
  context.emit("request", value);
  assert.doesNotThrow(() => context.emit("requestfailed", value));
  const result = observe.snapshot()!.methods.eth_getCode!;
  assert.equal(result.started, 1); assert.equal(result.failed, 1); assert.equal(result.pending, 0);
  assert.deepEqual(result.errors, {});
  observe.stop();
});
