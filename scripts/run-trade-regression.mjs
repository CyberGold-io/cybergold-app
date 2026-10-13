#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ScenarioUnavailableError, tradeScenarios } from "../tests/trading/scenarios.ts";
import { failureResult, observeScenario, originFetch, readJson, resultFor } from "../tests/trading/regression.ts";
import { observeBrowserQuotes } from "../tests/trading/browserQuotes.ts";

const { values } = parseArgs({ options: { target: { type: "string" }, mode: { type: "string", default: "quotes" },
  "output-dir": { type: "string" }, "base-url": { type: "string" } } });
if (!values.target) throw new Error("--target is required");
if (!["sandbox", "mainnet"].includes(values.target)) throw new Error("--target must be sandbox or mainnet");
if (!["quotes", "sandbox-execution", "fork-execution"].includes(values.mode)) throw new Error("--mode must be quotes, sandbox-execution or fork-execution");
if (!values["output-dir"]) throw new Error("--output-dir is required");
const output = resolve(values["output-dir"]);
await mkdir(output, { recursive: true });
const report = { schema: "cybergold.trade-regression.v1", runId: randomUUID(), target: values.target, mode: values.mode,
  startedAt: new Date().toISOString(), runnerOutcome: "pass", scenarios: [] };

async function walletResults() {
  const independent = JSON.parse(await readFile(resolve(output, "regression-execution.json"), "utf8"));
  report.scenarios = independent.scenarios; report.observations = independent.observations; report.fixtures = independent.fixtures ?? [];
  try {
    const ui = JSON.parse(await readFile(resolve(output, "regression-ui.json"), "utf8"));
    report.scenarios.push(...ui.scenarios); report.fixtures.push(...ui.fixtures ?? []);
  }
  catch { report.scenarios.push(...tradeScenarios.filter(s => s.requestedStrategy === "core").map(scenario => ({
    ...failureResult(resultFor(scenario, "execution"), new ScenarioUnavailableError("ui-results-unavailable")), id: `ui-${scenario.id}`, requestedStrategy: "auto" }))); }
}

