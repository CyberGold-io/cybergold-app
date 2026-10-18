import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { observeBrowserQuotes } from "../../tests/trading/browserQuotes.ts";
import { tradeScenarios } from "../../tests/trading/scenarios.ts";
import { tokenRequest } from "../../tests/trading/regression.ts";
import { protocolConfigurationFixture } from "../../tests/fixtures/protocol-configuration.ts";
import type { ScenarioResult } from "../../tests/trading/regression.ts";

type Action = "navigation" | "wallet" | "tokens" | "amount" | "fill" | "observation" | "display";

/** Execute the real observer and picker helpers, replacing only browser I/O. */
async function firstBrowserCase(t: TestContext, failure?: { action: Action; name: string; code?: string }, terminalError = false,
  checkpoint?: (results: readonly ScenarioResult[]) => Promise<void>) {
  const actions: string[] = [];
  let navigations = 0, filled = false;
  const action = (name: Action) => {
    actions.push(name);
    if (failure?.action === name) throw Object.assign(new Error("private-provider-token private-url private-dom"), {
      name: failure.name, code: failure.code,
    });
  };
  const requestId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e";
  const request = tokenRequest(tradeScenarios[0], protocolConfigurationFixture, protocolConfigurationFixture.contracts.helpers!);
  const quote = { mode: "exact-in", side: "buy", strategy: "core", quotedInput: request.amount,
    inputMaximum: request.amount, quotedOutput: "100", outputMinimum: "99" };
  const observation = { path: "/api/quotes/trade/stream", status: 200, request, requestId,
    terminal: terminalError ? { type: "error", code: "quote-timeout", requestId, error: "private-terminal-error" }
      : { type: "complete", value: quote } };
  const locator = (kind: "wallet" | "tokens" | "amount" | "filter" = "tokens"): unknown => {
    const value = {
      _apiName: "Locator", _expect: async () => ({ matches: true }),
      filter: () => value, first: () => value, last: () => value,
      getByRole: () => value, locator: () => value, or: () => value,
      waitFor: async () => { action("wallet"); },
      isVisible: async () => false,
      click: async () => { action(kind === "amount" ? "amount" : "tokens"); },
      fill: async () => { action("fill"); filled = true; },
      inputValue: async () => { action("display"); return "1"; },
    };
    return value;
  };
  const page = {
    setDefaultTimeout: (timeout: number) => { actions.push(`default-timeout:${timeout}`); },
    addInitScript: async () => { actions.push("install-observer"); },
    goto: async () => {
      // Remaining matrix rows still run; stop them at their original navigation.
      if (navigations++) throw new Error("private-later-case");
      action("navigation");
    },
    getByRole: (_role: string, options?: { name?: string }) => locator(options?.name === "Connect Wallet" ? "wallet" : "tokens"),
    locator: (selector: string) => locator(selector.endsWith("-amount") ? "amount" : selector === "#wallet-only-tokens" ? "filter" : "tokens"),
    evaluate: async () => { action("observation"); return filled ? [observation] : []; },
    close: async () => { actions.push("page-close"); },
  };
  t.mock.method(chromium, "launch", async () => ({ newPage: async () => page,
    close: async () => { actions.push("browser-close"); } } as unknown as Browser));
  // Evaluate each existing poll once; fixture failures need no wall-clock wait.
  t.mock.method(expect, "poll", ((read: () => Promise<unknown>) => ({
    toBe: async (expected: unknown) => assert.equal(await read(), expected),
    toBeGreaterThan: async (expected: bigint) => assert.ok((await read() as bigint) > expected),
  })) as never);
  const rows = await observeBrowserQuotes("http://fixture.invalid", protocolConfigurationFixture, {} as never, undefined, checkpoint);
  assert.equal(rows.length, 16); assert.equal(navigations, 16);
  assert.deepEqual(actions.slice(-2), ["page-close", "browser-close"]);
  assert.doesNotMatch(JSON.stringify(rows), /private-/);
  return { first: rows[0], actions, requestId };
}

for (const [action, stage, name, code] of [
  ["navigation", "ui-prepare-navigation", "TimeoutError", undefined],
  ["wallet", "ui-prepare-wallet", "TimeoutError", undefined],
  ["tokens", "ui-prepare-tokens", "Error", "EACCES"],
  ["amount", "ui-prepare-amount", "AbortError", "private-code"],
  ["fill", "ui-prepare-quote", "TimeoutError", undefined],
  ["observation", "ui-prepare-quote", "private-error-name", "private-code"],
  ["display", "ui-prepare-quote", "TimeoutError", undefined],
] as const) test(`quotes-only UI retains ${action} failure context without rewriting its failure`, async t => {
  const { first } = await firstBrowserCase(t, { action, name, code });
  assert.equal(first.id, "ui-core-issue-paxg-exact-in");
  assert.equal(first.status, "fail"); assert.equal(first.requestedStrategy, "auto");
  assert.equal(first.executionStage, stage);
  assert.equal(first.code, /Timeout|Abort/.test(name) ? "service-unavailable" : "unexpected-error");
  assert.equal(first.errorClass, name === "private-error-name" ? "UnknownError" : name);
  assert.equal(first.errorCode, code === "EACCES" ? "EACCES" : undefined);
});

test("quotes-only terminal failures retain the real quote code and request reference", async t => {
  const { first, requestId } = await firstBrowserCase(t, undefined, true);
  assert.equal(first.executionStage, "ui-prepare-quote");
  assert.equal(first.status, "fail"); assert.equal(first.code, "quote-timeout");
  assert.equal(first.refs?.requestId, requestId); assert.equal(first.errorClass, "Error");
});

test("quotes-only success preserves original UI actions and quote bounds", async t => {
  const { first, actions, requestId } = await firstBrowserCase(t);
  assert.equal(first.status, "pass"); assert.equal(first.code, undefined);
  assert.equal(first.executionStage, "complete"); assert.equal(first.actualStrategy, "core");
  assert.equal(first.errorClass, undefined); assert.equal(first.refs?.requestId, requestId);
  assert.equal(first.bounds?.quotedOutput, "100");
  assert.deepEqual(actions, ["default-timeout:20000", "install-observer", "navigation", "wallet",
    "tokens", "tokens", "tokens", "tokens", "amount", "observation", "fill", "observation", "display", "page-close", "browser-close"]);
});

test("quote observer checkpoints each completed result before moving to the next case", async t => {
  const snapshots: ScenarioResult[][] = [];
  const { first } = await firstBrowserCase(t, undefined, false, async rows => { snapshots.push(structuredClone([...rows])); });
  assert.deepEqual(snapshots.map(rows => rows.length), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.deepEqual(snapshots[0], [first]);
  assert.equal(snapshots[1][0].status, "pass"); assert.equal(snapshots[1][1].status, "fail");
  assert.ok(snapshots.every(rows => rows.at(-1)?.durationMs !== undefined));
});

test("unavailable optional quote checkpoint storage cannot change a completed quote outcome", async t => {
  let attempts = 0;
  const { first } = await firstBrowserCase(t, undefined, false, async () => {
    attempts++; throw Object.assign(new Error("private-checkpoint-path"), { code: "ENOSPC" });
  });
  assert.equal(attempts, 16); assert.equal(first.status, "pass");
  assert.equal(first.code, undefined); assert.equal(first.executionStage, "complete");
});
