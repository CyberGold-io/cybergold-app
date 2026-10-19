export type RegressionRunPolicy = 'diagnostic' | 'full';
export type RegressionPolicyOutcome = { status?: string; code?: string };
export type DiagnosticStop = { scenarioId: string; role: 'winner' | 'alternate' };

/** Historical producers continue the full inventory unless explicitly selected. */
export function regressionPolicy(value: unknown): RegressionRunPolicy {
  if (value === undefined) return 'full';
  if (value === 'diagnostic' || value === 'full') return value;
  throw new Error('--run-policy must be diagnostic or full');
}

/** Inspect one observed role; callers keep winner and alternate attribution. */
export function unexpectedFailure(row: RegressionPolicyOutcome | undefined): boolean {
  return Boolean(row && (row.status === 'fail' || row.status === 'unavailable')
    && row.code !== 'not-exercised' && row.code !== 'not-attempted');
}
