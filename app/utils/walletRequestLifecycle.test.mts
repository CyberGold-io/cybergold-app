import assert from "node:assert/strict";
import test from "node:test";
import { expect, type Page } from "@playwright/test";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
import { resultFor } from "../../tests/trading/regression.ts";
import { transactionDisposition } from "../../tests/trading/providerEvidence.ts";
import { tradeScenarios, ScenarioUnavailableError } from "../../tests/trading/scenarios.ts";
import { cleanupOwnedWalletRequest, isWalletRequestCleanupError } from "../../tests/trading/walletRequestLifecycle.ts";

const { requestWallet } = await withEnvironment(appEnvironment, () => import("../../tests/trading/walletExecution.ts"));
const hash = `0x${"a".repeat(64)}`;
const signature = `0x${"b".repeat(130)}`;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const result = () => ({ ...resultFor(tradeScenarios[0], "execution"), executionStage: "execution-submission" as const });

/** Native provider owns this promise; the test driver cannot cancel it directly. */
function nativeFixture(cleanup: "reject" | "reject-generic" | "fulfill" | "stuck" | "close-failure" | "close-fulfill", value = hash) {
  const original = Promise.withResolvers<unknown>();
  let requests = 0, confirms = 0, rejects = 0, closes = 0, closed = false;
  const cancellationError = Object.assign(new Error("private native rejection"), { code: 4001 });
  const button = (cancel = false) => ({
    or() { return this; }, isVisible: async () => !closed,
    click: async () => {
      if (!cancel) { confirms++; return; }
      rejects++;
      if (cleanup === "reject") original.reject(cancellationError);
      if (cleanup === "reject-generic") original.reject(new Error("private generic native failure"));
      if (cleanup === "fulfill") original.resolve(value);
      await tick();
    },
  });
  const popup = { url: () => "chrome-extension://owned/notification.html", bringToFront: async () => {},
    setDefaultTimeout: () => {}, getByTestId: (id: string) => button(id.includes("cancel")), locator: () => button(true) };
  const context = { pages: () => [popup], serviceWorkers: () => [{ url: () => "chrome-extension://owned/background.js" }],
    close: async () => {
      closes++;
      if (cleanup === "close-failure") throw new Error("private ordinary close failure");
      closed = true;
      if (cleanup === "close-fulfill") original.resolve(value);
      else original.reject(new Error("Target page, context or browser has been closed"));
      await tick();
    } };
  const page = { bringToFront: async () => { if (closed) throw new Error("Target closed"); }, context: () => context,
    evaluate: async (callback: (input: unknown) => Promise<unknown>, input: unknown) => {
      requests++;
      const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
      Object.defineProperty(globalThis, "window", { configurable: true,
        value: { ethereum: { request: () => requests === 1 ? original.promise : Promise.resolve(value) } } });
      try { return await callback(input); }
      finally {
        if (previous) Object.defineProperty(globalThis, "window", previous);
        else Reflect.deleteProperty(globalThis, "window");
      }
    } } as unknown as Page;
  return { page, original, counts: () => ({ requests, confirms, rejects, closes, closed }) };
}

/** Same production poll path, with the passage of 90 s represented in one turn. */
async function deadlines<T>(run: () => Promise<T>) {
  const poll = expect.poll;
  expect.poll = ((callback: () => Promise<boolean>, options: { timeout: number; intervals: number[] }) => ({ toBe: async () => {
    if (options.timeout === 90_000) {
      assert.deepEqual(options.intervals, [250, 500, 1000]);
      if (await callback()) return;
      throw new Error("original observer deadline");
    }
    assert.deepEqual(options, { timeout: 5000, intervals: [100, 250, 500] });
    for (let attempt = 0; attempt < 3; attempt++) { if (await callback()) return; await tick(); }
    throw new Error("native cleanup deadline");
  } })) as unknown as typeof expect.poll;
  try { return await run(); } finally { expect.poll = poll; }
}

test("expired original request is rejected before the next case can click its popup", async () => deadlines(async () => {
  const fixture = nativeFixture("reject"), first = { ...result(), executionAttempted: true };
  await assert.rejects(requestWallet(fixture.page, { method: "eth_sendTransaction", params: [] }, false, first),
    error => error instanceof ScenarioUnavailableError && error.code === "wallet-submission-timeout"
      && (error as Error & { walletRequestErrorCode?: number }).walletRequestErrorCode === 4001);
  assert.deepEqual(fixture.counts(), { requests: 1, confirms: 1, rejects: 1, closes: 0, closed: false });
  assert.equal(first.walletRequest?.deadlineExpired, true);
  assert.equal(first.walletRequest?.settlement, "rejected");
  assert.equal(first.walletRequest?.cleanup, "settled");
  assert.equal(first.walletRequest?.pendingAfter, 0);
  assert.equal(first.walletRequest?.requestStage, "execution-submission");
  assert.equal(first.walletRequestErrorCode, 4001);
  assert.equal(transactionDisposition(first), "not-submitted");
  const second = result();
  assert.equal(await requestWallet(fixture.page, { method: "eth_sendTransaction", params: [] }, false, second), hash);
  assert.equal(second.walletRequest?.pendingBefore, 0);
  assert.equal(second.walletRequest?.pendingAfter, 0);
  assert.equal(fixture.counts().requests, 2);
  assert.equal(first.transactionHash, undefined);
  assert.doesNotMatch(JSON.stringify(first), /private|params/);
}));

