#!/usr/bin/env node
import { parseArgs, parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copySyntheticSource, syntheticConfig, syntheticEnvironment, syntheticReport,
  writeSyntheticReport } from '../tests/trading/syntheticRegression.ts';

const { values } = parseArgs({ options: { suite: { type: 'string' }, 'output-dir': { type: 'string' } } });
if (!['sequential', 'independent'].includes(values.suite)) throw new Error('--suite must be sequential or independent');
if (!values['output-dir']) throw new Error('--output-dir is required');
const output = resolve(values['output-dir']), source = fileURLToPath(new URL('../', import.meta.url));
const report = syntheticReport(values.suite, randomUUID(), new Date().toISOString());
await writeSyntheticReport(output, report);
const work = await mkdtemp(join(tmpdir(), 'cybergold-synthetic-ui-'));

async function command(args, environment, name) {
  const log = await open(join(output, name + '.log'), 'w');
  try {
    await new Promise((resolveCommand, reject) => {
      const child = spawn(process.execPath, args, { cwd: work, env: environment, stdio: ['ignore', log.fd, log.fd] });
      const stop = () => child.kill('SIGTERM');
      process.once('SIGTERM', stop); process.once('SIGINT', stop);
      const cleanup = () => { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); };
      child.once('error', error => { cleanup(); reject(error); });
      child.once('exit', code => { cleanup(); if (code === 0) resolveCommand(); else reject(new Error('synthetic-command-failed')); });
    });
  } finally { await log.close(); }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePort, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePort); });
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}

try {
  await copySyntheticSource(source, work);
  const fixture = parseEnv(await readFile(join(source, 'tests/fixtures/app.env'), 'utf8'));
  const environment = syntheticEnvironment(process.env, fixture, work);
  await command([join(work, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], environment, 'synthetic-build');
  report.runnerDiagnostics.stage = 'synthetic-ui-tests';
  await writeSyntheticReport(output, report);
  const config = join(work, 'playwright.synthetic.config.cjs');
  await writeFile(config, 'module.exports = ' + JSON.stringify(syntheticConfig(work, output, await freePort(), report)) + ';\n');
  await command([join(work, 'node_modules/@playwright/test/cli.js'), 'test', '--config', config], environment, 'synthetic-ui-tests');
} catch {
  // Keep every completed test checkpoint; an orchestration failure never turns
  // a synthetic hash into transaction/receipt evidence or invents missing cases.
  try { Object.assign(report, JSON.parse(await readFile(join(output, 'report.json'), 'utf8'))); } catch { /* initial report remains */ }
  report.runnerOutcome = 'fail';
  report.runnerCode ??= report.runnerDiagnostics.stage === 'synthetic-build' ? 'synthetic-build-failed' : 'synthetic-ui-runner-failed';
  report.finishedAt = new Date().toISOString();
  await writeSyntheticReport(output, report);
  process.exitCode = 1;
} finally { await rm(work, { recursive: true, force: true }); }
