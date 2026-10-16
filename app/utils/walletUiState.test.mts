import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Page } from "@playwright/test";
import { observeWalletPageUiState, readWalletUiState, safeWalletUiState } from "../../tests/trading/walletUiState.ts";
import { observeWalletOnboarding, readWalletSetupDiagnostic, walletOnboardingStep, writeWalletSetupDiagnostic } from "../../tests/trading/runnerDiagnostics.ts";

const turn = () => new Promise(resolve => setImmediate(resolve));
const privateState = { route: "onboarding", url: "private-extension-url", text: "private-wallet-seed",
  controls: { srpInput: { matched: 1, visible: 1, enabled: 1, value: "private-wallet-seed" },
    unknownControl: { matched: 1 }, password: { visible: 0 } } };
const closedState = { route: "onboarding", controls: { srpInput: { matched: 1, visible: 1, enabled: 1 }, password: { visible: 0 } } };

test("wallet UI projection keeps only closed routes, controls and independently safe counters", () => {
  assert.deepEqual(safeWalletUiState(privateState), closedState);
  assert.deepEqual(safeWalletUiState({ route: "private-route", controls: {
    confirmation: { matched: Number.MAX_SAFE_INTEGER, visible: -1, enabled: 0.5 },
    alert: { matched: Number.MAX_SAFE_INTEGER + 1, visible: 0, enabled: "1" },
    unlock: { matched: NaN, enabled: Infinity }, accountMenu: { enabled: 1_000_000_000_001 },
  } }), { controls: { confirmation: { matched: Number.MAX_SAFE_INTEGER }, alert: { visible: 0 }, accountMenu: { enabled: 1_000_000_000_001 } } });
  for (const value of [null, [], "private-state", { route: "private-route" }, { controls: { unknownControl: { matched: 1 } } },
    Object.defineProperty({}, "route", { get: () => { throw new Error("private-getter"); } })])
    assert.equal(safeWalletUiState(value), undefined);
  const detached = safeWalletUiState(privateState)!;
  detached.controls!.srpInput!.matched = 9;
  assert.equal(privateState.controls.srpInput.matched, 1);
  assert.doesNotMatch(JSON.stringify(safeWalletUiState(privateState)), /private|value|unknownControl/);
});

