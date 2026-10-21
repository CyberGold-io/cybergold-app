import assert from "node:assert/strict";
import test from "node:test";
import { backendRoute } from "../server/backend-client.ts";
import { withEnvironment } from "../../tests/fixtures/environment.mts";

test("fixed faucet adapter retains bytes/IP and uses only the server's backend bearer", async () => {
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://127.0.0.1:3210", CYBERGOLD_BACKEND_BEARER_TOKEN: "fixture-server-token" }, async () => {
    const body = '{"address":"0x00000000000000000000000000000000000000a1","requestId":"unchanged"}';
    let calls = 0;
    const route = backendRoute("/api/faucet", (async (url, init) => {
      calls++;
      assert.equal(String(url), "http://127.0.0.1:3210/api/faucet?url=https://untrusted.invalid/api/internal/onchain-indexer/reconcile");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("origin"), "http://localhost:3000");
      assert.equal(headers.get("x-real-ip"), "198.51.100.7");
      assert.equal(headers.get("x-forwarded-for"), "198.51.100.7");
      assert.equal(headers.get("authorization"), "Bearer fixture-server-token");
      assert.equal(headers.get("cookie"), null);
      assert.equal(init?.redirect, "error");
      assert.equal(await new Response(init?.body).text(), body);
      return Response.json({ error: "quota" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60", "X-CyberGold-Faucet-Request-Id": "replace" } });
    }) as typeof fetch);
    const response = await route(new Request("https://sandbox.cybergold.io/api/faucet?url=https://untrusted.invalid/api/internal/onchain-indexer/reconcile", {
      method: "POST", body, headers: { "Content-Type": "application/json", Origin: "http://localhost:3000",
        "x-real-ip": "198.51.100.7", "x-forwarded-for": "198.51.100.7", Authorization: "browser-value", Cookie: "unused=value" },
    }));
    assert.equal(calls, 1);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("x-cybergold-faucet-request-id"), "replace");
    assert.deepEqual(await response.json(), { error: "quota" });
  });
});

test("ambiguous writes get one attempt and transport errors contain no internal URL", async () => {
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://private-backend:3000" }, async () => {
    for (const path of ["/api/safe", "/api/governance/owner-aliases", "/api/faucet"] as const) {
      let calls = 0;
      const route = backendRoute(path, (async () => { calls++; throw new Error("http://private:secret@backend/"); }) as typeof fetch);
      const response = await route(new Request(`https://app.invalid${path}`, { method: "POST", body: "{}" }));
      assert.equal(calls, 1);
      assert.ok(response.status >= 500);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.doesNotMatch(await response.text(), /private|secret|backend/);
    }
  });
});

test("faucet transport failures expose the same safe reference as their diagnostic log", async (t) => {
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://private-backend:3000" }, async () => {
    const events: unknown[][] = [];
    t.mock.method(console, "error", (...args: unknown[]) => events.push(args));
    for (const timedOut of [false, true]) {
      let calls = 0;
      const failure = new Error("http://private:secret@backend/ Authorization: Bearer private-token");
      if (timedOut) failure.name = "TimeoutError";
      const route = backendRoute("/api/faucet", (async () => { calls++; throw failure; }) as typeof fetch);
      const response = await route(new Request("https://app.invalid/api/faucet", { method: "POST", body: "{}" }));
      const payload = await response.json();
      assert.equal(calls, 1);
      assert.equal(response.status, timedOut ? 504 : 502);
      assert.equal(payload.code, timedOut ? "TIMEOUT" : "BAD_GATEWAY");
      assert.match(payload.correlationId, /^[0-9a-f-]{36}$/);
      assert.equal(response.headers.get("x-cybergold-faucet-request-id"), null);
      const logged = events.at(-1)![1] as Record<string, unknown>;
      assert.equal(logged.correlationId, payload.correlationId);
      assert.equal(logged.stage, "backend-http");
      assert.equal(logged.failureType, timedOut ? "provider-timeout" : "transport-error");
      assert.ok(typeof logged.elapsedMs === "number" && logged.elapsedMs >= 0);
      assert.doesNotMatch(JSON.stringify([payload, events]), /private|secret|Bearer|Authorization/);
    }
    t.mock.method(console, "error", () => { throw new Error("logger unavailable"); });
    const route = backendRoute("/api/faucet", (async () => { throw new TypeError("connection failed"); }) as typeof fetch);
    assert.equal((await route(new Request("https://app.invalid/api/faucet", { method: "POST", body: "{}" }))).status, 502);
  });
});

