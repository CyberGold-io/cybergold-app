import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, type Hex, type Address } from "viem";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
import { HELPERS_DIAMOND_ABI } from "../contracts/generated/helpersDiamond.ts";
import { erc20Abi } from "../contracts/erc20.ts";
import type { EthereumProvider } from "./ethereumProvider.ts";
import type { MetaMaskBatchRequest, MetaMaskSignatureRequest } from "./metaMaskRequestBatch.ts";
import { signWalletTypedDataGroup } from "./walletTypedData.ts";
import { createSwapDiagnostics, type ClientDiagnostic } from "./clientDiagnostics.ts";
const mainnetEnvironment = { ...appEnvironment, NEXT_PUBLIC_CHAIN_ID: "1" };
const { createMetaMaskRequestBatch, prepareWalletSwapBatch, reportWalletRequestBatchDiagnostic, resolveSelectedMetaMaskExtension, WalletRequestBatchStoppedError, WalletSignatureBatchStoppedError } =
  await withEnvironment(mainnetEnvironment, () => import("./metaMaskRequestBatch.ts"));
const { collectWalletApproval } = await withEnvironment(mainnetEnvironment, () => import("./walletBatch.ts"));
const { EXPECTED_CHAIN_ID } = await withEnvironment(mainnetEnvironment, () => import("./expectedChain.ts"));
const owner = `0x${"1".repeat(40)}` as const, token = `0x${"2".repeat(40)}` as const;
const helpers = `0x${"3".repeat(40)}` as const, permit2 = `0x${"4".repeat(40)}` as const;
const approvalHash = `0x${"a".repeat(64)}` as Hex, swapHash = `0x${"b".repeat(64)}` as Hex;
const args = [{ netCygldOut: 123n, recipient: owner }, { permit: { permitted: [{ token, amount: 456n }],
  nonce: 789n, deadline: 123456789n }, signature: "0x01" }] as const;

function fixture() {
  const requests: MetaMaskBatchRequest[] = [], batchRequests: { method: string; params: MetaMaskBatchRequest[] }[] = [];
  const waited: Hex[] = [], reports: Record<string, unknown>[] = [], confirmations: string[] = [];
  let rejected = false, receiptUnavailable = false, reverted = false, lateSDKFailure = false, unrelatedRequest = false;
  const provider: EthereumProvider = { isMetaMask: true, async request(request) {
    assert.equal(request.method, "eth_sendTransaction");
    requests.push(request as MetaMaskBatchRequest);
    if ((request.params as MetaMaskBatchRequest["params"])[0].to === helpers && rejected) throw { code: 4001, message: "Rejected" };
    return requests.length === 1 ? approvalHash : swapHash;
  } };
  const originalRequest = provider.request;
  const client = { getChainId: async () => EXPECTED_CHAIN_ID };
  const options = {
    getProvider: async () => provider,
    loadSDKProvider: async () => new Proxy(provider, { get(target, property) {
      if (property !== "request") return Reflect.get(target, property);
      return async (request: { method: "metamask_batch"; params: MetaMaskBatchRequest[] }) => {
      batchRequests.push(request);
      // The unit adapter follows the installed SDK's documented extension
      // request loop; actual SDK/MetaMask transport is exercised separately.
      const results = [];
      for (const [index, rpc] of request.params.entries()) {
        results.push(await provider.request(rpc));
        if (index === 0 && unrelatedRequest) {
          // A separate panel action can even carry identical transaction
          // fields; it is not the SDK's canonical supplied params array.
          await provider.request({ method: rpc.method, params: [{ ...rpc.params[0] }] });
        }
      }
      if (lateSDKFailure) throw new Error("SDK completion unavailable");
      return results;
      };
    } }),
    waitReceipt: async hash => {
      waited.push(hash);
      if (receiptUnavailable) throw new Error("Receipt unavailable");
      return { status: reverted ? "reverted" : "success" };
    }, report: event => { reports.push(event); },
  } satisfies Parameters<typeof createMetaMaskRequestBatch>[3];
  const batch = createMetaMaskRequestBatch(client as never, owner, helpers, options);
  collectWalletApproval(batch, token, permit2);
  return { batch, client, options, provider, originalRequest, requests, batchRequests, waited, reports, confirmations,
    tracker: { requestNext: (kind: string) => { confirmations.push(kind); } },
    rejectSwap: () => { rejected = true; }, outage: (value: boolean) => { receiptUnavailable = value; },
    revert: () => { reverted = true; }, stopAfterAllBroadcasts: () => { lateSDKFailure = true; },
    sendUnrelatedRequest: () => { unrelatedRequest = true; } };
}

