#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const targetArg = process.argv[2] ?? ".env.local";
const envPath = path.resolve(process.cwd(), targetArg);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(envPath)) {
  fail(`Missing env file: ${envPath}`);
}

function parseEnv(contents) {
  const values = new Map();

  contents.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !line.includes("=")) {
      return;
    }

    const key = line.slice(0, line.indexOf("=")).trim();
    let value = line.slice(line.indexOf("=") + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values.set(key, value);
  });

  return values;
}

function requireValue(env, key) {
  const value = env.get(key);
  if (!value) {
    fail(`Missing required env value: ${key}`);
  }
  return value;
}

async function rpc(rpcUrl, method, params = [], authorization) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    redirect: "error",
  });

  if (!response.ok) {
    throw new Error(`${method} returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${payload.error.message ?? JSON.stringify(payload.error)}`);
  }

  return payload.result;
}

const env = parseEnv(readFileSync(envPath, "utf8"));
const chainIdRaw = requireValue(env, "NEXT_PUBLIC_CHAIN_ID");
const expectedChainId = Number(chainIdRaw);
if (!Number.isInteger(expectedChainId) || expectedChainId <= 0) {
  fail("NEXT_PUBLIC_CHAIN_ID must be a positive integer.");
}

// By default use the App's existing fixed chain observation. An explicit
// tooling RPC retains its original server-side authorization behavior.
const toolingRpc = env.get("RPC_VALIDATION_URL");
const validationBase = (toolingRpc ?? env.get("NEXT_PUBLIC_APP_ORIGIN") ?? "http://localhost:3000").replace(/\/+$/, "");
try {
  const parsed = new URL(validationBase);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    fail("The validation endpoint from RPC_VALIDATION_URL or NEXT_PUBLIC_APP_ORIGIN must use http:// or https://.");
  }
} catch {
  fail("The validation endpoint from RPC_VALIDATION_URL or NEXT_PUBLIC_APP_ORIGIN must be a valid URL.");
}
const rpcValidationAuthorization = env.get("RPC_AUTHORIZATION") || undefined;
async function appObservation(route) {
  const response = await fetch(validationBase + route, { redirect: "error" });
  if (!response.ok) throw new Error(`App observation returned HTTP ${response.status}`);
  return response.json();
}

if (process.env.SKIP_RPC_VALIDATION === "1") {
  console.log(`Static env validation passed for ${path.relative(process.cwd(), envPath)}.`);
  process.exit(0);
}

try {
  const actualChainId = toolingRpc
    ? Number.parseInt(await rpc(validationBase, "eth_chainId", [], rpcValidationAuthorization), 16)
    : (await appObservation("/api/transaction/wait/head")).chainId;
  if (actualChainId !== expectedChainId) {
    fail(`RPC chain mismatch: expected ${expectedChainId}, got ${actualChainId} from the validation endpoint.`);
  }

  console.log(`Active env validation passed for chain ${expectedChainId}.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
