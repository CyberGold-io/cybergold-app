import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { expect, type Page } from "@playwright/test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, zeroAddress, type Address, type Hex } from "viem";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
import { protocolConfigurationFixture, tokenAddresses } from "../../tests/fixtures/protocol-configuration.ts";
import { failureResult, RegressionAssertionError, resultFor, type QuoteObservation, type ScenarioResult } from "../../tests/trading/regression.ts";
import { tradeScenarios } from "../../tests/trading/scenarios.ts";
import { notification } from "../../tests/metamask/wallet-ui.ts";
import { safeWalletClickError } from "../../tests/trading/runnerDiagnostics.ts";
import { isWalletRequestCleanupError } from "../../tests/trading/walletRequestLifecycle.ts";

const { executeScenario, executionPlan, requestWallet } = await withEnvironment(appEnvironment, () => import("../../tests/trading/walletExecution.ts"));
const owner = `0x${"a".repeat(40)}` as Address;
const approvalHash = `0x${"b".repeat(64)}` as Hex;

function basketObservation(mode: "exact-in" | "exact-out" = "exact-in"): QuoteObservation {
  const scenario = tradeScenarios.find(row => row.id === `core-issue-basket-${mode}`)!;
  const envelope = { helpers: protocolConfigurationFixture.contracts.helpers!, context: { chainId: protocolConfigurationFixture.chainId,
    blockNumber: "1", blockHash: `0x${"c".repeat(64)}`, observedAt: "2026-10-13T00:00:00Z" } };
  return { scenario, request: mode === "exact-in" ? { mode: "issue-exact-in", maximumAmountsIn: ["100", "200"] }
    : { mode: "issue-exact-out", netCygldOut: "50" },
  value: mode === "exact-in"
    ? { ...envelope, mode: "issue-exact-in", result: { amountsInExact: ["100", "200"], orderedCoreAssets: [tokenAddresses.PAXG, tokenAddresses.XAUT],
      netCygldOut: "50", fees: { protocolFeeCygld: "0", helperFeeCygld: "0" } } }
    : { ...envelope, mode: "issue-exact-out", result: { amountsInExact: ["100", "200"], orderedCoreAssets: [tokenAddresses.PAXG, tokenAddresses.XAUT],
      fees: { protocolFeeCygld: "0", helperFeeCygld: "0" } } },
  result: { ...resultFor(scenario, "execution"), actualStrategy: "core", bounds: { inputMaximum: ["100", "200"], outputMinimum: "50" } } };
}

function walletPage(request: () => Promise<unknown>): Page {
  return { bringToFront: async () => undefined, evaluate: request } as unknown as Page;
}

function browserWalletPage(provider: () => Promise<unknown>, returned: unknown[] = [], controls: {
  notificationReady?: () => Promise<void>; click?: (options: { timeout: number }) => Promise<void>;
  uiState?: () => Promise<unknown>;
} = {}): Page {
  const button = { click: async (options: { timeout: number }) => controls.click?.(options), or: () => button };
  let uiState: Promise<unknown> | undefined;
  const locator = (selector: string, filter?: string): { selector: string; count: () => Promise<number>; and: (other: { selector: string }) => unknown } & typeof button => ({
    ...button, selector, and: other => locator(selector, other.selector), count: async () => {
      if (!controls.uiState) throw new Error("fixture-ui-state-unavailable");
      uiState ??= Promise.resolve().then(controls.uiState);
      const state = await uiState as { controls?: Record<string, Record<string, number>> };
      const group = selector.includes("confirm-footer-button") ? "confirmation"
        : selector.includes("acknowledge-checkbox") ? "alertAcknowledge"
        : selector.includes("submit-button") ? "alertSubmit" : "alert";
      return state?.controls?.[group]?.[filter === ":visible" ? "visible" : filter ? "enabled" : "matched"] ?? 0;
    },
  });
  const popup = { url: () => "chrome-extension://fixture/notification.html#/confirm-transaction", bringToFront: async () => controls.notificationReady?.(),
    setDefaultTimeout: () => undefined, getByTestId: () => button, locator };
  return { bringToFront: async () => undefined,
    context: () => ({ pages: () => [popup], serviceWorkers: () => [{ url: () => "chrome-extension://fixture/background.js" }], close: async () => undefined }),
    evaluate: async (callback: (input: unknown) => Promise<unknown>, input: unknown) => {
      const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
      Object.defineProperty(globalThis, "window", { configurable: true, value: { ethereum: { request: provider } } });
      try {
        try { const value = await callback(input); returned.push(value); return structuredClone(value); }
        catch (error) {
          // Playwright's Error bridge transmits name/message/stack, losing code.
          const original = error as Error, serialized = new Error(original.message);
          serialized.name = original.name; serialized.stack = original.stack; throw serialized;
        }
      } finally {
        if (previous) Object.defineProperty(globalThis, "window", previous);
        else Reflect.deleteProperty(globalThis, "window");
      }
    },
  } as unknown as Page;
}

const installedBasket = (mixed = true) => Response.json({ configuration: {
  basketPermitIssuanceExactIn: { status: "success", value: mixed }, basketPermitIssuanceExactOut: { status: "success", value: mixed },
  permit2: { status: "success", value: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
} });

test("basket availability failures preserve the original exception and export only a fixed stage and safe class", async () => {
  for (const mode of ["exact-in", "exact-out"] as const) {
    const observation = basketObservation(mode);
    const error = Object.assign(new Error("private-wallet-seed signature private-provider-url"),
      { name: "private-error-name", code: "private-error-code" });
    const page = walletPage(async () => { assert.fail("A failed availability read must not request a wallet action"); });
    const fetcher = (async () => { throw error; }) as typeof fetch;
    await assert.rejects(executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher), cause => cause === error);
    assert.equal(observation.result.executionStage, "authorization-availability");
    assert.equal(observation.result.errorClass, "UnknownError");
    assert.equal(observation.result.errorCode, undefined);
    assert.equal(observation.result.transactionHash, undefined);
    assert.equal(observation.result.approvalTransactionHashes, undefined);
    assert.doesNotMatch(JSON.stringify(failureResult(observation.result, error)), /private-wallet-seed|signature|private-provider-url|private-error-name|private-error-code/);
  }
});