test("generic rejection during cleanup preserves timeout and does not establish non-submission", async () => deadlines(async () => {
  const fixture = nativeFixture("reject-generic"), evidence = { ...result(), executionAttempted: true };
  await assert.rejects(requestWallet(fixture.page, { method: "eth_sendTransaction", params: [] }, false, evidence),
    error => error instanceof ScenarioUnavailableError && error.code === "wallet-submission-timeout");
  assert.equal(evidence.walletRequest?.settlement, "rejected");
  assert.equal(evidence.walletRequest?.cleanup, "settled");
  assert.equal(evidence.walletRequestErrorCode, undefined);
  assert.equal(evidence.transactionHash, undefined);
  assert.equal(transactionDisposition(evidence), "unknown");
}));

for (const [method, value] of [["eth_sendTransaction", hash], ["eth_signTypedData_v4", signature]])
  test(`original late ${method} result returns without a replacement request`, async () => deadlines(async () => {
    for (const reported of [true, false]) {
      const fixture = nativeFixture("fulfill", value), evidence = result();
      assert.equal(await requestWallet(fixture.page, { method, params: [] }, false, reported ? evidence : undefined), value);
      assert.deepEqual(fixture.counts(), { requests: 1, confirms: 1, rejects: 1, closes: 0, closed: false });
      if (reported) {
        assert.equal(evidence.walletRequest?.deadlineExpired, true);
        assert.equal(evidence.walletRequest?.settlement, "fulfilled");
        assert.equal(evidence.walletRequest?.cleanup, "settled");
        assert.equal(evidence.walletRequest?.pendingAfter, 0);
      }
    }
  }));

test("unresponsive native request disposes the owned context and unwinds the fixture resource", async () => deadlines(async () => {
  const fixture = nativeFixture("stuck"), evidence = result();
  await assert.rejects(requestWallet(fixture.page, { method: "eth_sendTransaction", params: [] }, false, evidence),
    error => isWalletRequestCleanupError(error));
  assert.equal(evidence.walletRequest?.cleanup, "context-closed");
  assert.equal(evidence.walletRequest?.pendingAfter, 0);
  assert.equal(fixture.counts().requests, 1);
  assert.equal(fixture.counts().closes, 1);
  await assert.rejects(requestWallet(fixture.page, { method: "eth_sendTransaction", params: [] }), /Target closed/);
  assert.equal(fixture.counts().requests, 1, "No provider request can start on the disposed resource.");
}));

test("a hash arriving during context disposal stays scoped to its original business or approval request", async () => deadlines(async () => {
  for (const requestStage of ["execution-submission", "approval-submission"] as const) {
    const fixture = nativeFixture("close-fulfill"), evidence = { ...result(), executionStage: requestStage };
    await assert.rejects(requestWallet(fixture.page, { method: "eth_sendTransaction", params: [] }, false, evidence),
      error => isWalletRequestCleanupError(error));
    assert.equal(evidence.walletRequest?.cleanup, "context-closed");
    assert.equal(evidence.walletRequest?.settlement, "fulfilled");
    assert.equal(evidence.walletRequest?.pendingAfter, 0);
    assert.equal(fixture.counts().requests, 1);
    assert.equal(fixture.counts().closes, 1);
    if (requestStage === "execution-submission") {
      assert.equal(evidence.transactionHash, hash);
      assert.equal(evidence.transactionDisposition, "submitted");
      assert.equal(evidence.approvalTransactionHashes, undefined);
    } else {
      assert.deepEqual(evidence.approvalTransactionHashes, [hash]);
      assert.equal(evidence.transactionHash, undefined);
      assert.equal(evidence.transactionDisposition, undefined);
    }
  }
}));

test("ordinary context disposal failure propagates without hiding unresolved ownership", async () => deadlines(async () => {
  const fixture = nativeFixture("close-failure"), evidence = result();
  try {
    await assert.rejects(requestWallet(fixture.page, { method: "eth_signTypedData_v4", params: [] }, false, evidence), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "private ordinary close failure");
      assert.equal(isWalletRequestCleanupError(error), true);
      assert.equal(isWalletRequestCleanupError(new Error(error.message)), false);
      return true;
    });
    assert.equal(evidence.walletRequest?.cleanup, "unresolved");
    assert.equal(evidence.walletRequest?.pendingAfter, 1);
    assert.equal(fixture.counts().requests, 1);
    assert.equal(fixture.counts().closes, 1);
    assert.doesNotMatch(JSON.stringify(evidence), /private ordinary|native rejection/);
  } finally { fixture.original.reject(new Error("fixture cleanup")); await tick(); }
}));

test("cleanup rechecks async settlement before native rejection and before context disposal", async () => deadlines(async () => {
  let reads = 0, closes = 0;
  const page = { context: () => ({ serviceWorkers: () => [], close: async () => { closes++; } }) } as unknown as Page;
  const cleaned = await cleanupOwnedWalletRequest(page, async () => ++reads >= 2);
  assert.equal(cleaned.cleanup, "settled");
  assert.equal(cleaned.cleanupClickAttempts, 0);
  assert.equal(closes, 0);
}));
