import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { protocolConfigurationFixture as configured } from "../../tests/fixtures/protocol-configuration.ts";
import { emptyProtocolConfiguration, protocolConfigurationValues } from "./protocolConfiguration.ts";
import { parseFxMarketDataPayload, parseGoldMarketDataPayload, remainingMarketLifetime } from "./marketDataValidation.ts";
import { fxDisplayCacheKey, goldDisplayCacheKey, parseDisplayTokens, projectDisplayTokens,
  publicDisplaySnapshot, readPublicDisplayCache, tokenDisplayCacheKey, writePublicDisplayCache } from "./publicDisplayCache.ts";

function storage() {
  const rows = new Map<string, string>();
  return { rows, getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => { rows.set(key, value); } };
}

test("persistent selector rows project only Backend-managed display metadata, with separate chain keys", () => {
  const live = protocolConfigurationValues(configured);
  const contaminated = live.tokens.map(token => ({ ...token, helpers: configured.contracts.helpers,
    allowance: "99", balance: "10", paused: false, quote: { data: "0x" }, imported: true }));
  const display = projectDisplayTokens(contaminated);
  const store = storage(), key = tokenDisplayCacheKey(configured.chainId);
  writePublicDisplayCache(key, display, store);
  assert.deepEqual(readPublicDisplayCache(key, parseDisplayTokens, store), display);
  assert.equal(display.length, 7);
  assert.doesNotMatch(store.getItem(key)!, /helpers|allowance|balance|paused|quote|imported/);
  assert.equal(readPublicDisplayCache(tokenDisplayCacheKey(configured.chainId + 1), parseDisplayTokens, store), undefined);
  assert.equal(parseDisplayTokens([{ id: "bad", type: "erc20", decimals: 18 }]), undefined);
});

test("restricted or invalid storage is optional and cannot prevent the ordinary network path", () => {
  const restricted = { getItem: () => { throw new Error("restricted"); }, setItem: () => { throw new Error("restricted"); } };
  assert.equal(readPublicDisplayCache("catalog", parseDisplayTokens, restricted), undefined);
  assert.doesNotThrow(() => writePublicDisplayCache("catalog", [], restricted));
  const store = storage(); store.setItem("catalog", "not JSON");
  assert.equal(readPublicDisplayCache("catalog", parseDisplayTokens, store), undefined);
});

test("a scoped snapshot reuses parsed rows and observes later successful catalog writes", () => {
  const store = storage(), key = tokenDisplayCacheKey(configured.chainId);
  let parses = 0;
  const snapshot = publicDisplaySnapshot(key, value => { parses++; return parseDisplayTokens(value); }, store);
  assert.equal(snapshot(), undefined);
  writePublicDisplayCache(key, projectDisplayTokens(protocolConfigurationValues(configured).tokens), store);
  const first = snapshot(); assert.equal(first!.length, 7); assert.equal(snapshot(), first); assert.equal(parses, 1);
  writePublicDisplayCache(key, [], store);
  assert.deepEqual(snapshot(), []); assert.equal(parses, 2);
});

test("persisted gold and FX preserve acquisition age, stale status and the existing expiry", () => {
  const store = storage(), fetchedAt = "2026-10-11T10:00:00.000Z";
  const gold = { price: 3000, fetchedAt, stale: false };
  const fx = { base: "USD" as const, rates: { USD: 1, EUR: 0.9, CHF: 0.8, RUB: 90 }, fetchedAt, stale: true };
  writePublicDisplayCache(goldDisplayCacheKey, gold, store); writePublicDisplayCache(fxDisplayCacheKey, fx, store);
  const cachedGold = readPublicDisplayCache(goldDisplayCacheKey, parseGoldMarketDataPayload, store)!;
  const cachedFx = readPublicDisplayCache(fxDisplayCacheKey, parseFxMarketDataPayload, store)!;
  assert.deepEqual(cachedGold, gold); assert.deepEqual(cachedFx, fx);
  assert.equal(remainingMarketLifetime(cachedGold.fetchedAt, 3_600_000, Date.parse(fetchedAt) + 3_600_000), 0);
  assert.equal(remainingMarketLifetime(cachedFx.fetchedAt, 300_000, Date.parse(fetchedAt) + 300_000), 0);
  assert.equal(cachedFx.stale, true);
});

