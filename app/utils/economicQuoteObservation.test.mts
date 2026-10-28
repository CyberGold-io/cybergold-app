import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeFunctionData, zeroHash, type Address } from 'viem';
import { protocolConfigurationFixture as config, tokenAddresses } from '../../tests/fixtures/protocol-configuration.ts';
import { HISTORICAL_HELPERS_EXECUTION_ABI } from '../../tests/fixtures/helpers-execution-legacy.ts';
import { browserQuoteMatcher } from '../../tests/trading/browserQuoteObservation.ts';
import { installQuoteObservation, type QuoteObservation } from '../../tests/trading/quoteObservation.ts';
import { applyEconomicQuote, observeScenario, resultFor } from '../../tests/trading/regression.ts';
import { captureSelection, installSelectionCapture } from '../../tests/trading/providerEvidence.ts';
import { assertMatrixIntent, type MatrixScenario } from '../../tests/trading/matrix.ts';
import { assertCapturedTradeInput, observedPreparation } from '../../tests/trading/planAssertions.ts';
import { privateSandboxSelection } from '../../tests/trading/privateSandbox.ts';
import { uiQuoteReady } from '../../tests/trading/uiQuotePreparation.ts';
import { tradeScenarios } from '../../tests/trading/scenarios.ts';
import { exactInputPlan } from './universalExactInput.ts';
import type { EconomicQuote, PreparedTransaction } from './economicQuotes.ts';
import type { ProtocolFacts } from './protocolFacts.ts';

const owner = '0x0000000000000000000000000000000000000006' as Address;
const scenario = { ...tradeScenarios.find(row => row.asset === 'USDC' && row.side === 'buy'
  && row.inputMode === 'exact-in' && row.requestedStrategy === 'core')!, amountRaw: '100' };

function quote(): EconomicQuote {
  const inputs = [{ currency: tokenAddresses.USDC, amount: '100' }];
  const pool = { id: config.contracts.helpers!, address: config.contracts.helpers!, protocol: 'v3', feePips: 3000,
    token0: { address: tokenAddresses.USDC }, token1: { address: tokenAddresses.CYGLD } };
  const branches = [0, 1].map(index => ({ amountIn: '50', hops: [{ zeroForOne: true,
    pool: { ...pool, id: index ? config.contracts.uniswapAdapter! : pool.id,
      address: index ? config.contracts.uniswapAdapter! : pool.address } }] }));
  return { strategy: 'universal', operation: 'executeExactInput', routeFamily: 'market',
    settlementPolicy: 'protocol-retained-input', request: { intent: 0, inputs, outputCurrency: tokenAddresses.CYGLD },
    inputs: structuredClone(inputs), quotedInput: '100', inputMaximum: '100', quotedOutput: '100',
    plan: { allocations: [{ kind: 1, amountIn: '100' }], conversions: { market: {
      inputCurrency: tokenAddresses.USDC, outputCurrency: tokenAddresses.CYGLD, branches,
      template: { inputCurrency: tokenAddresses.USDC, outputCurrency: tokenAddresses.CYGLD,
        routes: [{ sharePpm: 500000, steps: [{ kind: 1, currencyOut: tokenAddresses.CYGLD, fee: 3000, tickSpacing: 0 }] },
          { sharePpm: 0, steps: [{ kind: 1, currencyOut: tokenAddresses.CYGLD, fee: 3000, tickSpacing: 0 }] }] } } },
      body: { branches: [{ kind: 1, amountIn: '100', data: { feeCygld: '1' } }] } },
    fees: { coreProtocolFeeCygld: '0', coreHelpersFeeCygld: '0', marketFeeCygld: '1' },
    estimatedRecipientOutputs: [{ kind: 0, token: tokenAddresses.CYGLD, id: '0', amount: '100' }],
    estimatedRetainedInputCharges: [], recoveryShares: [],
    deployment: { helpers: config.contracts.helpers!, adapter: config.contracts.uniswapAdapter!, encoding: 'uniswap-routing-v1' },
    context: { chainId: config.chainId, blockNumber: '100', blockHash: zeroHash, observedAt: '2026-10-26T12:00:00Z' },
    retentionDisclosure: { custodian: config.contracts.helpers!, beneficiary: 'helpers-owner-at-settlement' },
    searchCoverage: { coreSharesPercent: [0, 25, 50, 75, 100], orders: ['core-first', 'market-first'],
      maxCoreInvocations: 1, maxAmmHops: 3, scope: 'selected-inventory' } };
}