function announcedExtension(provider: EthereumProvider) {
  const events = new EventTarget();
  events.addEventListener("eip6963:requestProvider", () => events.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
    detail: { provider, info: { rdns: "io.metamask" } },
  })));
  return Object.assign(events, { setTimeout: (callback: () => void) => setTimeout(callback, 0), clearTimeout }) as never;
}

test("injected and RainbowKit SDK connectors resolve the same announced raw extension", async () => {
  const f = fixture(); const wrapped = await f.options.loadSDKProvider();
  assert.equal(await resolveSelectedMetaMaskExtension(f.provider, announcedExtension(f.provider)), f.provider);
  assert.equal(await resolveSelectedMetaMaskExtension(wrapped, announcedExtension(f.provider)), f.provider);
  assert.equal(Object.getOwnPropertySymbols(f.provider).length, 0);
  assert.deepEqual(f.requests, []); assert.deepEqual(f.batchRequests, []);
});

test("another installed MetaMask provider cannot be mistaken for the connector's extension", async () => {
  const f = fixture(); const other: EthereumProvider = { isMetaMask: true, request: async () => { throw new Error("No RPC expected"); } };
  assert.equal(await resolveSelectedMetaMaskExtension(other, announcedExtension(f.provider)), undefined);
  assert.equal(Object.getOwnPropertySymbols(f.provider).length, 0);
  assert.deepEqual(f.requests, []);
});

test("an unsupported announcement marker stays a quiet optional fallback", async () => {
  const f = fixture(); Object.preventExtensions(f.provider);
  assert.equal(await resolveSelectedMetaMaskExtension(f.provider, announcedExtension(f.provider)), undefined);
  assert.deepEqual(f.requests, []);
});

test("request batching observes the raw target beneath a RainbowKit SDK connector", async () => {
  const f = fixture(); const connector = await f.options.loadSDKProvider();
  const batch = await prepareWalletSwapBatch(f.client as never, owner, helpers, { ...f.options,
    chainId: 1, atomicStatus: "unsupported", getProvider: async () => connector,
    resolveExtension: provider => resolveSelectedMetaMaskExtension(provider, announcedExtension(f.provider)),
  });
  assert.equal(batch?.mode, "requests");
  collectWalletApproval(batch!, token, permit2);
  const submission = await batch!.submit("issueFromBasketExactOutWithPermit2", args, undefined, f.tracker);
  assert.deepEqual(submission.transactionHashes, [approvalHash, swapHash]);
  assert.deepEqual(f.confirmations, ["approval", "transaction"]);
  assert.equal(f.provider.request, f.originalRequest);
});

for (const chainId of [1, 31338]) test(`chain ${chainId} prepares the selected MetaMask extension without a query or wallet prompt`, async () => {
  const f = fixture(); let sdkPrepared = false;
  const batch = await prepareWalletSwapBatch(f.client as never, owner, helpers, { ...f.options,
    chainId, atomicStatus: "unsupported", resolveExtension: async provider => provider === f.provider ? provider : undefined,
    loadSDKProvider: async () => { sdkPrepared = true; return f.options.loadSDKProvider(); },
  });
  assert.equal(sdkPrepared, true); assert.equal(batch?.mode, "requests");
  assert.deepEqual(f.requests, []); assert.deepEqual(f.waited, []);
});

test("supported atomic capability survives optional SDK setup unavailability on Sandbox or Mainnet", async () => {
  const f = fixture();
  for (const chainId of [31338, 1]) {
    const batch = await prepareWalletSwapBatch(f.client as never, owner, helpers, { ...f.options,
      chainId, atomicStatus: "supported", getProvider: async () => { throw new Error("Extension discovery unavailable"); },
    });
    assert.equal(batch?.mode, "atomic");
  }
});

