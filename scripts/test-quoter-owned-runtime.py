"""Actual callback clocks/budget scopes in the mounted owned-only entrypoint."""
import asyncio
from contextlib import asynccontextmanager
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from cybergold_candidate.quote_budget import QuoteBudget, SearchStopped, budget_context, budget_entry, current_budget
from cybergold_candidate.quote_errors import QuoteFailure, public_quote_error
from psycopg.errors import UndefinedTable

spec = importlib.util.spec_from_file_location('owned_runtime_fixture', Path(__file__).with_name('owned-quoter-runtime.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class LegacyProducer:
    """The baseline get/on_update contract using its real QuoteBudget class."""
    def __init__(self):
        self.windows = []

    async def candidate(self):
        await asyncio.sleep(0)
        return {'quotedOutput': '100', 'privatePlan': 'not timing evidence'}

    @budget_entry
    async def get(self, request, on_update=None):
        budget = current_budget()
        self.windows.append((budget.initial-budget.started, budget.deadline-budget.initial))
        async def produce():
            value = await self.candidate()
            budget.qualified()
            if on_update:
                await on_update({'type': 'qualified', 'value': value})
            await asyncio.sleep(0)
            budget.cleanup_done()
            budget.canonical_done()
            return {**value, 'metrics': {'firstQualifiedMs': 999999}}
        return await budget.produce(produce())


class OwnedRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_baseline_callback_clock_is_measured_not_inferred_from_json_or_old_alias(self):
        service, callbacks = LegacyProducer(), []
        fixture.install_producer_observation(service)
        async def completed(frame):
            budget = current_budget()
            callbacks.append((asyncio.get_running_loop().time()-budget.started)*1000)
        result = await service.get({}, completed)
        times = result['metrics']
        self.assertAlmostEqual(times['timeToFirstWholePlanMs'], callbacks[0], delta=1)
        self.assertLess(times['timeToFirstWholePlanMs'], times['firstQualifiedMs'])
        self.assertLessEqual(times['timeToFirstWholePlanMs'], times['searchMs'])
        self.assertLessEqual(times['searchMs'], times['totalMs'])
        self.assertEqual(times['ownedCandidatesStarted'], 1)
        self.assertEqual(times['ownedCandidatesCompleted'], 1)
        self.assertEqual(times['ownedQualifiedUpdates'], 1)
        self.assertEqual(service.windows, [(5, 10)])

    async def test_new_quote_alias_uses_same_instrumentation_once(self):
        class NewerProducer(LegacyProducer):
            quote = LegacyProducer.get
        service = NewerProducer()
        fixture.install_producer_observation(service)
        result = await service.quote({})
        self.assertEqual(result['metrics']['ownedQualifiedUpdates'], 1)
        self.assertEqual(result['metrics']['ownedCandidatesCompleted'], 1)
        self.assertEqual(service.windows, [(5, 10)])

    async def test_reference_header_changes_only_owned_request_and_restores_normal_budget(self):
        service = LegacyProducer()
        fixture.install_producer_observation(service, reference_seconds=30)
        async def app(scope, _receive, _send):
            await service.get({})
            if scope.get('fail'):
                raise RuntimeError('controlled failure after reference')
        middleware = fixture.OwnedQuoteMiddleware(app)
        async def ignored(*_):
            pass
        reference = {'type': 'http', 'headers': [(fixture.REFERENCE_HEADER, b'reference')]}
        await middleware(reference, ignored, ignored)
        await middleware({'type': 'http', 'headers': []}, ignored, ignored)
        with self.assertRaises(RuntimeError):
            await middleware({**reference, 'fail': True}, ignored, ignored)
        await middleware({'type': 'http', 'headers': []}, ignored, ignored)
        self.assertEqual(service.windows, [(30, 10), (5, 10), (30, 10), (5, 10)])
        self.assertIsNone(current_budget())
        self.assertFalse(fixture._reference.get())

    async def test_accuracy_copy_contains_canonical_facts_and_no_quote_or_model_samples(self):
        await self.copy_control(missing=False)

    async def test_simultaneous_reference_and_normal_requests_keep_their_own_budgets(self):
        service = LegacyProducer()
        fixture.install_producer_observation(service)
        async def app(_scope, _receive, _send):
            await service.get({})
        middleware = fixture.OwnedQuoteMiddleware(app)
        async def ignored(*_):
            pass
        await asyncio.gather(
            middleware({'type': 'http', 'headers': [(fixture.REFERENCE_HEADER, b'reference')]}, ignored, ignored),
            middleware({'type': 'http', 'headers': []}, ignored, ignored))
        self.assertEqual(sorted(service.windows), [(5, 10), (30, 10)])
        self.assertIsNone(current_budget())
        self.assertFalse(fixture._reference.get())

    async def test_missing_source_cache_is_an_ordinary_empty_copy(self):
        await self.copy_control(missing=True)

    async def test_failure_clocks_distinguish_budget_timeout_from_immediate_no_route_without_private_data(self):
        class FailedProducer:
            @budget_entry
            async def get(self, request, on_update=None):
                budget = current_budget()
                async def produce():
                    if request['timeout']:
                        try:
                            await budget.discovery(asyncio.sleep(1))
                        except SearchStopped:
                            pass  # The real public route failure can remain quote-no-route.
                    error = QuoteFailure('quote-no-route')
                    error.provider_material = 'Bearer private-provider-calldata-signature'
                    raise error
                return await budget.produce(produce())
        service = FailedProducer()
        fixture.install_producer_observation(service)
        async def app(scope, _receive, send):
            try:
                await service.get(scope)
            except QuoteFailure as error:
                body = json.dumps(public_quote_error(error)).encode()
                await send({'type': 'http.response.start', 'status': 503,
                            'headers': [(b'content-length', str(len(body)).encode())]})
                await send({'type': 'http.response.body', 'body': body})
        middleware = fixture.OwnedQuoteMiddleware(app)
        async def request(timeout):
            messages = []
            async def send(message):
                messages.append(message)
            async def ignored():
                pass
            with budget_context(QuoteBudget(initial=.002, extension=.002)):
                await middleware({'type': 'http', 'headers': [], 'timeout': timeout}, ignored, send)
            head, body = messages
            self.assertEqual(json.loads(body['body'])['code'], 'quote-no-route')
            self.assertEqual(int(dict(head['headers'])[b'content-length']), len(body['body']))
            evidence = json.loads(dict(head['headers'])[fixture.METRICS_HEADER])
            self.assertNotIn('private-provider', str(messages))
            self.assertNotIn('timeToFirstWholePlanMs', evidence)
            self.assertEqual(evidence['ownedQualifiedUpdates'], 0)
            self.assertEqual(evidence['ownedCandidatesCompleted'], 0)
            self.assertGreaterEqual(evidence['totalMs'], 0)
            return evidence
        timeout, no_route = await asyncio.gather(request(True), request(False))
        self.assertEqual(timeout['selectionReason'], 'timeout')
        self.assertGreaterEqual(timeout['totalMs'], timeout['searchMs'])
        self.assertNotIn('selectionReason', no_route)
        self.assertIsNone(fixture._http_evidence.get())

    async def copy_control(self, *, missing):
        databases, prepared = [], []
        rows = [{'chain_id': 1, 'core_address': '0x'+'1'*40, 'namespace': namespace,
                 'identity': namespace, 'payload': {'fact': namespace}}
                for namespace in ('inventory', 'observation', 'cursor', 'helpers-configuration',
                                  'generation:fixture:observation', 'economic-quotes', 'market-model-samples')]
        class Connection:
            def __init__(self, database):
                self.database = database
            async def execute(self, sql, params=None):
                self.database.operations.append((sql, params))
                if sql.startswith('SELECT') and missing:
                    raise UndefinedTable('No optional cache table')
                return self
            async def fetchall(self):
                return rows
            @asynccontextmanager
            async def transaction(self):
                yield
        class Database:
            def __init__(self, url):
                self.operations = []
                self.closed = False
                databases.append(self)
            @asynccontextmanager
            async def connection(self):
                yield Connection(self)
            async def close(self):
                self.closed = True
        class Store:
            def __init__(self, database, chain, core):
                pass
            async def prepare(self):
                prepared.append(True)
        with patch('cybergold_candidate.database.Database', Database), \
                patch('cybergold_candidate.uniswap_state.UniswapStore', Store), \
                patch.dict(os.environ, {'DATABASE_URL': 'postgresql://fixture@pg/source',
                    'NEXT_PUBLIC_CHAIN_ID': '1', 'NEXT_PUBLIC_CORE_DIAMOND_ADDRESS': '0x'+'1'*40}):
            await fixture.copy_canonical_facts('owned_accuracy')
        self.assertTrue(all(database.closed for database in databases))
        self.assertEqual(len(prepared), 1)
        source, target = databases
        self.assertTrue(all(sql.startswith('SELECT') for sql, _ in source.operations))
        copied = [params[2] for _, params in target.operations]
        self.assertEqual(copied, [] if missing else [row['namespace'] for row in rows[:5]])


if __name__ == '__main__':
    unittest.main()
