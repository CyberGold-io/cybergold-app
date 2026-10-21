import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as viem from "viem";
import * as protocolConfiguration from "./protocolConfiguration.ts";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
import { marketFixtureQuote } from "../../tests/fixtures/market-quote.mts";
import { marketQuoteResult } from "./marketQuote.ts";
import { marketFundingAuthorization, marketSwapOperation } from "./marketSwap.ts";

const tokenPermit = await withEnvironment(appEnvironment, () => import("./tokenPermit.ts"));
const { signWalletTypedDataGroup } = await withEnvironment(appEnvironment, () => import("./walletTypedData.ts"));
const owner = "0x0000000000000000000000000000000000000001" as const;
const helpers = "0x0000000000000000000000000000000000000002" as const;
const signature = `0x${"11".repeat(32)}${"22".repeat(32)}1b` as const;

function fixture(options: { rejection?: boolean; simulationFailure?: boolean; allowance?: bigint; installed?: boolean; configuredHelpers?: viem.Address; observedHelpers?: viem.Address; signatureWait?: Promise<void> } = {}) {
  const configuration = { addresses: { core: helpers, helpers: options.configuredHelpers ?? helpers }, tokenAddresses: {} };
  const events: string[] = [], signing: Record<string, unknown>[] = [], simulations: unknown[][] = [], transactions: Record<string, unknown>[] = [];
  const modes: string[] = [], permissions: { token: string; owner: string }[] = [];
  const rejected = Object.assign(new Error("User rejected"), { code: 4001 });
  const dependencies: Record<string, unknown> = {
    "@/app/context/protocolConfigurationContext": { useProtocolConfiguration: () => configuration },
    "@/app/utils/protocolConfiguration": protocolConfiguration,
    react: { useCallback: (callback: unknown) => callback }, viem,
    wagmi: { usePublicClient: () => ({}), useWalletClient: () => ({ data: {} }),
      useSignTypedData: () => ({ signTypedDataAsync: async (request: Record<string, unknown>) => {
        events.push("signature"); signing.push(request); if (options.rejection) throw rejected; await options.signatureWait; return signature;
      } }),
      useWriteContract: () => ({ writeContractAsync: async (request: Record<string, unknown>) => {
        events.push("transaction"); transactions.push(request); return "0x01";
      } }) },
    "@/app/contracts/generated/helpersMarket": { HELPERS_MARKET_ABI: [] },
    "@/app/contracts/cybergold-helpers/issueFacet": { HELPERS_DIAMOND_ADDRESS: helpers },
    "@/app/contracts/erc20": { erc20Abi: [] },
    "@/app/utils/expectedChain": { EXPECTED_CHAIN_ID: 1, assertWalletOnExpectedChain: async () => {} },
    "@/app/utils/helpersRouterFacts": { fetchMarketSwapInstalled: async (mode: string) => { modes.push(mode); return options.installed ?? true; } },
    "@/app/utils/helpersExecutionGas": { estimateHelpersExecutionGas: async (...args: unknown[]) => {
      events.push("simulation"); simulations.push(args); if (options.simulationFailure) throw new Error("signed call reverted"); return 100000n;
    } },
    "@/app/utils/marketSwap": { marketFundingAuthorization, marketSwapOperation },
    "@/app/utils/tokenPermit": { ...tokenPermit, fetchTokenPermit: async (token: string, account: string) => {
      permissions.push({ token, owner: account }); return { spender: options.observedHelpers ?? helpers, allowance: { status: "success", value: String(options.allowance ?? 0n) },
        nonce: { status: "success", value: "7" }, authorization: { kind: "erc2612", confidence: "qualified",
          domain: { name: "Input Token", version: "1", chainId: 1, verifyingContract: token } } };
    } },
    "@/app/utils/walletTypedData": { signWalletTypedDataGroup },
    "@/app/utils/walletBatch": { collectWalletApproval: () => { throw new Error("unexpected approval"); } },
    "@/app/utils/receiptWait": { waitForAppTransactionReceipt: () => { throw new Error("unexpected approval receipt"); } },
    "@/app/utils/swapPolicy": { buildDeadline: () => 1900000000n, PERMIT_DEADLINE_TTL_SEC: 1200 },
    "./usePermit2Transfer": { usePermit2Transfer: () => ({ preparePermit2Authorization: () => { throw new Error("unexpected Permit2 setup"); } }) },
  };
  function load(name: string) {
    const source = readFileSync(new URL(`../hooks/flows/shared/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
    const exports: Record<string, (...args: unknown[]) => unknown> = {};
    runInNewContext(outputText, { exports, fetch, require: (key: string) => {
      if (key === "./usePurchaseAuthorization") return load("usePurchaseAuthorization");
      assert.ok(key in dependencies, key); return dependencies[key];
    } });
    return exports;
  }
  const hook = load("useMarketSwapExecution").useMarketSwapExecution() as {
    submit: (quote: ReturnType<typeof marketQuoteResult>, owner: viem.Address) => Promise<unknown> };
  return { events, signing, simulations, transactions, permissions, modes, rejected, configuration, submit: hook.submit };
}

for (const side of ["buy", "sell"] as const) for (const mode of ["exact-out"] as const) {
  test(`${side} ${mode} signs the inclusive native lot and targets its own market selector`, async () => {
    const quote = marketQuoteResult({ ...marketFixtureQuote, side, mode,
      tokenIn: side === "buy" ? marketFixtureQuote.tokenOut : marketFixtureQuote.tokenIn,
      params: { ...marketFixtureQuote.params, side: side === "buy" ? 0 : 1, amount: "1002", bound: "1234" } });
    const value = fixture(); await value.submit(quote, owner);
    const expectedLot = 1234n;
    const signed = value.signing[0] as { message: { value: bigint; spender: string; owner: string } };
    assert.equal(signed.message.value, expectedLot); assert.equal(signed.message.spender, helpers); assert.equal(signed.message.owner, owner);
    assert.deepEqual(value.permissions, [{ token: quote.value.tokenIn, owner }]);
    assert.deepEqual(value.modes, [mode]); assert.deepEqual(value.events, ["signature", "simulation", "transaction"]);
    assert.equal(value.transactions[0].functionName, "swapExactOutput");
    assert.equal(value.transactions[0].account, owner); assert.equal(value.transactions[0].address, helpers);
    const [params, authorization] = value.transactions[0].args as [typeof quote.params, { mode: number; nativePermit: { value: bigint } }];
    assert.equal(params, quote.params); assert.equal(params.routedInput, 1000n); assert.equal(params.feeCygld, 1n);
    assert.equal(authorization.mode, 1); assert.equal(authorization.nativePermit.value, expectedLot);
  });
}

test("native signature rejection requests neither another approval nor a swap", async () => {
  const value = fixture({ rejection: true });
  await assert.rejects(value.submit(marketQuoteResult({ ...marketFixtureQuote, mode:"exact-out" }), owner), value.rejected);
  assert.deepEqual(value.events, ["signature"]); assert.equal(value.simulations.length, 0); assert.equal(value.transactions.length, 0);
});

test("actual signed-call failure prevents transaction confirmation", async () => {
  const value = fixture({ simulationFailure: true });
  await assert.rejects(value.submit(marketQuoteResult({ ...marketFixtureQuote, mode:"exact-out" }), owner), /signed call reverted/);
  assert.deepEqual(value.events, ["signature", "simulation"]); assert.equal(value.transactions.length, 0);
});

test("sufficient Helpers allowance reuses its ordinary funding path without another permit", async () => {
  const value = fixture({ allowance: BigInt(marketFixtureQuote.params.bound) }); await value.submit(marketQuoteResult({ ...marketFixtureQuote, mode:"exact-out" }), owner);
  assert.equal(value.signing.length, 0); assert.deepEqual(value.modes, []);
  assert.equal((value.transactions[0].args as [unknown, { mode: number }])[1].mode, 0);
});

const changedHelpers = "0x0000000000000000000000000000000000000009" as const;
test("a quote retains its Helpers and concrete route adapter when bootstrap selection changes", async () => {
  const value = fixture({ configuredHelpers: changedHelpers });
  const quote = { ...marketQuoteResult({ ...marketFixtureQuote, mode:"exact-out" }), deployment: { core: helpers, helpers, adapter: marketFixtureQuote.params.adapter as viem.Address } };
  await value.submit(quote, owner);
  assert.equal((value.signing[0].message as { spender: string }).spender, helpers);
  assert.equal(value.transactions[0].address, helpers);
  assert.equal(value.simulations[0][6], helpers);
  assert.equal((value.transactions[0].args as [{ adapter: string }])[0].adapter, quote.params.adapter);
});

test("configuration refresh while the wallet prompt is open keeps the prepared target", async () => {
  let release!: () => void;
  const signatureWait = new Promise<void>(resolve => { release = resolve; });
  const value = fixture({ signatureWait });
  const submitted = value.submit(marketQuoteResult({ ...marketFixtureQuote, mode:"exact-out" }), owner);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.equal(value.signing.length, 1); assert.equal(value.transactions.length, 0);
  value.configuration.addresses.helpers = changedHelpers;
  release(); await submitted;
  assert.equal(value.transactions[0].address, helpers);
  assert.equal(value.simulations[0][6], helpers);
});

test("fresh permit facts for another Helpers target fail before a wallet prompt", async () => {
  const value = fixture({ observedHelpers: changedHelpers });
  await assert.rejects(value.submit(marketQuoteResult({ ...marketFixtureQuote, mode:"exact-out" }), owner), /permit spender changed/);
  assert.deepEqual(value.events, []); assert.deepEqual(value.signing, []); assert.deepEqual(value.transactions, []);
});
