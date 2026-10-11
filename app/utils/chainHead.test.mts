import assert from "node:assert/strict";
import test from "node:test";
import { createHeadSchedule, createHeadWatcher, type ChainHead } from "./chainHead.ts";

const head = (hash = "0xaa", timestamp = 100): ChainHead => ({
  chainId: 1, blockHash: hash, blockNumber: "100", blockTimestamp: String(timestamp), observedAt: new Date().toISOString(),
});

test("Mainnet sleeps to the next slot, briefly probes missed slots, then reschedules", () => {
  const schedule = createHeadSchedule(1);
  assert.equal(schedule(head(), 100_250), 12_000);
  assert.equal(schedule(head(), 112_250), 1_000);
  assert.equal(schedule(head(), 113_250), 1_000);
  assert.equal(schedule(head(), 114_250), 1_000);
  assert.equal(schedule(head(), 115_250), 9_000);
  assert.equal(schedule(head("0xbb", 124), 126_250), 10_000);
  assert.equal(createHeadSchedule(31338)(head(), 100_250), 1_000);
});

test("clock shifts cannot postpone a probe beyond a slot and errors never manufacture a head", () => {
  const schedule = createHeadSchedule(1);
  assert.equal(schedule(head(), 1), 12_000);
  const unknown = createHeadSchedule(1);
  for (let attempt = 0; attempt < 3; attempt++) assert.equal(unknown(undefined, 0), 1_000);
  assert.equal(unknown(undefined, 0), 12_000);
});

test("two observers share probes; unchanged hashes do not refresh; same-height replacement does", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0, current = head();
  const events: string[] = [];
  const watcher = createHeadWatcher(31338, (async () => { calls++; return Response.json(current); }) as typeof fetch);
  const stop1 = watcher.subscribe(value => events.push(value.blockHash));
  const stop2 = watcher.subscribe(() => {});
  t.after(() => { stop1(); stop2(); });
  const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  await flush();
  assert.equal(calls, 1);
  assert.deepEqual(events, ["0xaa"]);
  await watcher.read();
  assert.equal(calls, 1);
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(1_000); await flush(); }
  assert.equal(calls, 4);
  assert.deepEqual(events, ["0xaa"]);
  current = head("0xbb"); // number stays 100.
  t.mock.timers.tick(1_000); await flush();
  assert.deepEqual(events, ["0xaa", "0xbb"]);
  stop1();
  t.mock.timers.tick(1_000); await flush();
  assert.equal(calls, 6);
  stop2();
  t.mock.timers.tick(20_000); await flush();
  assert.equal(calls, 6);
});
