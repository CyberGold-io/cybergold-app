import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserContext, Page } from "@playwright/test";
import { importMetaMaskWallet } from "../../tests/metamask/import-wallet.ts";
import { observeWalletOnboarding } from "../../tests/trading/runnerDiagnostics.ts";

const steps = ["import-choice", "import-srp-choice", "import-srp-fill", "import-srp-confirm", "import-password-fill",
  "import-password-confirm", "import-password-terms", "import-password-submit", "import-metrics-opt-out", "import-metrics-confirm"];
function fixture(failAt?: string, protocolFailure?: string, detachFailure = false) {
  const actions: { selector: string; action: string; options?: unknown }[] = [];
  const stepsSeen: string[] = [];
  let detached = false, isolated = false;
  const context = { newCDPSession: async () => ({ send: async (command: string, params?: Record<string, unknown>) => {
    if (protocolFailure === command) throw new Error("private-CDP-error");
    if (command === "Page.getFrameTree") return { frameTree: { frame: { id: "owned-wallet-frame" } } };
    if (command === "Page.createIsolatedWorld") { isolated = true; return { executionContextId: 41 }; }
    if (command === "Runtime.callFunctionOn") {
      assert.equal(isolated, true); assert.equal(params?.executionContextId, 41);
      assert.doesNotMatch(String(params?.functionDeclaration), /private-seed|private-password/);
      assert.match(String(params?.functionDeclaration), /new ClipboardEvent\("paste"/);
      assert.doesNotMatch(String(params?.functionDeclaration), /navigator\.clipboard|permissions/);
      assert.deepEqual(params?.arguments, [{ value: '[data-testid="srp-input-import__srp-note"]' }, { value: "private-seed" }]);
      return protocolFailure === "paste-exception" ? { exceptionDetails: { text: "private-runtime-error" } } : {};
    }
    throw new Error("unexpected-protocol-command");
  }, detach: async () => { detached = true; if (detachFailure) throw new Error("private-detach-error"); } }) };
  const observation = observeWalletOnboarding(context, () => {
    stepsSeen.push(observation.snapshot().step);
  });
  const locator = (selector: string) => ({ click: async () => {
    actions.push({ selector, action: "click" });
    if (observation.snapshot().step === failAt) throw Object.assign(new Error("private-click-error"), { name: "TimeoutError" });
  }, type: async (_value: string, options: unknown) => {
    actions.push({ selector, action: "type", options });
    if (observation.snapshot().step === failAt) throw new Error("private-type-error");
  } });
  const page = { locator, getByTestId: (id: string) => locator(`[data-testid="${id}"]`),
    evaluate: () => { assert.fail("Do not evaluate in MetaMask's main world."); } };
  return { context: context as unknown as BrowserContext, page: page as unknown as Page, observation, actions, stepsSeen,
    detached: () => detached };
}

test("shared import uses the pinned native sequence with one isolated UI paste and no clipboard policy changes", async () => {
  const f = fixture();
  await importMetaMaskWallet(f.context, f.page, "private-seed", "private-password");
  assert.deepEqual(f.stepsSeen, steps);
  assert.deepEqual(f.actions.map(row => row.action), ["click", "click", "click", "click", "type", "type", "click", "click", "click", "click"]);
  assert.deepEqual(f.actions.filter(row => row.action === "type").map(row => row.options), [{ delay: 20 }, { delay: 20 }]);
  assert.equal(f.detached(), true);
  assert.doesNotMatch(JSON.stringify(f.observation.snapshot()), /private|phrase|password/);
  f.observation.stop();
});

test("each native import action retains its exact safe step and propagates the ordinary failure", async () => {
  for (const step of steps) {
    const f = fixture(step);
    await assert.rejects(importMetaMaskWallet(f.context, f.page, "private-seed", "private-password"), /private-(?:click|type)-error/);
    assert.equal(f.observation.snapshot().step, step);
    assert.deepEqual(f.stepsSeen, steps.slice(0, steps.indexOf(step) + 1));
    assert.doesNotMatch(JSON.stringify(f.observation.snapshot()), /private/);
    f.observation.stop();
  }
});

test("owned isolated-world failures retain SRP entry stage and always release an opened CDP session", async () => {
  for (const failure of ["Page.getFrameTree", "Page.createIsolatedWorld", "Runtime.callFunctionOn", "paste-exception"]) {
    const f = fixture(undefined, failure);
    await assert.rejects(importMetaMaskWallet(f.context, f.page, "private-seed", "private-password"));
    assert.equal(f.observation.snapshot().step, "import-srp-fill"); assert.equal(f.detached(), true);
    assert.doesNotMatch(JSON.stringify(f.observation.snapshot()), /private|runtime-error|CDP-error/);
    f.observation.stop();
  }
});

test("optional progress consumer errors cannot reject the native import", async () => {
  const f = fixture(); f.observation.stop();
  const observation = observeWalletOnboarding(f.context, () => { throw new Error("private-diagnostic-error"); });
  await importMetaMaskWallet(f.context, f.page, "private-seed", "private-password");
  assert.equal(observation.snapshot().step, "import-metrics-confirm"); observation.stop();
});

test("CDP cleanup preserves an earlier import failure and exposes cleanup failure after success", async () => {
  const first = fixture(undefined, "Runtime.callFunctionOn", true);
  await assert.rejects(importMetaMaskWallet(first.context, first.page, "private-seed", "private-password"), /private-CDP-error/);
  assert.equal(first.detached(), true); first.observation.stop();
  const cleanup = fixture(undefined, undefined, true);
  await assert.rejects(importMetaMaskWallet(cleanup.context, cleanup.page, "private-seed", "private-password"), /private-detach-error/);
  assert.equal(cleanup.detached(), true); cleanup.observation.stop();
});
