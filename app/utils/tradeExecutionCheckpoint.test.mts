import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { checkpointExecutionStage, executionStages, resultFor } from "../../tests/trading/regression.ts";
import { tradeScenarios } from "../../tests/trading/scenarios.ts";
import { protocolConfigurationFixture } from "../../tests/fixtures/protocol-configuration.ts";

test("execution checkpoints preserve pending outcomes and persist before the original wait", async () => {
  const rows = tradeScenarios.map(scenario => resultFor(scenario, "execution"));
  const original = structuredClone(rows), actions: string[] = [];
  let saved = "";
  await checkpointExecutionStage(rows, "setup-funding", async () => { actions.push("persist"); saved = JSON.stringify(rows); });
  const held = Promise.withResolvers<void>();
  const action = async () => { actions.push("original-wait"); await held.promise; return 17; };
  const pending = action();
  assert.deepEqual(actions, ["persist", "original-wait"]);
  assert.deepEqual(JSON.parse(saved), original.map(row => ({ ...row, executionStage: "setup-funding" })));
  held.resolve(); assert.equal(await pending, 17);
});

test("checkpoint write failures neither replace the original error nor skip the original action", async () => {
  const row = resultFor(tradeScenarios[0], "execution");
  const originalError = new Error("private-wallet-original-error");
  let calls = 0;
  await checkpointExecutionStage([row], "setup-network-add", async () => { throw new Error("private-path-write-error"); });
  await assert.rejects(async () => { calls++; throw originalError; }, error => error === originalError);
  assert.equal(calls, 1); assert.equal(row.code, "not-exercised");
  assert.equal(row.executionStage, "setup-network-add");
  assert.doesNotMatch(JSON.stringify(row), /private-/);
});

test("active fixture checkpoints do not rewrite matrix stages or successful economics", async () => {
  const rows = tradeScenarios.map(scenario => resultFor(scenario, "execution"));
  const fixture = { ...resultFor(tradeScenarios[0], "execution"), id: "fixture-cygld-bootstrap" };
  await checkpointExecutionStage(rows, "setup-ready", async () => {});
  await checkpointExecutionStage([fixture], "ui-prepare-quote", async () => {});
  assert.ok(rows.every(row => row.code === "not-exercised" && row.executionStage === "setup-ready"));
  assert.equal(fixture.executionStage, "ui-prepare-quote");
  assert.equal(rows.length, 20); assert.equal(new Set(executionStages).size, executionStages.length);
});

