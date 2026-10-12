/** Diagnostic linkage is optional and never changes execution readiness. */
export type DiagnosticReferences = { attemptId?: string; requestId?: string; correlationId?: string; workId?: string };
const references = new WeakMap<object, DiagnosticReferences>();
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

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