test("a basket allowance read failure is distinguished from approval and retains its safe system code", async () => {
  const observation = basketObservation();
  const error = Object.assign(new TypeError("private-rpc-response"), { code: "EACCES" });
  const page = walletPage(async () => { assert.fail("A failed allowance read must not request approval"); });
  const fetcher = (async path => String(path).startsWith("/api/governance/helpers-facts") ? installedBasket()
    : Promise.reject(error)) as typeof fetch;
  await assert.rejects(executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher), cause => cause === error);
  assert.equal(observation.result.executionStage, "allowance-read");
  assert.equal(observation.result.errorClass, "TypeError");
  assert.equal(observation.result.errorCode, "EACCES");
  assert.equal(observation.result.approvalTransactionHashes, undefined);
  assert.doesNotMatch(JSON.stringify(observation.result), /private-rpc-response/);
});

test("a returned approval hash is retained before its receipt completes and survives a reverted approval", async () => {
  const observation = basketObservation();
  const receiptRequested = Promise.withResolvers<void>();
  const receiptResponse = Promise.withResolvers<Response>();
  let walletRequests = 0;
  const page = walletPage(async () => { walletRequests++; return approvalHash; });
  const fetcher = (async path => {
    if (String(path).startsWith("/api/governance/helpers-facts")) return installedBasket();
    if (String(path).startsWith("/api/account/token-permit")) return Response.json({ allowance: { status: "success", value: "0" } });
    if (String(path).startsWith("/api/transaction/receipt")) {
      receiptRequested.resolve();
      return receiptResponse.promise;
    }
    assert.fail("No Helpers simulation or submission should follow a reverted approval");
  }) as typeof fetch;
  const execution = executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher);
  void execution.catch(() => undefined);
  await receiptRequested.promise;
  assert.equal(observation.result.executionStage, "approval-confirmation");
  assert.deepEqual(observation.result.approvalTransactionHashes, [approvalHash]);
  assert.equal(observation.result.transactionHash, undefined);
  assert.equal(walletRequests, 1);
  receiptResponse.resolve(Response.json({ receipt: { status: "reverted", transactionHash: approvalHash,
    blockNumber: "1", blockHash: `0x${"c".repeat(64)}`, logs: [] } }));
  let failure: unknown;
  try { await execution; } catch (error) { failure = error; }
  assert.ok(failure instanceof RegressionAssertionError);
  assert.equal(failure.code, "receipt-reverted");
  assert.equal(observation.result.executionStage, "approval-confirmation");
  assert.deepEqual(failureResult(observation.result, failure).approvalTransactionHashes, [approvalHash]);
  assert.equal(walletRequests, 1);
});

test("a rejected approval request retains its submission stage without inventing a transaction hash", async () => {
  const observation = basketObservation();
  const error = Object.assign(new Error("private-wallet-response"), { code: 4001 });
  const page = walletPage(async () => { throw error; });
  const fetcher = (async path => String(path).startsWith("/api/governance/helpers-facts") ? installedBasket()
    : Response.json({ allowance: { status: "success", value: "0" } })) as typeof fetch;
  await assert.rejects(executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher), cause => cause === error);
  assert.equal(observation.result.executionStage, "approval-submission");
  assert.equal(observation.result.approvalTransactionHashes, undefined);
  assert.equal(observation.result.transactionHash, undefined);
  assert.doesNotMatch(JSON.stringify(observation.result), /private-wallet-response/);
});

test("a later mixed-basket approval failure preserves every already returned approval hash", async () => {
  const observation = basketObservation();
  const secondHash = `0x${"d".repeat(64)}` as Hex;
  let walletRequests = 0;
  const page = walletPage(async () => ++walletRequests === 1 ? approvalHash : secondHash);
  const fetcher = (async (path, init) => {
    const url = String(path);
    if (url.startsWith("/api/governance/helpers-facts")) return installedBasket();
    if (url.startsWith("/api/account/token-permit")) return Response.json({ allowance: { status: "success", value: "0" } });
    if (url.startsWith("/api/account/permit2")) {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.mode, "allowances");
      return Response.json({ mode: "allowances", result: { allowances: request.tokens.map(() => ({ status: "success", value: "0" })) } });
    }
    if (url.startsWith("/api/transaction/receipt")) {
      const hash = new URL(url, "http://fixture.invalid").searchParams.get("hash");
      return Response.json({ receipt: { status: hash === approvalHash ? "success" : "reverted", transactionHash: hash,
        blockNumber: "1", blockHash: `0x${"c".repeat(64)}`, logs: [] } });
    }
    assert.fail("A reverted Permit2 approval must stop before nonce/signature or Helpers submission");
  }) as typeof fetch;
  await assert.rejects(executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher),
    error => error instanceof RegressionAssertionError && error.code === "receipt-reverted");
  assert.equal(walletRequests, 2);
  assert.equal(observation.result.executionStage, "approval-confirmation");
  assert.deepEqual(observation.result.approvalTransactionHashes, [approvalHash, secondHash]);
  assert.equal(observation.result.transactionHash, undefined);
});

test("a sufficient existing Permit2 allowance skips replacement approval while retaining the basket signature", async () => {
  const observation = basketObservation();
  const methods: string[] = [];
  const page = { bringToFront: async () => undefined, evaluate: async (_operation: unknown, request: { method: string; params: unknown[] }) => {
    methods.push(request.method);
    assert.equal(request.method, "eth_signTypedData_v4");
    const typed = JSON.parse(String(request.params[1]));
    assert.equal(typed.primaryType, "PermitBatchTransferFrom");
    assert.equal(typed.message.permitted[0].token, tokenAddresses.XAUT);
    assert.equal(typed.message.permitted[0].amount, "200");
    return `0x${"e".repeat(130)}`;
  } } as unknown as Page;
  const modes: string[] = [];
  const fetcher = (async (path, init) => {
    if (String(path).startsWith("/api/governance/helpers-facts")) return installedBasket();
    if (String(path).startsWith("/api/account/token-permit")) return Response.json({ allowance: { status: "success", value: "1000" } });
    if (String(path).startsWith("/api/account/permit2")) {
      const request = JSON.parse(String(init?.body)); modes.push(request.mode);
      if (request.mode === "allowances") {
        assert.deepEqual(request.tokens, [tokenAddresses.XAUT]);
        return Response.json({ mode: "allowances", result: { allowances: [{ status: "success", value: "1000" }] } });
      }
      assert.equal(request.mode, "nonce");
      return Response.json({ mode: "nonce", result: { nonce: "0" } });
    }
    assert.fail("Sufficient allowances must not request an approval receipt or Helpers execution");
  }) as typeof fetch;
  const plan = await executionPlan(observation, page, owner, protocolConfigurationFixture, fetcher);
  assert.equal(plan.operation, "issueFromBasketExactInWithMixedPermits");
  assert.deepEqual(methods, ["eth_signTypedData_v4"]);
  assert.deepEqual(modes, ["allowances", "nonce"]);
  assert.deepEqual(observation.result.authorization, ["allowance", "permit2"]);
  assert.equal(observation.result.approvalTransactionHashes, undefined);
});

