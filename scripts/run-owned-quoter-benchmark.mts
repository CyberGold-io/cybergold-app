#!/usr/bin/env node
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DockerQuoterResources, ownedQuoterBenchmark, type OwnedQuoterResourceConfiguration } from './owned-quoter-benchmark.ts';
import { runQuoterBenchmark, summarizeQuoterBenchmark } from '../tests/trading/quoterBenchmark.ts';

const { values } = parseArgs({ options: { resources: { type: 'string' }, output: { type: 'string' } } });
if (!values.resources || !values.output) throw new Error('usage: --resources <owned-profile-inputs.json> --output <report.json>');
const configuration = JSON.parse(await readFile(resolve(values.resources), 'utf8')) as OwnedQuoterResourceConfiguration;
const resources = new DockerQuoterResources(configuration);
let interrupted = false;
const stop = () => { interrupted = true; resources.cancel(); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
try {
  await resources.start();
  const destination = resolve(values.output);
  await mkdir(dirname(destination), { recursive: true });
  const definition = ownedQuoterBenchmark(resources, configuration.cases, configuration.repetitions);
  definition.checkpoint = async report => {
    const value = { ...report, environment: { scope: 'owned local fork; quote-only', chainId: configuration.chainId,
      baselineImage: configuration.baselineImage, candidateImage: configuration.candidateImage,
      platform: configuration.platform ?? 'linux/amd64',
      uncontrolled: ['upstream RPC caches', 'host scheduling'],
      changedStateScope: 'W3 advances the block header only; pool reserves are unchanged',
      startupBehavior: 'Native API startup may prefetch Helpers configuration; no benchmark quote/model/configuration warm-up before C1',
      instrumentation: 'read-only owned-fixture callback clocks on both images; normal 5+10 budget',
      accuracyScope: 'fresh-secondary whole-trade estimate and longer best-observed reference; no execution receipt or global optimum' },
    summary: summarizeQuoterBenchmark(report) };
    await writeFile(destination + '.tmp', JSON.stringify(value, null, 2)+'\n');
    await rename(destination + '.tmp', destination);
    if (interrupted) throw new Error('owned-profile-interrupted');
  };
  const report = await runQuoterBenchmark(definition);
  if (!report.rows.length || report.rows.some(row => row.status !== 'pass')) process.exitCode = 1;
} finally { await resources.close(); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