// Run the actual suite body with inert local stand-ins. A held original action
// exits the child after copying its already-written native report, modelling
// outer process termination without a browser, RPC, wallet signature or timer.
async function heldSuite(suite: "ui" | "independent", stop: "network-add" | "faucet" | "bootstrap-quote") {
  const output = mkdtempSync(join(tmpdir(), "cybergold-body-checkpoint-"));
  const report = join(output, "report.json"), proof = join(output, "proof.json"), script = join(output, "fixture.mjs");
  const source = fileURLToPath(new URL(`../../tests/metamask/${suite === "ui" ? "fixed-api-roundtrips" : "regression-execution"}.spec.ts`, import.meta.url));
  const stubTest = `
const state = globalThis.__bodyFixture;
export const expect = state.expect;
export const test = Object.assign((_name, body) => { state.body = body; }, { setTimeout() {}, step: async (_name, run) => run() });
export const errors = { TimeoutError: class TimeoutError extends Error {} };
`;
  const stubWallet = `
const state = globalThis.__bodyFixture;
export const addLocalNetwork = async () => state.action("network-add");
export const switchLocalNetwork = async () => state.action("network-switch");
export const requestConnection = async () => state.action("connect-request");
export const connectWallet = async () => state.action("connect-confirm");
export const notification = async () => ({ getByTestId: () => ({ click: async () => state.action("rejection-cancel") }) });
`;
  const stubHelpers = `
const state = globalThis.__bodyFixture;
const input = { click: async () => {}, fill: async () => state.action("amount"), inputValue: async () => {
  state.action(state.navigations === 3 ? "bootstrap-quote" : "rejection-quote"); return "1";
} };
export const getMainInput = () => input;
export const ensureBasketInputEditable = async () => input;
export const getSwapButton = async () => ({ click: async () => state.action("rejection-submit") });
export const openFeeDetails = async () => state.action("fee-details");
export const parseAmount = Number;
export const readWalletBalances = async () => { state.action("balances"); return { cygld: 1 }; };
export const selectToken = async () => state.action("token");
export const showAllSellTokens = async () => state.action("show-tokens");
`;
  const header = `
import fs from "node:fs";
import assert from "node:assert/strict";
const fixtureState = globalThis.__bodyFixture = { actions: [], navigations: 0, body: undefined,
  action(name) { this.actions.push(name); if (name === ${JSON.stringify(stop)}) {
    fs.writeFileSync(${JSON.stringify(proof)}, JSON.stringify({ actions: this.actions,
      report: JSON.parse(fs.readFileSync(${JSON.stringify(report)}, "utf8")) })); process.exit(0);
  } },
};
fixtureState.expect = value => ({ not: { toBe: other => assert.notEqual(value, other) }, toBe: other => assert.equal(value, other),
  toBeVisible: async () => {}, toBeEnabled: async () => {}, toHaveText: async () => {}, toEqual: other => assert.deepEqual(value, other) });
fixtureState.expect.poll = read => ({ toBeGreaterThan: async value => assert.ok(await read() > value),
  toBeTruthy: async () => assert.ok(await read()), toBe: async value => assert.equal(await read(), value) });
fixtureState.page = { setDefaultTimeout() {}, on() {}, getByRole: () => ({}), getByText: () => ({}),
  goto: async () => { fixtureState.navigations++; fixtureState.action("navigation"); },
  evaluate: async () => { fixtureState.action("accounts"); return ["0x1111111111111111111111111111111111111111"]; } };
globalThis.fetch = async url => {
  const path = new URL(url).pathname;
  if (path === "/api/protocol/config") { fixtureState.action("config"); return Response.json(${JSON.stringify({ ...protocolConfigurationFixture, chainId: 31337 })}); }
  if (path === "/api/faucet") { fixtureState.action("faucet"); return Response.json({}); }
  throw new Error("unexpected-network-request");
};
`;
  try {
    const result = await build({ entryPoints: [source], bundle: true, write: false, format: "esm", platform: "node",
      banner: { js: header }, footer: { js: "await fixtureState.body({ page: fixtureState.page }); throw new Error('held-action-not-reached');" },
      plugins: [{ name: "inert-wallet", setup(builder) {
        builder.onResolve({ filter: /^(?:@playwright\/test|\.\/testWithMetaMask)$/ }, () => ({ path: "test", namespace: "inert" }));
        builder.onResolve({ filter: /^\.\/wallet-ui$/ }, () => ({ path: "wallet", namespace: "inert" }));
        builder.onResolve({ filter: /^\.\/token-flows\/helpers$/ }, () => ({ path: "helpers", namespace: "inert" }));
        builder.onLoad({ filter: /.*/, namespace: "inert" }, args => ({ contents: args.path === "test" ? stubTest : args.path === "wallet" ? stubWallet : stubHelpers, loader: "js" }));
      } }] });
    writeFileSync(script, result.outputFiles[0].text);
    const environment = fileURLToPath(new URL("../../tests/fixtures/app.env", import.meta.url));
    const child = spawnSync(process.execPath, ["--env-file", environment, script], { stdio: "pipe", encoding: "utf8", env: {
      PATH: process.env.PATH, NODE_ENV: "test", PLAYWRIGHT_BASE_URL: "http://fixture.invalid",
      NEXT_PUBLIC_CHAIN_ID: "31337", NEXT_PUBLIC_WALLET_RPC_URL: "http://private-wallet-rpc.invalid",
      TRADE_REGRESSION_MODE: "sandbox-execution", TRADE_REGRESSION_TARGET: "sandbox",
      TRADE_REGRESSION_FAUCET_REQUEST_ID: "public-fixture-request", TRADE_REGRESSION_OUTPUT: report, TRADE_REGRESSION_UI_OUTPUT: report,
    } });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(readFileSync(proof, "utf8"));
  } finally { rmSync(output, { recursive: true, force: true }); }
}

test("both real suite bodies persist setup stages before held original network and funding actions", async () => {
  for (const suite of ["ui", "independent"] as const) for (const stop of ["network-add", "faucet"] as const) {
    const value = await heldSuite(suite, stop);
    assert.equal(value.report.scenarios.length, suite === "ui" ? 16 : 20);
    assert.ok(value.report.scenarios.every((row: { status: string; code: string; executionStage: string }) =>
      row.status === "unavailable" && row.code === "not-exercised"
      && row.executionStage === (stop === "network-add" ? "setup-network-add" : "setup-funding")));
    assert.deepEqual(value.actions, stop === "network-add" ? ["config", "navigation", "network-add"]
      : ["config", "navigation", "network-add", "network-switch", "connect-request", "connect-confirm", "accounts", "faucet"]);
    assert.doesNotMatch(JSON.stringify(value.report), /private-wallet-rpc|public-fixture-request|111111111111/);
  }
});

test("the real bootstrap retains its held quote stage after funding acceptance and rejection checks", async () => {
  const value = await heldSuite("ui", "bootstrap-quote");
  assert.equal(value.report.fixtures.length, 1);
  assert.equal(value.report.fixtures[0].id, "fixture-cygld-bootstrap");
  assert.equal(value.report.fixtures[0].code, "not-exercised");
  assert.equal(value.report.fixtures[0].executionStage, "ui-prepare-quote");
  assert.ok(value.report.scenarios.every((row: { code: string; executionStage: string }) => row.code === "not-exercised" && row.executionStage === "setup-ready"));
  assert.deepEqual(value.actions, ["config", "navigation", "network-add", "network-switch", "connect-request", "connect-confirm", "accounts", "faucet",
    "navigation", "show-tokens", "token", "token", "amount", "rejection-quote", "fee-details", "balances", "rejection-submit", "rejection-cancel", "balances",
    "navigation", "show-tokens", "token", "token", "amount", "bootstrap-quote"]);
  assert.doesNotMatch(JSON.stringify(value.report), /private-wallet-rpc|public-fixture-request|111111111111/);
});
