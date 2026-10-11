import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient, custom } from 'viem';
import { mainnet } from 'viem/chains';
import { createConfig } from '@wagmi/core';
import { getEnsNameQueryOptions, getEnsAvatarQueryOptions } from '@wagmi/core/query';
import { withEnsRecords } from './ensRecords.ts';

const holder = '0x0000000000000000000000000000000000000011';
const name = 'alice.eth';
function fixture(payload: object | Response, fallback: (args: { method: string; params?: unknown }) => unknown = () => { throw new Error('unexpected compatibility read'); }) {
  const paths: URL[] = [];
  const fetchImpl = (async (path, init) => {
    const url = new URL(String(path), 'http://app.invalid'); paths.push(url);
    assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return payload instanceof Response ? payload : Response.json(payload);
  }) as typeof fetch;
  const client = withEnsRecords(createClient({ chain: mainnet, transport: custom({ request: async (args) => fallback(args) }, { retryCount: 0 }) }), fetchImpl);
  const config = createConfig({ chains: [mainnet], client: () => client });
  return { client, config, paths };
}

test('standard Wagmi ENS name query uses its fixed holder API and no compatibility RPC', async () => {
  const { config, paths } = fixture({ holder, name });
  const query = getEnsNameQueryOptions(config, { address: holder });
  assert.equal(await query.queryFn({ queryKey: query.queryKey, signal: new AbortController().signal, meta: undefined }), name);
  assert.equal(paths[0]?.pathname, '/api/account/ens-name');
  assert.equal(paths[0]?.searchParams.get('holder'), holder);
});

test('missing ENS name and avatar records remain null', async () => {
  const { client } = fixture({ name: null, avatarRecord: null });
  assert.equal(await client.getEnsName({ address: holder }), null);
  assert.equal(await client.getEnsAvatar({ name }), null);
});

test('ENS outage surfaces once without compatibility fallback or fabricated absence', async () => {
  const { client, paths } = fixture(Response.json({ error: 'unavailable' }, { status: 503 }));
  await assert.rejects(client.getEnsName({ address: holder }), /temporarily unavailable/);
  await assert.rejects(client.getEnsAvatar({ name }), /temporarily unavailable/);
  assert.equal(paths.length, 2);
});

test('standard Wagmi avatar query retains HTTP/IPFS parsing and image validation', async (t) => {
  const imageRequests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(init.method, 'HEAD'); imageRequests.push(String(url));
    return new Response('', { headers: { 'Content-Type': 'image/png' } });
  });
  for (const [avatarRecord, expected] of [
    ['https://avatar.invalid/a.png', 'https://avatar.invalid/a.png'],
    ['ipfs://bafy-fixture/a.png', 'https://ipfs.io/ipfs/bafy-fixture/a.png'],
  ]) {
    const { config, paths } = fixture({ name, avatarRecord });
    const query = getEnsAvatarQueryOptions(config, { name });
    assert.equal(await query.queryFn({ queryKey: query.queryKey, signal: new AbortController().signal, meta: undefined }), expected);
    assert.equal(paths[0]?.pathname, '/api/account/ens-avatar-record');
    assert.equal(paths[0]?.searchParams.get('name'), name);
  }
  assert.equal(imageRequests.length, 2);
});

test('NFT avatar uses the fixed same-block token URI and standard metadata parsing without compatibility RPC', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { headers: { 'Content-Type': 'image/png' } }));
  const nft = '0x0000000000000000000000000000000000000022';
  const { client, paths } = fixture({ name, avatarRecord: `eip155:1/erc721:${nft}/${2n ** 200n}`,
    nftTokenUri: { status: 'success', value: `data:application/json;base64,${Buffer.from(JSON.stringify({ image: 'https://avatar.invalid/nft.png' })).toString('base64')}` } });
  assert.equal(await client.getEnsAvatar({ name }), 'https://avatar.invalid/nft.png');
  assert.equal(paths.length, 1);
});

test('ERC1155 URI substitution and per-read/retained response failure keep standard avatar behavior', async (t) => {
  const token = `0x${(2n ** 200n).toString(16)}`;
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    return init?.method === 'HEAD' ? new Response('', { headers: { 'Content-Type': 'image/png' } })
      : Response.json({ image: 'https://avatar.invalid/1155.png' });
  });
  const avatarRecord = `eip155:1/erc1155:0x${'2'.repeat(40)}/${token}`;
  const { client } = fixture({ name, avatarRecord, nftTokenUri: { status: 'success', value: 'https://nft.invalid/{id}.json' } });
  assert.equal(await client.getEnsAvatar({ name }), 'https://avatar.invalid/1155.png');
  assert.equal(urls[0], `https://nft.invalid/${token.slice(2).padStart(64, '0')}.json`);
  for (const nftTokenUri of [undefined, { status: 'failure', error: 'unavailable' }]) {
    assert.equal(await fixture({ name, avatarRecord, nftTokenUri }).client.getEnsAvatar({ name }), null);
  }
});

test('historical and non-avatar record library operations retain their original RPC parameters', async () => {
  let reads = 0;
  const { client, paths } = fixture({}, ({ method, params }) => {
    assert.equal(method, 'eth_call'); reads++;
    if (reads === 1) assert.equal((params as unknown[])[1], '0x18cba80');
    throw new Error('retained compatibility failure');
  });
  await assert.rejects(client.getEnsName({ address: holder, blockNumber: 26000000n }), /retained compatibility failure/);
  await assert.rejects(client.getEnsText({ name, key: 'url' }), /retained compatibility failure/);
  assert.equal(reads, 2);
  assert.equal(paths.length, 0);
});
