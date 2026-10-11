import assert from 'node:assert/strict';
import test from 'node:test';
import { defineChain, encodeErrorResult, parseAbi } from 'viem';
import { createConfig } from '@wagmi/core';
import { getBalanceQueryOptions, getEnsNameQueryOptions, getEnsAvatarQueryOptions,
  waitForTransactionReceiptQueryOptions } from '@wagmi/core/query';
import { createAppPublicClient } from './appPublicClient.ts';

const chain = defineChain({ id: 31338, name: 'Sandbox fixture',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://wallet-only.invalid'] } } });
const holder = `0x${'1'.repeat(40)}` as const;
const hash = `0x${'2'.repeat(64)}` as const;
const blockHash = `0x${'3'.repeat(64)}` as const;
function invoke<T extends { queryKey: unknown; queryFn: unknown }>(options: T) {
  return (options.queryFn as (context: unknown) => Promise<unknown>)({ queryKey: options.queryKey,
    signal: new AbortController().signal, meta: undefined });
}
function configuration(observe: (path: URL) => unknown) {
  const paths: string[] = [];
  const fetchImpl = (async (path, init) => {
    assert.equal(init?.method, undefined);
    assert.equal(init?.cache, 'no-store');
    assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    const url = new URL(String(path), 'https://app.invalid');
    assert.notEqual(url.pathname, '/api/rpc');
    paths.push(url.pathname);
    return Response.json(observe(url));
  }) as typeof fetch;
  const config = createConfig({ chains: [chain], client: ({ chain }) => createAppPublicClient({ chain, pollingInterval: 5 }, fetchImpl) });
  return { config, paths };
}

test('the production client factory serves actual Wagmi balance/name/avatar queries through fixed APIs only', async () => {
  const { config, paths } = configuration((url) => {
    if (url.pathname.endsWith('/native-balance')) {
      assert.equal(url.searchParams.get('purpose'), 'display');
      return { holder, balance: (2n ** 200n).toString() };
    }
    if (url.pathname.endsWith('/ens-name')) return { holder, name: 'alice.eth' };
    return { name: 'alice.eth', avatarRecord: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' };
  });
  const balance = await invoke(getBalanceQueryOptions(config, { address: holder, chainId: chain.id })) as { value: bigint; symbol: string };
  assert.equal(balance.value, 2n ** 200n);
  assert.equal(balance.symbol, 'ETH');
  assert.equal(await invoke(getEnsNameQueryOptions(config, { address: holder, chainId: chain.id })), 'alice.eth');
  assert.equal(await invoke(getEnsAvatarQueryOptions(config, { name: 'alice.eth', chainId: chain.id })), 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
  assert.deepEqual(paths, ['/api/account/native-balance', '/api/account/ens-name', '/api/account/ens-avatar-record']);
});

test('the production Wagmi receipt query formats and reports reverts through fixed APIs without an eth_call fallback', async () => {
  const { config, paths } = configuration((url) => url.pathname.endsWith('/revert') ? {
    data: encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['Fixture rejection'] }),
  } : { receipt: { transactionHash: hash, transactionIndex: '0x0', blockHash, blockNumber: '0x64',
    from: holder, to: holder, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1',
    contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x0', type: '0x2' } });
  await assert.rejects(invoke(waitForTransactionReceiptQueryOptions(config, { hash, chainId: chain.id })), /Fixture rejection/);
  assert.deepEqual(paths, ['/api/transaction/wait/receipt', '/api/transaction/revert']);
});

test('parallel standard NFT avatar parsing keeps each fixed observation isolated', async () => {
  const { config } = configuration((url) => {
    const name = url.searchParams.get('name');
    return { name, avatarRecord: `eip155:1/erc721:${holder}/2`, nftTokenUri: { status: 'success',
      value: JSON.stringify({ image: `data:image/svg+xml;base64,${Buffer.from(`<svg>${name}</svg>`).toString('base64')}` }) } };
  });
  const values = await Promise.all(['alice.eth', 'bob.eth'].map((name) => invoke(getEnsAvatarQueryOptions(config, { name, chainId: chain.id }))));
  assert.notEqual(values[0], values[1]);
  for (const [i, name] of ['alice.eth', 'bob.eth'].entries()) assert.equal(values[i], `data:image/svg+xml;base64,${Buffer.from(`<svg>${name}</svg>`).toString('base64')}`);
});