test("all fixed API adapters attach only the server token, with no browser credential fallback", async () => {
  const paths = ["/api/quotes/trade/model", "/api/protocol/config", "/api/transaction/revert", "/api/account/ens-name", "/api/account/ens-avatar-record", "/api/account/native-balance", "/api/governance/target-code", "/api/protocol/recovery-share-precision", "/api/transaction/wait/head", "/api/transaction/wait/transaction", "/api/transaction/wait/receipt", "/api/transaction/wait/block", "/api/transaction/permit2-approval-gas", "/api/transaction/recovery-redemption", "/api/governance/authority", "/api/governance/roles", "/api/governance/safe-nonce", "/api/governance/safe-transaction-hash", "/api/transaction/receipt", "/api/account/transaction-nonce", "/api/account/permit2", "/api/transaction/fees", "/api/protocol/recovery-assets", "/api/account/core-permit", "/api/quotes/token-preview", "/api/quotes/uniswap", "/api/governance/safe-principal", "/api/governance/helpers-facts", "/api/governance/core-facts", "/api/account/wallet-balances", "/api/protocol/facts", "/api/pools/snapshot", "/api/quotes/basket-preview", "/api/gold", "/api/fx", "/api/dashboard/onchain-summary", "/api/recovery/shares",
    "/api/account/token-permit", "/api/tokens/metadata", "/api/transaction/token-approval-gas", "/api/pools/catalog", "/api/quotes/basket-max",
    "/api/governance/owner-aliases", "/api/quote-pool-cache", "/api/safe",
    "/api/safe/events", "/api/faucet", "/api/diagnostics"] as const;
  for (const token of ["fixture-private-entry-token", undefined]) {
    await withEnvironment({ CYBERGOLD_BACKEND_URL: "https://api.sandbox.cybergold.io", CYBERGOLD_BACKEND_BEARER_TOKEN: token }, async () => {
      for (const path of paths) {
        const route = backendRoute(path, (async (url, init) => {
          assert.equal(String(url), `https://api.sandbox.cybergold.io${path}`);
          assert.equal(new Headers(init?.headers).get("authorization"), token ? `Bearer ${token}` : null);
          return Response.json({ accepted: true }, { headers: { authorization: "must-not-reach-browser" } });
        }) as typeof fetch);
        const response = await route(new Request(`http://localhost:3000${path}`, { headers: { Authorization: "Bearer browser-supplied" } }));
        assert.equal(response.headers.get("authorization"), null);
        assert.deepEqual(await response.json(), { accepted: true });
      }
    });
  }
});

