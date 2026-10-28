export type RegressionRunPolicy = 'diagnostic' | 'full';
export const regressionStatuses = ['pass', 'rejected', 'fail', 'unavailable', 'skipped'] as const;
export type RegressionStatus = typeof regressionStatuses[number];
export type RegressionPolicyOutcome = { status?: string; code?: string; alternateExecution?: RegressionPolicyOutcome };
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

/** A completed, explained refusal is neither a produced quote nor an unexpected failure. */
export function regressionOutcome(rows: readonly RegressionPolicyOutcome[], runnerOutcome = 'pass') {
  if (runnerOutcome !== 'pass' || rows.some(row => row.status === 'fail' || row.status === 'unavailable'
    || row.alternateExecution?.status === 'fail')) return 'fail';
  return rows.some(row => row.status === 'rejected' || row.alternateExecution?.status === 'rejected')
    ? 'completed-with-rejections' : 'pass';
}
