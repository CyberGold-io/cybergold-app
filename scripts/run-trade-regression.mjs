#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ScenarioUnavailableError, tradeScenarios } from "../tests/trading/scenarios.ts";
import { failureResult, observeScenario, originFetch, readJson, resultFor } from "../tests/trading/regression.ts";
import { executionCoverage } from "../tests/trading/providerEvidence.ts";
import { activeMatrixTemplates, buildMatrix, readValuation, matrixCountsFor, matrixTemplates } from "../tests/trading/matrix.ts";
import { observeBrowserQuotes } from "../tests/trading/browserQuotes.ts";
import { enrichResultQuality } from "../tests/trading/quoteQuality.ts";
import { qualificationBackendRevision, readWalletSetupDiagnostic, readWalletTestDiagnostics, safeCommandResult, safeRunnerError } from "../tests/trading/runnerDiagnostics.ts";
import { regressionPolicy, unexpectedFailure } from "../tests/trading/runPolicy.ts";

const { values } = parseArgs({ options: { target: { type: "string" }, mode: { type: "string", default: "quotes" },
  "diagnostic-scenario": { type: "string" }, "output-dir": { type: "string" }, "base-url": { type: "string" },
  "run-policy": { type: "string" } } });
const runPolicy = regressionPolicy(values["run-policy"] ?? process.env.TRADE_REGRESSION_RUN_POLICY);
if (!values.target) throw new Error("--target is required");
if (!["sandbox", "mainnet"].includes(values.target)) throw new Error("--target must be sandbox or mainnet");
if (!["quotes", "sandbox-execution", "fork-execution"].includes(values.mode)) throw new Error("--mode must be quotes, sandbox-execution or fork-execution");
if (!values["output-dir"]) throw new Error("--output-dir is required");
const output = resolve(values["output-dir"]);
await mkdir(output, { recursive: true });
const diagnosticId = values["diagnostic-scenario"]?.replace(/^ui-/, "");
const legacyDiagnostic = diagnosticId && tradeScenarios.find(s => s.id === diagnosticId);
let inventory = legacyDiagnostic ? [legacyDiagnostic]
  : diagnosticId ? matrixTemplates().filter(scenario => scenario.id === diagnosticId) : activeMatrixTemplates();
const report = { schema: "cybergold.trade-regression.v1", runId: randomUUID(), target: values.target, mode: values.mode, runPolicy,
  ...(values.mode === 'sandbox-execution' ? { suite: 'sequential' } : {}),
  startedAt: new Date().toISOString(), matrix: matrixCountsFor(inventory, diagnosticId ? 1 : 2), progress: { completedScenarioIds: [] },
  runnerOutcome: "pass", runnerDiagnostics: { stage: "origin" }, scenarios: [] };

let qualityConfiguration;

async function walletResults() {
  const walletTests = await readWalletTestDiagnostics({ ui: resolve(output, "wallet-fixture-ui.json"),
    independent: resolve(output, "wallet-fixture-independent.json") });
  if (Object.keys(walletTests).length) report.runnerDiagnostics.walletTests = walletTests;
  let firstProblem;
  report.fixtures = [];
  for (const [file, stage, ui] of [...(values["diagnostic-scenario"] ? [["regression-execution.json", "independent-report", false]] : [["regression-ui.json", "ui-report", true]])]) {
    try {
      const native = JSON.parse(await readFile(resolve(output, file), "utf8"));
      report.scenarios.push(...native.scenarios);
      if (native.valuation) report.valuation = native.valuation;
      if (native.observations) report.observations = { ...report.observations, ...native.observations };
      if (native.suite === 'sequential' || native.suite === 'independent') report.suite = native.suite;
      if (native.progress) report.progress = native.progress;
      if (native.diagnosticStop) report.diagnosticStop = native.diagnosticStop;
      if (Array.isArray(native.fixtures)) report.fixtures.push(...native.fixtures);
    } catch (error) {
      const code = ui ? "ui-results-unavailable" : "execution-results-unavailable";
      firstProblem ??= { stage, code, ...safeRunnerError(error) };
      report.scenarios.push(...unobservedRows(code, ui));
    }
  }
  if (firstProblem) {
    const { code, ...diagnostic } = firstProblem;
    report.runnerDiagnostics = { ...report.runnerDiagnostics, ...diagnostic };
    report.runnerOutcome = "fail"; report.runnerCode = code;
  }
  return !firstProblem;
}

