import { retainDiagnosticReferences } from "./diagnosticReferences.ts";

/** Read only safe linkage; public messages never contain the supplier body. */
export async function backendObservationError(response: Response, message: string) {
  const body = await response.json().catch(() => null), error = new Error(message);
  retainDiagnosticReferences(error, { ...body, requestId: response.headers.get("X-CyberGold-Request-Id") ?? body?.requestId });
  return error;
}