test("Mainnet ready accounts request approval and swap without receipt waits or an account upgrade", async () => {
  const f = fixture();
  const batch = await prepareWalletSwapBatch(f.client as never, owner, helpers, { ...f.options,
    chainId: 1, atomicStatus: "ready", resolveExtension: async () => f.provider,
  });
  assert.equal(batch?.mode, "requests"); assert.equal(f.requests.length, 0);
  collectWalletApproval(batch!, token, permit2);
  const submission = await batch!.submit("issueFromBasketExactOutWithPermit2", args, undefined, f.tracker);
  assert.deepEqual(f.requests.map(request => request.method), ["eth_sendTransaction", "eth_sendTransaction"]);
  assert.deepEqual(f.requests.map(request => request.params[0].chainId), ["0x1", "0x1"]);
  assert.deepEqual(f.confirmations, ["approval", "transaction"]);
  assert.deepEqual(f.waited, []);
  await submission.wait();
  assert.deepEqual(f.waited, [approvalHash, swapHash]);
});

test("other wallets, mobile/absent extension and SDK setup failure fall back before any signing", async () => {
  const f = fixture();
  for (const chainId of [1, 31338]) for (const options of [
    { getProvider: async () => undefined },
    { getProvider: async () => ({ ...f.provider, isMetaMask: false }) },
    { resolveExtension: async () => undefined },
    { loadSDKProvider: async () => { throw new Error("SDK unavailable"); } },
  ]) {
    const batch = await prepareWalletSwapBatch(f.client as never, owner, helpers, { ...f.options,
      chainId, atomicStatus: "unsupported", resolveExtension: async () => f.provider, ...options });
    assert.equal(batch, undefined);
  }
  assert.deepEqual(f.requests, []); assert.deepEqual(f.waited, []);
});

test("a cached SDK for another MetaMask provider cannot sign through the selected account", async () => {
  const f = fixture();
  const batch = await prepareWalletSwapBatch(f.client as never, owner, helpers, { ...f.options,
    chainId: 31338, atomicStatus: "unsupported", resolveExtension: async () => f.provider,
    loadSDKProvider: async () => ({ request: async () => { throw new Error("Must not call another wallet"); } }),
  });
  assert.equal(batch, undefined); assert.deepEqual(f.requests, []);
  assert.equal(f.provider.request, f.originalRequest);
});

test("approval and signed swap are sent as genuine SDK request-batch parameters without receipt waits or gas overrides", async () => {
  const f = fixture();
  const submission = await f.batch.submit("issueFromBasketExactOutWithPermit2", args, undefined, f.tracker);
  assert.equal(f.batch.mode, "requests");
  assert.equal(submission.kind, "wallet-request-batch");
  assert.deepEqual(submission.transactionHashes, [approvalHash, swapHash]);
  assert.deepEqual(f.waited, []);
  assert.deepEqual(f.confirmations, ["approval", "transaction"]);
  assert.equal(f.batchRequests.length, 1);
  assert.equal(f.batchRequests[0].method, "metamask_batch");
  assert.equal(f.batchRequests[0].params.length, 2);
  const [approval, swap] = f.requests.map(request => request.params[0]);
  assert.equal(approval.from, owner); assert.equal(approval.to, token);
  assert.equal(swap.from, owner); assert.equal(swap.to, helpers);
  assert.equal("gas" in swap, false); assert.equal("nonce" in swap, false);
  assert.equal(decodeFunctionData({ abi: erc20Abi, data: approval.data }).functionName, "approve");
  assert.deepEqual(decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: swap.data }).args, args);
  assert.equal(f.provider.request, f.originalRequest);
  assert.deepEqual(await submission.wait(), { transactionHash: swapHash });
  assert.deepEqual(f.waited, [approvalHash, swapHash]);
});

test("a rejected swap preserves its broadcast approval hash and never retries the request batch", async () => {
  const f = fixture(); f.rejectSwap();
  await assert.rejects(f.batch.submit("issueFromBasketExactOutWithPermit2", args), error => {
    assert.ok(error instanceof WalletRequestBatchStoppedError);
    assert.deepEqual(error.transactionHashes, [approvalHash]);
    assert.equal(error.submission, undefined);
    assert.equal((error.cause as { code: number }).code, 4001);
    return true;
  });
  assert.equal(f.requests.length, 2); assert.equal(f.batchRequests.length, 1);
  assert.equal(f.provider.request, f.originalRequest);
  assert.deepEqual(f.waited, []);
});

