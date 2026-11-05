#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { mnemonicToAccount } from "viem/accounts";
import { activeMatrixTemplates, buildMatrix, matrixCountsFor, readValuation } from "../tests/trading/matrix.ts";
import { runnerFundingPlan } from "../tests/trading/runnerFunding.ts";
import { originFetch, readJson } from "../tests/trading/regression.ts";
import type { ProtocolConfiguration } from "../app/utils/protocolConfiguration.ts";
import type { ProtocolFacts } from "../app/utils/protocolFacts.ts";

const { values } = parseArgs({ options: { "base-url": { type: "string" }, output: { type: "string" },
  suite: { type: "string", default: "sequential" }, "wallet-address": { type: "boolean", default: false } } });
if (!values["base-url"] || !values.output) throw new Error("usage: --base-url <owned-app-origin> --output <frozen-matrix.json>");
if (values.suite !== "sequential" && values.suite !== "independent") throw new Error("suite must be sequential or independent");
const fetcher = originFetch(values["base-url"]);
const [config, facts] = await Promise.all([readJson<ProtocolConfiguration>(fetcher, "/api/protocol/config"),
  readJson<ProtocolFacts>(fetcher, "/api/protocol/facts")]);
const valuation = await readValuation(config, facts, fetcher);
const scenarios = buildMatrix(config, valuation, activeMatrixTemplates());
const { plan } = runnerFundingPlan(config, valuation, scenarios, values.suite);
// The host already supplies this dedicated runner wallet privately. Never
// print its seed or copy signing material into the funding manifest.
const walletAddress = values["wallet-address"]
  ? mnemonicToAccount(process.env.SYNPRESS_WALLET_SEED_PHRASE!).address : undefined;
const destination = resolve(values.output);
await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
await writeFile(destination, JSON.stringify({ matrix: matrixCountsFor(scenarios), valuation, scenarios, fundingPlan: plan,
  ...(walletAddress ? { walletAddress } : {}) }, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ valuationId: valuation.id, suite: plan.suite, requiredCygldRaw: plan.requiredCygldRaw,
  requiredPaxgRaw: plan.requiredPaxgRaw, scenarioCount: scenarios.length }));