test("required Permit2 grants keep token order and confirm a USDT reset before its exact replacement", async () => {
  const observation = basketObservation();
  (observation.value as { result: { orderedCoreAssets: Address[] } }).result.orderedCoreAssets = [tokenAddresses.PAXG, tokenAddresses.USDT];
  const events: string[] = [];
  const hashes: Hex[] = [];
  const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const page = { bringToFront: async () => undefined, evaluate: async (_operation: unknown, request: { method: string; params: unknown[] }) => {
    if (request.method === "eth_signTypedData_v4") {
      events.push("signature");
      const typed = JSON.parse(String(request.params[1]));
      assert.deepEqual(typed.message.permitted.map((input: { amount: string }) => input.amount), ["100", "200"]);
      return `0x${"e".repeat(130)}`;
    }
    assert.equal(request.method, "eth_sendTransaction");
    const transaction = request.params[0] as { to: Address; data: Hex };
    const decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.data });
    assert.equal(decoded.functionName, "approve");
    assert.equal(decoded.args![0], permit2);
    events.push(`approve:${transaction.to}:${decoded.args![1]}`);
    const hash = `0x${(hashes.length + 1).toString(16).padStart(64, "0")}` as Hex; hashes.push(hash); return hash;
  } } as unknown as Page;
  const fetcher = (async (path, init) => {
    const url = String(path);
    if (url.startsWith("/api/governance/helpers-facts")) return installedBasket(false);
    if (url.startsWith("/api/account/permit2")) {
      const request = JSON.parse(String(init?.body));
      if (request.mode === "allowances") {
        assert.deepEqual(request.tokens, [tokenAddresses.PAXG, tokenAddresses.USDT]);
        return Response.json({ mode: "allowances", result: { allowances: [{ status: "success", value: "0" }, { status: "success", value: "50" }] } });
      }
      assert.equal(request.mode, "nonce");
      return Response.json({ mode: "nonce", result: { nonce: "0" } });
    }
    if (url.startsWith("/api/transaction/receipt")) {
      const hash = new URL(url, "http://fixture.invalid").searchParams.get("hash"); events.push(`receipt:${hashes.indexOf(hash as Hex) + 1}`);
      return Response.json({ receipt: { status: "success", transactionHash: hash, blockNumber: "1", blockHash: `0x${"c".repeat(64)}`, logs: [] } });
    }
    assert.fail("Permit2 allowance selection must use its own spender observations");
  }) as typeof fetch;
  const plan = await executionPlan(observation, page, owner, protocolConfigurationFixture, fetcher);
  assert.equal(plan.operation, "issueFromBasketExactInWithPermit2");
  assert.deepEqual(events, [`approve:${tokenAddresses.PAXG}:100`, "receipt:1", `approve:${tokenAddresses.USDT}:0`, "receipt:2", `approve:${tokenAddresses.USDT}:200`, "receipt:3", "signature"]);
  assert.deepEqual(observation.result.approvalTransactionHashes, hashes);
  assert.deepEqual(observation.result.authorization, ["permit2"]);
});

test("the browser Error bridge drops a native provider's custom numeric code", async () => {
  const fault = Object.assign(new Error("private-provider-response"), { code: 4001 });
  const page = browserWalletPage(async () => { throw fault; });
  await assert.rejects(page.evaluate(async () => (window as unknown as { ethereum: { request: (input: unknown) => Promise<unknown> } })
    .ethereum.request({ method: "eth_sendTransaction", params: [] })), error => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { code?: number }).code, undefined);
    return true;
  });
});

test("native provider codes cross the browser callback and survive per-case projection without private error data", async () => {
  for (const code of [4001, -32002, -32099, -32000]) {
    const observation = basketObservation();
    const fault = Object.assign(new Error("private-wallet-seed private-provider-url private-signature"),
      { code, data: { signature: "private-signature", params: "private-request-params" } });
    const returned: unknown[] = []; let requests = 0;
    const page = browserWalletPage(async () => { requests++; throw fault; }, returned);
    const fetcher = (async path => String(path).startsWith("/api/governance/helpers-facts") ? installedBasket()
      : Response.json({ allowance: { status: "success", value: "0" } })) as typeof fetch;
    let failure: unknown;
    try { await executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher); } catch (error) { failure = error; }
    assert.ok(failure instanceof Error);
    assert.equal(failure.message, "Wallet request failed.");
    assert.equal(requests, 1);
    assert.deepEqual(returned, [{ __cybergoldWalletRequestRejected: true, errorClass: "Error", walletRequestErrorCode: code }]);
    const result = failureResult(observation.result, failure);
    assert.equal(result.status, "fail");
    assert.equal(result.executionStage, "approval-submission");
    assert.equal(result.errorClass, "Error");
    assert.equal(result.walletRequestErrorCode, code);
    assert.deepEqual(result.lastApproval, { assetAddress: tokenAddresses.PAXG,
      spenderAddress: protocolConfigurationFixture.contracts.helpers, amountRaw: "100" });
    assert.equal(result.walletRequest?.method, "eth_sendTransaction");
    assert.equal(result.walletRequest?.settlement, "rejected");
    assert.equal(result.walletRequest?.pendingBefore, 0); assert.equal(result.walletRequest?.pendingAfter, 0);
    assert.doesNotMatch(JSON.stringify(result), /private-wallet-seed|private-provider-url|private-signature|private-request-params/);
  }
});