test("an SDK error after the Helpers hash retains a submitted receipt recheck without replay", async () => {
  const f = fixture(); f.stopAfterAllBroadcasts();
  let submission: Awaited<ReturnType<typeof f.batch.submit>> | undefined;
  await assert.rejects(f.batch.submit("issueFromBasketExactOutWithPermit2", args), error => {
    assert.ok(error instanceof WalletRequestBatchStoppedError);
    assert.deepEqual(error.transactionHashes, [approvalHash, swapHash]);
    submission = error.submission; assert.ok(submission);
    return true;
  });
  assert.deepEqual(await submission!.wait(), { transactionHash: swapHash });
  assert.deepEqual(f.waited, [approvalHash, swapHash]);
  assert.equal(f.requests.length, 2); assert.equal(f.batchRequests.length, 1);
  assert.equal(f.provider.request, f.originalRequest);
});

test("an unrelated panel transaction cannot become a batch's Helpers hash or tracker step", async () => {
  const f = fixture(); f.sendUnrelatedRequest(); f.rejectSwap();
  await assert.rejects(f.batch.submit("issueFromBasketExactOutWithPermit2", args, undefined, f.tracker), error => {
    assert.ok(error instanceof WalletRequestBatchStoppedError);
    assert.deepEqual(error.transactionHashes, [approvalHash]);
    assert.equal(error.submission, undefined);
    return true;
  });
  assert.deepEqual(f.confirmations, ["approval", "transaction"]);
  assert.equal(f.requests.length, 3); assert.equal(f.batchRequests.length, 1);
  assert.equal(f.provider.request, f.originalRequest);
});

test("production batch diagnostics stay quiet", async () => {
  const original = console.info;
  let calls = 0;
  try {
    console.info = () => { calls += 1; };
    await withEnvironment({ NODE_ENV: "production" }, () => reportWalletRequestBatchDiagnostic({ outcome: "enabled" }));
    assert.equal(calls, 0);
  } finally {
    console.info = original;
  }
});

test("confirmation rechecks never replay successful SDK submissions", async () => {
  const f = fixture(); const submission = await f.batch.submit("issueFromBasketExactOutWithPermit2", args);
  f.outage(true); await assert.rejects(submission.wait());
  f.outage(false); assert.deepEqual(await submission.wait(), { transactionHash: swapHash });
  assert.equal(f.requests.length, 2); assert.equal(f.batchRequests.length, 1);
});

test("a reverted receipt cannot be announced as a successful swap", async () => {
  const f = fixture(); const submission = await f.batch.submit("issueFromBasketExactOutWithPermit2", args);
  f.revert(); await assert.rejects(submission.wait(), error => (error as Error).name === "TransactionRevertedError");
});

test("local request diagnostics expose methods and hashes without signed payloads", async () => {
  const f = fixture(); await f.batch.submit("issueFromBasketExactOutWithPermit2", args);
  const text = JSON.stringify(f.reports);
  assert.ok(text.includes("metamask_batch")); assert.ok(text.includes(approvalHash));
  assert.equal(text.includes("signature"), false); assert.equal(text.includes("calldata"), false);
  assert.equal(text.includes(helpers), false);
});

function signatureFixture(failureIndex = -1, failure: unknown = { code: 4001 }, completionFailure = false) {
  const outer: { method: string; params: (MetaMaskBatchRequest | MetaMaskSignatureRequest)[] }[] = [];
  const inner: MetaMaskSignatureRequest[] = [], confirmations: string[] = [];
  const signature = `0x${"11".repeat(32)}${"22".repeat(32)}1b` as Hex;
  const raw: EthereumProvider = { isMetaMask: true, async request(request) {
    assert.equal(request.method, "eth_signTypedData_v4");
    inner.push(request as MetaMaskSignatureRequest);
    if (inner.length - 1 === failureIndex) throw failure;
    return signature;
  } };
  const original = raw.request;
  const batch = createMetaMaskRequestBatch({ getChainId: async () => EXPECTED_CHAIN_ID } as never, owner, helpers, {
    getProvider: async () => raw, waitReceipt: async () => ({ status: "success" }), report: () => {},
    loadSDKProvider: async () => ({ async request(request) {
      outer.push(request);
      const result = [];
      for (const rpc of request.params) result.push(await raw.request(rpc));
      if (completionFailure) throw new Error("SDK result unavailable");
      return result;
    } }),
  });
  const payload = (verifyingContract: Address, primaryType: "Permit" | "PermitBatchTransferFrom" = "Permit") => ({ account: owner,
    domain: { name: "", version: "", chainId: EXPECTED_CHAIN_ID, verifyingContract },
    primaryType, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" },
      { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      Permit: [{ name: "value", type: "uint256" }], PermitBatchTransferFrom: [{ name: "value", type: "uint256" }] }, message: { value: 123n } });
  return { batch, raw, original, payload, outer, inner, signature,
    tracker: { requestNext: (kind: string) => { confirmations.push(kind); } }, confirmations };
}

