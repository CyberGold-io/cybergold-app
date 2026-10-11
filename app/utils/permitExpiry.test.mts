import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as viem from "viem";
import * as protocolConfiguration from "./protocolConfiguration.ts";
import { maxUint256 } from "viem";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
const tokenPermit = await withEnvironment(appEnvironment, () => import("./tokenPermit.ts"));
const { signWalletTypedDataGroup } = await withEnvironment(appEnvironment, () => import("./walletTypedData.ts"));

import * as swapPolicy from "./swapPolicy.ts";
import * as pendingApproval from "./pendingApproval.ts";

const OWNER = "0x0000000000000000000000000000000000000001" as const;
const HELPERS = "0x0000000000000000000000000000000000000002" as const;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const TOKENS = [
  { token: "0x0000000000000000000000000000000000000003", amount: 3_000_000_000_000_000n },
  { token: "0x0000000000000000000000000000000000000004", amount: 2_000n },
] as const;
const SIGNATURE = `0x${"11".repeat(32)}${"22".repeat(32)}1b`;

type SignedRequest = { message: { deadline: bigint } };
type PermitResult = { deadline: bigint; permit?: { deadline: bigint } };
type PermitHook = {
  prepareSinglePermit2: (params: Record<string, unknown>) => Promise<PermitResult>;
  prepareBatchPermit2: (params: Record<string, unknown>) => Promise<PermitResult>;
  signCygldPermit: (params: Record<string, unknown>) => Promise<PermitResult>;
};