test("unknown names and malformed numeric metadata are omitted while the wallet rejection remains a failure", async () => {
  for (const code of ["4001", 4001.5, -32100, -31999, 1, NaN, { code: 4001 }]) {
    const observation = basketObservation();
    const fault = Object.assign(new Error("private-wallet-response"), { name: "private-provider-class", code });
    const returned: unknown[] = []; let requests = 0;
    const page = browserWalletPage(async () => { requests++; throw fault; }, returned);
    const fetcher = (async path => String(path).startsWith("/api/governance/helpers-facts") ? installedBasket()
      : Response.json({ allowance: { status: "success", value: "0" } })) as typeof fetch;
    let failure: unknown;
    try { await executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher); } catch (error) { failure = error; }
    assert.ok(failure instanceof Error);
    assert.equal(requests, 1);
    assert.deepEqual(returned, [{ __cybergoldWalletRequestRejected: true, errorClass: "UnknownError" }]);
    const result = failureResult(observation.result, failure);
    assert.equal(result.status, "fail");
    assert.equal(result.errorClass, "UnknownError");
    assert.equal(result.walletRequestErrorCode, undefined);
    assert.doesNotMatch(JSON.stringify(result), /private-wallet-response|private-provider-class/);
  }
});

test("successful native wallet hashes and signatures return unchanged with one provider request", async () => {
  for (const [method, value] of [["eth_sendTransaction", approvalHash], ["eth_signTypedData_v4", `0x${"e".repeat(130)}`]]) {
    const returned: unknown[] = []; let requests = 0;
    const page = browserWalletPage(async () => { requests++; return value; }, returned);
    assert.equal(await requestWallet(page, { method, params: [] }), value);
    assert.equal(requests, 1);
    assert.deepEqual(returned, [value]);
  }
});

for (const outcome of ["fulfilled", "rejected"] as const)
  test(`a wallet request ${outcome} while awaiting notification needs no confirm click`, async () => {
    const pending = Promise.withResolvers<unknown>(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const result = basketObservation().result, returned: unknown[] = [];
    let requests = 0, clicks = 0;
    const page = browserWalletPage(async () => { requests++; return pending.promise; }, returned, {
      notificationReady: async () => { entered.resolve(); await release.promise; },
      click: async () => { clicks++; },
    });
    const request = requestWallet(page, { method: "eth_sendTransaction", params: [] }, false, result);
    void request.catch(() => undefined);
    try {
      await entered.promise;
      assert.equal(result.walletRequest?.settlement, "pending");
      assert.equal(result.walletRequest?.pendingAfter, 1);
      if (outcome === "fulfilled") pending.resolve(approvalHash);
      else pending.reject(Object.assign(new Error("private-provider-response"), { code: -32002 }));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(result.walletRequest?.settlement, outcome);
      assert.equal(result.walletRequest?.pendingAfter, 0);
      release.resolve();
      if (outcome === "fulfilled") assert.equal(await request, approvalHash);
      else await assert.rejects(request, error => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Wallet request failed.");
        assert.equal((error as Error & { walletRequestErrorCode?: number }).walletRequestErrorCode, -32002);
        return true;
      });
      assert.equal(requests, 1); assert.equal(clicks, 0);
      assert.equal(result.walletRequest?.clickAttempts, 0); assert.equal(result.walletRequest?.clickCompleted, 0);
      assert.equal(result.walletRequest?.pendingBefore, 0); assert.equal(result.walletRequest?.pendingAfter, 0);
      assert.equal(result.walletRequest?.deadlineExpired, undefined);
      assert.deepEqual(returned, outcome === "fulfilled" ? [approvalHash]
        : [{ __cybergoldWalletRequestRejected: true, errorClass: "Error", walletRequestErrorCode: -32002 }]);
      assert.doesNotMatch(JSON.stringify(result), /private-provider-response/);
    } finally { release.resolve(); pending.resolve(approvalHash); await request.catch(() => undefined); }
  });

test("a request still pending after notification keeps its confirm click and existing budgets", async () => {
  const originalPoll = expect.poll;
  expect.poll = ((callback: () => Promise<boolean>, options: unknown) => ({ toBe: async () => {
    assert.deepEqual(options, { timeout: 90_000, intervals: [250, 500, 1000] });
    assert.equal(await callback(), true);
  } })) as unknown as typeof expect.poll;
  const pending = Promise.withResolvers<unknown>(), result = basketObservation().result;
  let requests = 0, clicks = 0;
  const page = browserWalletPage(async () => { requests++; return pending.promise; }, [], {
    notificationReady: async () => { assert.equal(result.walletRequest?.settlement, "pending"); },
    click: async options => {
      assert.deepEqual(options, { timeout: 1000 });
      clicks++; pending.resolve(approvalHash); await new Promise(resolve => setImmediate(resolve));
    },
  });
  try {
    assert.equal(await requestWallet(page, { method: "eth_sendTransaction", params: [] }, false, result), approvalHash);
    assert.equal(requests, 1); assert.equal(clicks, 1);
    assert.equal(result.walletRequest?.settlement, "fulfilled");
    assert.equal(result.walletRequest?.clickAttempts, 1); assert.equal(result.walletRequest?.clickCompleted, 1);
    assert.equal(result.walletRequest?.pendingBefore, 0); assert.equal(result.walletRequest?.pendingAfter, 0);
    assert.equal(result.walletRequest?.deadlineExpired, undefined);
  } finally { expect.poll = originalPoll; pending.resolve(approvalHash); }
});

