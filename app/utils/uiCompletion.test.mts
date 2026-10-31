import assert from "node:assert/strict";
import test from "node:test";
import { errors, type Page } from "@playwright/test";
import { approveUntilMined } from "../../tests/trading/uiCompletion.ts";
import { isUiCompletionDeadlineError } from "../../tests/trading/uiDiagnostics.ts";

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function fixture(options: { recheck?: boolean; click: () => Promise<void>; closed?: boolean; step?: string; stepDelay?: number; stepFinished?: () => void }) {
  const state = { visible: false, submitted: false, clicks: 0, opens: 0, observations: 0, timeouts: [] as number[], phases: [] as string[] };
  const control = { isVisible: async () => true, or: () => control,
    click: async ({ timeout }: { timeout: number }) => { state.clicks++; state.timeouts.push(timeout); await options.click(); } };
  const popup = { url: () => "chrome-extension://fixture/notification.html", bringToFront: async () => { state.opens++; },
    setDefaultTimeout() {}, getByTestId: () => control, locator: () => control, isClosed: () => Boolean(options.closed) };
  const success = { isVisible: async () => state.visible, filter: () => success, first: () => success };
  const page = {
    getByText: (pattern: RegExp) => pattern.test("Transaction confirmed") ? success : { isVisible: async () => false },
    getByRole: () => ({ isVisible: async () => Boolean(options.recheck), isEnabled: async () => true, click: control.click }),
    locator: () => ({ last: () => ({ innerText: async () => { if (options.stepDelay) await delay(options.stepDelay); options.stepFinished?.(); return options.step ?? "MetaMask 1 of 1: Transaction confirmation"; } }) }),
    context: () => ({ serviceWorkers: () => [{ url: () => "chrome-extension://fixture/background.js" }], pages: () => [popup] }),
  } as unknown as Page;
  return { state, page, observe: async (phase: string) => { state.observations++; state.phases.push(phase); return undefined; } };
}

for (const recheck of [false, true]) test(`completion during final ${recheck ? "receipt recheck" : "native"} action is observed without another interval`, async () => {
  const f = fixture({ recheck, click: async () => { await delay(500); f.state.submitted = true; f.state.visible = true; } });
  await approveUntilMined(f.page, () => f.state.submitted, f.observe, undefined, performance.now() + 650);
  assert.equal(f.state.clicks, 1); assert.equal(f.state.observations, 2);
  assert.deepEqual(f.state.phases, ["before-action", "after-action"]);
  assert.equal(f.state.opens, recheck ? 0 : 1); assert.ok(f.state.timeouts[0] > 0 && f.state.timeouts[0] <= 650);
});

test("a submitted hash without visible UI completion retains failure", async () => {
  const f = fixture({ click: async () => { await delay(500); f.state.submitted = true; } });
  await assert.rejects(approveUntilMined(f.page, () => f.state.submitted, f.observe, undefined, performance.now() + 650), error =>
    isUiCompletionDeadlineError(error) && (error as { code?: string }).code === "submitted-unconfirmed");
  assert.equal(f.state.visible, false); assert.equal(f.state.clicks, 1);
});

test("an action completing after the original deadline cannot turn into success", async () => {
  const finished = Promise.withResolvers<void>();
  const f = fixture({ click: async () => { await delay(100); f.state.submitted = true; f.state.visible = true; finished.resolve(); } });
  await assert.rejects(approveUntilMined(f.page, () => f.state.submitted, f.observe, undefined, performance.now() + 60), isUiCompletionDeadlineError);
  await finished.promise;
  assert.equal(f.state.visible, true); assert.equal(f.state.clicks, 1); assert.ok(f.state.timeouts[0] > 0 && f.state.timeouts[0] <= 60);
  assert.equal(f.state.observations, 1, "Expired work does not start another optional read.");
});

test("expired original allowance makes no UI or native action and never uses timeout zero", async () => {
  const f = fixture({ click: async () => { assert.fail("No native click after expiry"); } });
  await assert.rejects(approveUntilMined(f.page, () => false, f.observe, undefined, performance.now() - 1), isUiCompletionDeadlineError);
  assert.deepEqual(f.state.timeouts, []); assert.equal(f.state.observations, 0); assert.equal(f.state.opens, 0);
});

test("a UI label read exhausting the original allowance does not open or navigate a native view", async () => {
  const labelFinished = Promise.withResolvers<void>();
  const f = fixture({ stepDelay: 100, stepFinished: labelFinished.resolve, click: async () => { assert.fail("No native action after slow UI read"); } });
  await assert.rejects(approveUntilMined(f.page, () => false, f.observe, undefined, performance.now() + 60), isUiCompletionDeadlineError);
  await labelFinished.promise;
  assert.equal(f.state.opens, 0); assert.equal(f.state.clicks, 0);
});

