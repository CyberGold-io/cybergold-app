import { writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "./testWithMetaMask";
import { addLocalNetwork, connectWallet, requestConnection, switchLocalNetwork } from "./wallet-ui";
import { ScenarioUnavailableError, tradeScenarios } from "../trading/scenarios";
import { executeScenario } from "../trading/walletExecution";
import { fundSandboxWallet } from "../trading/sandboxFunding";
import { checkpointExecutionStage, failureResult, observeScenario, originFetch, readJson, resultFor, type RegressionReport } from "../trading/regression";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration";
import type { ProtocolFacts } from "../../app/utils/protocolFacts";
import type { Address } from "viem";

test("independent producer matrix signs with MetaMask and proves mined family and bounds", async ({ page }) => {
  test.setTimeout(3_600_000);
  const output = process.env.TRADE_REGRESSION_OUTPUT!;
  const report: RegressionReport = { schema: "cybergold.trade-regression.v1", runId: randomUUID(),
    target: process.env.TRADE_REGRESSION_TARGET === "mainnet" ? "mainnet" : "sandbox",
    mode: process.env.TRADE_REGRESSION_MODE === "sandbox-execution" ? "sandbox-execution" : "fork-execution",
    startedAt: new Date().toISOString(), scenarios: tradeScenarios.map(scenario => resultFor(scenario, "execution")) };
  async function persist() {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output + ".tmp", JSON.stringify(report, null, 2) + "\n"); await rename(output + ".tmp", output);
  }
  await persist();
  try {
    const fetcher = originFetch(process.env.PLAYWRIGHT_BASE_URL!);
    await checkpointExecutionStage(report.scenarios, "setup-config", persist);
    const config = await readJson<ProtocolConfiguration>(fetcher, "/api/protocol/config");
    report.observations = { chainId: config.chainId, forkGeneration: config.sandboxForkGeneration };
    // Mainnet writes are outside this suite's scope. The canonical fork runner
    // supplies its separately owned chain; Sandbox supplies its configured fork.
    expect(config.chainId).not.toBe(1);
    await checkpointExecutionStage(report.scenarios, "setup-navigation", persist);
    await page.goto("/en");
    const rpcUrl = process.env.NEXT_PUBLIC_WALLET_RPC_URL;
    if (!rpcUrl) throw new ScenarioUnavailableError("wallet-rpc-unavailable");
    await checkpointExecutionStage(report.scenarios, "setup-network-add", persist);
    await addLocalNetwork(page, { chainId: config.chainId, rpcUrl }, "CyberGold Test Wallet");
    await checkpointExecutionStage(report.scenarios, "setup-network-switch", persist);
    await switchLocalNetwork(page, config.chainId);
    await checkpointExecutionStage(report.scenarios, "setup-connect-request", persist);
    await requestConnection(page);
    await checkpointExecutionStage(report.scenarios, "setup-connect-confirm", persist);
    await connectWallet(page);
    await checkpointExecutionStage(report.scenarios, "setup-accounts", persist);
    const accounts = await page.evaluate(() => (window as unknown as { ethereum: { request: (input: unknown) => Promise<string[]> } }).ethereum.request({ method: "eth_accounts" }));
    const owner = accounts[0] as Address;
    await checkpointExecutionStage(report.scenarios, "setup-funding", persist);
    await fundSandboxWallet(owner, fetcher);
    await checkpointExecutionStage(report.scenarios, "setup-ready", persist);
    for (const [index, scenario] of tradeScenarios.entries()) {
      const started = performance.now();
      let result = report.scenarios[index];
      try {
        await checkpointExecutionStage([result], "execution-facts", persist);
        const facts = await readJson<ProtocolFacts>(fetcher, "/api/protocol/facts");
        await checkpointExecutionStage([result], "execution-quote", persist);
        const observation = await observeScenario(scenario, config, facts, fetcher, owner);
        result = observation.result; result.layer = "execution"; result.status = "unavailable"; result.code = "execution-not-completed";
        report.scenarios[index] = result;
        await persist();
        await executeScenario(observation, page, owner, config, fetcher);
      } catch (error) { report.scenarios[index] = failureResult(result, error); }
      report.scenarios[index].durationMs = Math.round(performance.now() - started);
      await persist();
    }
  } catch (error) {
    report.scenarios = report.scenarios.map(result => result.status === "pass" ? result : failureResult(result, error));
  } finally { report.finishedAt = new Date().toISOString(); await persist(); }
  expect(report.scenarios.filter(scenario => scenario.status !== "pass").map(scenario => ({ id: scenario.id, status: scenario.status, code: scenario.code }))).toEqual([]);
});
