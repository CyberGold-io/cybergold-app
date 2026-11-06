import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { test } from "node:test";
import { observeWalletRpc, walletRpcTargets, type WalletRpcTargets } from "../../tests/trading/walletRpcObservation.ts";

const endpoint = "http://127.0.0.1:12345";
function fixture(targets?: WalletRpcTargets) {
  const context = new EventEmitter();
  const observe = observeWalletRpc(context as never, endpoint, targets)!;
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


test("two pending eth_calls in one HTTP batch retain membership without payloads or responses", t => {
  let clock = 1000;
  t.mock.method(performance, "now", () => clock);
  const helpers = "0x" + "2".repeat(40), token = "0x" + "3".repeat(40), blockHash = "0x" + "4".repeat(64);
  const data = "0xABF176FD" + "55".repeat(100);
  const { context, observe, request } = fixture({ helpers, tokens: [token] });
  let responseAccesses = 0, payloadReads = 0;
  const batch = request(undefined, { postDataJSON: () => { payloadReads++; return [
    { method: "eth_blockNumber", id: "private-id" },
    { method: "eth_call", id: 123456789, params: [{ from: token, to: helpers, data }, "pending", { [token]: { balance: "private-override" } }] },
    { method: "private-method", params: ["private-input"] },
    { method: "eth_call", params: [{ to: token, data: "0x70a08231" + "66".repeat(32) }, { blockHash, requireCanonical: false }] },
  ]; }, response: async () => { responseAccesses++; throw Error("must not read a pending response"); } });
  clock = 1010; context.emit("request", batch);
  clock = 1035;
  const snapshot = observe.snapshot()!;
  assert.equal(snapshot.pendingHttpRequests, 1);
  assert.equal(snapshot.methods.eth_call!.pending, 2);
  assert.equal(snapshot.methods.eth_blockNumber!.pending, 1);
  assert.equal(snapshot.pendingEthCallsTruncated, false);
  assert.deepEqual(snapshot.pendingEthCalls, [
    { selector: "0xabf176fd", targetCategory: "helpers", blockTagCategory: "pending", stateOverridePresent: true,
      transportOrdinal: 1, batchIndex: 1, batchSize: 4, startedMs: 10, pendingMs: 25 },
    { selector: "0x70a08231", targetCategory: "token", blockTagCategory: "hash", requireCanonical: false,
      stateOverridePresent: false, transportOrdinal: 1, batchIndex: 3, batchSize: 4, startedMs: 10, pendingMs: 25 },
  ]);
  assert.equal(payloadReads, 1); assert.equal(responseAccesses, 0);
  const serialized = JSON.stringify(snapshot);
  for (const privateValue of [helpers, token, blockHash, data, "123456789", "private-"]) assert.ok(!serialized.includes(privateValue));
  assert.doesNotMatch(serialized, /"(?:to|from|url|params|id|data|input|balance|blockHash|blockNumber)":/);
  observe.stop();
});

test("method clocks place unfinished calls before raw submission and retain settlement order", t => {
  let clock = 500;
  t.mock.method(performance, "now", () => clock);
  const { context, observe, request } = fixture();
  const call = request("eth_call"), raw = request("eth_sendRawTransaction"), failed = request("eth_call");
  clock = 510; context.emit("request", call);
  clock = 520; context.emit("request", raw);
  clock = 540; context.emit("requestfinished", raw);
  clock = 545; context.emit("request", failed);
  clock = 555; context.emit("requestfailed", failed);
  clock = 600;
  const snapshot = observe.snapshot()!;
  assert.equal(snapshot.elapsedMs, 100);
  assert.equal(snapshot.pendingHttpRequests, 1);
  assert.equal(snapshot.methods.eth_call!.firstStartedMs, 10);
  assert.equal(snapshot.methods.eth_call!.lastFailedMs, 55);
  assert.equal(snapshot.methods.eth_call!.lastFinishedMs, undefined);
  assert.equal(snapshot.methods.eth_sendRawTransaction!.firstStartedMs, 20);
  assert.equal(snapshot.methods.eth_sendRawTransaction!.lastFinishedMs, 40);
  assert.equal(snapshot.pendingEthCalls[0].startedMs, 10);
  assert.equal(snapshot.pendingEthCalls[0].pendingMs, 90);
  observe.stop();
});

test("pending detail truncation keeps all method and HTTP counts and recovers after a batch settles", () => {
  const { context, observe, request } = fixture();
  const batch = request(undefined, { postDataJSON: () => Array.from({ length: 10 }, () => ({ method: "eth_call" })) });
  const later = request("eth_call");
  context.emit("request", batch); context.emit("request", later);
  let snapshot = observe.snapshot()!;
  assert.equal(snapshot.pendingHttpRequests, 2);
  assert.equal(snapshot.methods.eth_call!.pending, 11);
  assert.equal(snapshot.pendingEthCalls.length, 8);
  assert.equal(snapshot.pendingEthCallsTruncated, true);
  assert.deepEqual(snapshot.pendingEthCalls.map(call => call.batchIndex), [0, 1, 2, 3, 4, 5, 6, 7]);
  snapshot.pendingEthCalls[0].targetCategory = "private-mutation" as never;
  assert.equal(observe.snapshot()!.pendingEthCalls[0].targetCategory, "other");
  context.emit("requestfinished", batch);
  snapshot = observe.snapshot()!;
  assert.equal(snapshot.methods.eth_call!.pending, 1);
  assert.equal(snapshot.methods.eth_call!.finished, 10);
  assert.equal(snapshot.pendingHttpRequests, 1);
  assert.equal(snapshot.pendingEthCallsTruncated, false);
  assert.equal(snapshot.pendingEthCalls[0].transportOrdinal, 2);
  assert.equal(snapshot.pendingEthCalls[0].batchIndex, 0);
  assert.equal(snapshot.pendingEthCalls[0].batchSize, 1);
  observe.stop();
  const frozen = observe.snapshot()!;
  frozen.pendingEthCalls[0].selector = "0xdeadbeef";
  context.emit("requestfinished", later);
  assert.equal(observe.snapshot()!.pendingEthCalls[0].selector, undefined);
  assert.equal(observe.snapshot()!.methods.eth_call!.pending, 1);
});

test("block references and known targets become closed categories; unknown input never supplies raw identity", () => {
  const targets = { core: "0x" + "1".repeat(40), helpers: "0x" + "2".repeat(40), permit2: "0x" + "3".repeat(40),
    multicall: "0x" + "4".repeat(40), tokens: ["0x" + "5".repeat(40)] };
  const { context, observe, request } = fixture(targets);
  const cases: [unknown, string, string | undefined][] = [
    [undefined, "omitted", targets.core], ["latest", "latest", targets.helpers], ["pending", "pending", targets.permit2],
    ["earliest", "earliest", targets.multicall], ["safe", "safe", targets.tokens[0]], ["finalized", "finalized", undefined],
    ["0x1234", "number", "0x" + "6".repeat(40)], ["0x" + "7".repeat(64), "hash", "not-an-address"],
    [{ blockNumber: "0x0" }, "number", undefined], [{ blockHash: "private-hash", requireCanonical: true }, "other", undefined],
    ["private-block", "other", undefined], [null, "other", undefined],
  ];
  const categories = ["core", "helpers", "permit2", "multicall", "token", "other"];
  for (const [index, [block, expected, to]] of cases.entries()) {
    const value = request("eth_call", { postDataJSON: () => ({ method: "eth_call", params: [{ to, data: "private-data" }, block] }) });
    context.emit("request", value);
    const detail = observe.snapshot()!.pendingEthCalls[0];
    assert.equal(detail.blockTagCategory, expected);
    assert.equal(detail.targetCategory, categories[index] ?? "other");
    assert.equal(detail.selector, undefined);
    assert.equal(detail.requireCanonical, index === 9 ? true : undefined);
    context.emit("requestfinished", value);
  }
  assert.doesNotMatch(JSON.stringify(observe.snapshot()), /private-|0x[1-7]{40}/);
  observe.stop();
});

test("optional target mapping failures preserve method counts and block observations", () => {
  assert.deepEqual(walletRpcTargets(undefined as never), {});
  const { context, observe, request } = fixture({ tokens: [null] } as never);
  const value = request("eth_call", { postDataJSON: () => ({ method: "eth_call", params: [{ to: "0x" + "1".repeat(40) }, "pending"] }) });
  assert.doesNotThrow(() => context.emit("request", value));
  assert.equal(observe.snapshot()!.methods.eth_call!.pending, 1);
  assert.equal(observe.snapshot()!.pendingHttpRequests, 1);
  assert.equal(observe.snapshot()!.pendingEthCalls[0].targetCategory, "other");
  assert.equal(observe.snapshot()!.pendingEthCalls[0].blockTagCategory, "pending");
  observe.stop();
});


test("selector observation accepts input aliases and valid four-byte prefixes without validating or retaining tails", () => {
  const { context, observe, request } = fixture();
  const cases = [
    { transaction: { input: "0xABF176FDprivate-input-tail" }, selector: "0xabf176fd" },
    { transaction: { data: "0x70a08231private-invalid-hex-tail", input: "0xdeadbeefprivate-unused-alias" }, selector: "0x70a08231" },
    { transaction: { data: "0x123", input: "0xdeadbeefprivate-unused-alias" }, selector: undefined },
  ];
  for (const { transaction, selector } of cases) {
    const value = request("eth_call", { postDataJSON: () => ({ method: "eth_call", params: [transaction, "latest"] }) });
    context.emit("request", value);
    const snapshot = observe.snapshot()!;
    assert.equal(snapshot.pendingEthCalls[0].selector, selector);
    assert.equal(snapshot.methods.eth_call!.pending, 1);
    assert.doesNotMatch(JSON.stringify(snapshot), /private-|input|calldata|unused-alias/);
    context.emit("requestfinished", value);
  }
  assert.equal(observe.snapshot()!.methods.eth_call!.started, 3);
  assert.equal(observe.snapshot()!.methods.eth_call!.finished, 3);
  observe.stop();
});

test("override presence distinguishes address-map objects from absent, null and malformed third parameters", () => {
  const { context, observe, request } = fixture();
  const privateAddress = "0x" + "9".repeat(40);
  const cases: [unknown[], boolean][] = [
    [[{}, "latest"], false], [[{}, "latest", undefined], false], [[{}, "latest", null], false],
    [[{}, "latest", false], false], [[{}, "latest", 1], false], [[{}, "latest", "private-override"], false],
    [[{}, "latest", []], false], [[{}, "latest", {}], true],
    [[{}, "latest", { [privateAddress]: { stateDiff: { "private-slot": "private-value" } } }], true],
  ];
  for (const [params, expected] of cases) {
    const value = request("eth_call", { postDataJSON: () => ({ method: "eth_call", params }) });
    context.emit("request", value);
    const snapshot = observe.snapshot()!;
    assert.equal(snapshot.pendingEthCalls[0].stateOverridePresent, expected);
    assert.equal(snapshot.methods.eth_call!.pending, 1);
    assert.doesNotMatch(JSON.stringify(snapshot), /private-|0x9{40}|stateDiff/);
    context.emit("requestfinished", value);
  }
  assert.equal(observe.snapshot()!.methods.eth_call!.started, cases.length);
  assert.equal(observe.snapshot()!.methods.eth_call!.finished, cases.length);
  observe.stop();
});

test("pending numeric block references retain their supplied lossless quantity through snapshots and stop", () => {
  const { context, observe, request } = fixture();
  const maximum = "0x" + "F".repeat(64);
  const batch = request(undefined, { postDataJSON: () => [
    { method: "eth_call", params: [{}, "0x1921D5F"] },
    { method: "eth_call", params: [{}, { blockNumber: "0xAB", requireCanonical: true }] },
    { method: "eth_call", params: [{}, { blockNumber: "0x0" }] },
    { method: "eth_call", params: [{}, { blockNumber: maximum }] },
  ] });
  context.emit("request", batch);
  const snapshot = observe.snapshot()!;
  assert.equal(snapshot.pendingHttpRequests, 1);
  assert.equal(snapshot.methods.eth_call!.pending, 4);
  assert.deepEqual(snapshot.pendingEthCalls.map(call => call.blockTagCategory), ["number", "number", "number", "number"]);
  assert.deepEqual(snapshot.pendingEthCalls.map(call => call.blockNumber), ["0x1921d5f", "0xab", "0x0", maximum.toLowerCase()]);
  assert.equal(snapshot.pendingEthCalls[1].requireCanonical, true);
  snapshot.pendingEthCalls[0].blockNumber = "0x0";
  assert.equal(observe.snapshot()!.pendingEthCalls[0].blockNumber, "0x1921d5f");
  observe.stop();
  const frozen = observe.snapshot()!;
  frozen.pendingEthCalls[1].blockNumber = "0xdeadbeef";
  context.emit("requestfinished", batch);
  assert.equal(observe.snapshot()!.pendingEthCalls[1].blockNumber, "0xab");
  assert.equal(observe.snapshot()!.methods.eth_call!.pending, 4);
});

test("hashes, named tags and invalid or oversized references never invent a numeric block", () => {
  const { context, observe, request } = fixture();
  const hash = "0x" + "a".repeat(64), oversized = "0x" + "1".repeat(65);
  const cases: [unknown, string][] = [
    [hash, "hash"], [{ blockHash: hash, blockNumber: "0x42" }, "hash"],
    ["latest", "latest"], ["pending", "pending"], [undefined, "omitted"],
    [oversized, "number"], [{ blockNumber: oversized }, "number"],
    [{ blockNumber: "0x01" }, "other"], [123, "other"],
  ];
  for (const [block, category] of cases) {
    const value = request("eth_call", { postDataJSON: () => ({ method: "eth_call", params: [{}, block] }) });
    context.emit("request", value);
    const snapshot = observe.snapshot()!;
    assert.equal(snapshot.pendingEthCalls[0].blockTagCategory, category);
    assert.equal(snapshot.pendingEthCalls[0].blockNumber, undefined);
    assert.equal(snapshot.methods.eth_call!.pending, 1);
    assert.ok(!JSON.stringify(snapshot).includes(hash));
    assert.ok(!JSON.stringify(snapshot).includes(oversized));
    context.emit("requestfinished", value);
  }
  assert.equal(observe.snapshot()!.methods.eth_call!.started, cases.length);
  assert.equal(observe.snapshot()!.methods.eth_call!.finished, cases.length);
  observe.stop();
});