function createFixture(context: TestContext, approvals = true, pendingReceipt = 0) {
  let now = 1_791_011_000_000;
  const startedAt = now;
  const advance = (seconds: number) => { now += seconds * 1_000; };
  context.mock.method(Date, "now", () => now);
  const signed: { request: SignedRequest; at: bigint }[] = [];
  const approvalAmounts: bigint[] = [];
  let receiptCount = 0;
  let finishApproval = () => {};
  const publicClient = {
    // Two slow confirmations exceed even a twenty-minute window started at entry.
    waitForTransactionReceipt: async () => {
      if (++receiptCount === pendingReceipt) {
        await new Promise<void>(resolve => {
          finishApproval = () => { advance(4 * 60); resolve(); };
        });
      } else {
        advance(16 * 60);
      }
      return { status: "success" };
    },
  };
  const dependencies: Record<string, unknown> = {
    "@/app/context/protocolConfigurationContext": { useProtocolConfiguration: () => ({ addresses: { core: HELPERS, helpers: HELPERS }, tokenAddresses: { USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7" } }) },
    "@/app/utils/protocolConfiguration": protocolConfiguration,
    react: { useCallback: (callback: unknown) => callback, useRef: (current: unknown) => ({ current }) },
    wagmi: {
      usePublicClient: () => publicClient,
      useWalletClient: () => ({ data: {} }),
      useSignTypedData: () => ({
        signTypedDataAsync: async (request: SignedRequest) => {
          signed.push({ request, at: BigInt(Math.floor(now / 1_000)) });
          return SIGNATURE;
        },
      }),
      useWriteContract: () => ({
        writeContractAsync: async ({ args }: { args: [string, bigint] }) => {
          approvalAmounts.push(args[1]);
          return "0x01";
        },
      }),
    },
    viem: {
      ...viem,
      maxUint256,
      parseSignature: () => ({ v: 27n, yParity: 0, r: "0x01", s: "0x02" }),
    },
    "@/app/contracts/erc20": { erc20Abi: [], erc20PermitReadAbi: [] },
    "@/app/hooks/cybergold-helpers/usePermit2Address": {
      usePermit2Address: () => ({ data: PERMIT2, isError: false }),
    },
    "@/app/contracts/cybergold-helpers/issueFacet": { HELPERS_DIAMOND_ADDRESS: HELPERS },
    "@/app/utils/permit2/nonce": {
      getPermit2Nonce: async () => { advance(30); return 0n; },
    },
    "@/app/utils/permit2/verifyAddress": {
      requirePermit2ContractAddress: () => PERMIT2,
      verifyPermit2ContractAddress: async () => { advance(30); return PERMIT2; },
    },
    "@/app/utils/tokensApproval": {
      getTokensNeedingPermit2Approval: async ({ permitted }: { permitted: unknown[] }) =>
        approvals ? permitted.map(p => ({ ...(p as object), allowance: 0n })) : [],
    },
    "@/app/utils/receiptWait": {
      waitForAppTransactionReceipt: () => publicClient.waitForTransactionReceipt(),
    },
    "@/app/utils/permit2ApprovalGas": { permit2ApprovalGasLimit: async () => 50_000n },
    "@/app/utils/pendingApproval": pendingApproval,
    "@/app/utils/walletTypedData": { signWalletTypedDataGroup },
    "@/app/utils/tokenPermit": { ...tokenPermit,
      fetchTokenPermit: async () => ({ spender: HELPERS, allowance: { status: "success", value: "0" } }), tokenApprovalGasLimit: async () => 50000n },
    "@/app/utils/walletBatch": {
      collectWalletApproval: (batch: { approvals: unknown[] }, token: string, spender: string) => {
        batch.approvals.push({ token, spender });
      },
    },
    "@/app/utils/corePermit": {
      fetchCorePermit: async () => { advance(120); return { spender: HELPERS, domain: { verifyingContract: HELPERS } }; },
      corePermitSigningFields: () => ({
        domain: { name: "CYGLD", version: "1", chainId: 1, verifyingContract: HELPERS },
        spender: HELPERS,
        nonce: 0n,
      }),
    },
    "@/app/utils/swapPolicy": swapPolicy,
    "@/app/config/chain": { targetChainId: 1 },
    "@/app/utils/expectedChain": {
      EXPECTED_CHAIN_ID: 1,
      assertWalletOnExpectedChain: async () => { advance(30); },
    },
    "../../../config/publicEnvironment.ts": {
      publicEnv: { NEXT_PUBLIC_CORE_DIAMOND_ADDRESS: HELPERS },
    },
  };

  // Execute the actual hooks with deterministic wallet/RPC boundaries.
  function loadHook(name: "usePermit2Transfer" | "useCygldPermit") {
    const source = readFileSync(new URL(`../hooks/flows/shared/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    const exports: Record<string, () => PermitHook> = {};
    runInNewContext(outputText, {
      exports,
      Date,
      require: (specifier: string) => {
        assert.ok(specifier in dependencies, `Unexpected hook dependency: ${specifier}`);
        return dependencies[specifier];
      },
    });
    return exports[name]();
  }

  return { loadHook, signed, approvalAmounts, startedAt, finishApproval: () => finishApproval() };
}

for (const batch of [false, true]) {
  test(`${batch ? "basket" : "single-token"} permit starts twenty minutes at signing after slow approvals`, async (context) => {
    const fixture = createFixture(context);
    const hook = fixture.loadHook("usePermit2Transfer");
    const result = batch
      ? await hook.prepareBatchPermit2({ owner: OWNER, permitted: TOKENS })
      : await hook.prepareSinglePermit2({ owner: OWNER, permitToken: TOKENS[0].token, permitAmount: TOKENS[0].amount });
    assert.equal(fixture.signed.length, 1);
    const { request, at } = fixture.signed[0];
    assert.ok(at > BigInt(fixture.startedAt / 1_000) + 16n * 60n);
    assert.equal(request.message.deadline, at + 20n * 60n);
    assert.equal(batch ? result.permit?.deadline : result.deadline, request.message.deadline);
    assert.deepEqual(fixture.approvalAmounts, Array(batch ? 2 : 1).fill(maxUint256));
  });

  test(`${batch ? "basket" : "single-token"} permit preserves a caller's explicit deadline`, async (context) => {
    const fixture = createFixture(context, false);
    const hook = fixture.loadHook("usePermit2Transfer");
    const deadline = 1_791_020_000n;
    const result = batch
      ? await hook.prepareBatchPermit2({ owner: OWNER, permitted: TOKENS, deadline })
      : await hook.prepareSinglePermit2({ owner: OWNER, permitToken: TOKENS[0].token, permitAmount: TOKENS[0].amount, deadline });
    assert.equal(fixture.signed[0].request.message.deadline, deadline);
    assert.equal(batch ? result.permit?.deadline : result.deadline, deadline);
    assert.deepEqual(fixture.approvalAmounts, []);
  });

  test(`${batch ? "basket" : "single-token"} permit signing still overlaps the final approval confirmation`, async (context) => {
    const fixture = createFixture(context, true, batch ? 2 : 1);
    const hook = fixture.loadHook("usePermit2Transfer");
    const preparation = batch
      ? hook.prepareBatchPermit2({ owner: OWNER, permitted: TOKENS })
      : hook.prepareSinglePermit2({ owner: OWNER, permitToken: TOKENS[0].token, permitAmount: TOKENS[0].amount });
    let settled = false;
    void preparation.then(() => { settled = true; });
    await setImmediate();
    assert.equal(fixture.signed.length, 1);
    const { request, at } = fixture.signed[0];
    assert.equal(request.message.deadline, at + 20n * 60n);
    assert.equal(settled, false);
    fixture.finishApproval();
    const result = await preparation;
    assert.equal(batch ? result.permit?.deadline : result.deadline, request.message.deadline);
  });
}

for (const mode of ["atomic", "requests"]) {
  test(`${mode} wallet batching receives twenty minutes without separate approval transactions`, async (context) => {
    const fixture = createFixture(context);
    const walletBatch = { mode, approvals: [] };
    const result = await fixture.loadHook("usePermit2Transfer").prepareBatchPermit2({
      owner: OWNER, permitted: TOKENS, walletBatch,
    });
    assert.equal(fixture.signed[0].request.message.deadline, fixture.signed[0].at + 20n * 60n);
    assert.equal(result.permit?.deadline, fixture.signed[0].request.message.deadline);
    assert.equal(walletBatch.approvals.length, 2);
    assert.deepEqual(fixture.approvalAmounts, []);
  });
}

test("an already-approved token receives twenty minutes from signing", async (context) => {
  const fixture = createFixture(context, false);
  await fixture.loadHook("usePermit2Transfer").prepareSinglePermit2({
    owner: OWNER, permitToken: TOKENS[0].token, permitAmount: TOKENS[0].amount,
  });
  assert.equal(fixture.signed[0].request.message.deadline, fixture.signed[0].at + 20n * 60n);
  assert.deepEqual(fixture.approvalAmounts, []);
});

test("CYGLD permit starts twenty minutes after metadata reads and wallet preparation", async (context) => {
  const fixture = createFixture(context);
  const result = await fixture.loadHook("useCygldPermit").signCygldPermit({ owner: OWNER, value: 1n });
  assert.equal(fixture.signed[0].request.message.deadline, fixture.signed[0].at + 20n * 60n);
  assert.equal(result.deadline, fixture.signed[0].request.message.deadline);
});

test("CYGLD permit preserves a caller's explicit deadline", async (context) => {
  const fixture = createFixture(context);
  const deadline = 1_791_020_000n;
  const result = await fixture.loadHook("useCygldPermit").signCygldPermit({ owner: OWNER, value: 1n, deadline });
  assert.equal(fixture.signed[0].request.message.deadline, deadline);
  assert.equal(result.deadline, deadline);
});