test("onboarding snapshots retain detached safe UI state and stop before late observations", async () => {
  const context = {}, observation = observeWalletOnboarding(context);
  walletOnboardingStep(context, "import-wallet"); observation.uiState(privateState);
  const first = observation.snapshot();
  assert.equal(first.step, "import-wallet"); assert.deepEqual(first.uiState, closedState);
  first.uiState!.controls!.srpInput!.matched = 8;
  assert.deepEqual(observation.snapshot().uiState, closedState);
  observation.stop(); const stopped = observation.snapshot();
  observation.uiState({ route: "home" }); walletOnboardingStep(context, "complete");
  await turn(); assert.deepEqual(observation.snapshot(), stopped);
  const directory = await mkdtemp(join(tmpdir(), "wallet-ui-state-")), path = join(directory, "setup.json");
  try {
    await writeWalletSetupDiagnostic(path, { stage: "wallet-onboarding", result: "fail", onboarding: stopped });
    assert.deepEqual((await readWalletSetupDiagnostic(path))?.onboarding, stopped);
    const raw = JSON.parse(await readFile(path, "utf8")); raw.onboarding.uiState = privateState;
    await writeFile(path, JSON.stringify(raw));
    assert.deepEqual((await readWalletSetupDiagnostic(path))?.onboarding?.uiState, closedState);
    assert.doesNotMatch(JSON.stringify(await readWalletSetupDiagnostic(path)), /private-wallet-seed|private-extension-url|unknownControl/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function observerPage() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const bindings: ((source: unknown, value: unknown) => void)[] = [], evaluations: { mode: string; binding?: string }[] = [];
  const frame = {}, setup = Promise.withResolvers<void>();
  const page = { mainFrame: () => frame,
    on: (name: string, callback: (...args: unknown[]) => void) => { const group = listeners.get(name) ?? new Set(); group.add(callback); listeners.set(name, group); },
    off: (name: string, callback: (...args: unknown[]) => void) => { listeners.get(name)?.delete(callback); },
    exposeBinding: (_name: string, callback: (source: unknown, value: unknown) => void) => { bindings.push(callback); return setup.promise; },
    evaluate: async (_callback: unknown, options: { mode: string; binding?: string }) => { evaluations.push(options); },
  } as unknown as Page;
  return { page, setup, bindings, evaluations, frame,
    emit: (name: string, ...args: unknown[]) => { for (const callback of listeners.get(name) ?? []) callback(...args); },
    listenerCount: () => [...listeners.values()].reduce((total, rows) => total + rows.size, 0) };
}

test("selected-page observation sanitizes binding data and ignores subframes and stopped lifetimes", async () => {
  const fixture = observerPage(), received: unknown[] = [];
  const receive = (value: unknown) => { received.push(value); };
  const first = observeWalletPageUiState(fixture.page, receive);
  fixture.setup.resolve(); await turn();
  assert.equal(fixture.evaluations.length, 1); assert.equal(fixture.evaluations[0].mode, "observe");
  fixture.bindings[0]({}, privateState); assert.deepEqual(received, [closedState]);
  fixture.bindings[0]({}, { route: "private-route" }); assert.equal(received.length, 1);
  fixture.emit("framenavigated", {}); assert.equal(fixture.evaluations.length, 1);
  fixture.emit("framenavigated", fixture.frame); fixture.emit("domcontentloaded"); assert.equal(fixture.evaluations.length, 3);
  first.stop(); const stoppedCount = fixture.evaluations.length;
  assert.equal(fixture.listenerCount(), 0); assert.equal(fixture.evaluations.at(-1)?.mode, "stop");
  fixture.bindings[0]({}, { route: "home" }); fixture.emit("domcontentloaded"); assert.equal(received.length, 1);
  assert.equal(fixture.evaluations.length, stoppedCount);
  const second = observeWalletPageUiState(fixture.page, receive); await turn();
  assert.notEqual(fixture.evaluations.at(-1)?.binding, fixture.evaluations[0].binding);
  fixture.bindings[0]({}, { route: "unlock" }); fixture.bindings[1]({}, { route: "home" });
  assert.deepEqual(received, [closedState, { route: "home" }]); second.stop();
});

test("stopping before binding setup completes prevents later installation and delivery", async () => {
  const fixture = observerPage(); let received = 0;
  const observation = observeWalletPageUiState(fixture.page, () => { received++; });
  observation.stop(); fixture.setup.resolve(); await turn();
  assert.deepEqual(fixture.evaluations.map(row => row.mode), ["stop"]);
  fixture.bindings[0]({}, privateState); assert.equal(received, 0); assert.equal(fixture.listenerCount(), 0);
});

test("optional observer setup, bridge and consumer failures never escape into wallet setup", async () => {
  for (const failure of ["binding-sync", "binding-async", "evaluate-sync", "evaluate-async", "listener"] as const) {
    const page = { mainFrame: () => ({}), on: () => { if (failure === "listener") throw new Error("private-listener"); }, off: () => undefined,
      exposeBinding: () => { if (failure === "binding-sync") throw new Error("private-binding");
        return failure === "binding-async" ? Promise.reject(new Error("private-binding")) : Promise.resolve(); },
      evaluate: () => { if (failure === "evaluate-sync") throw new Error("private-evaluation");
        return failure === "evaluate-async" ? Promise.reject(new Error("private-evaluation")) : Promise.resolve(); } } as unknown as Page;
    const observation = observeWalletPageUiState(page, () => { throw new Error("private-consumer"); });
    await turn(); observation.stop(); await turn();
  }
  const fixture = observerPage(), observation = observeWalletPageUiState(fixture.page, () => { throw new Error("private-consumer"); });
  fixture.setup.resolve(); await turn(); assert.doesNotThrow(() => fixture.bindings[0]({}, privateState)); observation.stop();
});

test("confirmation snapshot reads are optional and project browser data before returning", async () => {
  let options: unknown;
  assert.deepEqual(await readWalletUiState({ evaluate: async (_callback: unknown, value: unknown) => {
    options = value; return privateState;
  } } as unknown as Page), closedState);
  assert.equal((options as { mode: string }).mode, "snapshot");
  assert.deepEqual(Object.keys((options as { selectors: object }).selectors), ["confirmation", "alert", "alertSubmit", "alertAcknowledge"]);
  for (const evaluate of [() => { throw new Error("private-snapshot"); }, () => Promise.reject(new Error("private-snapshot"))])
    assert.equal(await readWalletUiState({ evaluate } as unknown as Page), undefined);
});
