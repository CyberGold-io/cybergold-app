import assert from "node:assert/strict";
import test from "node:test";
import type { TokenMetadata } from "./importedTokens.ts";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
import { checkSwapWalletBalances } from "./walletBalanceSnapshot.ts";
import { tokenUsdPricesFromSnapshots } from "./tokenUsdPricing.ts";

const { fetchTokenMetadata, importedTokenFromMetadata, importedTokenId, readImportedTokens, rememberImportedToken } =
  await withEnvironment(appEnvironment, () => import("./importedTokens.ts"));
import { tokens, tokenAddresses } from "../../tests/fixtures/protocol-configuration.ts";

const address = "0x00000000000000000000000000000000000000Ab" as const;
const success = <T,>(value: T) => ({ status: "success" as const, value });
const failure = { status: "failure" as const, error: "contract-read-failed" as const };
const value: TokenMetadata = { context: { chainId: 31338, blockNumber: "100", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1791600000", observedAt: "2026-10-10T00:00:00Z" },
  token: { chainId: 31338, address }, metadata: { name: success("Imported token"), symbol: success("NEW"), decimals: success(6) },
  authorization: { kind: "unknown", confidence: "unknown" }, balance: success("123456789012345678901234567890") };

test("import identity scopes contract address to network and preserves observed precision", () => {
  const token = importedTokenFromMetadata(value)!;
  assert.equal(token.id, importedTokenId(31338, address)); assert.equal(token.decimals, 6); assert.equal(token.name, "Imported token");
  assert.notEqual(token.id, importedTokenId(1, address));
  assert.equal(tokenUsdPricesFromSnapshots([], [token])[token.id], undefined, "import does not invent a fiat price");
});

test("configured identities survive address import, including CYGLD and WETH separately from ETH", () => {
  for (const configured of tokens.filter(token => token.type === "erc20")) {
    assert.equal(importedTokenFromMetadata({ ...value, token: { ...value.token, address: configured.address } }, tokens), configured);
  }
  assert.equal(importedTokenFromMetadata({ ...value, token: { ...value.token, address: tokenAddresses.WETH } }, tokens)!.id, "weth");
});

test("unavailable metadata retains actual address identity and never guesses precision", () => {
  const unresolved = importedTokenFromMetadata({ ...value, metadata: { ...value.metadata, decimals: failure } });
  assert.equal(unresolved, undefined);
  const display = importedTokenFromMetadata({ ...value, metadata: { ...value.metadata, name: failure, symbol: failure } })!;
  assert.equal(display.name.toLowerCase(), address.toLowerCase()); assert.match(display.symbol, /^0x0000…00AB$/i);
});

test("selected-token metadata uses the focused API with cancellation and lossless balance", async () => {
  const signal = new AbortController().signal;
  const observed = await fetchTokenMetadata(address, address, signal, (async (url, init) => {
    assert.equal(url, `/api/tokens/metadata?token=${address}&holder=${address}`);
    assert.equal(init!.signal, signal); assert.equal(init!.cache, "no-store"); return Response.json(value);
  }) as typeof fetch);
  assert.equal(observed.balance?.status, "success");
  assert.equal(observed.balance?.status === "success" ? BigInt(observed.balance.value) : undefined, 123456789012345678901234567890n);
  await assert.rejects(fetchTokenMetadata(address, undefined, undefined, (async () => new Response("", { status: 503 })) as typeof fetch), /temporarily unavailable/);
  await fetchTokenMetadata(address, address, signal, (async (url, init) => {
    assert.equal(url, `/api/tokens/metadata?token=${address}&holder=${address}&purpose=balance`);
    assert.equal(init!.signal, signal);
    return Response.json({ ...value, authorization: { kind: "unknown", confidence: "unknown", reason: "not-requested" } });
  }) as typeof fetch, "balance");
});

test("imported balance failure remains unknown in preflight rather than zero", () => {
  const id = importedTokenId(31338, address);
  assert.deepEqual(checkSwapWalletBalances({ native: success("0"), tokens: [{ id, balance: failure }] }, [{ tokenId: id, amount: 1n }]), { reason: "unavailable", tokenId: id });
  assert.deepEqual(checkSwapWalletBalances({ native: success("0"), tokens: [{ id, balance: success("0") }] }, [{ tokenId: id, amount: 1n }]), { reason: "insufficient", tokenId: id });
});

test("session imports survive locale navigation, deduplicate address and remain scoped to network", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, contents: string) => storage.set(key, contents),
  } } });
  try {
    rememberImportedToken(value); rememberImportedToken(value);
    assert.equal(readImportedTokens(31338).length, 1); assert.equal(readImportedTokens(31338)[0].id, importedTokenId(31338, address));
    assert.deepEqual(readImportedTokens(1), []);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