for (const count of [1, 3]) test(`${count} typed permissions use one flat SDK call and preserve ordered domains and results`, async () => {
  const f = signatureFixture();
  const payloads = [f.payload(token), f.payload(helpers), f.payload(permit2, "PermitBatchTransferFrom")].slice(0, count);
  const signatures = await f.batch.signTypedData!(payloads, f.tracker);
  assert.equal(f.outer.length, 1); assert.equal(f.outer[0].method, "metamask_batch");
  assert.equal(f.outer[0].params.length, count); assert.deepEqual(signatures, Array(count).fill(f.signature));
  assert.deepEqual(f.inner.map(request => request.params[0]), Array(count).fill(owner));
  assert.deepEqual(f.inner.map(request => JSON.parse(request.params[1]).domain.verifyingContract), payloads.map(p => p.domain.verifyingContract));
  for (const request of f.inner) {
    const typed = JSON.parse(request.params[1]);
    assert.equal(typed.domain.version, ""); assert.equal(typed.domain.name, "");
    assert.deepEqual(typed.types.EIP712Domain.map((field: { name: string }) => field.name), ["name", "version", "chainId", "verifyingContract"]);
    assert.equal(typed.message.value, "123");
  }
  assert.deepEqual(f.confirmations, Array(count).fill("signature")); assert.equal(f.raw.request, f.original);
});

for (const index of [0, 1]) for (const code of [4001, 4200]) test(`signature error ${code} at index ${index} stops the SDK group without replay`, async () => {
  const f = signatureFixture(index, { code });
  await assert.rejects(f.batch.signTypedData!([f.payload(token), f.payload(helpers), f.payload(permit2)]), error => {
    assert.ok(error instanceof WalletSignatureBatchStoppedError);
    assert.equal(error.completedSignatures, index); assert.equal((error.cause as { code: number }).code, code); return true;
  });
  assert.equal(f.outer.length, 1); assert.equal(f.inner.length, index + 1); assert.equal(f.raw.request, f.original);
});

test("a lost SDK completion after signing all payloads remains a stopped group with no automatic replay", async () => {
  const f = signatureFixture(-1, undefined, true);
  await assert.rejects(f.batch.signTypedData!([f.payload(token), f.payload(helpers)]), error => {
    assert.ok(error instanceof WalletSignatureBatchStoppedError); assert.equal(error.completedSignatures, 2); return true;
  });
  assert.equal(f.outer.length, 1); assert.equal(f.inner.length, 2); assert.equal(f.raw.request, f.original);
});

test("SDK signing emits one safe fulfillment for each actual request, without an outer-group duplicate", async () => {
  const f = signatureFixture(), events: ClientDiagnostic[] = [], observedArguments: unknown[][] = [];
  const swap = createSwapDiagnostics({}, undefined, event => events.push(event));
  const signatures = await signWalletTypedDataGroup([f.payload(token), f.payload(helpers)],
    async () => { assert.fail("The eligible SDK owns signing"); }, f.batch, {
      requestNext: swap.walletStep, signatureFulfilled: (...args) => { observedArguments.push(args); swap.signatureFulfilled(); },
    });
  assert.deepEqual(signatures, [f.signature, f.signature]);
  assert.equal(f.outer.length, 1); assert.equal(f.inner.length, 2); assert.equal(f.raw.request, f.original);
  assert.deepEqual(observedArguments, [[], []]);
  assert.deepEqual(events.map(event => [event.operation, event.outcome]), [
    ["swap", "started"], ["wallet", "requested"], ["wallet", "succeeded"], ["wallet", "requested"], ["wallet", "succeeded"],
  ]);
  assert.ok(events.every(event => event.attemptId === swap.id));
  assert.equal(events.some(event => event.operation === "swap" && event.outcome === "succeeded"), false);
  assert.doesNotMatch(JSON.stringify(events), new RegExp(`${f.signature.slice(2)}|primaryType|message|verifyingContract`));
});

