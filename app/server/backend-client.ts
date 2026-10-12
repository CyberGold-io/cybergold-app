import "server-only";
import type { paths } from "@/app/contracts/backend/http";
import { serverEnv } from "./environment.ts";
import { safeDiagnosticReferences } from "../utils/diagnosticReferences.ts";

export type PublicBackendPath = Exclude<keyof paths, `/api/internal/${string}` | "/api/rpc">;
const RESPONSE_HEADERS = ["content-type", "cache-control", "retry-after", "x-cybergold-faucet-request-id", "x-accel-buffering", "x-cybergold-market-fallback", "x-cybergold-request-id", "x-cybergold-attempt-id", "x-cybergold-backend-revision"];

function transportFailure(path: PublicBackendPath, error: unknown, elapsedMs: number, attemptId?: string) {
  const timedOut = error instanceof Error && error.name === "TimeoutError";
  const requestId = crypto.randomUUID(), correlationId = requestId;
  const references = { requestId, correlationId, ...(attemptId ? { attemptId } : {}) };
  const headers = { "Cache-Control": "no-store", "X-CyberGold-Request-Id": requestId,
    ...(attemptId ? { "X-CyberGold-Attempt-Id": attemptId } : {}) };
  try { console.error("[backend-api] request failed", { ...references, operation: path, stage: "backend-http",
    elapsedMs, failureType: timedOut ? "provider-timeout" : "transport-error",
    ...(path === "/api/faucet" ? { code: timedOut ? "TIMEOUT" : "BAD_GATEWAY", httpStatus: timedOut ? 504 : 502 } : {}) }); }
  catch { /* Reporting cannot alter the product response. */ }
  if (path === "/api/transaction/revert") {
    return Response.json({ error: "Transaction revert observations are temporarily unavailable." }, { status: 503, headers });
  }
  if (path.startsWith("/api/transaction/wait/")) {
    return Response.json({ error: "Transaction confirmation observations are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/governance/roles") {
    return Response.json({ error: "Governance role observations are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/governance/target-code") {
    return Response.json({ error: "Proposal target code is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/governance/safe-nonce" || path === "/api/governance/safe-transaction-hash") {
    return Response.json({ error: "Safe transaction observations are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/transaction/receipt") {
    return Response.json({ error: "Transaction receipt is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/account/transaction-nonce") {
    return Response.json({ error: "Pending transaction nonce is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/transaction/fees") {
    return Response.json({ error: "Transaction fee observations are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/protocol/recovery-share-precision") {
    return Response.json({ error: "Recovery-share precision is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/protocol/recovery-assets") {
    return Response.json({ error: "Core recovery assets are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/protocol/config") {
    return Response.json({ error: "Protocol configuration is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/protocol/facts") {
    return Response.json({ error: "Protocol facts are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/governance/core-facts") {
    return Response.json({ error: "Core governance facts are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/governance/helpers-facts") {
    return Response.json({ error: "Helpers configuration is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/governance/safe-principal") {
    return Response.json({ error: "Safe principal observations are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/account/permit2") {
    return Response.json({ error: "Permit2 observations are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/account/core-permit") {
    return Response.json({ error: "Core permit context is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/account/token-permit") {
    return Response.json({ error: "Token permit context is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/tokens/metadata") {
    return Response.json({ error: "Token metadata is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/transaction/token-approval-gas") {
    return Response.json({ error: "Token approval gas estimation is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/account/ens-name" || path === "/api/account/ens-avatar-record") {
    return Response.json({ error: "ENS observations are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/account/native-balance") {
    return Response.json({ error: "Native balance is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/account/wallet-balances") {
    return Response.json({ error: "Wallet balances are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/account/liquidity-positions") {
    return Response.json({ error: "Liquidity positions are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/pools/snapshot") {
    return Response.json({ error: "Pool observations are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/pools/catalog") {
    return Response.json({ error: "Pool inventory is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/quotes/basket-preview") {
    return Response.json({ error: "Basket previews are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/quotes/token-preview") {
    return Response.json({ error: "Token previews are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/quotes/uniswap") {
    return Response.json({ error: "Uniswap quotes are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/quotes/intent/stream" || path === "/api/quotes/market/stream" || path === "/api/quotes/market" || path === "/api/quotes/trade/stream") {
    return Response.json({ code: timedOut ? "quote-timeout" : "quote-service-unavailable",
      error: timedOut ? "Quote service request timed out." : "Quote service connection failed.", ...references }, { status: 503, headers });
  }
  if (path === "/api/quotes/market/model" || path === "/api/quotes/trade/model") {
    return Response.json({ error: "Market estimates are temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/quotes/routes" || path === "/api/quotes/routes/stream") {
    return Response.json({ error: "Route search is temporarily unavailable." }, { status: 503, headers });
  }
  if (path === "/api/recovery/shares") {
    return Response.json({ error: "Recovery-share RPC snapshot is unavailable" }, { status: 503, headers });
  }
  if (path === "/api/faucet") {
    const code = timedOut ? "TIMEOUT" : "BAD_GATEWAY";
    const status = timedOut ? 504 : 502;
    return Response.json({ error: timedOut ? "Fork faucet request timed out." : "Fork faucet is temporarily unavailable.",
      code, ...references }, { status, headers });
  }
  const messages: Partial<Record<PublicBackendPath, string>> = {
    "/api/dashboard/onchain-summary": "Failed to load on-chain dashboard summary.",
    "/api/governance/owner-aliases": "Failed to process governance owner aliases request.",
    "/api/quote-pool-cache": "Failed to process quote-pool-cache request.",
    "/api/safe": "Failed to process Safe request.",
    "/api/safe/events": "Failed to index Safe execution events.",
  };
  return Response.json({ error: messages[path] ?? "Market data is temporarily unavailable.", ...references }, {
    status: ["/api/safe", "/api/gold", "/api/fx"].includes(path) ? 503 : 500, headers,
  });
}

/** One fixed operation per Next route; no URL, path, or credentials from callers. */
export function backendRoute(path: PublicBackendPath, fetchImpl: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    const started = performance.now();
    const { attemptId } = safeDiagnosticReferences({ attemptId: request.headers.get("X-CyberGold-Attempt-Id") });
    try {
      const url = new URL(path, serverEnv.CYBERGOLD_BACKEND_URL);
      url.search = new URL(request.url).search;
      const headers = new Headers();
      if (attemptId) headers.set("X-CyberGold-Attempt-Id", attemptId);
      // Retain Origin only for compatibility with a retained pre-migration backend;
      // the authenticated API entry and current faucet do not authorize by Origin.
      const forwardedHeaders = ["content-type", "content-length", ...(path === "/api/faucet" ? ["origin", "x-real-ip", "x-forwarded-for"] : [])];
      for (const name of forwardedHeaders) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      // Never forward a browser-supplied bearer. This server's private service
      // credential authenticates the backend hop, not the end user's authority.
      const token = serverEnv.CYBERGOLD_BACKEND_BEARER_TOKEN;
      if (token) headers.set("authorization", `Bearer ${token}`);
      const init: RequestInit & { duplex?: "half" } = {
        method: request.method, headers, signal: request.signal, cache: "no-store", redirect: "error",
      };
      if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
        init.body = request.body;
        init.duplex = "half";
      }
      // In particular, never retry an alias nonce, Safe action or faucet write.
      const response = await fetchImpl(url, init);
      const responseHeaders = new Headers();
      for (const name of RESPONSE_HEADERS) {
        const value = response.headers.get(name);
        if (value !== null) responseHeaders.set(name, value);
      }
      return new Response(request.method === "HEAD" || response.status === 204 || response.status === 304
        ? null : (path === "/api/quotes/routes/stream" || path === "/api/quotes/intent/stream" || path === "/api/quotes/market/stream" || path === "/api/quotes/trade/stream") ? response.body : await response.arrayBuffer(), { status: response.status, headers: responseHeaders });
    } catch (error) {
      if (request.signal.aborted) throw error;
      return transportFailure(path, error, Math.round(performance.now() - started), attemptId);
    }
  };
}