function hooks() {
  const slots: { value?: unknown; deps?: unknown[] }[] = [];
  let cursor = 0;
  let hydrated = false;
  const effects: (() => void)[] = [];
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createContext: (initial: unknown) => ({ Provider: "Provider", initial }), useContext: () => undefined,
    useState: (initial?: unknown) => { const index = cursor++; const slot = slots[index] ??= { value: initial };
      return [slot.value, (value: unknown) => { slot.value = value; }]; },
    useMemo: (compute: () => unknown, deps: unknown[]) => { const slot = slots[cursor++] ??= {};
      if (!same(slot.deps, deps)) { slot.value = compute(); slot.deps = deps; } return slot.value; },
    useEffect: (effect: () => void, deps: unknown[]) => { const slot = slots[cursor++] ??= {};
      if (!same(slot.deps, deps)) { effects.push(effect); slot.deps = deps; } },
    useSyncExternalStore: (_: unknown, snapshot: () => unknown, serverSnapshot: () => unknown) => hydrated ? snapshot() : serverSnapshot(),
  };
  return { react, render: <T,>(run: () => T) => { cursor = 0; return run(); },
    flush: () => { hydrated = true; while (effects.length) effects.shift()!(); } };
}

function load(path: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports: Record<string, (...args: never[]) => unknown> = {};
  runInNewContext(output, { exports, ...globals, require: (key: string) => { assert.ok(key in dependencies, key); return dependencies[key]; } });
  return exports;
}

test("actual provider hydrates display labels without reviving any operation address or live token", () => {
  const store = storage(), runtime = hooks(), key = tokenDisplayCacheKey(configured.chainId);
  writePublicDisplayCache(key, projectDisplayTokens(protocolConfigurationValues(configured).tokens), store);
  const cache = { readPublicDisplayCache: (key: string, parse: (value: unknown) => unknown) => readPublicDisplayCache(key, parse, store),
    publicDisplaySnapshot: (key: string, parse: (value: unknown) => unknown) => publicDisplaySnapshot(key, parse, store),
    writePublicDisplayCache: (key: string, value: unknown) => writePublicDisplayCache(key, value, store),
    parseDisplayTokens, projectDisplayTokens, tokenDisplayCacheKey };
  const useCache = load("../hooks/usePublicDisplayCache.ts", { react: runtime.react, "../utils/publicDisplayCache": cache });
  const query = { data: undefined as typeof configured | undefined, error: null, isLoading: true, refetch: async () => undefined };
  let networkReads = 0;
  const context = load("../context/protocolConfigurationContext.tsx", {
    react: runtime.react, "react/jsx-runtime": { jsx: (_: unknown, props: unknown) => props },
    "@tanstack/react-query": { useQuery: () => { networkReads++; return query; } },
    "../config/chain": { targetChainId: configured.chainId }, "./sandboxForkContext": { useSandboxForkGeneration: () => null },
    "../utils/protocolConfiguration": { emptyProtocolConfiguration, protocolConfigurationValues, fetchProtocolConfiguration: () => undefined },
    "../hooks/usePublicDisplayCache": useCache, "../utils/publicDisplayCache": cache,
  });
  const render = () => runtime.render(() => context.ProtocolConfigurationProvider!({ children: null } as never)) as
    { value: ReturnType<typeof protocolConfigurationValues> & { displayTokens: typeof configured.tokens } };
  const first = render();
  assert.equal(first.value.displayTokens.length, 0, "SSR and initial hydration remain identical");
  runtime.flush(); const hydrated = render();
  assert.equal(hydrated.value.displayTokens.length, 7); assert.equal(hydrated.value.tokens.length, 0);
  assert.deepEqual(hydrated.value.addresses, {}); assert.deepEqual(hydrated.value.tokenAddresses, {});
  assert.equal(hydrated.value.identity, "unavailable");
  query.data = configured; query.isLoading = false;
  const live = render(); runtime.flush();
  assert.equal(live.value.tokens.length, 7); assert.equal(live.value.addresses.helpers, configured.contracts.helpers);
  assert.ok(networkReads > 0, "restored display cache does not substitute for the ordinary live query");
  assert.deepEqual(JSON.parse(store.getItem(key)!), projectDisplayTokens(live.value.tokens));
});

