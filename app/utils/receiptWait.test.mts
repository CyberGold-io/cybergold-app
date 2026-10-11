import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicClient, custom, defineChain, encodeErrorResult, parseAbi } from 'viem';
import { createConfig } from '@wagmi/core';
import { waitForTransactionReceiptQueryOptions } from '@wagmi/core/query';
import { withTransactionReverts } from './transactionRevert.ts';
import { createReceiptWaitClient } from './receiptWait.ts';
import { withReceiptObservations } from '../../tests/fixtures/receipt-compatibility.ts';

const originalHash = `0x${'ab'.repeat(32)}` as const;
const replacementHash = `0x${'cd'.repeat(32)}` as const;
const blockHash = `0x${'01'.repeat(32)}` as const;
const sender = '0x0000000000000000000000000000000000000011';
const recipient = '0x0000000000000000000000000000000000000022';
const transaction = { hash: originalHash, from: sender, to: recipient, nonce: '0x7', input: '0x1234',
  value: '0xa', gas: '0x5208', maxFeePerGas: '0xb', maxPriorityFeePerGas: '0x1', type: '0x2',
  blockHash: null, blockNumber: null, transactionIndex: null, chainId: '0x7a6a',
  r: `0x${'01'.repeat(32)}`, s: `0x${'02'.repeat(32)}`, v: '0x1', yParity: '0x1' };
function receipt(hash = originalHash, status = '0x1') {
  return { transactionHash: hash, transactionIndex: '0x0', blockHash, blockNumber: '0x64',
    from: sender, to: recipient, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0xb',
    contractAddress: null, logs: [{ address: recipient, data: '0x1234', topics: [blockHash],
      blockHash, blockNumber: '0x64', transactionHash: hash, transactionIndex: '0x0', logIndex: '0x0', removed: false }],
    logsBloom: `0x${'00'.repeat(256)}`, status, type: '0x2' };
}
function block(transactions: unknown[]) {
  return { number: '0x64', hash: blockHash, parentHash: blockHash, timestamp: '0x1',
    gasLimit: '0x100000', gasUsed: '0x5208', baseFeePerGas: '0x1', difficulty: '0x0',
    extraData: '0x', miner: sender, nonce: '0x0000000000000000', transactions,
    logsBloom: `0x${'00'.repeat(256)}`, receiptsRoot: blockHash, sha3Uncles: blockHash,
    size: '0x100', stateRoot: blockHash, transactionsRoot: blockHash, uncles: [] };
}

function fixture(observe: (url: URL) => Record<string, unknown> | Response) {
  const paths: string[] = [];
  const fetchImpl = (async (url, init) => {
    assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    assert.ok(init?.signal);
    const request = new URL(String(url), 'http://app.invalid');
    assert.ok(request.pathname.startsWith('/api/transaction/wait/'));
    paths.push(request.pathname);
    const result = observe(request);
    return result instanceof Response ? result : Response.json({ chainId: 31338,
      observedAt: '2026-10-02T00:00:00.000Z', ...result });
  }) as typeof fetch;
  const client = createReceiptWaitClient({ pollingInterval: 5 }, fetchImpl);
  return { client, paths, fetchImpl };
}

