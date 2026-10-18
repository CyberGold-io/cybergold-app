import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { failureResult, type ScenarioResult } from "../../tests/trading/regression.ts";
import { transactionDisposition } from "../../tests/trading/providerEvidence.ts";
import { isWalletRequestCleanupError, walletRequestContextClosedError } from "../../tests/trading/walletRequestLifecycle.ts";

const source = readFileSync(new URL("../../tests/metamask/regression-execution.spec.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("diagnostic-suite.ts", source, ts.ScriptTarget.Latest, true);
let roleBody: string, roleCatch: string, suiteCatch: string, suiteFinally: string;
const visit = (node: ts.Node) => {
  if (ts.isTryStatement(node) && node.catchClause?.block.getText(parsed).includes("report.scenarios[index] = failureResult(result, error)")) {
    roleBody = node.tryBlock.getText(parsed);
    roleCatch = node.catchClause.block.getText(parsed);
  }
  if (ts.isTryStatement(node) && node.catchClause?.block.getText(parsed).includes("report.scenarios = report.scenarios.map")) {
    suiteCatch = node.catchClause.block.getText(parsed);
    suiteFinally = node.finallyBlock!.getText(parsed);
  }
  ts.forEachChild(node, visit);
};
visit(parsed); assert.ok(roleBody!); assert.ok(roleCatch!); assert.ok(suiteCatch!); assert.ok(suiteFinally!);

const result = (): ScenarioResult => ({ id: "diagnostic-sale", family: "redeem-token", inputMode: "exact-in", asset: "PAXG",
  requestedStrategy: "core", actualStrategy: "core", layer: "execution", status: "unavailable", code: "execution-not-completed",
  executionStage: "execution-quote", transactionDisposition: "not-submitted" });

for (const receipt of [false, true]) test(`actual diagnostic caller retains ${receipt ? "mined" : "unknown"} role evidence and leaves unexercised inventory after resource disposal`, async () => {
  const current = result(), hash = `0x${"a".repeat(64)}`;
  const untouched = { ...result(), id: "not-yet-exercised", executionAttempted: false, code: "not-exercised", executionStage: "setup-ready" } as ScenarioResult;
  let persisted = 0, nextCase = false, executions = 0;
  const report = { scenarios: [current, untouched], finishedAt: undefined as string | undefined };
  const resourceError = walletRequestContextClosedError();
  const scope = { report, index: 0, result: current, performance, started: performance.now() - 5, failureResult, transactionDisposition,
    scenario: {}, page: {}, config: {}, fetcher: undefined, owner: `0x${"1".repeat(40)}`,
    checkpointExecutionStage: async () => {}, readJson: async () => ({}), observeScenario: async () => ({ result: current }),
    executeScenario: async (observation: { result: ScenarioResult }) => {
      executions++; assert.equal(observation.result.executionAttempted, true, "The actual caller marks execution before its native executor starts.");
      observation.result.executionStage = "execution-submission";
      observation.result.walletRequest = { method: "eth_sendTransaction", settlement: receipt ? "fulfilled" : "pending", elapsedMs: 10,
        pendingBefore: 0, pendingAfter: receipt ? 0 : 1, clickAttempts: 1, clickCompleted: 1, cleanup: "context-closed",
        cleanupElapsedMs: 5, cleanupClickAttempts: 1, cleanupClickCompleted: 1, requestStage: "execution-submission" };
      if (receipt) Object.assign(observation.result, { transactionHash: hash, transactionDisposition: "confirmed",
        receipt: { status: "reverted", transactionHash: hash, blockNumber: "100" } });
      throw resourceError;
    }, isWalletRequestCleanupError, persist: async () => { persisted++; } };
  const { runRole, finish } = vm.runInNewContext(ts.transpile(`async function runRole() { try ${roleBody!} catch (error) ${roleCatch!} }
    async function finish(action) { try { await action(); } catch (error) ${suiteCatch!} finally ${suiteFinally!} }
    ({ runRole, finish });`, { target: ts.ScriptTarget.ES2022 }), scope) as {
    runRole: () => Promise<void>; finish: (action: () => Promise<void>) => Promise<void> };
  assert.equal(current.executionAttempted, undefined);
  await assert.rejects(finish(async () => { await runRole(); nextCase = true; }), error => error === resourceError);
  assert.equal(nextCase, false); assert.equal(executions, 1); assert.equal(persisted, 3); assert.ok(report.finishedAt);
  const failed = report.scenarios[0];
  assert.equal(failed.status, "fail"); assert.equal(failed.walletRequest?.cleanup, "context-closed");
  assert.equal(failed.transactionDisposition, receipt ? "confirmed" : "unknown");
  assert.ok(typeof failed.durationMs === "number");
  if (receipt) { assert.equal(failed.transactionHash, hash); assert.equal(failed.receipt?.status, "reverted"); }
  else assert.equal(failed.transactionHash, undefined);
  assert.equal(report.scenarios[1], untouched); assert.equal(untouched.status, "unavailable"); assert.equal(untouched.code, "not-exercised");
});

test("ordinary diagnostic trade failure remains a failed role without becoming a resource error", async () => {
  const current = result(), report = { scenarios: [current] };
  let persisted = 0;
  const scope = { report, index: 0, result: current, performance, started: performance.now(), failureResult, transactionDisposition,
    scenario: {}, page: {}, config: {}, fetcher: undefined, owner: `0x${"1".repeat(40)}`,
    checkpointExecutionStage: async () => {}, readJson: async () => ({}), observeScenario: async () => ({ result: current }),
    executeScenario: async (observation: { result: ScenarioResult }) => {
      assert.equal(observation.result.executionAttempted, true); observation.result.executionStage = "execution-submission";
      throw new Error("ordinary trade failure");
    }, isWalletRequestCleanupError, persist: async () => { persisted++; } };
  const runRole = vm.runInNewContext(ts.transpile(`async function runRole() { try ${roleBody!} catch (error) ${roleCatch!} }; runRole;`, { target: ts.ScriptTarget.ES2022 }), scope) as () => Promise<void>;
  assert.equal(current.executionAttempted, undefined);
  await runRole();
  assert.equal(report.scenarios[0].status, "fail"); assert.equal(report.scenarios[0].transactionDisposition, "unknown");
  assert.equal(persisted, 1, "The actual caller wrote its initial role; ordinary end-of-case persistence remains outside this try/catch.");
});