for (const [control, stages] of [["confirm-footer-button", 1], ["confirm-btn", 1],
  ["page-container-footer-next", 1], ["page-container-footer-next", 2]] as const)
  test(`${control} with ${stages} confirmation stage(s) settles one native request without resubmission`, async () => {
    const originalPoll = expect.poll;
    expect.poll = ((callback: () => Promise<boolean>, options: unknown) => ({ toBe: async () => {
      assert.deepEqual(options, { timeout: 90_000, intervals: [250, 500, 1000] });
      for (let attempt = 0; attempt < 3; attempt++) if (await callback()) return;
      assert.fail("The existing native request did not settle through its confirmation controls.");
    } })) as unknown as typeof expect.poll;
    const pending = Promise.withResolvers<unknown>(), result = basketObservation().result;
    let requests = 0, clicks = 0;
    type FixtureLocator = { available: boolean; or(other: FixtureLocator): FixtureLocator; click(options: { timeout: number }): Promise<void> };
    const locator = (available: boolean): FixtureLocator => ({
      available, or: other => locator(available || other.available),
      click: async options => {
        assert.deepEqual(options, { timeout: 1000 });
        if (!available) throw Object.assign(new Error("fixture-missing-confirmation-control"), { name: "TimeoutError" });
        if (++clicks === stages) pending.resolve(approvalHash);
        await new Promise(resolve => setImmediate(resolve));
      },
    });
    const popup = { url: () => "chrome-extension://fixture/notification.html", bringToFront: async () => undefined,
      setDefaultTimeout: () => undefined, getByTestId: (id: string) => locator(id === control),
      locator: (selector: string) => locator(control === "page-container-footer-next"
        && selector === '.page-container__footer [data-testid="page-container-footer-next"]') };
    const page = { bringToFront: async () => undefined, evaluate: async () => { requests++; return pending.promise; },
      context: () => ({ pages: () => [popup], serviceWorkers: () => [{ url: () => "chrome-extension://fixture/background.js" }] }) } as unknown as Page;
    try {
      assert.equal(await requestWallet(page, { method: "eth_sendTransaction", params: [] }, false, result), approvalHash);
      assert.equal(requests, 1); assert.equal(clicks, stages);
      assert.equal(result.walletRequest?.settlement, "fulfilled");
      assert.equal(result.walletRequest?.clickCompleted, stages);
      assert.equal(result.walletRequest?.pendingBefore, 0); assert.equal(result.walletRequest?.pendingAfter, 0);
      assert.equal(result.walletRequest?.deadlineExpired, undefined);
    } finally { expect.poll = originalPoll; pending.resolve(approvalHash); }
  });


test("successful native confirmation records its existing click and optional observation failures cannot reject the hash", async () => {
  const originalPoll = expect.poll;
  expect.poll = ((callback: () => Promise<boolean>) => ({ toBe: async () => assert.equal(await callback(), true) })) as unknown as typeof expect.poll;
  let resolvePending!: (value: unknown) => void, clicks = 0, requests = 0;
  const pending = new Promise(resolve => { resolvePending = resolve; });
  const button = { or: () => button, click: async () => { clicks++; resolvePending(approvalHash); } };
  const popup = { url: () => "chrome-extension://fixture/notification.html", bringToFront: async () => undefined,
    setDefaultTimeout: () => undefined, getByTestId: () => button, locator: () => button };
  const page = { bringToFront: async () => undefined, evaluate: async () => { requests++; return pending; },
    context: () => ({ pages: () => [popup], serviceWorkers: () => [{ url: () => "chrome-extension://fixture/background.js" }] }) } as unknown as Page;
  try {
    const result = basketObservation().result;
    assert.equal(await requestWallet(page, { method: "eth_sendTransaction", params: [] }, false, result), approvalHash);
    assert.equal(requests, 1); assert.equal(clicks, 1);
    assert.equal(result.walletRequest?.settlement, "fulfilled"); assert.equal(result.walletRequest?.clickAttempts, 1);
    assert.equal(result.walletRequest?.clickCompleted, 1); assert.equal(result.walletRequest?.pendingAfter, 0);
    const failingObserver = Object.defineProperty({}, "walletRequest", { set: () => { throw new Error("private-observer-failure"); } }) as ScenarioResult;
    const immediate = browserWalletPage(async () => approvalHash);
    assert.equal(await requestWallet(immediate, { method: "eth_sendTransaction", params: [] }, false, failingObserver), approvalHash);
  } finally { expect.poll = originalPoll; resolvePending(approvalHash); }
});

test("notification observations use existing page snapshots and preserve selection despite a failed observer", async () => {
  for (const selection of ["existing-notification", "existing-extension", "created"] as const) {
    let reads = 0, created = 0, navigations = 0;
    const popup = { url: () => selection === "existing-notification" ? "chrome-extension://fixture/notification.html" : "chrome-extension://fixture/home.html",
      bringToFront: async () => undefined, goto: async () => { navigations++; }, setDefaultTimeout: () => undefined };
    const page = { context: () => ({ serviceWorkers: () => [{ url: () => "chrome-extension://fixture/background.js" }],
      pages: () => { reads++; return selection === "created" ? [] : [popup]; },
      newPage: async () => { created++; return popup; } }) } as unknown as Page;
    let observed: unknown;
    assert.equal(await notification(page, value => { observed = value; throw new Error("private-observer-failure"); }), popup);
    assert.deepEqual(observed, { notificationSelection: selection, notificationViewCount: selection === "existing-notification" ? 1 : 0 });
    assert.equal(reads, selection === "existing-notification" ? 1 : 2);
    assert.equal(created, selection === "created" ? 1 : 0); assert.equal(navigations, selection === "existing-notification" ? 0 : 1);
  }
});

test("click failures expose only a fixed class and classification, never private messages or custom fields", () => {
  for (const [error, kind] of [[Object.assign(new Error("private-DOM"), { name: "TimeoutError" }), "timeout"],
    [new Error("Target page, context or browser has been closed: private-signature"), "closed"],
    [Object.assign(new Error("private-provider-url"), { name: "private-class" }), "other"]] as const) {
    const observed = safeWalletClickError(error);
    assert.equal(observed.lastClickErrorKind, kind);
    assert.doesNotMatch(JSON.stringify(observed), /private-DOM|private-signature|private-provider-url|private-class/);
  }
  assert.deepEqual(safeWalletClickError(Object.defineProperty({}, "message", { get: () => { throw new Error("private-getter"); } })),
    { lastClickErrorClass: "UnknownError", lastClickErrorKind: "other" });
});