function prepare(selected: EconomicQuote): PreparedTransaction {
  const economicQuote = structuredClone(selected);
  economicQuote.quotedOutput = '101';
  economicQuote.context = { ...economicQuote.context, blockNumber: '101', blockHash: '0x'+'ab'.repeat(32) };
  economicQuote.plan.body = { repricedFee: '2' };
  const conversion = economicQuote.plan.conversions.market as { branches: { amountIn: string }[] };
  conversion.branches.forEach(branch => { branch.amountIn = '49'; });
  return { strategy: selected.strategy, operation: selected.operation, routeFamily: selected.routeFamily,
    settlementPolicy: selected.settlementPolicy, inputs: structuredClone(selected.inputs), quotedInput: '100',
    inputMaximum: '100', quotedOutput: '101', outputMinimum: '99', fees: selected.fees,
    plan: { ...selected.request, inputs: structuredClone(selected.inputs), recipient: owner, deadline: '2000000000',
      minimumOutput: '99', body: '0xab' }, planDescription: {},
    estimatedRecipientOutputs: [{ kind: 0, token: tokenAddresses.CYGLD, id: '0', amount: '101' }],
    estimatedRetainedInputCharges: [], recoveryShares: [], deployment: selected.deployment,
    context: economicQuote.context, retentionDisclosure: selected.retentionDisclosure,
    searchCoverage: selected.searchCoverage, economicQuote, sender: owner };
}

const preparationObservation = (selected: EconomicQuote, prepared = prepare(selected)): QuoteObservation => ({
  path: '/api/tx-preparations', request: { quote: structuredClone(selected), sender: owner, recipient: owner, slippageBps: 100 },
  status: 200, terminal: { type: 'complete', value: prepared } });
const data = (prepared: PreparedTransaction) => encodeFunctionData({ abi: HISTORICAL_HELPERS_EXECUTION_ABI,
  functionName: 'executeExactInput', args: [exactInputPlan(prepared.plan), { authorizations: [],
    permit2: { permit: { permitted: [], nonce: 0n, deadline: 0n }, signature: '0x' } }] });

test('economic browser observations use original requests and keep unsigned preparation distinct', async () => {
  const selected = quote(), prepared = prepare(selected), calls: string[] = [];
  const scope = { location: { href: 'https://fixture.invalid/en' }, fetch: async (input: RequestInfo | URL) => {
    calls.push(String(input)); return Response.json(String(input) === '/api/economic-quotes' ? selected : prepared);
  } } as unknown as NonNullable<Parameters<typeof installQuoteObservation>[0]>;
  installQuoteObservation(scope);
  await scope.fetch('/api/economic-quotes', { method: 'POST', body: JSON.stringify(selected.request) });
  await scope.fetch('/api/tx-preparations', { method: 'POST', body: JSON.stringify({ quote: selected, sender: owner }) });
  await scope.fetch('/api/rpc', { method: 'POST', body: JSON.stringify({ method: 'eth_sendTransaction' }) });
  await new Promise(resolve => setImmediate(resolve));
  const rows = scope.__cybergoldTradeObservations!;
  assert.equal(rows.length, 2); assert.equal(calls.length, 3);
  assert.equal(browserQuoteMatcher(scenario, config, '0', [])(rows[0]), true);
  assert.equal(browserQuoteMatcher(scenario, config, '0', [])(rows[1]), false);
  assert.deepEqual(rows[0].terminal!.value, selected);
  assert.equal(uiQuoteReady(rows, scenario, config, true), true);
  assert.equal('deadline' in rows[0].request, false);
  assert.equal('minimumOutput' in selected.plan, false);
});

test('economic reporting preserves budget versus lower funding without inventing execution bounds', () => {
  const selected = quote(), result = resultFor(scenario, 'browser');
  selected.inputs[0].amount = selected.quotedInput = selected.inputMaximum = '40';
  applyEconomicQuote(result, selected, selected.request);
  assert.deepEqual(result.quoteTerms!.requestedInput, [{ asset: tokenAddresses.USDC.toLowerCase(), amount: '100' }]);
  assert.deepEqual(result.quoteTerms!.inputSpent, [{ asset: tokenAddresses.USDC.toLowerCase(), amount: '40' }]);
  assert.equal(result.bounds!.outputMinimum, undefined);
  assert.match(result.planDigest!, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('conversions'), false);
  const exceeded = structuredClone(selected); exceeded.inputs[0].amount = '101';
  assert.throws(() => applyEconomicQuote(result, exceeded, selected.request), /economic-input-budget-exceeded/);
});

