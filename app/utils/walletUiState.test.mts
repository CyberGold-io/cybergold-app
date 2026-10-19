import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Page } from "@playwright/test";
import { observeWalletPageUiState, readWalletUiState, readWalletOnboardingUiState, safeWalletUiState } from "../../tests/trading/walletUiState.ts";
import { observeWalletOnboarding, readWalletSetupDiagnostic, walletOnboardingStep, writeWalletSetupDiagnostic } from "../../tests/trading/runnerDiagnostics.ts";

const turn = () => new Promise(resolve => setImmediate(resolve));
const privateState = { route: "onboarding", url: "private-extension-url", text: "private-wallet-seed",
  controls: { srpInput: { matched: 1, visible: 1, enabled: 1, value: "private-wallet-seed" },
    unknownControl: { matched: 1 }, passwordInput: { visible: 0 } } };
const closedState = { route: "onboarding", controls: { srpInput: { matched: 1, visible: 1, enabled: 1 }, passwordInput: { visible: 0 } } };

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

test("rapid optional progress checkpoints cannot overwrite the final wallet failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wallet-ui-checkpoints-")), path = join(directory, "setup.json");
  try {
    const pending = Array.from({ length: 10 }, () => writeWalletSetupDiagnostic(path, { stage: "wallet-onboarding", result: "running" }));
    const final = { stage: "wallet-onboarding", result: "fail", errorClass: "Error",
      onboarding: { step: "import-srp-confirm", elapsedMs: 100 } } as const;
    pending.push(writeWalletSetupDiagnostic(path, final));
    await Promise.all(pending);
    assert.deepEqual(await readWalletSetupDiagnostic(path), final);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function observerPage() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>(), frame = {};
  let reads = 0, route = "onboarding/import-with-srp", fail = false;
  const blocked = Promise.withResolvers<void>(); let block = false;
  type Locator = { selector: string; and: (other: { selector: string }) => Locator; count: () => Promise<number> };
  const locator = (selector: string, filter?: string): Locator => ({ selector,
    and: other => locator(selector, other.selector), count: async () => {
      reads++; if (block) await blocked.promise;
      if (fail) throw new Error("private-read-error");
      return selector.includes("create-password-new-input") ? filter === ":visible" ? 1 : filter ? 0 : 2 : 0;
    } });
  const page = { mainFrame: () => frame, url: () => `chrome-extension://private-extension/home.html#/${route}?private-request`, locator,
    on: (name: string, callback: (...args: unknown[]) => void) => { const group = listeners.get(name) ?? new Set(); group.add(callback); listeners.set(name, group); },
    off: (name: string, callback: (...args: unknown[]) => void) => { listeners.get(name)?.delete(callback); },
    evaluate: () => { assert.fail("MetaMask scuttles main-world evaluation."); },
    exposeBinding: () => { assert.fail("No main-world wallet binding is installed."); },
  } as unknown as Page;
  return { page, frame, reads: () => reads, blocked,
    setBlock: (value: boolean) => { block = value; }, setFailure: () => { fail = true; }, setRoute: (value: string) => { route = value; },
    emit: (name: string, ...args: unknown[]) => { for (const callback of listeners.get(name) ?? []) callback(...args); },
    listenerCount: () => [...listeners.values()].reduce((total, rows) => total + rows.size, 0) };
}
const flushReads = async () => { for (let i = 0; i < 50; i++) await turn(); };