test("actual market hooks use parsed fallback after hydration and still acquire and persist fresh Backend responses", async () => {
  for (const feed of ["gold", "fx"] as const) {
    const store = storage(), runtime = hooks(), key = feed === "gold" ? goldDisplayCacheKey : fxDisplayCacheKey;
    const oldTimestamp = new Date(Date.now() - 7_200_000).toISOString();
    const old = feed === "gold" ? { price: 3000, fetchedAt: oldTimestamp, stale: false }
      : { base: "USD", rates: { USD: 1, EUR: 0.8, CHF: 0.7, RUB: 80 }, fetchedAt: oldTimestamp, stale: true };
    writePublicDisplayCache(key, old, store);
    const cache = { goldDisplayCacheKey, fxDisplayCacheKey,
      publicDisplaySnapshot: (key: string, parse: (value: unknown) => unknown) => publicDisplaySnapshot(key, parse, store),
      readPublicDisplayCache: (key: string, parse: (value: unknown) => unknown) => readPublicDisplayCache(key, parse, store),
      writePublicDisplayCache: (key: string, value: unknown) => writePublicDisplayCache(key, value, store) };
    const useCache = load("../hooks/usePublicDisplayCache.ts", { react: runtime.react, "../utils/publicDisplayCache": cache });
    let acquire!: (url: string) => Promise<unknown>, options!: { fallbackData?: typeof old; refreshInterval: (data?: typeof old) => number };
    let response = { ...old, fetchedAt: new Date().toISOString(), stale: false };
    let calls = 0;
    const modules = load(`../hooks/${feed === "gold" ? "useGoldPrice" : "useFxRates"}.ts`, {
      swr: { default: (url: string, fetcher: typeof acquire, config: typeof options) => {
        assert.equal(url, `/api/${feed}`); acquire = fetcher; options = config;
        return { data: config.fallbackData, error: undefined, isLoading: true };
      } }, "./usePublicDisplayCache": useCache, "../utils/publicDisplayCache": cache,
      "./useMarketFreshness": { useMarketExpired: (timestamp: string | undefined, ttl: number) =>
        remainingMarketLifetime(timestamp, ttl, Date.parse(oldTimestamp) + 7_200_000) === 0 },
      "../utils/marketDataValidation": { parseGoldMarketDataPayload, parseFxMarketDataPayload, remainingMarketLifetime },
    }, { fetch: async (_: string, init: RequestInit) => {
      calls++; assert.equal(init?.cache, "no-store"); return Response.json(response);
    } });
    const hook = modules[feed === "gold" ? "useGoldPrice" : "useFxRates"]!;
    assert.equal((runtime.render(() => hook()) as { fetchedAt?: string }).fetchedAt, undefined);
    runtime.flush();
    const fallback = runtime.render(() => hook()) as { fetchedAt: string; isLoading: boolean; isStale: boolean };
    assert.equal(fallback.fetchedAt, oldTimestamp); assert.equal(fallback.isLoading, false); assert.equal(fallback.isStale, true);
    assert.equal(options.refreshInterval(options.fallbackData), 10_000, "existing stale/expired refresh cadence is retained");
    // The acquisition is still present even while a display fallback is available.
    assert.deepEqual(await acquire(`/api/${feed}`), response); assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(store.getItem(key)!), response, "successful acquisition replaces only parsed display data");
    const retained = response;
    response = { ...old, fetchedAt: new Date().toISOString(), stale: true };
    assert.deepEqual(await acquire(`/api/${feed}`), response, "ordinary stale Backend responses still render");
    assert.deepEqual(JSON.parse(store.getItem(key)!), retained, "a stale supplier fallback does not overwrite the genuine observation");
  }
});