const chain = defineChain({ id: 31338, name: 'Synthetic Sandbox', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://synthetic.invalid'] } } });

test('standard waiter formats a confirmed receipt and full logs through one fixed API read', async () => {
  const { client, paths } = fixture((url) => {
    assert.equal(url.searchParams.get('hash'), originalHash);
    return { receipt: receipt() };
  });
  const result = await client.waitForTransactionReceipt({ hash: originalHash });
  assert.equal(result.status, 'success');
  assert.equal(result.blockNumber, 100n);
  assert.equal(result.gasUsed, 21000n);
  assert.equal(result.logs[0]?.data, '0x1234');
  assert.equal(result.logs[0]?.logIndex, 0);
  assert.deepEqual(paths, ['/api/transaction/wait/receipt']);
});

test('native reverted receipt is retained rather than promoted to success', async () => {
  const { client } = fixture(() => ({ receipt: receipt(originalHash, '0x0') }));
  assert.equal((await client.waitForTransactionReceipt({ hash: originalHash })).status, 'reverted');
});

test('standard confirmation count waits for later heads without precision loss', async () => {
  let head = 100n;
  const { client, paths } = fixture((url) => url.pathname.endsWith('/head')
    ? { blockNumber: (head++).toString() } : { receipt: receipt() });
  const result = await client.waitForTransactionReceipt({ hash: originalHash, confirmations: 3, timeout: 1000 });
  assert.equal(result.status, 'success');
  assert.ok(head >= 103n);
  assert.ok(paths.includes('/api/transaction/wait/head'));
});

for (const reason of ['repriced', 'cancelled', 'replaced'] as const) {
  test(`standard Viem ${reason} detection retains original sender/nonce and replacement receipt`, async () => {
    const replacement = { ...transaction, hash: replacementHash, blockNumber: '0x64', blockHash,
      ...(reason === 'cancelled' ? { to: sender, value: '0x0', input: '0x' } :
        reason === 'replaced' ? { input: '0x5678' } : { maxFeePerGas: '0x20' }) };
    const callbacks: unknown[] = [];
    const { client, paths } = fixture((url) => {
      if (url.pathname.endsWith('/head')) return { blockNumber: '100' };
      if (url.pathname.endsWith('/transaction')) return { transaction };
      if (url.pathname.endsWith('/block')) {
        assert.equal(url.searchParams.get('blockNumber'), '100');
        return { block: block([replacement]) };
      }
      return { receipt: url.searchParams.get('hash') === replacementHash ? receipt(replacementHash) : null };
    });
    const result = await client.waitForTransactionReceipt({ hash: originalHash, timeout: 1000, retryCount: 0,
      onReplaced(value) {
        callbacks.push(value.reason);
        assert.equal(value.replacedTransaction.hash, originalHash);
        assert.equal(value.replacedTransaction.nonce, 7);
        assert.equal(value.transaction.hash, replacementHash);
        assert.equal(value.transactionReceipt.transactionHash, replacementHash);
      } });
    assert.equal(result.transactionHash, replacementHash);
    assert.deepEqual(callbacks, [reason]);
    assert.ok(paths.includes('/api/transaction/wait/block'));
  });
}

test('unknown transaction remains a timed-out observation with no replacement callback', async () => {
  let replacements = 0;
  const { client } = fixture((url) => url.pathname.endsWith('/head') ? { blockNumber: '100' } :
    url.pathname.endsWith('/transaction') ? { transaction: null } : { receipt: null });
  await assert.rejects(client.waitForTransactionReceipt({ hash: originalHash, timeout: 60, retryCount: 0,
    onReplaced() { replacements++; } }), (error: Error) => error.name === 'WaitForTransactionReceiptTimeoutError');
  assert.equal(replacements, 0);
});

test('provider outage is an error rather than a missing receipt or replacement', async () => {
  const { client, paths } = fixture(() => Response.json({ error: 'unavailable' }, { status: 503 }));
  await assert.rejects(client.getTransactionReceipt({ hash: originalHash }), /temporarily unavailable/);
  assert.equal(paths.length, 1, 'retain the App transport retryCount=0');
});

test('a stalled supplier retains the inherited transport timeout before it can look absent', async () => {
  let calls = 0;
  const client = createReceiptWaitClient({ timeout: 10 }, (async (_url, init) => {
    calls++;
    await new Promise<void>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      // Keep this synthetic unresolved fetch alive until its timeout signal.
      setTimeout(() => reject(new Error('fixture did not receive timeout')), 50);
    });
    return Response.json({ receipt: null });
  }) as typeof fetch);
  await assert.rejects(client.getTransactionReceipt({ hash: originalHash }), /aborted due to timeout/);
  assert.equal(calls, 1);
});