function unobservedRows(code, ui = !diagnosticId) {
  return inventory.map(scenario => ({ ...resultFor(scenario, "execution"), code, executionAttempted: false, transactionDisposition: 'not-submitted',
    ...(ui ? { id: `ui-${scenario.id}`, requestedStrategy: "auto" } : {}) }));
}

function quoteFailure(scenario, error) {
  const result = failureResult(resultFor(scenario, diagnosticId ? "api" : "browser"), error);
  return diagnosticId ? result : { ...result, id: `ui-${scenario.id}`, requestedStrategy: "auto" };
}

function command(executable, args, env) {
  return new Promise(resolveResult => {
    // Wallet onboarding, signed request bodies and provider output are never
    // copied into regression artifacts. The structured result survives failures.
    const child = spawn(executable, args, { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "ignore"] });
    const forward = () => child.kill("SIGTERM");
    process.once("SIGTERM", forward); process.once("SIGINT", forward);
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      process.removeListener("SIGTERM", forward); process.removeListener("SIGINT", forward); resolveResult(result);
    };
    child.once("error", error => finish({ exitCode: 1, ...safeRunnerError(error) }));
    child.once("exit", (code, signal) => finish(safeCommandResult(code, signal)));
  });
}
try {
  if (values.mode === "fork-execution") {
    const names = ["BACKEND_IMAGE", "CONTRACTS_JSON", "FUNDING_JSON", "MAINNET_RPC_URL"];
    if (names.some(name => !process.env[name])) throw new ScenarioUnavailableError("fork-fixture-configuration-unavailable");
    report.runnerDiagnostics.stage = "fork-qualification";
    const childResult = await command("python3", ["scripts/qualify-fixed-api-wallet.py", "--backend-image", process.env.BACKEND_IMAGE,
      "--contracts-json", process.env.CONTRACTS_JSON, "--funding-json", process.env.FUNDING_JSON, "--output-dir", output],
      { TRADE_REGRESSION_TARGET: values.target, TRADE_REGRESSION_RUN_POLICY: runPolicy });
    try {
      const qualification = JSON.parse(await readFile(resolve(output, "qualification.json"), "utf8"));
      const context = {};
      if (/^[0-9a-f]{40}$/.test(qualification.frontendCommit ?? "")) context.appRevision = qualification.frontendCommit;
      const backendRevision = qualificationBackendRevision(qualification);
      if (backendRevision) context.backendRevision = backendRevision;
      if (Number.isSafeInteger(qualification.forkBlock)) context.blockNumber = String(qualification.forkBlock);
      if (/^0x[0-9a-f]{64}$/i.test(qualification.forkBlockHash ?? "")) context.blockHash = qualification.forkBlockHash;
      if (/^sha256:[0-9a-f]{64}$/.test(qualification.backendImageId ?? "")) context.backendImageId = qualification.backendImageId;
      report.context = context;
      const observation = {};
      if (["running", "pass", "fail"].includes(qualification.result)) observation.result = qualification.result;
      if (["source", "fork", "funding", "core-preparation", "helpers-preparation", "backend", "frontend", "wallet-cache", "wallet-tests", "receipts"].includes(qualification.stage)) observation.stage = qualification.stage;
      if (["timeout", "interrupted", "command-failed", "system-error", "operation-failed", "unexpected-error"].includes(qualification.errorClass)) observation.errorClass = qualification.errorClass;
      if (qualification.cleanup && typeof qualification.cleanup === "object") {
        observation.cleanup = {};
        for (const key of ["processes", "containers", "network", "source"])
          if (["complete", "failed"].includes(qualification.cleanup[key])) observation.cleanup[key] = qualification.cleanup[key];
      }
      report.qualification = observation;
    } catch { /* Optional release observations never admit or reject a run. */ }
    report.runnerDiagnostics = { ...report.runnerDiagnostics, ...childResult };
    const available = await walletResults();
    if (available && childResult.exitCode !== 0) { report.runnerOutcome = "fail"; report.runnerCode = "fork-qualification-failed"; }
  } else {
    const origin = values["base-url"] ?? process.env.APP_BASE_URL;
    if (!origin) throw new ScenarioUnavailableError("app-origin-unavailable");
    const fetcher = originFetch(origin, response => {
      const revision = response.headers.get("X-CyberGold-Backend-Revision");
      if (/^[0-9a-f]{40}$/.test(revision ?? "")) report.context = { ...report.context, backendRevision: revision };
    });
    try {
      const html = await (await fetcher("/en")).text();
      const footerLink = html.match(/<a\b[^>]*\bdata-testid="deployed-commit"[^>]*>/)?.[0];
      const revision = footerLink?.match(/\btitle="([a-f0-9]{40})"/)?.[1];
      if (revision) report.context = { ...report.context, appRevision: revision };
    } catch { /* Optional deployed release observation never admits a run. */ }
    report.runnerDiagnostics.stage = "config-facts";
    const [config, facts] = await Promise.all([readJson(fetcher, "/api/protocol/config"),
      readJson(fetcher, "/api/protocol/facts")]);
    qualityConfiguration = config;
    report.observations = { chainId: config.chainId, forkGeneration: config.sandboxForkGeneration };
    if (legacyDiagnostic) inventory = [legacyDiagnostic];
    else {
      report.valuation = await readValuation(config, facts, fetcher);
      inventory = buildMatrix(config, report.valuation, inventory);
    }
    const diagnostic = diagnosticId ? inventory[0] : undefined;
    if (diagnosticId) {
      if (!diagnostic) throw new ScenarioUnavailableError("diagnostic-scenario-unavailable");
      report.diagnostic = { scenarioId: diagnostic.id, source: legacyDiagnostic ? "legacy-scenario" : "matrix-scenario", newAttempt: true };
      if (diagnostic.sizingError) throw new ScenarioUnavailableError(diagnostic.sizingError);
    }
    const matrixPath = resolve(output, "matrix.json");
    report.matrix = matrixCountsFor(inventory, diagnosticId ? 1 : 2);
    await writeFile(matrixPath, JSON.stringify({ matrix: report.matrix, valuation: report.valuation, scenarios: inventory }) + "\n");
    if (values.mode === "quotes") {
      const checkpoint = async scenarios => {
        const completed = scenarios.filter(row => row.code !== 'not-exercised');
        report.progress = { completedScenarioIds: completed.map(row => row.id) };
        if (runPolicy === 'diagnostic') {
          const stopped = completed.find(unexpectedFailure);
          if (stopped) report.diagnosticStop = { scenarioId: stopped.id, role: 'winner' };
        }
        const path = resolve(output, "regression-ui.json");
        await writeFile(path + ".tmp", JSON.stringify({ ...report, scenarios,
          coverage: executionCoverage(scenarios), runnerOutcome: "unavailable", runnerDiagnostics: { stage: "ui-report" } }) + "\n");
        await rename(path + ".tmp", path);
      };
      try {
        if (diagnostic) {
          report.scenarios.push((await observeScenario(diagnostic, config, facts, fetcher)).result);
          try { await checkpoint(report.scenarios); } catch { /* Optional evidence cannot rewrite an observed result. */ }
        } else report.scenarios.push(...await observeBrowserQuotes(origin, config, facts, inventory, checkpoint, report.valuation, runPolicy));
      }
      catch (error) {
        if (error instanceof ScenarioUnavailableError && error.code === "browser-unavailable") {
          report.runnerOutcome = "unavailable"; report.runnerCode = error.code;
        }
        for (const scenario of inventory)
          report.scenarios.push(quoteFailure(scenario, error));
      }
      report.observations.correlationAvailable = report.scenarios.some(row => row.refs?.requestId);
    } else {
      // This specific command signs only the dedicated Sandbox fork. Mainnet
      // transactions are outside the owner's authorization; fork mode above
      // creates its own disposable chain through the established qualifier.
      if (values.target !== "sandbox" || config.chainId === 1) throw new Error("sandbox-execution-target-required");
      const env = { TRADE_REGRESSION_MATRIX: matrixPath, TRADE_REGRESSION_RUN_POLICY: runPolicy, ...(values["diagnostic-scenario"] ? { TRADE_REGRESSION_DIAGNOSTIC_SCENARIO: values["diagnostic-scenario"] } : {}), PLAYWRIGHT_BASE_URL: origin, PLAYWRIGHT_EXTERNAL_SERVER: "1", NEXT_PUBLIC_CHAIN_ID: String(config.chainId), NEXT_PUBLIC_CHAIN_NAME: "CyberGold Sandbox",
        TRADE_REGRESSION_OUTPUT: resolve(output, "regression-execution.json"), TRADE_REGRESSION_UI_OUTPUT: resolve(output, "regression-ui.json"),
        TRADE_REGRESSION_WALLET_SETUP_OUTPUT: resolve(output, "wallet-setup.json"),
        TRADE_REGRESSION_UI_FIXTURE_OUTPUT: resolve(output, "wallet-fixture-ui.json"),
        TRADE_REGRESSION_INDEPENDENT_FIXTURE_OUTPUT: resolve(output, "wallet-fixture-independent.json"),
        TRADE_REGRESSION_FAUCET_REQUEST_ID: report.runId, TRADE_REGRESSION_MODE: "sandbox-execution", TRADE_REGRESSION_TARGET: "sandbox" };
      report.runnerDiagnostics.stage = "wallet-cache";
      const setupResult = await command(process.execPath, ["scripts/cache-metamask-wallet.mjs", "--extension-only"], env);
      report.runnerDiagnostics = { ...report.runnerDiagnostics, ...setupResult };
      const walletSetup = await readWalletSetupDiagnostic(env.TRADE_REGRESSION_WALLET_SETUP_OUTPUT);
      if (walletSetup) report.runnerDiagnostics.walletSetup = walletSetup;
      if (setupResult.exitCode !== 0) {
        report.runnerOutcome = "fail"; report.runnerCode = "wallet-setup-failed";
        report.scenarios = unobservedRows("wallet-setup-unavailable");
      } else {
        report.runnerDiagnostics = { stage: "wallet-tests", ...(walletSetup ? { walletSetup } : {}) };
        const childResult = await command(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.regression.config.ts"], env);
        report.runnerDiagnostics = { ...report.runnerDiagnostics, ...childResult };
        const available = await walletResults();
        if (available && childResult.exitCode !== 0) { report.runnerOutcome = "fail"; report.runnerCode = "wallet-tests-failed"; }
      }
    }
  }
} catch (error) {
  const failure = failureResult(resultFor(tradeScenarios[0], "api"), error);
  report.runnerOutcome = values.mode === "quotes" ? failure.status : "fail"; report.runnerCode = failure.code;
  report.runnerDiagnostics = { ...report.runnerDiagnostics, ...safeRunnerError(error) };
  if (values.mode === "quotes") {
    const observed = new Set(report.scenarios.map(row => row.id));
    for (const scenario of inventory) if (!observed.has(diagnosticId ? scenario.id : `ui-${scenario.id}`))
      report.scenarios.push(quoteFailure(scenario, error));
  } else if (!report.scenarios.length) {
    const code = report.runnerDiagnostics.stage === "wallet-cache" ? "wallet-setup-unavailable" : "execution-results-unavailable";
    report.scenarios = unobservedRows(code);
  }
}
if (report.runnerOutcome === "pass") report.runnerDiagnostics.stage = "complete";
if (qualityConfiguration) for (const result of [...report.scenarios, ...(report.fixtures ?? [])]) {
  enrichResultQuality(result, report.valuation, qualityConfiguration);
  if (result.alternateExecution) enrichResultQuality(result.alternateExecution, report.valuation, qualityConfiguration);
}
report.coverage = executionCoverage(report.scenarios);
if (runPolicy === 'diagnostic' && !report.diagnosticStop) for (const row of report.scenarios) {
  if (!report.progress.completedScenarioIds.includes(row.id)) continue;
  if (unexpectedFailure(row)) { report.diagnosticStop = { scenarioId: row.id, role: 'winner' }; break; }
  if (unexpectedFailure(row.alternateExecution)) { report.diagnosticStop = { scenarioId: row.id, role: 'alternate' }; break; }
}
report.finishedAt = new Date().toISOString();
await writeFile(resolve(output, "report.json.tmp"), JSON.stringify(report, null, 2) + "\n");
await rename(resolve(output, "report.json.tmp"), resolve(output, "report.json"));
console.log(JSON.stringify({ schema: report.schema, runId: report.runId, target: report.target, mode: report.mode,
  counts: Object.fromEntries(["pass", "fail", "unavailable", "skipped"].map(status => [status, report.scenarios.filter(row => row.status === status).length])) }));
process.exitCode = report.runnerOutcome !== "pass" || report.scenarios.some(row => row.status === "fail" || row.status === "unavailable" || row.alternateExecution?.status === "fail") ? 1 : 0;
