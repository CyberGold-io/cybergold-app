import assert from "node:assert/strict";
import test from "node:test";
import { expect, type Page } from "@playwright/test";
import { decodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
import { protocolConfigurationFixture, tokenAddresses } from "../../tests/fixtures/protocol-configuration.ts";
import { failureResult, RegressionAssertionError, resultFor, type QuoteObservation, type ScenarioResult } from "../../tests/trading/regression.ts";
import { tradeScenarios } from "../../tests/trading/scenarios.ts";
import { ScenarioUnavailableError } from "../../tests/trading/scenarios.ts";
import { notification } from "../../tests/metamask/wallet-ui.ts";
import { safeWalletClickError } from "../../tests/trading/runnerDiagnostics.ts";

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
  const popup = { url: () => "chrome-extension://fixture/notification.html", bringToFront: async () => controls.notificationReady?.(),
    setDefaultTimeout: () => undefined, getByTestId: () => button, locator: () => button, evaluate: controls.uiState };
  return { bringToFront: async () => undefined,
    context: () => ({ pages: () => [popup], serviceWorkers: () => [{ url: () => "chrome-extension://fixture/background.js" }] }),
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

test("a timed-out native request stays pending and the next case observes it without changing the original case", async () => {
  const originalPoll = expect.poll;
  expect.poll = ((callback: () => Promise<boolean>) => ({ toBe: async () => {
    if (!await callback()) throw new Error("fixture-observation-deadline");
  } })) as unknown as typeof expect.poll;
  let resolvePending!: (value: unknown) => void, evaluations = 0, pageSnapshots = 0, clickCalls = 0;
  const firstRequest = new Promise(resolve => { resolvePending = resolve; });
  const ambiguity = new Error("strict mode violation: private-DOM private-signature");
  const button = { or: () => button, click: async () => { clickCalls++; throw ambiguity; } };
  const popup = { url: () => "chrome-extension://fixture/notification.html", bringToFront: async () => undefined,
    setDefaultTimeout: () => undefined, getByTestId: () => button, locator: () => button };
  const page = { bringToFront: async () => undefined,
    context: () => ({ pages: () => { pageSnapshots++; return [popup]; },
      serviceWorkers: () => [{ url: () => "chrome-extension://fixture/background.js" }] }),
    evaluate: async () => ++evaluations === 1 ? firstRequest : approvalHash } as unknown as Page;
  const first = basketObservation().result, second = basketObservation().result, third = basketObservation().result;
  try {
    await assert.rejects(requestWallet(page, { method: "eth_sendTransaction", params: [] }, false, first),
      error => error instanceof ScenarioUnavailableError && error.code === "wallet-submission-timeout");
    const diagnostic = first.walletRequest!;
    assert.equal(diagnostic.settlement, "pending"); assert.equal(diagnostic.deadlineExpired, true);
    assert.equal(diagnostic.pendingBefore, 0); assert.equal(diagnostic.pendingAfter, 1);
    assert.equal(diagnostic.notificationSelection, "existing-notification"); assert.equal(diagnostic.notificationViewCount, 1);
    assert.equal(diagnostic.clickAttempts, 1); assert.equal(diagnostic.clickCompleted, 0);
    assert.equal(diagnostic.lastClickErrorClass, "Error"); assert.equal(diagnostic.lastClickErrorKind, "ambiguous");
    assert.equal(pageSnapshots, 1); assert.equal(clickCalls, 1);
    assert.doesNotMatch(JSON.stringify(diagnostic), /private-DOM|private-signature|fixture-observation-deadline/);
    const frozen = structuredClone(diagnostic);
    assert.equal(await requestWallet(page, { method: "eth_sendTransaction", params: [] }, false, second), approvalHash);
    assert.equal(second.walletRequest?.pendingBefore, 1); assert.equal(second.walletRequest?.pendingAfter, 1);
    resolvePending(approvalHash); await firstRequest; await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(first.walletRequest, frozen);
    assert.equal(await requestWallet(page, { method: "eth_sendTransaction", params: [] }, false, third), approvalHash);
    assert.equal(third.walletRequest?.pendingBefore, 0); assert.equal(third.walletRequest?.pendingAfter, 0);
    assert.equal(evaluations, 3);
  } finally { expect.poll = originalPoll; resolvePending(approvalHash); }
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
          error => error instanceof ScenarioUnavailableError && error.code === "wallet-authorization-timeout");
        assert.equal(requests, 1); assert.equal(clicks, 1); assert.equal(snapshots, 1);
        assert.equal(result.walletRequest?.settlement, "pending"); assert.equal(result.walletRequest?.deadlineExpired, true);
        assert.equal(result.walletRequest?.clickCompleted, 0); assert.equal(result.walletRequest?.lastClickErrorKind, "timeout");
        assert.deepEqual(result.walletRequest?.uiState, mode === "state" ? { route: "confirmation", controls: {
          confirmation: { matched: 1, visible: 1, enabled: 0 }, alert: { visible: 1 } } } : undefined);
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
      error => error instanceof ScenarioUnavailableError && error.code === "wallet-authorization-timeout");
    assert.equal(requests, 1); assert.equal(clicks, 3); assert.equal(result.walletRequest?.uiState, undefined);
    const frozen = structuredClone(result.walletRequest);
    observation.resolve({ route: "confirmation", controls: { confirmation: { matched: 1, visible: 1, enabled: 0 } } });
    pending.resolve(approvalHash); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(result.walletRequest, frozen);
  } finally { expect.poll = originalPoll; observation.resolve(undefined); pending.resolve(approvalHash); }
});