test("optional observation and native diagnostics failures do not block visible completion", async () => {
  const f = fixture({ click: async () => { await delay(500); f.state.visible = true; } });
  await approveUntilMined(f.page, () => false, async () => { throw new Error("optional read unavailable"); },
    () => { throw new Error("optional record unavailable"); }, performance.now() + 650);
  assert.equal(f.state.clicks, 1);
});

test("a closed popup after its original native click can still expose UI completion", async () => {
  const f = fixture({ closed: true, click: async () => { f.state.visible = true; throw new Error("Native popup closed"); } });
  await approveUntilMined(f.page, () => false, f.observe, undefined, performance.now() + 650);
  assert.equal(f.state.clicks, 1);
});

test("an ordinary native error retains its identity", async () => {
  const original = new Error("ordinary native control error");
  const f = fixture({ click: async () => { throw original; } });
  await assert.rejects(approveUntilMined(f.page, () => false, f.observe, undefined, performance.now() + 650), error => error === original);
  assert.equal(f.state.clicks, 1);
});

test("a bound terminal failure wins over stale visible success and retains its identity", async () => {
  const original = new Error("current product-reported revert");
  const f = fixture({ click: async () => { assert.fail("No native action after terminal failure"); } });
  f.state.visible = true;
  await assert.rejects(approveUntilMined(f.page, () => true, async () => original, undefined, performance.now() + 650), error => error === original);
  assert.equal(f.state.clicks, 0);
});

test("a native timeout before completion does not create a second confirmation allowance", async () => {
  const f = fixture({ click: async () => { await delay(500); throw new errors.TimeoutError("ordinary native timeout"); } });
  await assert.rejects(approveUntilMined(f.page, () => false, f.observe, undefined, performance.now() + 650), error =>
    isUiCompletionDeadlineError(error) && (error as { code?: string }).code === "ui-completion-not-observed");
  assert.equal(f.state.clicks, 1); assert.ok(f.state.observations >= 2);
});

for (const recheck of [false, true]) test(`asynchronous UI completion after final ${recheck ? "receipt recheck" : "native"} click uses only the original remaining allowance`, async () => {
  const finished = Promise.withResolvers<void>();
  const f = fixture({ recheck, click: async () => {
    await delay(500); f.state.submitted = true;
    setTimeout(() => { f.state.visible = true; finished.resolve(); }, 50);
  } });
  try {
    await approveUntilMined(f.page, () => f.state.submitted, f.observe, undefined, performance.now() + 700);
    assert.equal(f.state.visible, true); assert.equal(f.state.clicks, 1);
    assert.ok(f.state.phases.slice(1).every(phase => phase === "after-action"));
  } finally { await finished.promise; }
});

test("a waiting-for-confirmation label consumes the final allowance with observations only", async () => {
  const f = fixture({ step: "Waiting for confirmation", click: async () => { assert.fail("No additional native action while waiting"); } });
  const visible = setTimeout(() => { f.state.visible = true; }, 60);
  try {
    await approveUntilMined(f.page, () => true, f.observe, undefined, performance.now() + 200);
    assert.equal(f.state.clicks, 0); assert.equal(f.state.opens, 0);
  } finally { clearTimeout(visible); }
});

test("asynchronous success beyond the original deadline fails and the read-only tail starts no later reads", async () => {
  const finished = Promise.withResolvers<void>();
  const f = fixture({ click: async () => {
    await delay(50); f.state.submitted = true;
    setTimeout(() => { f.state.visible = true; finished.resolve(); }, 150);
  } });
  await assert.rejects(approveUntilMined(f.page, () => f.state.submitted, f.observe, undefined, performance.now() + 120), isUiCompletionDeadlineError);
  const observations = f.state.observations;
  await finished.promise;
  assert.equal(f.state.visible, true); assert.equal(f.state.clicks, 1);
  assert.equal(f.state.observations, observations);
});

test("multiple ordinary native polls retain their schedule before the final read-only slice", async () => {
  const f = fixture({ click: async () => { if (f.state.clicks === 4) f.state.visible = true; } });
  await approveUntilMined(f.page, () => false, f.observe, undefined, performance.now() + 3000);
  assert.equal(f.state.clicks, 4); assert.equal(f.state.opens, 4);
  assert.deepEqual(f.state.phases, ["before-action", "after-action", "before-action", "after-action", "before-action", "after-action", "before-action", "after-action"]);
});