test('standard wide head and fee quantities are not rounded by JSON numbers', async () => {
  const { client } = fixture((url) => url.pathname.endsWith('/head') ? { blockNumber: (2n**200n).toString() } :
    { receipt: { ...receipt(), effectiveGasPrice: `0x${(2n**200n).toString(16)}` } });
  assert.equal(await client.getBlockNumber(), 2n**200n);
  assert.equal((await client.getTransactionReceipt({ hash: originalHash })).effectiveGasPrice, 2n**200n);
});

test('the actual Wagmi receipt-hook query resolves through fixed observations with its chain ID', async () => {
  const fallback: string[] = [];
  const { fetchImpl, paths } = fixture(() => ({ receipt: receipt() }));
  const config = createConfig({ chains: [chain], pollingInterval: 5, transports: { [chain.id]:
    withReceiptObservations(custom({ request: async ({ method }) => { fallback.push(method); throw new Error('Unexpected fallback'); } },
      { retryCount: 0 }), fetchImpl) } });
  const options = waitForTransactionReceiptQueryOptions(config, { hash: originalHash, chainId: chain.id });
  const result = await options.queryFn({ queryKey: options.queryKey, signal: new AbortController().signal, meta: undefined });
  assert.equal(result.chainId, 31338);
  assert.equal(result.status, 'success');
  assert.deepEqual(paths, ['/api/transaction/wait/receipt']);
  assert.deepEqual(fallback, []);
});

test('the actual Wagmi hook retains repriced callbacks and replacement receipt identity', async () => {
  const fallback: string[] = [];
  const reasons: string[] = [];
  const replacement = { ...transaction, hash: replacementHash, blockNumber: '0x64', blockHash, maxFeePerGas: '0x20' };
  const { fetchImpl } = fixture((url) => {
    if (url.pathname.endsWith('/head')) return { blockNumber: '100' };
    if (url.pathname.endsWith('/transaction')) return { transaction };
    if (url.pathname.endsWith('/block')) return { block: block([replacement]) };
    return { receipt: url.searchParams.get('hash') === replacementHash ? receipt(replacementHash) : null };
  });
  const config = createConfig({ chains: [chain], pollingInterval: 5, transports: { [chain.id]:
    withReceiptObservations(custom({ request: async ({ method }) => { fallback.push(method); throw new Error('Unexpected fallback'); } },
      { retryCount: 0 }), fetchImpl) } });
  const options = waitForTransactionReceiptQueryOptions(config, { hash: originalHash, chainId: chain.id, timeout: 1000,
    onReplaced: ({ reason }) => reasons.push(reason) });
  const result = await options.queryFn({ queryKey: options.queryKey, signal: new AbortController().signal, meta: undefined });
  assert.equal(result.transactionHash, replacementHash);
  assert.deepEqual(reasons, ['repriced']);
  assert.deepEqual(fallback, []);
});

test('Wagmi retains its original revert replay and error decoding on the compatibility transport', async () => {
  const fallback: unknown[] = [];
  const { fetchImpl, paths } = fixture((url) => url.pathname.endsWith('/transaction') ? { transaction } :
    { receipt: receipt(originalHash, '0x0') });
  const config = createConfig({ chains: [chain], transports: { [chain.id]:
    withReceiptObservations(custom({ request: async ({ method, params }) => {
      assert.equal(method, 'eth_call');
      fallback.push(params);
      const call = params[0];
      assert.equal(call.from, sender);
      assert.equal(call.to, recipient);
      assert.equal(call.data, transaction.input);
      assert.equal(call.value, transaction.value);
      return encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['Synthetic token transfer rejection'] });
    } }, { retryCount: 0 }), fetchImpl) } });
  const options = waitForTransactionReceiptQueryOptions(config, { hash: originalHash, chainId: chain.id });
  await assert.rejects(options.queryFn({ queryKey: options.queryKey, signal: new AbortController().signal, meta: undefined }), /Synthetic token transfer rejection/);
  assert.equal(fallback.length, 1);
  assert.deepEqual(paths, ['/api/transaction/wait/receipt', '/api/transaction/wait/transaction']);
});

