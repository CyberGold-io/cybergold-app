/** Diagnostic linkage is optional and never changes execution readiness. */
export type DiagnosticReferences = { attemptId?: string; requestId?: string; correlationId?: string; workId?: string };
const references = new WeakMap<object, DiagnosticReferences>();
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const quotePhases = ["context", "initial-search", "initial-preview", "capacity", "basket-preview",
  "expected-input-search", "execution-search", "final-preview", "canonicality", "retained-validation"] as const;
const routePhases = ["context", "eligibility", "v3-coverage", "typed-reserve", "structured-search", "composition", "canonicality"] as const;
const waveNumbers = ["elapsedMs", "subphaseElapsedMs", "legacyCandidates", "legacyCompleted", "typedEnumerated",
  "typedCompleted", "typedPending", "sdkRequests", "sdkWaiting", "sdkLockWaitMs", "sdkExchangeMs"] as const;
const quoteCodes = ["rpc-rate-limit", "rpc-timeout", "rpc-unavailable", "rpc-access-denied", "quote-timeout",
  "quote-no-route", "quote-contract-reverted", "quote-unavailable", "insufficient-protocol-supply",
  "issuance-cap-exceeded", "redemption-supply-exceeded", "redemption-capacity-exceeded"] as const;
const providerStages = ["composition", "basket-preview", "initial-preview", "execution-search", "expected-input-search",
  "final-preview", "tolerance", "canonicality", "selection", "route-pricing", "fee-bounds", "qualification", "retained-validation"] as const;
const providerOutcomes = ["running", "qualified", "rejected", "not-improved", "cancelled", "superseded"] as const;
const legCounters = ["index", "started", "succeeded", "failed", "cancelled", "pending", "omittedFailureCodes", "omittedPools"] as const;
const providerCounters = ["attempts", "qualified", "rejected", "notImproved", "cancelled", "superseded", "pending", "omittedRows"] as const;
const providerAmounts = ["targetAmount", "minimumAmountOut", "maximumAmountOut", "observedAmountOut", "maximumAmountIn", "observedAmountIn",
  "executionAmount", "quotedInput", "quotedOutput", "inputMaximum", "outputMinimum"] as const;
const providerTimes = ["firstQualifiedMs", "selectionMs", "canonicalCompletedMs", "cleanupCompletedMs"] as const;
const attemptTimes = ["startedMs", "completedMs", "elapsedMs"] as const;
const selectionReasons = ["best-initial", "first-extension", "complete", "timeout"] as const;
type PoolEvidence = { protocol: "v2" | "v3" | "v4"; poolId?: string; poolAddress?: string };
type QuoteCode = typeof quoteCodes[number];
type RouteLeg = Partial<Record<typeof legCounters[number], number>> & {
  index: number; inputAsset?: string; outputAsset?: string; amount?: string; bestAvailable?: boolean;
  failureCounts: { code: QuoteCode; count: number }[];
  bestPools: PoolEvidence[];
};
type ProviderQualification = { attempt: number; stage: typeof providerStages[number]; outcome: typeof providerOutcomes[number]; code?: QuoteCode }
  & Partial<Record<typeof providerAmounts[number], string>> & Partial<Record<typeof attemptTimes[number], number>> & { pools?: PoolEvidence[]; omittedPools?: number };
export type QuoteDiagnostics = { phase?: typeof quotePhases[number]; qualified?: boolean; elapsedMs?: number; inversionIteration?: number;
  routeWave?: { mode?: "exact-in" | "exact-out"; subphase?: typeof routePhases[number];
    legs?: { count: number; omittedRows?: number; rows: RouteLeg[] } } & Partial<Record<typeof waveNumbers[number], number>>;
  providerQualifications?: { provider: "core" | "market"; attempts: number; rows: ProviderQualification[]; selectedAttempt?: number; selectionReason?: typeof selectionReasons[number] } & Partial<Record<typeof providerCounters[number], number>> & Partial<Record<typeof providerTimes[number], number>> };