test("a failed signature click records optional closed UI state without changing the native failure or budgets", async () => {
  const originalPoll = expect.poll;
  expect.poll = ((callback: () => Promise<boolean>, options: unknown) => ({ toBe: async () => {
    assert.deepEqual(options, { timeout: 90_000, intervals: [250, 500, 1000] });
    assert.equal(await callback(), false); await new Promise(resolve => setImmediate(resolve));
    throw new Error("fixture-observation-deadline");
  } })) as unknown as typeof expect.poll;
  try {
    for (const mode of ["state", "sync-failure", "async-failure"] as const) {
      const pending = Promise.withResolvers<unknown>(), result = basketObservation().result;
      let requests = 0, clicks = 0, snapshots = 0;
      const page = browserWalletPage(async () => { requests++; return pending.promise; }, [], {
        click: async options => { assert.deepEqual(options, { timeout: 1000 }); clicks++;
          throw Object.assign(new Error("private-DOM-text"), { name: "TimeoutError" }); },
        uiState: () => { snapshots++;
          if (mode === "sync-failure") throw new Error("private-observer-failure");
          if (mode === "async-failure") return Promise.reject(new Error("private-observer-failure"));
          return Promise.resolve({ route: "confirmation", rawUrl: "private-url", controls: {
            confirmation: { matched: 1, visible: 1, enabled: 0, text: "private-signature" }, alert: { visible: 1 } } });
        },
      });
      try {
        await assert.rejects(requestWallet(page, { method: "eth_signTypedData_v4", params: [] }, false, result),
          error => isWalletRequestCleanupError(error));
        assert.equal(requests, 1); assert.equal(clicks, 1); assert.equal(snapshots, 1);
        assert.equal(result.walletRequest?.settlement, "pending"); assert.equal(result.walletRequest?.deadlineExpired, true);
        assert.equal(result.walletRequest?.clickCompleted, 0); assert.equal(result.walletRequest?.lastClickErrorKind, "timeout");
        assert.deepEqual(result.walletRequest?.uiState, mode === "state" ? { route: "confirmation", controls: {
          confirmation: { matched: 1, visible: 1, enabled: 0 }, alert: { matched: 0, visible: 1, enabled: 0 },
          alertSubmit: { matched: 0, visible: 0, enabled: 0 }, alertAcknowledge: { matched: 0, visible: 0, enabled: 0 } } } : undefined);
        assert.doesNotMatch(JSON.stringify(result), /private-|fixture-observation-deadline/);
      } finally { pending.resolve(approvalHash); await new Promise(resolve => setImmediate(resolve)); }
    }
  } finally { expect.poll = originalPoll; }
});

test("an unresponsive optional UI read never delays native polling and cannot mutate a finished case", async () => {
  const originalPoll = expect.poll, pending = Promise.withResolvers<unknown>(), observation = Promise.withResolvers<unknown>();
  let requests = 0, clicks = 0, snapshots = 0;
  expect.poll = ((callback: () => Promise<boolean>, options: unknown) => ({ toBe: async () => {
    assert.deepEqual(options, { timeout: 90_000, intervals: [250, 500, 1000] });
    for (let attempt = 0; attempt < 3; attempt++) assert.equal(await callback(), false);
    assert.equal(snapshots, 1, "Only one optional UI read may remain in flight.");
    throw new Error("fixture-observation-deadline");
  } })) as unknown as typeof expect.poll;
  const result = basketObservation().result;
  const page = browserWalletPage(async () => { requests++; return pending.promise; }, [], {
    click: async options => { assert.deepEqual(options, { timeout: 1000 }); clicks++;
      throw Object.assign(new Error("private-DOM"), { name: "TimeoutError" }); },
    uiState: () => { snapshots++; return observation.promise; },
  });
  try {
    await assert.rejects(requestWallet(page, { method: "eth_signTypedData_v4", params: [] }, false, result),
      error => isWalletRequestCleanupError(error));
    assert.equal(requests, 1); assert.equal(clicks, 3); assert.equal(result.walletRequest?.uiState, undefined);
    const frozen = structuredClone(result.walletRequest);
    observation.resolve({ route: "confirmation", controls: { confirmation: { matched: 1, visible: 1, enabled: 0 } } });
    pending.resolve(approvalHash); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(result.walletRequest, frozen);
  } finally { expect.poll = originalPoll; observation.resolve(undefined); pending.resolve(approvalHash); }
});

const rpcEndpoint = "http://127.0.0.1:12345/";
function rpcContext(page: Page) {
  const extension = page.context();
  const context = Object.assign(new EventEmitter(), { pages: () => extension.pages(),
    serviceWorkers: () => extension.serviceWorkers(), close: () => extension.close() });
  Object.assign(page, { context: () => context });
  return context;
}
function rpcRequest(response: () => Promise<unknown> = async () => ({ status: () => 200 })) {
  return { url: () => rpcEndpoint, postDataJSON: () => ({ method: "eth_getCode", id: 123456789,
    params: ["private-address", "private-payload"] }), response };
}
function noRpcListeners(context: EventEmitter) {
  for (const event of ["request", "requestfinished", "requestfailed"]) assert.equal(context.listenerCount(event), 0);
}

for (const method of ["eth_sendTransaction", "eth_signTypedData_v4"] as const)
  for (const outcome of ["fulfilled", "rejected"] as const)
  test(`passive RPC observations retain ${outcome} ${method} outcome and freeze after ordinary cleanup`, async () => {
    const originalPoll = expect.poll, pending = Promise.withResolvers<unknown>();
    const metadata = Promise.withResolvers<{ status(): number }>();
    const result = basketObservation().result;
    let requests = 0, clicks = 0;
    const held = rpcRequest(() => metadata.promise);
    const page = browserWalletPage(async () => { requests++; context.emit("request", held); return pending.promise; }, [], {
      click: async options => {
        assert.deepEqual(options, { timeout: 1000 }); clicks++;
        assert.equal(result.walletRequest?.rpc?.methods.eth_getCode?.pending, 1);
        context.emit("requestfinished", held);
        if (outcome === "fulfilled") pending.resolve(approvalHash);
        else pending.reject(Object.assign(new Error("private native rejection"), { code: 4001 }));
        await new Promise(resolve => setImmediate(resolve));
      },
    });
    const context = rpcContext(page);
    expect.poll = ((callback: () => Promise<boolean>, options: unknown) => ({ toBe: async () => {
      assert.deepEqual(options, { timeout: 90_000, intervals: [250, 500, 1000] });
      assert.equal(await callback(), true);
    } })) as unknown as typeof expect.poll;
    try {
      await withEnvironment({ NEXT_PUBLIC_WALLET_RPC_URL: rpcEndpoint }, async () => {
        if (outcome === "fulfilled") assert.equal(await requestWallet(page, { method, params: [] }, false, result), approvalHash);
        else await assert.rejects(requestWallet(page, { method, params: [] }, false, result), error =>
          error instanceof Error && (error as Error & { walletRequestErrorCode?: number }).walletRequestErrorCode === 4001);
      });
      assert.equal(requests, 1); assert.equal(clicks, 1);
      assert.equal(result.walletRequest?.settlement, outcome);
      assert.equal(result.walletRequest?.clickCompleted, 1);
      assert.equal(result.walletRequest?.rpc?.methods.eth_getCode?.started, 1);
      assert.equal(result.walletRequest?.rpc?.methods.eth_getCode?.finished, 1);
      assert.equal(result.walletRequest?.rpc?.methods.eth_getCode?.pending, 0);
      noRpcListeners(context);
      const frozen = structuredClone(result.walletRequest);
      metadata.resolve({ status: () => 200 }); await Promise.resolve(); await Promise.resolve();
      context.emit("request", rpcRequest()); context.emit("requestfinished", held);
      assert.deepEqual(result.walletRequest, frozen);
      assert.doesNotMatch(JSON.stringify(result), /private-|123456789|127\.0\.0\.1|params|payload/);
    } finally { expect.poll = originalPoll; metadata.resolve({ status: () => 200 }); pending.resolve(approvalHash); }
  });