test("generic catalog filters and V4 snapshots retain lossless bytes through the fixed Backend adapter", async () => {
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://127.0.0.1:3210" }, async () => {
    const tokenA = `0x${"a".repeat(40)}`, tokenB = `0x${"b".repeat(40)}`;
    const raw = JSON.stringify({ protocol: "v4", dex: "uniswap_v4", token0: tokenA, token1: tokenB,
      fee: 100, exists: true, activeLiquidityRaw: String(2n ** 100n), poolId: `0x${"c".repeat(64)}`,
      context: { chainId: 1, blockNumber: "100", blockHash: `0x${"d".repeat(64)}`, observedAt: "2026-10-01T00:00:00Z" },
    }, null, 2) + "\n";
    const catalog = backendRoute("/api/pools/catalog", (async (url, init) => {
      assert.equal(String(url), `http://127.0.0.1:3210/api/pools/catalog?tokenA=${tokenA}&tokenB=${tokenB}`);
      assert.equal(init?.method, "GET");
      return new Response(raw, { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch);
    assert.equal(await (await catalog(new Request(`https://app.invalid/api/pools/catalog?tokenA=${tokenA}&tokenB=${tokenB}`))).text(), raw);
    const body = JSON.stringify({ protocol: "v4", tokenA, tokenB, fee: 100, tickSpacing: 1, hooks: `0x${"0".repeat(40)}` }, null, 2) + "\n";
    const pool = backendRoute("/api/pools/snapshot", (async (_url, init) => {
      assert.equal(await new Response(init?.body).text(), body);
      return new Response(raw, { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch);
    assert.equal(await (await pool(new Request("https://app.invalid/api/pools/snapshot", { method: "POST", body }))).text(), raw);
  });
});

test("signed alias requests preserve UTF-8 bytes across streamed chunk boundaries", async () => {
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://127.0.0.1:3210" }, async () => {
    // Deliberate whitespace and escaped Unicode expose accidental parse/stringify
    // normalization. The signature is synthetic; signing is tested by the backend.
    const raw = `{ "alias": "Café \\u2605", "nonce": "fixture-nonce", "signature": "0x${"ab".repeat(65)}" }\n`;
    const bytes = new TextEncoder().encode(raw);
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    let calls = 0;
    const route = backendRoute("/api/governance/owner-aliases", (async (url, init) => {
      calls++;
      assert.equal(String(url), "http://127.0.0.1:3210/api/governance/owner-aliases");
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json; charset=utf-8");
      assert.deepEqual(new Uint8Array(await new Response(init?.body).arrayBuffer()), bytes);
      return new Response('{ "error": "fixture signature rejected" }\n', {
        status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }) as typeof fetch);
    const init: RequestInit & { duplex: "half" } = {
      method: "POST", body: stream, duplex: "half",
      headers: { "content-type": "application/json; charset=utf-8" },
    };
    const response = await route(new Request("https://app.invalid/api/governance/owner-aliases", init));
    assert.equal(calls, 1);
    assert.equal(response.status, 401);
    assert.equal(await response.text(), '{ "error": "fixture signature rejected" }\n');
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("cancellation propagates and backend error bytes/correlation IDs are unchanged", async () => {
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://127.0.0.1:3210" }, async () => {
    const abort = new AbortController();
    const request = new Request("https://app.invalid/api/safe", { method: "POST", body: "{}", signal: abort.signal });
    const route = backendRoute("/api/safe", (async (_url, init) => {
      assert.equal(init?.signal, request.signal);
      abort.abort();
      throw request.signal.reason;
    }) as typeof fetch);
    await assert.rejects(route(request), { name: "AbortError" });
    const body = '{ "error": "service unavailable", "correlationId": "backend-correlation" }';
    const passthrough = backendRoute("/api/safe", (async () => new Response(body, { status: 503, headers: {
      "content-type": "application/json", "cache-control": "no-store", "retry-after": "3" } })) as typeof fetch);
    const response = await passthrough(new Request("https://app.invalid/api/safe", { method: "POST", body: "{}" }));
    assert.equal(response.status, 503);
    assert.equal(await response.text(), body);
    assert.equal(response.headers.get("retry-after"), "3");
  });
});

for (const path of ["/api/quotes/routes/stream", "/api/quotes/intent/stream", "/api/quotes/market/stream", "/api/quotes/trade/stream"] as const) test(`${path} forwards a chunk before upstream completion and preserves cancellation`, async () => {
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://127.0.0.1:3210", CYBERGOLD_BACKEND_BEARER_TOKEN: "fixture-private" }, async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { writer = controller; }, cancel() { cancelled = true; },
    });
    const route = backendRoute(path, (async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-private");
      return new Response(body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-accel-buffering": "no" } });
    }) as typeof fetch);
    let returned = false;
    const pending = route(new Request(`https://app.invalid${path}`, { method: "POST", body: "{}" })).then(value => {
      returned = true; return value;
    });
    // The synthetic fetch returns headers immediately. Drain its continuation,
    // while the body remains open, to detect response buffering causally.
    await Promise.resolve(); await Promise.resolve();
    assert.equal(returned, true, "the App must return headers before the producer completes its body");
    const response = await pending;
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    const reader = response.body!.getReader();
    const events = '{"type":"model","value":{}}\n{"type":"qualified","value":{}}\n';
    writer.enqueue(new TextEncoder().encode(events));
    const chunk = await reader.read();
    assert.equal(new TextDecoder().decode(chunk.value), events);
    await reader.cancel();
    assert.equal(cancelled, true);
  });
});

test("fixed adapters preserve optional diagnostic linkage without forwarding browser credentials", async () => {
  const attemptId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e", requestId = "eb3e6932-a2af-4303-a09e-35831f864a1d";
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://127.0.0.1:3210", CYBERGOLD_BACKEND_BEARER_TOKEN: "fixture-private" }, async () => {
    const route = backendRoute("/api/quotes/trade/stream", (async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("X-CyberGold-Attempt-Id"), attemptId);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-private");
      return new Response('{"type":"complete","value":{}}\n', { headers: { "X-CyberGold-Request-Id": requestId } });
    }) as typeof fetch);
    const response = await route(new Request("https://app.invalid/api/quotes/trade/stream", { method: "POST", body: "{}",
      headers: { "X-CyberGold-Attempt-Id": attemptId, authorization: "browser-secret" } }));
    assert.equal(response.headers.get("X-CyberGold-Request-Id"), requestId);
    const failed = backendRoute("/api/quotes/trade/stream", (async () => { throw new TypeError("private transport text"); }) as typeof fetch);
    const result = await failed(new Request("https://app.invalid/api/quotes/trade/stream", { headers: { "X-CyberGold-Attempt-Id": attemptId } }));
    const body = await result.json();
    assert.equal(body.attemptId, attemptId); assert.equal(body.requestId, result.headers.get("X-CyberGold-Request-Id"));
    assert.equal(body.correlationId, body.requestId); assert.doesNotMatch(JSON.stringify(body), /private transport/);
  });
});
