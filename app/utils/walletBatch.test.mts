import assert from "node:assert/strict";
import test from "node:test";
import { createWalletClient, custom, decodeFunctionData, defineChain, maxUint256, toHex } from "viem";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
import { erc20Abi } from "../contracts/erc20.ts";
import { HELPERS_DIAMOND_ABI } from "../contracts/generated/helpersDiamond.ts";
const { collectWalletApproval, createWalletSwapBatch, walletAtomicStatus, WalletBatchFailedError } =
  await withEnvironment(appEnvironment, () => import("./walletBatch.ts"));
const { targetChainId } = await withEnvironment(appEnvironment, () => import("../config/chain.ts"));

const owner = `0x${"1".repeat(40)}` as const, token = `0x${"2".repeat(40)}` as const;
const helpers = `0x${"3".repeat(40)}` as const, spender = `0x${"4".repeat(40)}` as const;
const id = "opaque-wallet-bundle-id", hash = `0x${"a".repeat(64)}` as const;
const chain = defineChain({ id: targetChainId, name: "Isolated fixture", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://fixture.invalid"] } } });
const args = [{ netCygldOut: 123n, recipient: owner }, { permit: { permitted: [{ token, amount: 456n }],
  nonce: 789n, deadline: 123456789n }, signature: "0x01" }] as const;

function fixture() {
  const requests: { method: string; params?: unknown }[] = [];
  let receiptLogs: { address: typeof helpers; data: `0x${string}`; topics: `0x${string}`[] }[] = [];
  let capabilities: object = { [toHex(targetChainId)]: { atomic: { status: "supported" } } };
  let status = 200, receiptStatus = "0x1", unavailable = false, rejectSend = false, missingReceipts = false;
  const client = createWalletClient({ account: owner, chain, transport: custom({ async request(request) {
    requests.push(request);
    if (request.method === "eth_chainId") return toHex(targetChainId);
    if (request.method === "wallet_getCapabilities") return capabilities;
    if (request.method === "wallet_sendCalls") {
      if (rejectSend) throw { code: 4001, message: "Rejected" };
      return { id };
    }
    if (request.method === "wallet_getCallsStatus") {
      if (unavailable) throw { code: -32603, message: "Unavailable" };
      return { atomic: true, chainId: toHex(targetChainId), version: "2.0.0", status,
        ...(!missingReceipts ? { receipts: [{ transactionHash: hash, blockNumber: "0x64", gasUsed: "0x123", status: receiptStatus, logs: receiptLogs }] } : {}) };
    }
    throw new Error(`Unexpected wallet request: ${request.method}`);
  } }, { retryCount: 0 }) });
  return { client, requests, capabilities: (value: object) => { capabilities = value; },
    status: (value: number, receipt = "0x1") => { status = value; receiptStatus = receipt; },
    unavailable: (value: boolean) => { unavailable = value; }, rejectSend: () => { rejectSend = true; },
    missingReceipts: () => { missingReceipts = true; }, logs: (value: typeof receiptLogs) => { receiptLogs = value; } };
}

test("capabilities are requested for the connected network; other networks cannot grant support", async () => {
  const f = fixture();
  assert.equal(await walletAtomicStatus(f.client, owner, targetChainId), "supported");
  assert.deepEqual(f.requests[0].params, [owner, [toHex(targetChainId)]]);
  for (const value of ["ready", "unsupported"] as const) {
    f.capabilities({ [toHex(targetChainId)]: { atomic: { status: value } } });
    assert.equal(await walletAtomicStatus(f.client, owner, targetChainId), value);
  }
  f.capabilities({ [toHex(targetChainId + 1)]: { atomic: { status: "supported" } } });
  assert.equal(await walletAtomicStatus(f.client, owner, targetChainId), "unsupported");
  f.capabilities({ "0x0": { atomic: { status: "supported" } } });
  assert.equal(await walletAtomicStatus(f.client, owner, targetChainId), "supported");
});

test("unsupported discovery is an ordinary sequential option and never requests signing", async () => {
  const requests: string[] = [];
  const client = { request: async ({ method }: { method: string }) => { requests.push(method); throw { code: 4200 }; } };
  assert.equal(await walletAtomicStatus(client as never, owner, targetChainId), "unavailable");
  assert.deepEqual(requests, ["wallet_getCapabilities"]);
});

test("approval and original Helpers terms are ordered in one atomic bundle with an opaque ID", async () => {
  const f = fixture(), batch = createWalletSwapBatch(f.client, owner, helpers);
  collectWalletApproval(batch, token, spender);
  const submission = await batch.submit("issueFromBasketExactOutWithPermit2", args);
  assert.equal(submission.id, id);
  assert.notEqual(submission.id, hash);
  const parameters = (f.requests.find(row => row.method === "wallet_sendCalls")!.params as [{
    atomicRequired: boolean; from: string; chainId: string; calls: { to: string; data: `0x${string}` }[];
  }])[0];
  assert.equal(parameters.atomicRequired, true);
  assert.equal(parameters.chainId, toHex(targetChainId));
  assert.equal(parameters.from, owner);
  assert.deepEqual(parameters.calls.map(call => call.to), [token, helpers]);
  assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: parameters.calls[0].data }).args, [spender, maxUint256]);
  assert.deepEqual(decodeFunctionData({ abi: HELPERS_DIAMOND_ABI, data: parameters.calls[1].data }).args, args);
  assert.deepEqual(await submission.wait(), { transactionHash: hash });
  assert.equal(f.requests.filter(row => row.method === "wallet_sendCalls").length, 1);
  assert.equal(f.requests.filter(row => row.method === "eth_sendTransaction").length, 0);
});

