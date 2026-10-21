import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as viem from "viem";
import * as protocolConfiguration from "./protocolConfiguration.ts";
import type { TokenPermitContext } from "./tokenPermit.ts";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
import * as pendingApproval from "./pendingApproval.ts";
import { erc20Abi } from "../contracts/erc20.ts";

const tokenPermit = await withEnvironment(appEnvironment, () => import("./tokenPermit.ts"));
const { signWalletTypedDataGroup } = await withEnvironment(appEnvironment, () => import("./walletTypedData.ts"));
const { WalletSignatureBatchStoppedError } = await withEnvironment(appEnvironment, () => import("./metaMaskRequestBatch.ts"));
const { collectWalletApproval } = await withEnvironment(appEnvironment, () => import("./walletBatch.ts"));
import { tokenAddresses } from "../../tests/fixtures/protocol-configuration.ts";

const owner = "0x0000000000000000000000000000000000000001" as const;
const helpers = "0x0000000000000000000000000000000000000002" as const;
const token = "0x0000000000000000000000000000000000000003" as const;
const ceiling = 1234567890123456789012345n;
const signature = `0x${"11".repeat(32)}${"22".repeat(32)}1b` as const;
const success = <T,>(value: T) => ({ status: "success" as const, value });
const failure = { status: "failure" as const, error: "contract-read-failed" as const };
const context: TokenPermitContext = {
  context: { chainId: 1, blockNumber: "100", blockHash: `0x${"aa".repeat(32)}`, blockTimestamp: "1791600000", observedAt: "2026-10-10T00:00:00Z" },
  token: { chainId: 1, address: token }, owner, spender: helpers, allowance: success("0"), nonce: success("7"),
  authorization: { kind: "erc2612", confidence: "qualified", domain: { name: "Domain differs from symbol", version: "2",
    chainId: 1, verifyingContract: token, salt: `0x${"bb".repeat(32)}` } },
};

