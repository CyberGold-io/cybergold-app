import { retainDiagnosticReferences, safeDiagnosticReferences, type DiagnosticReferences } from "./diagnosticReferences.ts";

/** Transport evidence only; absent or malformed metadata never changes a result. */
export type ServerTiming = { name: string; durationMs: number };
export type BackendHttpMetadata = { backendRevision?: string; serverTiming?: ServerTiming[] };

export function backendHttpMetadata(headers: Headers): BackendHttpMetadata {
  const revision = headers.get("X-CyberGold-Backend-Revision");
  const serverTiming: ServerTiming[] = [];
  // Descriptions may contain commas/semicolons; never treat their text as metrics.
  const timing = headers.get("Server-Timing")?.replace(/"(?:[^"\\]|\\.)*(?:"|$)/g, "");
  for (const metric of timing?.split(",") ?? []) {
    const [name, ...parameters] = metric.trim().split(";");
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) continue;
    const duration = parameters.map(value => /^\s*dur\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*$/.exec(value)?.[1]).find(Boolean);
    if (duration !== undefined && Number.isFinite(Number(duration))) serverTiming.push({ name, durationMs: Number(duration) });
  }
  return { ...(revision && /^[0-9a-f]{40}$/i.test(revision) ? { backendRevision: revision.toLowerCase() } : {}),
    ...(serverTiming.length ? { serverTiming } : {}) };
}

export type BackendHttpObservation = DiagnosticReferences & BackendHttpMetadata & {
  operation: "economic-estimates"; outcome: "succeeded" | "failed" | "cancelled";
  elapsedMs: number; headersMs?: number; bodyMs?: number; httpStatus?: number;
};
const observations = new WeakMap<object, BackendHttpObservation>();
export const CLIENT_TRANSPORT_DIAGNOSTIC_EVENT = "cybergold:transport-diagnostic";

/** Page-local evidence only: no telemetry POST, history store or readiness gate. */
export function recordBackendHttpObservation(value: unknown, observation: BackendHttpObservation) {
  try {
    if (value && typeof value === "object") {
      observations.set(value, observation);
      retainDiagnosticReferences(value, safeDiagnosticReferences(observation));
    }
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CLIENT_TRANSPORT_DIAGNOSTIC_EVENT,
      { detail: structuredClone(observation) }));
  } catch { /* Optional local observation cannot interrupt the request. */ }
}

export function backendHttpObservation(value: unknown): BackendHttpObservation | undefined {
  return value && typeof value === "object" ? observations.get(value) : undefined;
}
