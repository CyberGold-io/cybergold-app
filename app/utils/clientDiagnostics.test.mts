import assert from "node:assert/strict";
import test from "node:test";
import { createWalletClient, custom, encodeErrorResult, getContractError, InternalRpcError, parseAbi, RawContractError } from "viem";
import { createQuoteDiagnostics, createSwapDiagnostics, diagnosticFailure, diagnosticReason, reportClientDiagnostic, type ClientDiagnostic } from "./clientDiagnostics.ts";
import { QuotePreviewError } from "./quoteErrors.ts";

const contractContext = {
  abi: [{ type: "function", name: "issue", inputs: [], outputs: [], stateMutability: "nonpayable" }],
  functionName: "issue", args: [],
} as const;

test("Viem's generic internal wallet error is not evidence of a contract revert", () => {
  const error = getContractError(new InternalRpcError(Object.assign(new Error("private wallet/provider text"),
    { code: -32603 })), contractContext);
  assert.equal(error.cause.name, "ContractFunctionRevertedError");
  assert.deepEqual(diagnosticFailure(error), { reason: "rpc_error", errorCode: -32603 });
  const events: ClientDiagnostic[] = [];
  const swap = createSwapDiagnostics({}, undefined, event => events.push(event));
  swap.walletStep("transaction"); swap.failed(error);
  assert.deepEqual(events.at(-1)?.reason, "rpc_error");
  assert.equal(events.at(-1)?.outcome, "failed");
  assert.equal(events.at(-1)?.transactionHash, undefined);
  assert.equal(events.at(-1)?.errorCode, -32603);
  assert.doesNotMatch(JSON.stringify(events), /private|provider|ContractFunction/);
});

test("unknown EVM revert bytes retain only their selector, never encoded arguments", () => {
  const raw = `0x756688FE${"ab".repeat(64)}` as const;
  const error = getContractError(new RawContractError({ data: raw }), contractContext);
  assert.deepEqual(diagnosticFailure(error), { reason: "contract_reverted", errorCode: 3, errorSelector: "0x756688fe" });
  const events: ClientDiagnostic[] = [];
  const swap = createSwapDiagnostics({}, undefined, event => events.push(event));
  swap.submitted(`0x${"c".repeat(64)}`); swap.failed(error);
  assert.equal(events.at(-1)?.outcome, "reverted");
  assert.equal(events.at(-1)?.errorSelector, "0x756688fe");
  assert.doesNotMatch(JSON.stringify(events), /abababab/);
  const empty = getContractError(new RawContractError({ data: "0x" }), contractContext);
  assert.deepEqual(diagnosticFailure(empty), { reason: "contract_reverted", errorCode: 3 });
});

test("actual Viem wallet writes preserve provider codes through RPC wrappers", async () => {
  const abi = parseAbi(["function issue()", "error InvalidNonce()"]);
  for (const [fault, expected] of [
    [{ code: -32603, message: "private internal provider error" }, { reason: "rpc_error", errorCode: -32603 }],
    [{ code: 3, message: "execution reverted", data: encodeErrorResult({ abi, errorName: "InvalidNonce" }) },
      { reason: "contract_reverted", errorCode: 3, errorSelector: "0x756688fe" }],
  ] as const) {
    let requests = 0;
    const client = createWalletClient({ account: "0x0000000000000000000000000000000000000011",
      transport: custom({ request: async ({ method }) => {
        assert.equal(method, "eth_sendTransaction"); requests++; throw fault;
      } }, { retryCount: 0 }),
    });
    await assert.rejects(client.writeContract({ address: "0x0000000000000000000000000000000000000022",
      abi, functionName: "issue", chain: null }), error => {
      assert.deepEqual(diagnosticFailure(error), expected); return true;
    });
    assert.equal(requests, 1);
  }
});