const quoteWork = new WeakMap<object, QuoteDiagnostics>();

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const boundedInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1e12;
const address = (value: unknown) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.exec(value)?.[0] === value ? value.toLowerCase() : undefined;
const uint256 = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.exec(value)?.[0] === value && BigInt(value) < 2n ** 256n;
function poolIdentity(value: unknown) {
  if (typeof value !== "string") return;
  if (/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.exec(value)?.[0] === value) return value.toLowerCase();
  const matched = /^v3:(0x[0-9a-fA-F]{40}):(0x[0-9a-fA-F]{40}):([0-9]{1,7})$/.exec(value);
  if (matched && matched[0] === value && Number(matched[3]) <= 1e6) return value.toLowerCase();
}
function safePools(value: unknown): PoolEvidence[] {
  return (Array.isArray(value) ? value.slice(0, 8) : []).flatMap(raw => {
    const pool = record(raw);
    if (!pool || (pool.protocol !== "v2" && pool.protocol !== "v3" && pool.protocol !== "v4")) return [];
    const poolId = poolIdentity(pool.poolId), poolAddress = address(pool.poolAddress);
    return poolId || poolAddress ? [{ protocol: pool.protocol, ...(poolId ? { poolId } : {}), ...(poolAddress ? { poolAddress } : {}) } as PoolEvidence] : [];
  });
}
function times<T extends string>(source: Record<string, unknown>, names: readonly T[]) {
  const result: Partial<Record<T, number>> = {};
  for (const name of names) { const value = source[name]; if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e12) result[name] = value; }
  return result;
}
function counters<T extends string>(source: Record<string, unknown>, names: readonly T[]) {
  const result: Partial<Record<T, number>> = {};
  for (const name of names) if (boundedInteger(source[name])) result[name] = source[name];
  return result;
}
function routeLegs(value: unknown): NonNullable<NonNullable<QuoteDiagnostics["routeWave"]>["legs"]> | undefined {
  const source = record(value);
  if (!source || !boundedInteger(source.count)) return;
  const rows: RouteLeg[] = [];
  for (const raw of Array.isArray(source.rows) ? source.rows.slice(0, 16) : []) {
    const input = record(raw);
    if (!input || !boundedInteger(input.index)) continue;
    const row: RouteLeg = { ...counters(input, legCounters), index: input.index, failureCounts: [], bestPools: [] };
    if (typeof input.bestAvailable === "boolean") row.bestAvailable = input.bestAvailable;
    for (const name of ["inputAsset", "outputAsset"] as const) {
      const safe = address(input[name]);
      if (safe) row[name] = safe;
    }
    if (uint256(input.amount)) row.amount = input.amount;
    for (const rawFailure of Array.isArray(input.failureCounts) ? input.failureCounts.slice(0, 16) : []) {
      const failure = record(rawFailure);
      if (failure && (quoteCodes as readonly unknown[]).includes(failure.code) && boundedInteger(failure.count))
        row.failureCounts.push({ code: failure.code as QuoteCode, count: failure.count });
    }
    row.bestPools = safePools(input.bestPools);
    rows.push(row);
  }
  return { count: source.count, ...(boundedInteger(source.omittedRows) ? { omittedRows: source.omittedRows } : {}), rows };
}
function providerQualifications(value: unknown): QuoteDiagnostics["providerQualifications"] {
  const source = record(value);
  if (!source || (source.provider !== "core" && source.provider !== "market") || !boundedInteger(source.attempts)) return;
  const rows: ProviderQualification[] = [];
  for (const raw of Array.isArray(source.rows) ? source.rows.slice(0, 8) : []) {
    const input = record(raw);
    if (!input || !boundedInteger(input.attempt) || !(providerStages as readonly unknown[]).includes(input.stage)
      || !(providerOutcomes as readonly unknown[]).includes(input.outcome)) continue;
    const row: ProviderQualification = { attempt: input.attempt, stage: input.stage as ProviderQualification["stage"], outcome: input.outcome as ProviderQualification["outcome"] };
    if ((quoteCodes as readonly unknown[]).includes(input.code)) row.code = input.code as QuoteCode;
    for (const name of providerAmounts) if (uint256(input[name])) row[name] = input[name];
    Object.assign(row, times(input, attemptTimes));
    if (Array.isArray(input.pools)) row.pools = safePools(input.pools);
    if (boundedInteger(input.omittedPools)) row.omittedPools = input.omittedPools;
    rows.push(row);
  }
  return { ...counters(source, providerCounters), ...times(source, providerTimes), provider: source.provider, attempts: source.attempts, rows,
    ...(boundedInteger(source.selectedAttempt) ? { selectedAttempt: source.selectedAttempt } : {}),
    ...((selectionReasons as readonly unknown[]).includes(source.selectionReason) ? { selectionReason: source.selectionReason as typeof selectionReasons[number] } : {}) };
}