test('unmigrated wallet-library calls retain their unchanged transport and block-tag arguments', async () => {
  const calls: unknown[] = [];
  const { fetchImpl, paths } = fixture(() => { throw new Error('Unexpected focused read'); });
  const client = createPublicClient({ transport: withReceiptObservations(custom({ request: async (request) => {
    calls.push(request);
    if (request.method === 'eth_getBalance') return '0x5';
    return block([]);
  } }, { retryCount: 0 }), fetchImpl) });
  assert.equal(await client.getBalance({ address: sender, blockNumber: 100n }), 5n);
  await client.getBlock({ blockTag: 'latest', includeTransactions: true });
  assert.deepEqual(calls, [{ method: 'eth_getBalance', params: [sender, '0x64'] },
    { method: 'eth_getBlockByNumber', params: ['latest', true] }]);
  assert.deepEqual(paths, []);
});

test('per-call retry overrides reach both the fixed observations and the compatibility transport', async () => {
  let fixedCalls = 0;
  let compatibilityCalls = 0;
  const client = createPublicClient({ transport: withReceiptObservations(custom({ request: async () => {
    compatibilityCalls += 1;
    throw new Error('Synthetic compatibility outage');
  } }, { retryCount: 1, retryDelay: 0 }), (async () => {
    fixedCalls += 1;
    return new Response(null, { status: 503 });
  }) as typeof fetch) });
  await assert.rejects(client.request({ method: 'eth_getTransactionReceipt', params: [originalHash] }, { retryCount: 0 }),
    /temporarily unavailable/);
  await assert.rejects(client.request({ method: 'eth_getBalance', params: [sender, '0x64'] }, { retryCount: 0 }),
    /Synthetic compatibility outage/);
  assert.equal(fixedCalls, 1);
  assert.equal(compatibilityCalls, 1);
});


for (const value of [0n, 1n, 2n**200n]) {
  test(`actual Wagmi wallet-profile balance preserves ${value} wei through the fixed API`, async () => {
    const { getBalanceQueryOptions } = await import('@wagmi/core/query');
    const requests: string[] = [];
    const config = createConfig({ chains: [chain], transports: { [chain.id]:
      withReceiptObservations(custom({ request: async () => { throw new Error('Unexpected RPC fallback'); } }, { retryCount: 0 }),
        (async (url, init) => {
          const request = new URL(String(url), 'http://app.invalid'); requests.push(request.pathname);
          assert.equal(request.pathname, '/api/account/native-balance');
          assert.equal(request.searchParams.get('purpose'), 'display');
          assert.equal(request.searchParams.get('holder'), sender);
          assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
          return Response.json({ holder: sender, balance: value.toString() });
        }) as typeof fetch) } });
    const options = getBalanceQueryOptions(config, { address: sender, chainId: chain.id });
    const result = await options.queryFn({ queryKey: options.queryKey, signal: new AbortController().signal, meta: undefined });
    assert.equal(result.value, value); assert.equal(result.decimals, 18); assert.equal(result.symbol, 'ETH');
    assert.deepEqual(requests, ['/api/account/native-balance']);
  });
}

test('native balance outage is one error, never zero or a compatibility retry', async () => {
  let calls = 0;
  const client = createPublicClient({ transport: withReceiptObservations(custom({ request: async () => {
    throw new Error('Unexpected RPC fallback');
  } }, { retryCount: 0 }), (async () => { calls++; return new Response(null, { status: 503 }); }) as typeof fetch) });
  await assert.rejects(client.getBalance({ address: sender }), /temporarily unavailable/);
  assert.equal(calls, 1);
});

test('historical and pending native balances retain their original native arguments', async () => {
  const requests: unknown[] = [];
  const client = createPublicClient({ transport: withReceiptObservations(custom({ request: async (request) => {
    requests.push(request); return '0x5';
  } }, { retryCount: 0 }), (async () => { throw new Error('Unexpected latest API'); }) as typeof fetch) });
  assert.equal(await client.getBalance({ address: sender, blockTag: 'pending' }), 5n);
  assert.equal(await client.getBalance({ address: sender, blockNumber: 100n }), 5n);
  assert.deepEqual(requests, [{ method: 'eth_getBalance', params: [sender, 'pending'] },
    { method: 'eth_getBalance', params: [sender, '0x64'] }]);
});