test('a click captures semantic economic evidence and the original intent, without a guessed executable plan', () => {
  const selected = quote();
  let receive: ((event: Event) => void) | undefined;
  const scope = { addEventListener: (_name: string, listener: (event: Event) => void) => { receive = listener; } } as unknown as NonNullable<Parameters<typeof installSelectionCapture>[0]>;
  installSelectionCapture(scope);
  receive!({ detail: { economicQuote: selected } } as unknown as Event);
  const captured = scope.__cybergoldSelections![0];
  const evidence = captureSelection(captured);
  assert.equal(evidence.primary.selectedProvider, 'universal');
  assert.equal(evidence.primary.bounds.outputMinimum, undefined);
  assertMatrixIntent(scenario as MatrixScenario, captured, config);
  assert.throws(() => assertMatrixIntent({ ...scenario, amountRaw: '101' } as MatrixScenario, captured, config), /matrix-intent-mismatch/);
  selected.plan.allocations[0].amountIn = '999';
  assert.equal(captured.economicQuote!.plan.allocations[0].amountIn, '100');
});

test('prepared bytes bind the actual preparation to the click while allowing reprice quantities/context', async () => {
  const selected = quote(), prepared = prepare(selected), capture = { economicQuote: selected };
  const rows = [preparationObservation(selected, prepared)];
  assert.equal(observedPreparation(capture, owner, rows), prepared);
  await assertCapturedTradeInput(capture, data(prepared), owner, rows);
  await assert.rejects(assertCapturedTradeInput(capture, data(prepared), owner), /ui-preparation-not-observed/);
  const otherClick = structuredClone(rows); (otherClick[0].request.quote as EconomicQuote).context.blockNumber = '99';
  await assert.rejects(assertCapturedTradeInput(capture, data(prepared), owner, otherClick), /ui-preparation-not-observed/);
  const wrongBytes = prepare(selected); wrongBytes.plan.body = '0xcd';
  await assert.rejects(assertCapturedTradeInput(capture, data(wrongBytes), owner, rows), /ui-prepared-plan-mismatch/);
  const changedRoute = structuredClone(prepared);
  const conversion = changedRoute.economicQuote.plan.conversions.market as { template: { routes: { sharePpm: number }[] } };
  conversion.template.routes[0].sharePpm = 400000;
  await assert.rejects(assertCapturedTradeInput(capture, data(changedRoute), owner,
    [preparationObservation(selected, changedRoute)]), /ui-preparation-selected-route-mismatch/);
});

test('private fork fallback retains a semantic economic quote with no wire-plan cast', () => {
  const selected = quote(), observed = { path: '/api/economic-quotes', request: selected.request,
    status: 200, terminal: { type: 'complete', value: selected } };
  const retained = privateSandboxSelection([observed], scenario as MatrixScenario, config)!;
  assert.deepEqual(retained.economicQuote, selected);
  assert.equal(retained.universalQuote, undefined);
  retained.economicQuote!.plan.body = { changed: true };
  assert.notDeepEqual(retained.economicQuote!.plan.body, selected.plan.body);
});

test('the active API profile observes economic quotes without wallet or execution fields', async () => {
  const selected = quote(), requested: { path: string; body: Record<string, unknown> }[] = [];
  const facts = { basket: { assets: { status: 'success', value: [tokenAddresses.PAXG, tokenAddresses.XAUT] },
    targetsPpm: { status: 'success', value: ['500000', '500000'] } } } as unknown as ProtocolFacts;
  const observed = await observeScenario(scenario, config, facts, (async (path, init) => {
    requested.push({ path: String(path), body: JSON.parse(String(init?.body)) }); return Response.json(selected);
  }) as typeof fetch);
  assert.equal(observed.result.status, 'pass'); assert.equal(requested.length, 1);
  assert.equal(requested[0].path, '/api/economic-quotes');
  assert.deepEqual(requested[0].body, selected.request);
  assert.equal('recipient' in requested[0].body, false); assert.equal('slippageBps' in requested[0].body, false);
  assert.equal(observed.result.bounds!.outputMinimum, undefined);
  assert.equal('deadline' in (observed.value as EconomicQuote).plan, false);
});
