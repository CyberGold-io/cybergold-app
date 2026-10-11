import type {
  CachedPoolCandidate,
  PoolCacheLookupParams,
  PoolCacheRecordParams,
  QuotePoolCacheClient,
} from "../types";

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function listPools(params: PoolCacheLookupParams, fetchImpl: typeof fetch): Promise<CachedPoolCandidate[]> {
  try {
    const response = await fetchImpl("/api/quote-pool-cache", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        action: "list-pools",
        ...params,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const payload = await safeJson(response);
    return Array.isArray(payload?.entries) ? payload.entries : [];
  } catch {
    return [];
  }
}

async function recordObservations(params: PoolCacheRecordParams, fetchImpl: typeof fetch) {
  if (params.entries.length === 0) {
    return;
  }

  try {
    await fetchImpl("/api/quote-pool-cache", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "record-observations",
        entries: params.entries,
      }),
    });
  } catch {
    // Ignore cache persistence failures and keep quote selection functional.
  }
}

export function createQuotePoolCacheClient(fetchImpl: typeof fetch = fetch): QuotePoolCacheClient {
  return { listPools: params => listPools(params, fetchImpl),
    recordObservations: params => recordObservations(params, fetchImpl) };
}

export const quotePoolCacheClient = createQuotePoolCacheClient();
