import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { Page } from "@playwright/test";
import { CLIENT_DIAGNOSTIC_EVENT, createSwapDiagnostics, type ClientDiagnostic } from "./clientDiagnostics.ts";
import { installUiSwapObservation, uiSwapObservation } from "../../tests/trading/uiSwapObservation.ts";

const hash = `0x${"a".repeat(64)}` as const;
const original = `0x${"b".repeat(64)}` as const;

function localPage() {
  const scope = new EventTarget() as unknown as Window;
  const before = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: scope });
  const page = { evaluate: async (read: (argument?: string) => unknown, argument?: string) => read(argument) } as unknown as Page;
  return { scope, page, restore() {
    if (before) Object.defineProperty(globalThis, "window", before);
    else Reflect.deleteProperty(globalThis, "window");
  } };
}

test("primary and later receipt recheck share one attempt and retain the confirmed hash", async () => {
  const events: ClientDiagnostic[] = [];
  const swap = createSwapDiagnostics({}, undefined, value => events.push(value));
  const broadcasts = 1;
  let reads = 0;
  swap.submitted(original);
  await assert.rejects(swap.confirm(async () => { reads++; throw new Error("observation unavailable"); }));
  swap.failed({ name: "TimeoutError" });
  const result = await swap.confirm(async () => { reads++; return { transactionHash: hash, logs: [] }; });
  assert.equal(result.transactionHash, hash);
  assert.equal(broadcasts, 1); assert.equal(reads, 2);
  assert.deepEqual(events.map(value => value.outcome), ["started", "submitted", "unconfirmed", "succeeded"]);
  assert.equal(new Set(events.map(value => value.attemptId)).size, 1);
  assert.equal(events.at(-1)?.transactionHash, hash);
  assert.equal(events.at(-1)?.stage, "confirmation");
});

test("synchronous local observation survives telemetry failure and cannot mutate its producer", async () => {
  const local = localPage();
  try {
    installUiSwapObservation(local.scope);
    const network: ClientDiagnostic[] = [];
    local.scope.addEventListener(CLIENT_DIAGNOSTIC_EVENT, event => {
      (event as CustomEvent<ClientDiagnostic>).detail.transactionHash = "private-listener-mutation";
    });
    const swap = createSwapDiagnostics({}, undefined, value => { network.push(value); throw new Error("collector unavailable"); });
    swap.submitted(hash);
    assert.equal((await uiSwapObservation(local.page, swap.id))?.transactionHash, hash);
    assert.equal(network.at(-1)?.transactionHash, hash);
    assert.doesNotMatch(JSON.stringify(network), /private-listener/);
  } finally { local.restore(); }
});

test("late predecessor events retain their own identity and no raw payload is captured", async () => {
  const local = localPage();
  try {
    installUiSwapObservation(local.scope);
    const old = createSwapDiagnostics({}, undefined, () => {});
    const current = createSwapDiagnostics({}, undefined, () => {});
    current.submitted(hash);
    old.submitted(original);
    assert.deepEqual(await uiSwapObservation(local.page), { attemptId: current.id, outcome: "submitted", transactionHash: hash });
    assert.deepEqual(await uiSwapObservation(local.page, old.id), { attemptId: old.id, outcome: "submitted", transactionHash: original });
    local.scope.dispatchEvent(new CustomEvent(CLIENT_DIAGNOSTIC_EVENT, { detail: {
      operation: "swap", attemptId: current.id, outcome: "unconfirmed", transactionHash: "private-calldata",
      message: "private-wallet-url", signature: "private-signature", params: ["private-request"],
    } }));
    assert.deepEqual(await uiSwapObservation(local.page, current.id), { attemptId: current.id, outcome: "unconfirmed", transactionHash: hash });
    assert.doesNotMatch(JSON.stringify(local.scope), /private-/);
  } finally { local.restore(); }
});

test("UI confirmation exercises receipt-only recovery inside its existing deadline without resubmitting", async () => {
  const source = readFileSync(new URL("../../tests/metamask/fixed-api-roundtrips.spec.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("suite.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === "approveUntilMined");
  assert.ok(declaration && ts.isFunctionDeclaration(declaration));
  let confirmed = false, recoveries = 0, observations = 0;
  const approve = vm.runInNewContext(ts.transpile(declaration.getText(parsed), { target: ts.ScriptTarget.ES2022 }) + "; approveUntilMined", {
    errors: { TimeoutError: class extends Error {} },
    confirmedTransactionText: () => ({ isVisible: async () => confirmed }),
    getSwapButton: () => { throw new Error("must not resubmit Swap or touch an unrelated wallet request"); },
    uiCompletionAssertion: async (action: () => Promise<unknown>) => action(),
    expect: { poll: (read: () => Promise<boolean>, options: { timeout: number; intervals: number[] }) => {
      assert.equal(options.timeout, 90_000); assert.deepEqual(Array.from(options.intervals), [250, 500, 1000]);
      return { toBe: async (value: boolean) => { assert.equal(await read(), false); assert.equal(await read(), value); } };
    } },
  }) as (page: Page, submitted: () => boolean, observe: () => Promise<void>) => Promise<void>;
  const page = {
    getByText: () => ({ isVisible: async () => false }),
    getByRole: (_role: string, options: { name: RegExp }) => {
      assert.match("Check confirmation", options.name);
      return { isVisible: async () => !confirmed, isEnabled: async () => true,
        click: async () => { recoveries++; confirmed = true; } };
    },
  } as unknown as Page;
  await approve(page, () => true, async () => { observations++; });
  assert.equal(recoveries, 1); assert.equal(observations, 2);
});