test("rejecting a batch does not send individual transactions afterwards", async () => {
  const f = fixture(); f.rejectSend();
  const batch = createWalletSwapBatch(f.client, owner, helpers);
  collectWalletApproval(batch, token, spender);
  await assert.rejects(batch.submit("issueFromBasketExactOutWithPermit2", args));
  assert.equal(f.requests.filter(row => row.method === "wallet_sendCalls").length, 1);
  assert.equal(f.requests.filter(row => row.method === "eth_sendTransaction").length, 0);
});

test("rechecking an unavailable bundle status does not resend its calls", async () => {
  const f = fixture(), batch = createWalletSwapBatch(f.client, owner, helpers);
  const submission = await batch.submit("issueFromBasketExactOutWithPermit2", args);
  f.unavailable(true);
  await assert.rejects(submission.wait());
  f.unavailable(false);
  assert.deepEqual(await submission.wait(), { transactionHash: hash });
  assert.equal(f.requests.filter(row => row.method === "wallet_sendCalls").length, 1);
  assert.equal(f.requests.filter(row => row.method === "eth_sendTransaction").length, 0);
});

test("definite batch failures distinguish reverted receipts from wallet execution failures", async () => {
  for (const reverted of [false, true]) {
    const f = fixture(); f.status(500, reverted ? "0x0" : "0x1");
    const submission = await createWalletSwapBatch(f.client, owner, helpers).submit("issueFromBasketExactOutWithPermit2", args);
    await assert.rejects(submission.wait(), error => {
      assert.ok(error instanceof WalletBatchFailedError);
      assert.equal(error.outcome, reverted ? "reverted" : "failed");
      return true;
    });
  }
});

test("successful wallet confirmation does not invent a hash when receipts are absent", async () => {
  const f = fixture(); f.missingReceipts();
  const submission = await createWalletSwapBatch(f.client, owner, helpers).submit("issueFromBasketExactOutWithPermit2", args);
  assert.deepEqual(await submission.wait(), { transactionHash: undefined });
});


test("atomic confirmation carries existing operation logs without another receipt read", async () => {
  const f = fixture(), logs = [{ address: helpers, data: "0xab" as const, topics: [`0x${"1".repeat(64)}` as `0x${string}`] }];
  f.logs(logs);
  const submission = await createWalletSwapBatch(f.client, owner, helpers).submit("issueFromBasketExactOutWithPermit2", args);
  const result = await submission.wait();
  assert.deepEqual(result.logs, logs); assert.equal(result.transactionHash, hash);
  assert.equal(f.requests.filter(row => row.method === "wallet_getCallsStatus").length, 1);
  assert.equal(f.requests.some(row => row.method === "eth_getTransactionReceipt"), false);
});