test("diagnostics do not treat arbitrary error data as revert bytes or serialize unsafe codes", () => {
  for (const code of [true, "-32603", 1.2, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(diagnosticFailure({ code, data: "0x756688fe", raw: "0x756688fe" }), { reason: "unknown" });
  }
  for (const raw of ["0x756688f", "0x756688fe0", "0x756688feprivate", "private", { data: "0x756688fe" }]) {
    assert.deepEqual(diagnosticFailure({ name: "ContractFunctionRevertedError", raw }), { reason: "unknown" });
  }
  assert.deepEqual(diagnosticFailure({ name: "ContractFunctionRevertedError", data: "0x756688fe" }), { reason: "unknown" });
  const cycle: { cause?: unknown; code: number } = { code: -32603 }; cycle.cause = cycle;
  assert.deepEqual(diagnosticFailure({ name: "InternalRpcError", cause: cycle }), { reason: "rpc_error", errorCode: -32603 });
  assert.deepEqual(diagnosticFailure({ name: "InternalRpcError", code: -32603, cause: { code: 4001 } }),
    { reason: "wallet_rejected", errorCode: 4001 });
});

test("quote outcomes are deduplicated and a new quote gets a new correlation ID", () => {
  const events: ClientDiagnostic[] = [];
  const quotes = createQuoteDiagnostics(event => events.push(event));
  const context = { direction: "issue", route: "basket", inputMode: "exact-in", chainId: 31338 } as const;
  quotes.observe(context, "loading"); quotes.observe(context, "success"); quotes.observe(context, "success");
  assert.equal(events.length, 1);
  const firstId = quotes.id;
  quotes.observe(context, "loading"); quotes.observe(context, "failed");
  assert.equal(events.length, 2); assert.notEqual(quotes.id, firstId);
  assert.equal(events[1].reason, "unknown");
  quotes.observe(context, "idle"); assert.equal(quotes.id, undefined);
});

test("wallet stages and submitted receipt outcomes share one attempt and never serialize errors", () => {
  const events: ClientDiagnostic[] = [];
  const hash = `0x${"a".repeat(64)}`;
  const swap = createSwapDiagnostics({ direction: "redeem" }, "quote-id", event => events.push(event));
  swap.walletStep("signature"); swap.submitted(hash);
  swap.failed(Object.assign(new Error("signature=secret https://secret@rpc"), { name: "TimeoutError" }));
  assert.deepEqual(events.map(event => event.outcome), ["started", "requested", "submitted", "unconfirmed"]);
  assert.equal(new Set(events.map(event => event.attemptId)).size, 1);
  assert.equal(events[3].reason, "rpc_error"); assert.equal(events[3].transactionHash, hash);
  assert.doesNotMatch(JSON.stringify(events), /secret/);
  swap.failed({ name: "TransactionRevertedError" }); assert.equal(events.at(-1)?.outcome, "reverted");
  swap.confirmed(hash); assert.equal(events.at(-1)?.outcome, "succeeded");
  const rejected = createSwapDiagnostics({}, undefined, event => events.push(event));
  rejected.failed({ cause: { code: 4001, message: "private" } });
  assert.equal(events.at(-1)?.reason, "wallet_rejected"); assert.equal(events.at(-1)?.outcome, "failed");
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
  assert.equal(diagnosticReason(cycle), "unknown");
});

test("diagnostic failures cannot prevent submission or create retries", async () => {
  let calls = 0;
  const fetcher = (async (url, init) => { calls++;
    assert.equal(url, "/api/diagnostics"); assert.equal(init?.credentials, "omit");
    throw new Error("offline"); }) as typeof fetch;
  assert.doesNotThrow(() => reportClientDiagnostic({ operation: "quote" }, fetcher));
  assert.doesNotThrow(() => reportClientDiagnostic({}, (() => { throw new Error("unavailable"); }) as typeof fetch));
  const swap = createSwapDiagnostics({}, undefined, () => { throw new Error("logger unavailable"); });
  assert.doesNotThrow(() => { swap.walletStep("approval"); swap.submitted("hash"); swap.confirmed(); swap.failed({ code: 4001 }); });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
});

test("a submitted wallet bundle remains submitted without inventing a transaction hash", () => {
  const events: ClientDiagnostic[] = [];
  const swap = createSwapDiagnostics({ chainId: 31338 }, undefined, event => events.push(event));
  swap.submitted();
  swap.failed({ name: "TimeoutError" });
  assert.equal(events.at(-1)?.outcome, "unconfirmed");
  assert.equal(events.at(-1)?.transactionHash, undefined);
  swap.failed({ name: "WalletBatchFailedError" });
  assert.equal(events.at(-1)?.outcome, "failed");
  swap.failed({ name: "TransactionRevertedError" });
  assert.equal(events.at(-1)?.outcome, "reverted");
  const hash = `0x${"b".repeat(64)}`;
  swap.confirmed(hash);
  assert.equal(events.at(-1)?.transactionHash, hash);
});

test("quote causes, Backend request references and preparation stages survive safely", () => {
  const requestId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e", correlationId = "eb3e6932-a2af-4303-a09e-35831f864a1d";
  const error = new QuotePreviewError("rpc-timeout", "https://private-provider", { requestId, correlationId });
  const events: ClientDiagnostic[] = [], quotes = createQuoteDiagnostics(event => events.push(event));
  quotes.observe({ direction: "issue", strategy: "core" }, "failed", error);
  assert.equal(events[0].reason, "rpc_error"); assert.equal(events[0].errorClassification, "rpc-timeout");
  assert.equal(events[0].requestId, requestId); assert.equal(events[0].correlationId, correlationId);
  const swap = createSwapDiagnostics({ requestId }, quotes.id, event => events.push(event));
  swap.stage("balance"); swap.failed(error);
  assert.equal(events.at(-1)?.stage, "balance");
  assert.doesNotMatch(JSON.stringify(events), /private-provider/);
  assert.equal(diagnosticReason(new QuotePreviewError("quote-contract-reverted", "private")), "contract_reverted");
  assert.equal(diagnosticReason(new QuotePreviewError("quote-no-route", "private")), "unknown");
});