/** Match the Backend's closed logical work projection; it never determines readiness. */
export function safeQuoteDiagnostics(value: unknown): QuoteDiagnostics | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const source = value as Record<string, unknown>, result: QuoteDiagnostics = {};
    const numbers = <T extends string>(input: Record<string, unknown>, names: readonly T[]) => {
      const output: Partial<Record<T, number>> = {};
      for (const name of names) {
        const number = input[name];
        if (typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= 1e12) output[name] = number;
      }
      return output;
    };
    if (typeof source.phase === "string" && (quotePhases as readonly string[]).includes(source.phase)) result.phase = source.phase as QuoteDiagnostics["phase"];
    if (typeof source.qualified === "boolean") result.qualified = source.qualified;
    Object.assign(result, numbers(source, ["elapsedMs", "inversionIteration"]));
    const qualifications = providerQualifications(source.providerQualifications);
    if (qualifications) result.providerQualifications = qualifications;
    const wave = source.routeWave;
    if (wave && typeof wave === "object" && !Array.isArray(wave)) {
      const input = wave as Record<string, unknown>, projected: NonNullable<QuoteDiagnostics["routeWave"]> = {};
      if (input.mode === "exact-in" || input.mode === "exact-out") projected.mode = input.mode;
      if (typeof input.subphase === "string" && (routePhases as readonly string[]).includes(input.subphase)) projected.subphase = input.subphase as typeof routePhases[number];
      Object.assign(projected, numbers(input, waveNumbers));
      const legs = routeLegs(input.legs);
      if (legs) projected.legs = legs;
      if (Object.keys(projected).length) result.routeWave = projected;
    }
    return Object.keys(result).length ? result : undefined;
  } catch { /* Optional diagnostics cannot replace a quote outcome. */ }
}

export function quoteDiagnostics(value: unknown): QuoteDiagnostics | undefined {
  try {
    return value && typeof value === "object"
      ? safeQuoteDiagnostics(quoteWork.get(value) ?? (value as { quoteDiagnostics?: unknown }).quoteDiagnostics) : undefined;
  } catch { /* Optional diagnostics cannot replace a quote outcome. */ }
}

export function retainQuoteDiagnostics(value: unknown, metadata: unknown) {
  const safe = safeQuoteDiagnostics(metadata);
  if (safe && value && typeof value === "object") quoteWork.set(value, safe);
}

export function safeDiagnosticReferences(value: unknown): DiagnosticReferences {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>, result: DiagnosticReferences = {};
  for (const key of ["attemptId", "requestId", "correlationId", "workId"] as const)
    if (typeof source[key] === "string" && uuid.test(source[key])) result[key] = source[key];
  return result;
}

export function diagnosticReferences(value: unknown): DiagnosticReferences {
  return value && typeof value === "object" ? { ...references.get(value), ...safeDiagnosticReferences(value) } : {};
}

export function retainDiagnosticReferences(value: unknown, metadata: DiagnosticReferences) {
  if (value && typeof value === "object") references.set(value, { ...references.get(value), ...safeDiagnosticReferences(metadata) });
}

export function diagnosticAttemptId(): string | undefined {
  try { return crypto.randomUUID(); } catch { return undefined; }
}

export function diagnosticReference(value: unknown): string | undefined {
  const metadata = diagnosticReferences(value);
  return metadata.correlationId ?? metadata.requestId ?? metadata.attemptId;
}
