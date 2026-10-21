#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const helpersSourceArgument = process.argv.indexOf("--helpers-source");
const helpersSource = helpersSourceArgument >= 0
  ? process.argv[helpersSourceArgument + 1] : process.env.CYBERGOLD_HELPERS_ABI_SOURCE;
const marketSourceArgument = process.argv.indexOf("--market-source");
const marketSource = marketSourceArgument >= 0
  ? process.argv[marketSourceArgument + 1] : process.env.CYBERGOLD_HELPERS_MARKET_ABI_SOURCE;

const specs = [
  { source: path.resolve(root, "app/contracts/abi-inputs/helpersTradeExactInput.json"),
    output: path.resolve(root, "app/contracts/generated/helpersTradeExactInput.ts"), prefix: "HELPERS_TRADE_EXACT_INPUT", compiledInterface: true },
  {
    source: path.resolve(root, "../cybergold-protocol/generated/abi/CoreDiamond.json"),
    output: path.resolve(root, "app/contracts/generated/coreDiamond.ts"),
    prefix: "CORE_DIAMOND",
  },
  {
    source: path.resolve(root, "../cybergold-protocol/generated/abi/StakingDiamond.json"),
    output: path.resolve(root, "app/contracts/generated/stakingDiamond.ts"),
    prefix: "STAKING_DIAMOND",
  },
  {
    source: helpersSource ? path.resolve(helpersSource)
      : path.resolve(root, "app/contracts/abi-inputs/HelpersDiamond.json"),
    output: path.resolve(root, "app/contracts/generated/helpersDiamond.ts"),
    prefix: "HELPERS_DIAMOND",
  },
  {
    source: marketSource ? path.resolve(marketSource)
      : path.resolve(root, "app/contracts/abi-inputs/HelpersMarket.json"),
    output: path.resolve(root, "app/contracts/generated/helpersMarket.ts"),
    prefix: "HELPERS_MARKET",
  },
  {
    source: path.resolve(root, "../cybergold-protocol/generated/abi/GovernanceDiamond.json"),
    output: path.resolve(root, "app/contracts/generated/governanceDiamond.ts"),
    prefix: "GOVERNANCE_DIAMOND",
  },
];

function render(spec, artifact) {
  if (spec.compiledInterface) return "// Generated from compiled ITradeExactInput. Do not edit by hand.\n"
    + `export const ${spec.prefix}_ABI = ${JSON.stringify(artifact.abi, null, 2)} as const;\n\n`
    + `export const ${spec.prefix}_FUNCTIONS = ${JSON.stringify(artifact.methodIdentifiers, null, 2)} as const;\n`;
  if (
    !artifact.interface ||
    typeof artifact.interface.interfaceId !== "string" ||
    typeof artifact.interface.erc165Advertised !== "boolean"
  ) {
    throw new Error(
      `Canonical release ABI lacks explicit interface metadata: ${spec.source}`
    );
  }
  const banner = "// Generated from the compiled release facets. Do not edit by hand.\n";
  return `${banner}export const ${spec.prefix}_ABI = ${JSON.stringify(artifact.abi, null, 2)} as const;\n\n`
    + `export const ${spec.prefix}_FUNCTIONS = ${JSON.stringify(artifact.selectors, null, 2)} as const;\n\n`
    + `export const ${spec.prefix}_INTERFACE_ID = ${JSON.stringify(artifact.interface.interfaceId)} as const;\n\n`
    + `export const ${spec.prefix}_ERC165_ADVERTISED = ${JSON.stringify(artifact.interface.erc165Advertised)} as const;\n`;
}

const generatedModules = specs.map((spec) => {
  if (!fs.existsSync(spec.source)) {
    throw new Error(`Missing canonical release ABI: ${spec.source}`);
  }
  const artifact = JSON.parse(fs.readFileSync(spec.source, "utf8"));
  return { spec, generated: render(spec, artifact) };
});

for (const { spec, generated } of generatedModules) {
  if (check) {
    if (!fs.existsSync(spec.output) || fs.readFileSync(spec.output, "utf8") !== generated) {
      throw new Error(`Generated ABI module drift: ${spec.output}`);
    }
  } else {
    fs.mkdirSync(path.dirname(spec.output), { recursive: true });
    fs.writeFileSync(spec.output, generated);
    process.stdout.write(`Generated ${spec.output}\n`);
  }
}