function revertQuery(observe: (url: URL) => object | Response, callbacks?: string[]) {
  const paths: URL[] = [];
  const fetchImpl = (async (path, init) => {
    const url = new URL(String(path), 'http://app.invalid');paths.push(url);
    assert.equal(init?.cache, 'no-store');assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    const value = observe(url);return value instanceof Response ? value : Response.json(value);
  }) as typeof fetch;
  const client = withTransactionReverts(createPublicClient({ chain, pollingInterval: 5,
    transport: withReceiptObservations(custom({ request: async () => { throw new Error('Unexpected compatibility RPC'); } }, { retryCount: 0 }), fetchImpl) }), fetchImpl);
  const config = createConfig({ chains: [chain], client: () => client });
  const query = waitForTransactionReceiptQueryOptions(config, { hash: originalHash, timeout: 1000,
    onReplaced: ({ reason }) => callbacks?.push(reason) });
  return { paths, run: () => query.queryFn({ queryKey: query.queryKey, signal: new AbortController().signal, meta: undefined }) };
}

test('actual Wagmi reverted receipt uses fixed hash replay and standard Error ABI decoding', async () => {
  const { run, paths } = revertQuery((url) => url.pathname.endsWith('/revert') ?
    { data: encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['Synthetic rejection 😀'] }), reverted: true } :
    { receipt: receipt(originalHash, '0x0') });
  await assert.rejects(run(), /Synthetic rejection 😀/);
  assert.deepEqual(paths.map(url => url.pathname), ['/api/transaction/wait/receipt', '/api/transaction/revert']);
  assert.equal(paths[1]?.searchParams.get('hash'), originalHash);
});

test('reverted replacement retains standard callback and replays the replacement hash', async () => {
  const callbacks: string[] = [];
  const replacement = { ...transaction, hash: replacementHash, blockNumber: '0x64', blockHash, maxFeePerGas: '0x20' };
  const { run, paths } = revertQuery((url) => {
    if (url.pathname.endsWith('/revert')) return { data: null, reverted: true };
    if (url.pathname.endsWith('/head')) return { blockNumber: '100' };
    if (url.pathname.endsWith('/transaction')) return { transaction };
    if (url.pathname.endsWith('/block')) return { block: block([replacement]) };
    return { receipt: url.searchParams.get('hash') === replacementHash ? receipt(replacementHash, '0x0') : null };
  }, callbacks);
  await assert.rejects(run(), /unknown reason/);
  assert.deepEqual(callbacks, ['repriced']);
  assert.equal(paths.find(url => url.pathname.endsWith('/revert'))?.searchParams.get('hash'), replacementHash);
});

test('revert observation outage is one ordinary error rather than a fabricated revert reason', async () => {
  const { run, paths } = revertQuery((url) => url.pathname.endsWith('/revert') ? new Response(null, { status: 503 }) :
    { receipt: receipt(originalHash, '0x0') });
  await assert.rejects(run(), /observations are temporarily unavailable/);
  assert.equal(paths.filter(url => url.pathname.endsWith('/revert')).length, 1);
});

test('successful receipt needs no replay and retains the standard chain ID', async () => {
  const { run, paths } = revertQuery(() => ({ receipt: receipt() }));
  const result = await run();assert.equal(result.status, 'success');assert.equal(result.chainId, chain.id);
  assert.deepEqual(paths.map(url => url.pathname), ['/api/transaction/wait/receipt']);
});

test('standard Panic ABI and unknown/custom return bytes retain useful plain errors', async () => {
  for (const [data, expected] of [
    [encodeErrorResult({ abi: parseAbi(['error Panic(uint256)']), errorName: 'Panic', args: [17n] }), /Panic 0x11/],
    ['0x1234', /unknown reason/],
  ] as const) {
    const { run } = revertQuery((url) => url.pathname.endsWith('/revert') ? { data, reverted: true } :
      { receipt: receipt(originalHash, '0x0') });
    await assert.rejects(run(), expected);
  }
});
