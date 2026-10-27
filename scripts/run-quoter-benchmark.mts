#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runQuoterBenchmark, summarizeQuoterBenchmark, type QuoterBenchmarkDefinition } from '../tests/trading/quoterBenchmark.ts';

const { values } = parseArgs({ options: { adapter: { type: 'string' }, output: { type: 'string' } } });
if (!values.adapter || !values.output) throw new Error('usage: --adapter <owned-profile-module> --output <report.json>');
const adapter = await import(pathToFileURL(resolve(values.adapter)).href) as {
  benchmark: QuoterBenchmarkDefinition; close?: () => Promise<void>;
};
const destination = resolve(values.output);
const save: QuoterBenchmarkDefinition['checkpoint'] = async report => {
  await writeFile(destination + '.tmp', JSON.stringify({ ...report, summary: summarizeQuoterBenchmark(report) }, null, 2) + '\n');
  await rename(destination + '.tmp', destination);
};
try {
  await mkdir(dirname(destination), { recursive: true });
  const report = await runQuoterBenchmark({ ...adapter.benchmark, checkpoint: save });
  await save(report);
  if (!report.rows.length || report.rows.some(row => row.status !== 'pass')) process.exitCode = 1;
} finally {
  await adapter.close?.();
}