function command(executable, args, env) {
  return new Promise(resolveResult => {
    // Wallet onboarding, signed request bodies and provider output are never
    // copied into regression artifacts. The structured result survives failures.
    const child = spawn(executable, args, { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "ignore"] });
    const forward = () => child.kill("SIGTERM");
    process.once("SIGTERM", forward); process.once("SIGINT", forward);
    const finish = code => { process.removeListener("SIGTERM", forward); process.removeListener("SIGINT", forward); resolveResult(code); };
    child.once("error", () => finish(1)); child.once("exit", code => finish(code ?? 1));
  });
}
try {
  if (values.mode === "fork-execution") {
    const names = ["BACKEND_IMAGE", "CONTRACTS_JSON", "FUNDING_JSON", "MAINNET_RPC_URL"];
    if (names.some(name => !process.env[name])) throw new ScenarioUnavailableError("fork-fixture-configuration-unavailable");
    const code = await command("python3", ["scripts/qualify-fixed-api-wallet.py", "--backend-image", process.env.BACKEND_IMAGE,
      "--contracts-json", process.env.CONTRACTS_JSON, "--funding-json", process.env.FUNDING_JSON, "--output-dir", output],
      { TRADE_REGRESSION_TARGET: values.target });
    try {
      const qualification = JSON.parse(await readFile(resolve(output, "qualification.json"), "utf8"));
      const context = {};
      for (const [source, key] of [["frontendCommit", "appRevision"], ["backendCommit", "backendRevision"]])
        if (/^[0-9a-f]{40}$/.test(qualification[source] ?? "")) context[key] = qualification[source];
      if (Number.isSafeInteger(qualification.forkBlock)) context.blockNumber = String(qualification.forkBlock);
      if (/^0x[0-9a-f]{64}$/i.test(qualification.forkBlockHash ?? "")) context.blockHash = qualification.forkBlockHash;
      if (/^sha256:[0-9a-f]{64}$/.test(qualification.backendImageId ?? "")) context.backendImageId = qualification.backendImageId;
      report.context = context;
      const observation = {};
      if (["running", "pass", "fail"].includes(qualification.result)) observation.result = qualification.result;
      if (["source", "fork", "funding", "core-preparation", "backend", "frontend", "wallet-cache", "wallet-tests", "receipts"].includes(qualification.stage)) observation.stage = qualification.stage;
      if (["timeout", "interrupted", "command-failed", "system-error", "operation-failed", "unexpected-error"].includes(qualification.errorClass)) observation.errorClass = qualification.errorClass;
      if (qualification.cleanup && typeof qualification.cleanup === "object") {
        observation.cleanup = {};
        for (const key of ["processes", "containers", "network", "source"])
          if (["complete", "failed"].includes(qualification.cleanup[key])) observation.cleanup[key] = qualification.cleanup[key];
      }
      report.qualification = observation;
    } catch { /* Optional release observations never admit or reject a run. */ }
    await walletResults();
    if (code) { report.runnerOutcome = "fail"; report.runnerCode = "fork-qualification-failed"; }
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
    const [config, facts] = await Promise.all([readJson(fetcher, "/api/protocol/config"), readJson(fetcher, "/api/protocol/facts")]);
    report.observations = { chainId: config.chainId, forkGeneration: config.sandboxForkGeneration };
    if (values.mode === "quotes") {
      for (const scenario of tradeScenarios) {
        const started = performance.now();
        try { report.scenarios.push((await observeScenario(scenario, config, facts, fetcher)).result); }
        catch (error) { report.scenarios.push({ ...failureResult(resultFor(scenario, "api"), error), durationMs: Math.round(performance.now() - started) }); }
      }
      try { report.scenarios.push(...await observeBrowserQuotes(origin, config, facts)); }
      catch (error) {
        if (error instanceof ScenarioUnavailableError && error.code === "browser-unavailable") {
          report.runnerOutcome = "unavailable"; report.runnerCode = error.code;
        }
        for (const scenario of tradeScenarios.filter(s => s.requestedStrategy === "core"))
          report.scenarios.push({ ...failureResult(resultFor(scenario, "browser"), error), id: `ui-${scenario.id}`, requestedStrategy: "auto" });
      }
      report.observations.correlationAvailable = report.scenarios.some(row => row.refs?.requestId);
    } else {
      // This specific command signs only the dedicated Sandbox fork. Mainnet
      // transactions are outside the owner's authorization; fork mode above
      // creates its own disposable chain through the established qualifier.
      if (values.target !== "sandbox" || config.chainId === 1) throw new Error("sandbox-execution-target-required");
      const env = { PLAYWRIGHT_BASE_URL: origin, PLAYWRIGHT_EXTERNAL_SERVER: "1", NEXT_PUBLIC_CHAIN_ID: String(config.chainId),
        TRADE_REGRESSION_OUTPUT: resolve(output, "regression-execution.json"), TRADE_REGRESSION_UI_OUTPUT: resolve(output, "regression-ui.json"),
        TRADE_REGRESSION_FAUCET_REQUEST_ID: report.runId, TRADE_REGRESSION_MODE: "sandbox-execution", TRADE_REGRESSION_TARGET: "sandbox" };
      if (await command(process.execPath, ["scripts/cache-metamask-wallet.mjs"], env)) throw new ScenarioUnavailableError("wallet-setup-unavailable");
      const code = await command(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.regression.config.ts"], env);
      await walletResults();
      if (code) { report.runnerOutcome = "fail"; report.runnerCode = "wallet-tests-failed"; }
    }
  }
} catch (error) {
  const failure = failureResult(resultFor(tradeScenarios[0], "api"), error);
  report.runnerOutcome = failure.status; report.runnerCode = failure.code;
  if (values.mode === "quotes") {
    const observed = new Set(report.scenarios.map(row => row.id));
    for (const scenario of tradeScenarios) if (!observed.has(scenario.id))
      report.scenarios.push(failureResult(resultFor(scenario, "api"), error));
    for (const scenario of tradeScenarios.filter(row => row.requestedStrategy === "core")) if (!observed.has(`ui-${scenario.id}`))
      report.scenarios.push({ ...failureResult(resultFor(scenario, "browser"), error), id: `ui-${scenario.id}`, requestedStrategy: "auto" });
  } else if (!report.scenarios.length) report.scenarios = tradeScenarios.map(scenario => failureResult(resultFor(scenario, "execution"), error));
}
report.finishedAt = new Date().toISOString();
await writeFile(resolve(output, "report.json.tmp"), JSON.stringify(report, null, 2) + "\n");
await rename(resolve(output, "report.json.tmp"), resolve(output, "report.json"));
console.log(JSON.stringify({ schema: report.schema, runId: report.runId, target: report.target, mode: report.mode,
  counts: Object.fromEntries(["pass", "fail", "unavailable", "skipped"].map(status => [status, report.scenarios.filter(row => row.status === status).length])) }));
process.exitCode = report.runnerOutcome !== "pass" || report.scenarios.some(row => row.status === "fail" || row.status === "unavailable") ? 1 : 0;
