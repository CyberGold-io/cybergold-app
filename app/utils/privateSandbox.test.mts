import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from '@playwright/test';
import type { Address } from 'viem';
import { privateSandboxPhase, privateSandboxScenarios, privateSandboxSelection, sandboxIsolation, scenarioIsolation } from '../../tests/trading/privateSandbox.ts';
import { buildMatrix, valuationSnapshot } from '../../tests/trading/matrix.ts';
import { executeAlternate } from '../../tests/trading/providerEvidence.ts';
import { tokenRequest } from '../../tests/trading/regression.ts';
import { protocolConfigurationFixture } from '../../tests/fixtures/protocol-configuration.ts';
import { coreTrade, marketTrade } from '../../tests/fixtures/trade-quote.mts';
import type { ProtocolFacts } from './protocolFacts.ts';

const config = protocolConfigurationFixture;
const facts = { context: { observedAt: '2026-10-18T12:00:00Z' }, basket: {
  assets: { status: 'success', value: [] }, targetsPpm: { status: 'success', value: [] },
  cygldPerUnitFp18: { status: 'success', value: [] },
} } as unknown as ProtocolFacts;
const matrix = buildMatrix(config, valuationSnapshot(config, facts, []));
const isolation = { source: 'sandbox', sourceBlockNumber: '100', sourceBlockHash: `0x${'1'.repeat(64)}`,
  baselineBlockNumber: '104', baselineBlockHash: `0x${'2'.repeat(64)}`, cacheGeneration: 2,
  reset: 'snapshot-reverted', chain: 'owned-fork', cache: 'recreated-per-attempt', wallet: 'fresh-profile-per-attempt' };

test('private phases keep the sequential matrix and select one independent scenario without mutating frozen inputs', () => {
  assert.equal(privateSandboxPhase(undefined), undefined);
  assert.equal(privateSandboxPhase('prepare'), 'prepare');
  assert.throws(() => privateSandboxPhase('reset-shared-chain'), /private-sandbox-phase-invalid/);
  const frozen = structuredClone(matrix);
  assert.equal(privateSandboxScenarios(matrix, undefined).length, 48);
  assert.equal(privateSandboxScenarios(matrix, 'prepare').length, 48);
  assert.deepEqual(privateSandboxScenarios(matrix, 'winner', `ui-${matrix[4].id}`), [matrix[4]]);
  assert.deepEqual(privateSandboxScenarios(matrix, 'alternate', matrix[4].id), [matrix[4]]);
  assert.deepEqual(matrix, frozen);
  assert.throws(() => privateSandboxScenarios(matrix, 'winner', 'missing'), /scenario-unavailable/);
});

test('isolation evidence carries source and prepared anchors plus independent cache and wallet generations', () => {
  assert.deepEqual(sandboxIsolation({ ...isolation, privateRpc: 'must-not-be-retained' }), isolation);
  assert.throws(() => sandboxIsolation({ ...isolation, source: 'mainnet' }), /source-required/);
  assert.throws(() => sandboxIsolation({ ...isolation, reset: undefined }), /reset-required/);
  assert.throws(() => sandboxIsolation({ ...isolation, cache: 'shared-cache' }), /cache-reset-required/);
  assert.throws(() => sandboxIsolation({ ...isolation, wallet: 'reused-profile' }), /wallet-reset-required/);
  assert.throws(() => sandboxIsolation({ ...isolation, sourceBlockHash: undefined }), /sourceBlockHash-invalid/);
  for (const role of ['winner', 'alternate'] as const) {
    const emitted = JSON.parse(JSON.stringify(scenarioIsolation(sandboxIsolation(isolation), role)));
    assert.equal(emitted.reset, 'snapshot-reverted');
    assert.equal(emitted.attemptRole, role);
  }
});

test('a pre-click UI failure retains the exact complete browser quote and excludes requests with other amounts', () => {
  const scenario = { ...matrix[0], amountRaw: '100' };
  const quote = coreTrade();
  const selected = privateSandboxSelection([
    { path: '/api/quotes/trade/stream', status: 200, request: { side: scenario.side, mode: scenario.inputMode, amount: '100' }, terminal: { type: 'complete', value: quote } },
    { path: '/api/quotes/trade/stream', status: 200, request: { side: scenario.side, mode: scenario.inputMode, amount: '999' }, terminal: { type: 'complete', value: marketTrade() } },
  ], scenario, config);
  assert.deepEqual(selected?.quote, quote);
  assert.equal(selected?.intent?.amount, '100');
  selected!.quote!.quotedInput = '777';
  assert.equal(quote.quotedInput, '20');
  assert.equal(privateSandboxSelection([], scenario, config), undefined);
});

test('the restored-baseline alternate still revalidates the original losing plan and uses ordinary execution', async () => {
  const scenario = { ...matrix[0], amountRaw: '100', sizingError: undefined };
  const primary = coreTrade('buy', 'exact-in'), losing = { ...marketTrade('buy', 'exact-in'), quotedInput: '100', quotedOutput: '200', inputMaximum: '100', outputMinimum: '1' };
  const selected = { ...primary, providerAssessments: { core: { availability: 'qualified', searchOutcome: 'complete' },
    market: { availability: 'qualified', searchOutcome: 'complete' } }, providerCandidates: { core: primary, market: losing } } as const;
  const request = tokenRequest(scenario, config, config.contracts.helpers!);
  let revalidations = 0, executions = 0;
  const alternate = await executeAlternate({ quote: selected }, scenario, request, {} as Page, config.contracts.helpers as Address, config,
    (async (_path, init) => {
      revalidations++;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.retainedPlan, { strategy: 'market', request: losing.providerRequest, quote: losing.providerQuote });
      return new Response(JSON.stringify({ type: 'complete', value: { ...losing, tokenIn: selected.providerCandidates.market.tokenIn,
        tokenOut: selected.providerCandidates.market.tokenOut, inputMaximum: '100', outputMinimum: '1' } }) + '\n');
    }) as typeof fetch,
    async observation => { executions++; observation.result.status = 'pass'; return observation.result; }, undefined, 'restored-baseline');
  assert.equal(alternate.comparisonState, 'restored-baseline');
  assert.equal(alternate.status, 'pass');
  assert.equal(alternate.transactionDisposition, 'confirmed');
  assert.equal(revalidations, 1); assert.equal(executions, 1);
});
