import { createHash } from 'node:crypto';
import { cp, mkdir, rename, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

export const syntheticFiles = [
  'market-swaps.spec.ts', 'execution-tolerance.spec.ts',
  'swap-confirmation-feedback.spec.ts', 'wallet-batch.spec.ts',
] as const;
export type SyntheticSuite = 'sequential' | 'independent';
export type SyntheticTarget = 'sandbox' | 'mainnet';
export type SyntheticCase = {
  id: string; name: string; testFile: string; family: 'runner'; layer: 'browser'; inputMode: 'unknown';
  status: 'pass' | 'fail' | 'skipped' | 'unavailable'; code: string; durationMs: number; evidenceKind: 'mocked-ui';
};
export type SyntheticReport = ReturnType<typeof syntheticReport>;

export function syntheticReport(suite: SyntheticSuite, runId: string, startedAt: string, target: SyntheticTarget = 'sandbox') {
  return {
    schema: 'cybergold.trade-regression.v1', runId, target, mode: 'synthetic', suite,
    chainId: target === 'mainnet' ? 1 : 31337, testContext: `mocked-${target}`,
    evidenceKind: 'mocked-ui', transactionEvidence: 'synthetic-hashes-mocked-receipts', startedAt,
    finishedAt: undefined as string | undefined, runnerOutcome: 'unavailable' as 'pass' | 'fail' | 'unavailable',
    runnerCode: undefined as string | undefined, runnerDiagnostics: { stage: 'synthetic-build' },
    counts: { total: 0, passed: 0, failed: 0, skipped: 0, interrupted: 0 },
    progress: { completedScenarioIds: [] as string[] }, scenarios: [] as SyntheticCase[],
  };
}

export function syntheticCase(file: string, title: string, status: string, durationMs: number): SyntheticCase {
  const testFile = `tests/e2e/${basename(file)}`;
  const id = `synthetic-${createHash('sha256').update(testFile + '\0' + title).digest('hex').slice(0, 24)}`;
  const result = status === 'passed' ? 'pass' : status === 'skipped' ? 'skipped'
    : status === 'interrupted' ? 'unavailable' : 'fail';
  return { id, name: title, testFile, family: 'runner', layer: 'browser', inputMode: 'unknown',
    status: result, code: `mocked-ui-${result === 'pass' ? 'passed' : result === 'skipped' ? 'skipped'
      : result === 'unavailable' ? 'interrupted' : 'failed'}`, durationMs, evidenceKind: 'mocked-ui' };
}

export function recordSyntheticCase(report: SyntheticReport, row: SyntheticCase) {
  const prior = report.scenarios.findIndex(value => value.id === row.id);
  if (prior < 0) report.scenarios.push(row); else report.scenarios[prior] = row;
  report.progress.completedScenarioIds = report.scenarios.map(value => value.id);
  report.counts = {
    total: report.scenarios.length,
    passed: report.scenarios.filter(value => value.status === 'pass').length,
    failed: report.scenarios.filter(value => value.status === 'fail').length,
    skipped: report.scenarios.filter(value => value.status === 'skipped').length,
    interrupted: report.scenarios.filter(value => value.status === 'unavailable').length,
  };
}

export function finishSyntheticReport(report: SyntheticReport, status: string) {
  report.finishedAt = new Date().toISOString();
  report.runnerDiagnostics.stage = 'complete';
  report.runnerOutcome = status === 'passed' ? 'pass' : 'fail';
  if (status !== 'passed') report.runnerCode = 'mocked-ui-failed';
}

export async function writeSyntheticReport(outputDir: string, report: SyntheticReport) {
  await mkdir(outputDir, { recursive: true });
  const path = join(outputDir, 'report.json');
  await writeFile(path + '.tmp', JSON.stringify(report) + '\n');
  await rename(path + '.tmp', path);
}

// Copy only frontend/test source. Local env files, wallet state and credentials
// never enter the writable workspace; installed dependencies remain read-only.
export async function copySyntheticSource(source: string, work: string) {
  for (const name of ['app', 'components', 'i18n', 'lib', 'messages', 'public',
    'tests', 'scripts', 'wallet-setup', 'next.config.ts', 'postcss.config.mjs',
    'tsconfig.json', 'package.json', 'instrumentation.ts', 'proxy.ts']) {
    await cp(join(source, name), join(work, name), { recursive: true });
  }
  await symlink(join(source, 'node_modules'), join(work, 'node_modules'), 'dir');
}

export function syntheticEnvironment(inherited: Record<string, string | undefined>, fixture: Record<string, string>, home: string, target: SyntheticTarget = 'sandbox'): Record<string, string | undefined> {
  const originalHome = inherited.HOME ?? homedir();
  const browserCache = process.platform === 'darwin' ? join(originalHome, 'Library/Caches/ms-playwright')
    : process.platform === 'win32' ? join(inherited.LOCALAPPDATA ?? join(originalHome, 'AppData/Local'), 'ms-playwright')
      : join(inherited.XDG_CACHE_HOME ?? join(originalHome, '.cache'), 'ms-playwright');
  return {
    PATH: inherited.PATH, SYSTEMROOT: inherited.SYSTEMROOT,
    PLAYWRIGHT_BROWSERS_PATH: inherited.PLAYWRIGHT_BROWSERS_PATH ?? browserCache,
    HOME: home, TMPDIR: home, NEXT_TELEMETRY_DISABLED: '1', ...fixture,
    ...(target === 'mainnet' ? { NEXT_PUBLIC_CHAIN_ID: '1', NEXT_PUBLIC_CHAIN_NAME: 'Ethereum', NEXT_PUBLIC_FORK_FAUCET_ENABLED: '0' } : {}),
  };
}

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export function syntheticConfig(work: string, outputDir: string, port: number, report: SyntheticReport) {
  return {
    testDir: join(work, 'tests/e2e'), testMatch: [...syntheticFiles],
    timeout: 120_000, fullyParallel: false, retries: 0, workers: 1,
    outputDir: join(work, 'test-results'),
    reporter: [['list'], [join(work, 'tests/trading/syntheticReporter.ts'), { outputDir, report }]],
    use: { baseURL: `http://127.0.0.1:${port}`, headless: true, trace: 'off' },
    webServer: {
      command: `${shellQuote(process.execPath)} ${shellQuote(join(work, 'node_modules/next/dist/bin/next'))} start --hostname 127.0.0.1 --port ${port}`,
      cwd: work, url: `http://127.0.0.1:${port}/en`, timeout: 120_000, reuseExistingServer: false,
      stdout: 'ignore', stderr: 'ignore',
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  };
}