test("a timed-out native observation retains held RPC evidence after native context cleanup", async () => {
  const originalPoll = expect.poll, pending = Promise.withResolvers<unknown>();
  const result = basketObservation().result;
  const held = rpcRequest();
  let requests = 0, clicks = 0;
  const page = browserWalletPage(async () => { requests++; context.emit("request", held); return pending.promise; }, [], {
    click: async () => { clicks++; throw Object.assign(Error("private missing control"), { name: "TimeoutError" }); },
  });
  const context = rpcContext(page);
  expect.poll = ((callback: () => Promise<boolean>, options: unknown) => ({ toBe: async () => {
    assert.deepEqual(options, { timeout: 90_000, intervals: [250, 500, 1000] });
    assert.equal(await callback(), false); throw Error("private observation deadline");
  } })) as unknown as typeof expect.poll;
  try {
    await withEnvironment({ NEXT_PUBLIC_WALLET_RPC_URL: rpcEndpoint }, () => assert.rejects(
      requestWallet(page, { method: "eth_sendTransaction", params: [] }, false, result),
      error => isWalletRequestCleanupError(error)));
    assert.equal(requests, 1); assert.equal(clicks, 1);
    assert.equal(result.walletRequest?.settlement, "pending");
    assert.equal(result.walletRequest?.rpc?.methods.eth_getCode?.pending, 1);
    assert.equal(result.walletRequest?.pendingAfter, 1); assert.equal(result.walletRequest?.cleanup, "context-closed"); noRpcListeners(context);
    const frozen = structuredClone(result.walletRequest);
    context.emit("requestfinished", held); pending.resolve(approvalHash);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(result.walletRequest, frozen);
  } finally { expect.poll = originalPoll; pending.resolve(approvalHash); }
});

test("synchronous native evaluation failure detaches its optional RPC listeners and preserves the error", async () => {
  const failure = Error("private evaluate failure"), result = basketObservation().result;
  const page = browserWalletPage(async () => approvalHash);
  const context = rpcContext(page); let evaluations = 0;
  Object.assign(page, { evaluate: () => { evaluations++; throw failure; } });
  await withEnvironment({ NEXT_PUBLIC_WALLET_RPC_URL: rpcEndpoint }, () => assert.rejects(
    requestWallet(page, { method: "eth_sendTransaction", params: [] }, false, result), error => error === failure));
  assert.equal(evaluations, 1); noRpcListeners(context);
  assert.equal(result.walletRequest?.settlement, "rejected");
  assert.equal(result.walletRequest?.pendingAfter, 0);
});

test("optional RPC setup and detach failures cannot reject a successful native hash", async () => {
  for (const fault of ["setup", "detach", "no-report", "no-config"] as const) {
    const page = browserWalletPage(async () => approvalHash), result = basketObservation().result;
    const context = rpcContext(page), on = context.on, off = context.off;
    let registrations = 0;
    context.on = ((event, listener) => {
      registrations++; on.call(context, event, listener);
      if (fault === "setup") throw Error("private setup failure");
      return context;
    }) as typeof context.on;
    context.off = ((event, listener) => {
      off.call(context, event, listener);
      if (fault === "detach") throw Error("private detach failure");
      return context;
    }) as typeof context.off;
    await withEnvironment({ NEXT_PUBLIC_WALLET_RPC_URL: fault === "no-config" ? undefined : rpcEndpoint }, async () => {
      assert.equal(await requestWallet(page, { method: "eth_sendTransaction", params: [] }, false,
        fault === "no-report" ? undefined : result), approvalHash);
    });
    noRpcListeners(context);
    assert.equal(registrations, fault === "no-report" || fault === "no-config" ? 0 : fault === "setup" ? 1 : 3);
    if (fault === "setup") assert.equal(result.walletRequest?.rpc, undefined);
  }
});

