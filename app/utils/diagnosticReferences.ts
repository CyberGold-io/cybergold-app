/** Diagnostic linkage is optional and never changes execution readiness. */
export type DiagnosticReferences = { attemptId?: string; requestId?: string; correlationId?: string; workId?: string };
const references = new WeakMap<object, DiagnosticReferences>();
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const quotePhases = ["context", "initial-search", "initial-preview", "capacity", "basket-preview",
  "expected-input-search", "execution-search", "final-preview", "canonicality", "retained-validation"] as const;
const routePhases = ["context", "eligibility", "v3-coverage", "typed-reserve", "composition", "canonicality"] as const;
const waveNumbers = ["elapsedMs", "subphaseElapsedMs", "legacyCandidates", "legacyCompleted", "typedEnumerated",
  "typedCompleted", "typedPending", "sdkRequests", "sdkWaiting", "sdkLockWaitMs", "sdkExchangeMs"] as const;
export type QuoteDiagnostics = { phase?: typeof quotePhases[number]; qualified?: boolean; elapsedMs?: number; inversionIteration?: number;
  routeWave?: { mode?: "exact-in" | "exact-out"; subphase?: typeof routePhases[number] } & Partial<Record<typeof waveNumbers[number], number>> };
const quoteWork = new WeakMap<object, QuoteDiagnostics>();

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
    const wave = source.routeWave;
    if (wave && typeof wave === "object" && !Array.isArray(wave)) {
      const input = wave as Record<string, unknown>, projected: NonNullable<QuoteDiagnostics["routeWave"]> = {};
      if (input.mode === "exact-in" || input.mode === "exact-out") projected.mode = input.mode;
      if (typeof input.subphase === "string" && (routePhases as readonly string[]).includes(input.subphase)) projected.subphase = input.subphase as typeof routePhases[number];
      Object.assign(projected, numbers(input, waveNumbers));
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