test("onboarding snapshots use utility-world counts under MetaMask scuttling and avoid credential-key redaction", async () => {
  const fixture = observerPage(), received: { route?: string }[] = [];
  const observation = observeWalletPageUiState(fixture.page, state => { received.push(state); });
  await flushReads(); assert.equal(received.length, 1); assert.equal(received[0].route, "onboarding");
  const state = await readWalletOnboardingUiState(fixture.page);
  assert.deepEqual(state?.controls?.passwordInput, { matched: 2, visible: 1, enabled: 0 });
  assert.equal(Object.hasOwn(state?.controls ?? {}, "password"), false);
  assert.doesNotMatch(JSON.stringify(state), /private|value|"password":/);
  const reads = fixture.reads(); fixture.emit("framenavigated", {}); await flushReads(); assert.equal(fixture.reads(), reads);
  fixture.setRoute("unlock"); fixture.emit("framenavigated", fixture.frame); await flushReads();
  assert.equal(received.at(-1)?.route, "unlock");
  observation.stop(); assert.equal(fixture.listenerCount(), 0);
  const stoppedReads = fixture.reads(); fixture.emit("domcontentloaded"); await flushReads(); assert.equal(fixture.reads(), stoppedReads);
});

test("optional onboarding reads are serialized and stopped lifetimes cannot deliver late state", async () => {
  const fixture = observerPage(); fixture.setBlock(true); let received = 0;
  const observation = observeWalletPageUiState(fixture.page, () => { received++; });
  fixture.emit("domcontentloaded"); fixture.emit("framenavigated", fixture.frame);
  await turn(); assert.equal(fixture.reads(), 1);
  observation.stop(); fixture.blocked.resolve(); await flushReads();
  assert.equal(received, 0); assert.equal(fixture.listenerCount(), 0);
});

test("onboarding read, listener and consumer failures remain optional", async () => {
  const failure = observerPage(); failure.setFailure();
  const observation = observeWalletPageUiState(failure.page, () => { assert.fail("No failed read can emit state."); });
  await flushReads(); observation.stop();
  const fixture = observerPage(), consumer = observeWalletPageUiState(fixture.page, () => { throw new Error("private-consumer"); });
  await flushReads(); consumer.stop();
  const broken = { on: () => { throw new Error("private-listener"); }, off: () => undefined } as unknown as Page;
  assert.doesNotThrow(() => observeWalletPageUiState(broken, () => {}).stop());
});

test("confirmation snapshots retain bounded counts without evaluating in the wallet's main world", async () => {
  const selectors: string[] = [];
  type SnapshotLocator = { selector: string; and: (other: { selector: string }) => SnapshotLocator; count: () => Promise<number> };
  const locator = (selector: string, filter?: string): SnapshotLocator => ({ selector,
    and: (other: { selector: string }) => locator(selector, other.selector),
    count: async () => {
      selectors.push(selector);
      if (!selector.includes('data-testid="confirm-footer-button"')) return 0;
      return filter === ":visible" ? 1 : filter ? 0 : 2;
    },
  });
  const page = { url: () => "chrome-extension://private-extension/notification.html#/confirm-transaction?private-request",
    locator, evaluate: () => { assert.fail("Main-world eval is unavailable under MetaMask hardening."); } } as unknown as Page;
  const observed = await readWalletUiState(page);
  assert.deepEqual(observed, { route: "confirmation", controls: {
    confirmation: { matched: 2, visible: 1, enabled: 0 }, alert: { matched: 0, visible: 0, enabled: 0 },
    alertSubmit: { matched: 0, visible: 0, enabled: 0 }, alertAcknowledge: { matched: 0, visible: 0, enabled: 0 },
  } });
  assert.equal(new Set(selectors).size, 4);
  assert.doesNotMatch(JSON.stringify(observed), /private|notification\.html/);
});

test("confirmation locator failures remain optional and reveal no wallet data", async () => {
  for (const failure of [() => { throw new Error("private-snapshot"); }, () => Promise.reject(new Error("private-snapshot"))]) {
    const page = { url: () => "chrome-extension://private-extension/notification.html#/confirm-transaction",
      locator: () => ({ count: failure }) } as unknown as Page;
    assert.equal(await readWalletUiState(page), undefined);
  }
  assert.equal(await readWalletUiState({ url: () => "private-invalid-url" } as unknown as Page), undefined);
});