function fixture(value = context, options: { installed?: boolean; signatureError?: unknown; readError?: unknown; chainError?: unknown; executionError?: unknown; estimation?: Promise<void>; approvalReverted?: boolean; permit2Allowance?: bigint; contexts?: Record<string, TokenPermitContext> } = {}) {
  const events: string[] = [], approvals: bigint[] = [], signed: Record<string, unknown>[] = [];
  const executions: { name: string; params: Record<string, unknown> }[] = [];
  const estimates: { functionName: string; args: unknown[] }[] = [];
  let availabilityReads = 0;
  const execute = (name: string) => async (params: Record<string, unknown>) => { events.push(name); executions.push({ name, params }); if (options.executionError) throw options.executionError; return "0x01"; };
  const dependencies: Record<string, unknown> = {
    "@/app/context/protocolConfigurationContext": { useProtocolConfiguration: () => ({ addresses: { core: helpers, helpers: helpers }, tokenAddresses: { USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7" } }) },
    "@/app/utils/protocolConfiguration": protocolConfiguration,
    react: { useCallback: (callback: unknown) => callback, useRef: (current: unknown) => ({ current }) },
    viem,
    wagmi: {
      usePublicClient: () => ({}), useWalletClient: () => ({ data: {} }),
      useSignTypedData: () => ({ signTypedDataAsync: async (request: Record<string, unknown>) => {
        events.push("sign"); signed.push(request); if (options.signatureError) throw options.signatureError; return signature;
      } }),
      useWriteContract: () => ({ writeContractAsync: async ({ args }: { args: [string, bigint] }) => {
        events.push(`approve:${args[1]}`); approvals.push(args[1]); return "0x01";
      } }),
    },
    "@/app/contracts/erc20": { erc20Abi },
    "@/app/contracts/cybergold-helpers/issueFacet": { HELPERS_DIAMOND_ADDRESS: helpers },
    "@/app/hooks/cybergold-helpers/useIssueFromTokenExactOutWithPermit2": { useIssueFromTokenExactOutWithPermit2: () => ({
      issueFromNativeExactOut: execute("native"), issueFromTokenExactOut: execute("allowance"), issueFromTokenExactOutWithPermit: execute("permit"), issueFromTokenExactOutWithPermit2: execute("permit2"),
    }) },
    "@/app/utils/helpersRouterFacts": { fetchTokenPermitIssuanceInstalled: async () => { availabilityReads++; return options.installed ?? true; } },
    "@/app/utils/tokenPermit": { ...tokenPermit, fetchTokenPermit: async (address: string) => { if (options.readError) throw options.readError; return options.contexts?.[address] ?? value; }, tokenApprovalGasLimit: async () => 50000n },
    "@/app/utils/walletBatch": { collectWalletApproval },
    "@/app/utils/walletTypedData": { signWalletTypedDataGroup },
    "@/app/utils/pendingApproval": pendingApproval,
    "@/app/config/chain": { targetChainId: 1 },
    "@/app/hooks/cybergold-helpers/usePermit2Address": { usePermit2Address: () => ({ data: helpers, isError: false }) },
    "@/app/utils/permit2/nonce": { getPermit2Nonce: async () => 13n },
    "@/app/utils/permit2/verifyAddress": { requirePermit2ContractAddress: () => helpers, verifyPermit2ContractAddress: async () => helpers },
    "@/app/utils/permit2ApprovalGas": { permit2ApprovalGasLimit: async () => 50000n },
    "@/app/utils/tokensApproval": { getTokensNeedingPermit2Approval: async ({ permitted }: { permitted: { token: string; amount: bigint }[] }) =>
      permitted.filter(p => (options.permit2Allowance ?? 0n) < p.amount).map(p => ({ ...p, allowance: options.permit2Allowance ?? 0n })) },
    "@/app/utils/receiptWait": { waitForAppTransactionReceipt: async () => { events.push("mined"); return { status: options.approvalReverted ? "reverted" : "success" }; } },
    "@/app/utils/expectedChain": { EXPECTED_CHAIN_ID: 1, assertWalletOnExpectedChain: async () => { if (options.chainError) throw options.chainError; } },
    "@/app/utils/swapPolicy": { buildDeadline: () => 1791601200n, PERMIT_DEADLINE_TTL_SEC: 1200 },
    "./useExecutionFeeEstimate": { useExecutionFeeEstimate: () => ({ estimateSignedContractFee: async (params: typeof estimates[number]) => { estimates.push(params); await options.estimation; } }) },
  };
  function loadHook(name: string): Record<string, () => unknown> {
    const source = readFileSync(new URL(`../hooks/flows/shared/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
    const exports: Record<string, () => unknown> = {};
    runInNewContext(outputText, { exports, require: (key: string) => {
      if (["./usePurchaseAuthorization", "./usePermit2Transfer"].includes(key)) return loadHook(key.slice(2));
      assert.ok(key in dependencies, key); return dependencies[key];
    } });
    return exports;
  }
  const hook = loadHook("useTokenPurchaseExecution").useTokenPurchaseExecution() as {
    submitTokenPurchase: (params: Record<string, unknown>) => Promise<unknown> };
  const authorization = loadHook("usePurchaseAuthorization").usePurchaseAuthorization() as {
    preparePurchaseAuthorization: (params: Record<string, unknown>) => Promise<{ inputs: { token: string; authorization: number; maximumInputAmount: bigint; permit: { value: bigint } }[]; permit2: { permit: { permitted: { token: string; amount: bigint }[] }; signature: string } }> };
  return { events, approvals, signed, executions, estimates, availabilityReads: () => availabilityReads,
    authorize: (permitted: { token: string; amount: bigint }[], extra: Record<string, unknown> = {}) => authorization.preparePurchaseAuthorization({ owner, permitted, nativePermitsInstalled: true, ...extra }),
    submit: (extra: Record<string, unknown> = {}) => hook.submitTokenPurchase({ owner, recipient: owner, inputToken: token,
      maximumInputAmount: ceiling, netCygldOut: 5n, expectedOrderedCoreAssets: [token], quotes: [], nativeInput: false, ...extra }) };
}

test("native standard permit signs the exact purchase ceiling and simulates that signed executor", async () => {
  const value = fixture(); await value.submit();
  assert.deepEqual(value.approvals, []);
  assert.equal(value.signed.length, 1);
  const request = value.signed[0] as { message: { value: bigint; nonce: bigint; spender: string }; domain: typeof context.authorization.domain };
  assert.equal(request.message.value, ceiling); assert.equal(request.message.nonce, 7n); assert.equal(request.message.spender, helpers);
  assert.equal(request.domain!.name, "Domain differs from symbol"); assert.equal(request.domain!.salt, context.authorization.domain!.salt);
  assert.equal(value.executions[0].name, "permit");
  assert.equal(value.executions[0].params.account, owner, "transaction retains the captured permit owner");
  assert.equal(value.estimates[0].functionName, "issueFromTokenExactOutWithPermit");
  assert.equal((value.estimates[0].args[2] as { value: bigint }).value, ceiling);
});

test("actual signed purchase simulation finishes before requesting its transaction", async () => {
  let release!: () => void;
  const estimation = new Promise<void>(resolve => { release = resolve; });
  const value = fixture(context, { estimation });
  const submission = value.submit();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.equal(value.estimates.length, 1); assert.equal(value.executions.length, 0);
  release(); await submission; assert.equal(value.executions.length, 1);
});

test("account unavailability after signing retains the captured owner and requests no alternative authorization", async () => {
  const error = Object.assign(new Error("Captured wallet account unavailable"), { code: 4100 });
  const value = fixture(context, { executionError: error });
  await assert.rejects(value.submit(), error);
  assert.equal(value.executions[0].params.account, owner); assert.equal(value.signed.length, 1); assert.deepEqual(value.approvals, []);
});

test("nonstandard uint256 domain chain ID stays lossless in typed data", async () => {
  const domainChain = 2n ** 200n;
  const value = fixture({ ...context, authorization: { ...context.authorization,
    domain: { ...context.authorization.domain, chainId: domainChain.toString() } } });
  await value.submit(); assert.equal((value.signed[0].domain as { chainId: bigint }).chainId, domainChain);
});

test("explicit empty domain version/name stay present in the actual hook's signed hash", async () => {
  const value = fixture({ ...context, authorization: { ...context.authorization,
    domain: { ...context.authorization.domain, name: "", version: "" } } });
  await value.submit();
  const request = value.signed[0] as { domain: Record<string, unknown>; types: { EIP712Domain: { name: string; type: string }[]; Permit: unknown[] } };
  assert.equal(request.domain.version, ""); assert.equal(request.domain.name, "");
  assert.deepEqual(Array.from(request.types.EIP712Domain, field => field.name), ["name", "version", "chainId", "verifyingContract", "salt"]);
  const faithful = viem.hashTypedData({ ...request, types: { ...request.types, EIP712Domain: [
    { name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }, { name: "salt", type: "bytes32" },
  ] } } as never);
  const inferred = viem.hashTypedData({ ...request, types: { Permit: request.types.Permit } } as never);
  assert.equal(viem.hashTypedData(request as never), faithful); assert.notEqual(faithful, inferred);
});

test("sufficient existing Helpers allowance bypasses permit discovery and retains existing approval", async () => {
  const value = fixture({ ...context, allowance: success(viem.maxUint256.toString()) }); await value.submit();
  assert.equal(value.availabilityReads(), 0); assert.deepEqual(value.approvals, []); assert.deepEqual(value.signed, []);
  assert.equal(value.executions[0].name, "allowance");
});

for (const kind of ["none", "unknown", "variant"] as const) {
  test(`${kind} token authorization uses a per-trade Permit2 permission and reusable setup approval`, async () => {
    const value = fixture({ ...context, nonce: failure, authorization: { kind, confidence: "unknown" } }); await value.submit();
    assert.deepEqual(value.approvals, [viem.maxUint256]); assert.equal(value.signed.length, 1); assert.equal(value.availabilityReads(), 0);
    assert.equal(value.executions[0].name, "permit2");
    assert.equal((value.signed[0].message as { permitted: { amount: bigint } }).permitted.amount, ceiling);
  });
}

test("old Helpers target retains the existing Permit2 executor when the native selector is absent", async () => {
  const value = fixture(context, { installed: false }); await value.submit();
  assert.deepEqual(value.approvals, [viem.maxUint256]); assert.equal(value.signed.length, 1); assert.equal(value.executions[0].name, "permit2");
});

test("USDT clears nonzero insufficient Permit2 setup allowance before approving its reusable setup", async () => {
  const value = fixture({ ...context, allowance: success("10"), authorization: { kind: "none", confidence: "observed" } }, { permit2Allowance: 10n });
  await value.submit({ inputToken: tokenAddresses.USDT });
  assert.deepEqual(value.approvals, [0n, viem.maxUint256]);
  assert.deepEqual(value.events, ["approve:0", "mined", `approve:${viem.maxUint256}`, "mined", "sign", "permit2"]);
});

test("a mined reverted USDT reset stops before the second approval or purchase", async () => {
  const value = fixture({ ...context, allowance: success("10"), authorization: { kind: "none", confidence: "observed" } }, { approvalReverted: true, permit2Allowance: 10n });
  await assert.rejects(value.submit({ inputToken: tokenAddresses.USDT }), { name: "TransactionRevertedError" });
  assert.deepEqual(value.approvals, [0n]); assert.deepEqual(value.signed, []); assert.deepEqual(value.executions, []);
});

test("ordinary ERC20 replaces insufficient allowance without an unrelated zero reset", async () => {
  const value = fixture({ ...context, allowance: success("10"), authorization: { kind: "unknown", confidence: "unknown" } });
  await value.submit(); assert.deepEqual(value.approvals, [viem.maxUint256]);
});

test("atomic wallet collects USDT zero-first Permit2 setup approvals in execution order", async () => {
  const value = fixture({ ...context, allowance: success("10"), authorization: { kind: "none", confidence: "observed" } }, { permit2Allowance: 10n });
  const calls: { to: viem.Address; data: viem.Hex }[] = [];
  let operation = "";
  await value.submit({ inputToken: tokenAddresses.USDT, walletBatch: { mode: "atomic", approvals: calls,
    submit: async (name: string) => { operation = name; return "batch"; } } });
  assert.deepEqual(calls.map(call => viem.decodeFunctionData({ abi: erc20Abi, data: call.data }).args?.[1]), [0n, viem.maxUint256]);
  assert.deepEqual(value.approvals, []); assert.equal(operation, "issueFromTokenExactOutWithPermit2");
});

test("user rejects token permit: stop without replacement authorization or purchase", async () => {
  const error = Object.assign(new Error("User rejected"), { code: 4001 });
  const value = fixture(context, { signatureError: error }); await assert.rejects(value.submit(), error);
  assert.deepEqual(value.approvals, []); assert.deepEqual(value.executions, []);
});

test("wallet format unsupported can retain exact ordinary approval", async () => {
  const value = fixture(context, { signatureError: { code: 4200 } }); await value.submit();
  assert.deepEqual(value.approvals, [ceiling]); assert.equal(value.executions[0].name, "allowance");
});

for (const read of ["allowance", "nonce", "transport", "unavailable"] as const) {
  test(`${read} read failure remains unavailable and requests no fallback signature or approval`, async () => {
    const value = fixture({ ...context, ...(read === "allowance" ? { allowance: failure } : read === "nonce" ? { nonce: failure }
      : read === "unavailable" ? { authorization: { kind: "unavailable", confidence: "unknown" } } : {}) },
      read === "transport" ? { readError: new Error("RPC unavailable") } : {});
    await assert.rejects(value.submit()); assert.deepEqual(value.approvals, []); assert.deepEqual(value.signed, []);
  });
}

test("network change before signing retains existing chain error and requests no wallet authorization", async () => {
  const error = new Error("Wallet chain changed"); const value = fixture(context, { chainError: error });
  await assert.rejects(value.submit(), error); assert.deepEqual(value.signed, []); assert.deepEqual(value.approvals, []);
});

test("nested user rejection cannot be mistaken for unsupported typed data", () => {
  assert.equal(tokenPermit.walletTypedDataUnavailable({ code: 4200, cause: { code: 4001 } }), false);
  assert.equal(tokenPermit.walletTypedDataUnavailable({ cause: { code: -32601 } }), true);
  assert.equal(tokenPermit.walletTypedDataUnavailable({ code: -32602 }), false);
});

test("a warm Permit2 setup needs only the exact per-trade signature and purchase", async () => {
  const value = fixture({ ...context, authorization: { kind: "none", confidence: "observed" } }, { permit2Allowance: viem.maxUint256 });
  await value.submit(); assert.deepEqual(value.approvals, []); assert.equal(value.signed.length, 1);
  assert.equal((value.signed[0].message as { permitted: { amount: bigint } }).permitted.amount, ceiling);
  assert.equal(value.executions[0].name, "permit2");
});

test("universal funding requests an exact Permit2 setup allowance and exact signature", async () => {
  const value = fixture({ ...context, authorization: { kind: "none", confidence: "observed" } });
  const result = await value.authorize([{ token, amount: ceiling }], { exactApproval: true });
  assert.deepEqual(value.approvals, [ceiling]);
  assert.equal((value.signed[0].message as { permitted: { amount: bigint }[] }).permitted[0].amount, ceiling);
  assert.equal(result.permit2.permit.permitted[0].amount, ceiling);
});

test("universal USDT setup clears only insufficient allowance then grants the exact lot", async () => {
  const value = fixture({ ...context, authorization: { kind: "none", confidence: "observed" } },
    { permit2Allowance: 10n });
  await value.authorize([{ token: tokenAddresses.USDT, amount: ceiling }], { exactApproval: true });
  assert.deepEqual(value.approvals, [0n, ceiling]);
});

test("universal funding reuses sufficient setup allowance without revocation", async () => {
  const value = fixture({ ...context, authorization: { kind: "none", confidence: "observed" } },
    { permit2Allowance: viem.maxUint256 });
  await value.authorize([{ token, amount: ceiling }], { exactApproval: true });
  assert.deepEqual(value.approvals, []);
  assert.equal((value.signed[0].message as { permitted: { amount: bigint }[] }).permitted[0].amount, ceiling);
});

test("a singleton native signature and singleton execution use the prepared SDK groups", async () => {
  const value = fixture(); const groups: unknown[][] = [], operations: string[] = [];
  await value.submit({ walletBatch: { mode: "requests", approvals: [],
    signTypedData: async (requests: unknown[]) => { groups.push(requests); return [signature]; },
    submit: async (name: string) => { operations.push(name); return "batch"; } } });
  assert.equal(groups.length, 1); assert.equal(groups[0].length, 1);
  assert.deepEqual(operations, ["issueFromTokenExactOutWithPermit"]); assert.deepEqual(value.signed, []);
});

test("an SDK signature group with partial results cannot select exact approval after a later format error", async () => {
  const value = fixture();
  await assert.rejects(value.submit({ walletBatch: { mode: "requests", approvals: [],
    signTypedData: async () => { throw new WalletSignatureBatchStoppedError({ code: 4200 }, 1); },
    submit: async () => { throw new Error("No execution expected"); } } }), { name: "WalletSignatureBatchStoppedError" });
  assert.deepEqual(value.approvals, []); assert.deepEqual(value.executions, []);
});

test("mixed baskets keep the full Core order and group native permissions with one compact Permit2 subset", async () => {
  const unsupported = "0x0000000000000000000000000000000000000004";
  const sufficient = "0x0000000000000000000000000000000000000005";
  const zero = "0x0000000000000000000000000000000000000006";
  const value = fixture(context, { contexts: {
    [unsupported]: { ...context, authorization: { kind: "none", confidence: "observed" } },
    [sufficient]: { ...context, allowance: success(viem.maxUint256.toString()) },
  } });
  const groups: { primaryType: string; message: { value?: bigint; permitted?: { token: string; amount: bigint }[] } }[][] = [];
  const calls: { to: viem.Address; data: viem.Hex }[] = [];
  const result = await value.authorize([{ token, amount: ceiling }, { token: unsupported, amount: 9n },
    { token: sufficient, amount: 8n }, { token: zero, amount: 0n }], { walletBatch: { mode: "requests", approvals: calls,
      signTypedData: async (requests: typeof groups[number]) => { groups.push(requests); return requests.map(() => signature); } } });
  assert.equal(groups.length, 1); assert.deepEqual(Array.from(groups[0], request => request.primaryType), ["Permit", "PermitBatchTransferFrom"]);
  assert.equal(groups[0][0].message.value, ceiling);
  assert.deepEqual(Array.from(groups[0][1].message.permitted!, p => ({ ...p })), [{ token: unsupported, amount: 9n }]);
  assert.deepEqual(Array.from(result.inputs, input => [input.token, input.authorization, input.maximumInputAmount]),
    [[token, 1, ceiling], [unsupported, 2, 9n], [sufficient, 0, 8n], [zero, 0, 0n]]);
  assert.equal(result.inputs[0].permit.value, ceiling);
  assert.deepEqual(Array.from(result.permit2.permit.permitted, p => ({ ...p })), [{ token: unsupported, amount: 9n }]);
  assert.equal(calls.length, 1); assert.deepEqual(viem.decodeFunctionData({ abi: erc20Abi, data: calls[0].data }).args, [helpers, viem.maxUint256]);
  assert.deepEqual(value.signed, []); assert.deepEqual(value.approvals, []);
});

test("all-native basket uses one SDK signature group and no Permit2 setup or typed permission", async () => {
  const other = "0x0000000000000000000000000000000000000004";
  const value = fixture(); const groups: unknown[][] = [], calls: unknown[] = [];
  const result = await value.authorize([{ token, amount: ceiling }, { token: other, amount: 1n }], {
    walletBatch: { mode: "atomic", approvals: calls, signTypedData: async (requests: unknown[]) => { groups.push(requests); return requests.map(() => signature); } } });
  assert.equal(groups.length, 1); assert.equal(groups[0].length, 2); assert.equal(calls.length, 0);
  assert.deepEqual(Array.from(result.inputs, input => input.authorization), [1, 1]);
  assert.deepEqual(Array.from(result.permit2.permit.permitted), []); assert.equal(result.permit2.signature, "0x");
});

test("a first SDK format failure replaces only pending Permit2 setup with exact Helpers approvals", async () => {
  const value = fixture({ ...context, authorization: { kind: "none", confidence: "observed" } });
  const calls: { to: viem.Address; data: viem.Hex }[] = [];
  const result = await value.authorize([{ token, amount: ceiling }], { walletBatch: { mode: "requests", approvals: calls,
    signTypedData: async () => { throw new WalletSignatureBatchStoppedError({ code: 4200 }, 0); } } });
  assert.deepEqual(Array.from(result.inputs, input => input.authorization), [0]);
  assert.equal(calls.length, 1); assert.deepEqual(viem.decodeFunctionData({ abi: erc20Abi, data: calls[0].data }).args, [helpers, ceiling]);
  assert.equal(result.permit2.signature, "0x"); assert.deepEqual(value.approvals, []);
});

test("a reverted last Permit2 setup receipt ends a format-unavailable attempt before replacement approval", async () => {
  const value = fixture({ ...context, authorization: { kind: "none", confidence: "observed" } },
    { approvalReverted: true, signatureError: { code: 4200 } });
  await assert.rejects(value.submit(), { name: "TransactionRevertedError" });
  assert.deepEqual(value.approvals, [viem.maxUint256]); assert.equal(value.signed.length, 1);
  assert.deepEqual(value.executions, []);
});