test("SDK signature rejection reports only previously fulfilled requests and preserves no-replay behavior", async () => {
  const f = signatureFixture(1); let observed = 0;
  await assert.rejects(f.batch.signTypedData!([f.payload(token), f.payload(helpers), f.payload(permit2)], {
    requestNext: () => {}, signatureFulfilled: () => { observed++; },
  }), error => error instanceof WalletSignatureBatchStoppedError && error.completedSignatures === 1);
  assert.equal(observed, 1); assert.equal(f.outer.length, 1); assert.equal(f.inner.length, 2); assert.equal(f.raw.request, f.original);
});

test("SDK aggregate failure retains actual fulfilled signatures without claiming group success or retrying", async () => {
  const f = signatureFixture(-1, undefined, true); let observed = 0;
  await assert.rejects(f.batch.signTypedData!([f.payload(token), f.payload(helpers)], {
    requestNext: () => {}, signatureFulfilled: () => { observed++; },
  }), error => error instanceof WalletSignatureBatchStoppedError && error.completedSignatures === 2);
  assert.equal(observed, 2); assert.equal(f.outer.length, 1); assert.equal(f.inner.length, 2); assert.equal(f.raw.request, f.original);
});

test("an SDK fulfillment observer failure never discards a native result or adds signing requests", async () => {
  const f = signatureFixture(); let observed = 0;
  assert.deepEqual(await f.batch.signTypedData!([f.payload(token), f.payload(helpers)], {
    requestNext: () => {}, signatureFulfilled: () => { observed++; throw new Error("observer unavailable"); },
  }), [f.signature, f.signature]);
  assert.equal(observed, 2); assert.equal(f.outer.length, 1); assert.equal(f.inner.length, 2); assert.equal(f.raw.request, f.original);
});

test("a rejected asynchronous SDK fulfillment observation does not escape or change a signature", async () => {
  const f = signatureFixture(); let observed = 0;
  assert.deepEqual(await f.batch.signTypedData!([f.payload(token)], {
    requestNext: () => {}, signatureFulfilled: async () => { observed++; throw new Error("observer unavailable"); },
  }), [f.signature]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(observed, 1); assert.equal(f.outer.length, 1); assert.equal(f.inner.length, 1); assert.equal(f.raw.request, f.original);
});

test("eligible MetaMask atomic accounts retain the SDK signature group and their atomic transaction executor", async () => {
  const f = signatureFixture();
  const batch = await prepareWalletSwapBatch({ getChainId: async () => EXPECTED_CHAIN_ID } as never, owner, helpers, {
    chainId: EXPECTED_CHAIN_ID, atomicStatus: "supported", getProvider: async () => f.raw,
    resolveExtension: async () => f.raw, waitReceipt: async () => ({ status: "success" }),
    loadSDKProvider: async () => new Proxy(f.raw, { get(target, property) {
      if (property !== "request") return Reflect.get(target, property);
      return async (request: { params: MetaMaskSignatureRequest[] }) => {
        f.outer.push({ method: "metamask_batch", params: request.params });
        const result = []; for (const rpc of request.params) result.push(await f.raw.request(rpc)); return result;
      };
    } }), report: () => {},
  });
  assert.equal(batch?.mode, "atomic"); assert.ok(batch?.signTypedData);
  await batch.signTypedData([f.payload(token), f.payload(helpers)]);
  assert.equal(f.outer.length, 1); assert.equal(f.inner.length, 2);
});


test("SDK confirmation keeps the final Helpers receipt logs from its existing wait", async () => {
  const f = fixture(), logs = [{ address: helpers, data: "0xab" as const, topics: [`0x${"1".repeat(64)}` as Hex] }];
  const waited: Hex[] = [];
  const batch = createMetaMaskRequestBatch(f.client as never, owner, helpers, { ...f.options,
    waitReceipt: async hash => { waited.push(hash); return { status: "success", ...(hash === swapHash ? { logs } : {}) }; } });
  collectWalletApproval(batch, token, permit2);
  const submission = await batch.submit("issueFromBasketExactOutWithPermit2", args);
  assert.deepEqual((await submission.wait()).logs, logs);
  assert.deepEqual(waited, [approvalHash, swapHash]);
});