test("the real independent executor rejects changed mined calldata even with the same valid selector", async () => {
  const { HELPERS_EXECUTION_ABI } = await import("../contracts/cybergold-helpers/execution.ts");
  const refund = { address: protocolConfigurationFixture.contracts.helpers!,
    topics: encodeEventTopics({ abi: HELPERS_EXECUTION_ABI, eventName: "DustRefunded", args: { payer: owner, asset: tokenAddresses.XAUT } }),
    data: encodeAbiParameters([{ type: "uint256" }], [7n]) };
  for (const changed of [false, true]) {
    const scenario = tradeScenarios.find(row => row.id === "core-redeem-usdc-exact-in")!;
    const observation = { scenario, request: { native: false, counterToken: tokenAddresses.USDC }, value: {
      executionAmount: "100", expectedCoreOutputs: [], preview: {}, quotes: [],
    }, result: { ...resultFor(scenario, "execution"), bounds: { inputMaximum: "100", outputMinimum: "90" } } } as unknown as QuoteObservation;
    let sent: Hex | undefined, requests = 0;
    const page = { bringToFront: async () => {}, evaluate: async (_callback: unknown, request: {params: {data: Hex}[]}) => {
      requests++; sent=request.params[0].data; return approvalHash;
    } } as unknown as Page;
    const altered = encodeFunctionData({ abi: HELPERS_EXECUTION_ABI, functionName: "redeemToTokenExactIn", args: [{
      grossCygldIn: 200n, recipient: owner, minimumAmountOut: 90n, expectedCoreOutputs: [], outputToken: tokenAddresses.USDC,
    }, []] });
    const fetcher = (async path => {
      const url=String(path);
      if(url.startsWith("/api/account/token-permit")) return Response.json({allowance:{status:"success",value:"1000"}});
      if(url.startsWith("/api/transaction/helpers-execution")) return Response.json({helpers:protocolConfigurationFixture.contracts.helpers,gas:"100000"});
      if(url.startsWith("/api/transaction/receipt")) return Response.json({receipt:{status:"success",transactionHash:approvalHash,blockNumber:"1",blockHash:`0x${"c".repeat(64)}`,logs:[refund]}});
      if(url.startsWith("/api/transaction/wait/transaction")) return Response.json({transaction:{from:owner,to:protocolConfigurationFixture.contracts.helpers,input:changed?altered:sent}});
      assert.fail("unexpected test-only API path");
    }) as typeof fetch;
    await assert.rejects(executeScenario(observation,page,owner,protocolConfigurationFixture,fetcher), error => error instanceof RegressionAssertionError && error.code === (changed ? "execution-calldata-mismatch" : "operation-event-missing"));
    assert.equal(requests,1);assert.equal(observation.result.transactionHash,approvalHash);
    assert.deepEqual(observation.result.receipt!.refunds, [{ asset: tokenAddresses.XAUT, amount: "7" }]);
  }
});

for (const kind of ["token", "native", "basket"] as const) test(`independent ${kind} execution retains all owned refunds without adding them to selected-pair amounts`, async () => {
  const { HELPERS_EXECUTION_ABI } = await import("../contracts/cybergold-helpers/execution.ts");
  const event = (name: string, args: Record<string, unknown>) => {
    const abi = HELPERS_EXECUTION_ABI.find(row => row.type === "event" && row.name === name)!;
    if (abi.type !== "event") throw Error("Fixture event missing");
    const values = abi.inputs.filter(row => !row.indexed);
    return { address: protocolConfigurationFixture.contracts.helpers!, topics: encodeEventTopics({ abi: [abi], eventName: name as never, args: args as never }),
      data: encodeAbiParameters(values, values.map(row => args[row.name]) as never) };
  };
  const inputToken = kind === "native" ? zeroAddress : tokenAddresses.USDC;
  const observation = kind === "basket" ? basketObservation("exact-out") : (() => {
    const scenario = tradeScenarios.find(row => row.id === `core-issue-${kind === "native" ? "eth" : "usdc"}-exact-in`)!;
    return { scenario, request: { native: kind === "native", counterToken: tokenAddresses.USDC },
      value: { executionAmount: "90", preview: { orderedCoreAssets: [tokenAddresses.PAXG, tokenAddresses.XAUT] }, quotes: [] },
      result: { ...resultFor(scenario, "execution"), bounds: { inputMaximum: "100", outputMinimum: "90" } } } as unknown as QuoteObservation;
  })();
  const logs = kind === "basket" ? [event("IssuedFromBasket", { payer: owner, recipient: owner, orderedCoreAssets: [tokenAddresses.PAXG, tokenAddresses.XAUT],
    amountsIn: [100n, 200n], netCygldOut: 50n, protocolFeeCygld: 0n, helperFeeCygld: 0n })]
    : [event("Issued", { payer: owner, recipient: owner, inputToken, inputUsed: 80n, netCygldOut: 90n, protocolFeeCygld: 1n, helperFeeCygld: 0n }),
      event("DustRefunded", { payer: owner, asset: inputToken, amount: 20n })];
  logs.push(event("DustRefunded", { payer: owner, asset: tokenAddresses.XAUT, amount: 2n ** 100n }));
  let sent: Hex | undefined, requests = 0;
  const page = walletPage(async () => approvalHash);
  Object.assign(page, { evaluate: async (_callback: unknown, request: { params: { data: Hex }[] }) => {
    requests++; sent = request.params[0].data; return approvalHash;
  } });
  const fetcher = (async path => {
    const url = String(path);
    if (url.startsWith("/api/governance/helpers-facts")) return installedBasket();
    if (url.startsWith("/api/account/token-permit")) return Response.json({ allowance: { status: "success", value: "1000" } });
    if (url.startsWith("/api/transaction/helpers-execution")) return Response.json({ helpers: protocolConfigurationFixture.contracts.helpers, gas: "100000" });
    if (url.startsWith("/api/transaction/receipt")) return Response.json({ receipt: { status: "success", transactionHash: approvalHash, blockNumber: "1", blockHash: `0x${"c".repeat(64)}`, logs } });
    if (url.startsWith("/api/transaction/wait/transaction")) return Response.json({ transaction: { from: owner, to: protocolConfigurationFixture.contracts.helpers, input: sent } });
    assert.fail("unexpected test-only API path");
  }) as typeof fetch;
  const result = await executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher);
  assert.equal(result.status, "pass"); assert.equal(requests, 1);
  assert.deepEqual(result.receipt!.refunds, [...(kind === "basket" ? [] : [{ asset: inputToken, amount: "20" }]),
    { asset: tokenAddresses.XAUT, amount: String(2n ** 100n) }]);
  if (kind === "basket") assert.deepEqual(result.receipt!.amountsIn, ["100", "200"]);
  else { assert.equal(result.receipt!.inputUsed, "80"); assert.equal(result.receipt!.inputRefund, "20"); assert.equal(result.receipt!.amountOut, "90"); }
  assert.equal(result.executionTerms!.refundCoverage, "observed-helper-refunds");
  assert.deepEqual(result.executionTerms!.inputSpent!.map(row => row.amount), kind === "basket" ? ["100", "200"] : ["80"]);
  assert.deepEqual(result.executionTerms!.netOutput!.map(row => row.amount), kind === "basket" ? ["50"] : ["90", String(2n ** 100n)]);
});
