"""Read-only mounted instrumentation for disposable owned quote API containers.

This entrypoint is not part of either Backend image or production API. The
constant reference header changes the existing budget only in this fixture.
"""
import argparse
import asyncio
from contextvars import ContextVar
from functools import wraps
import json
import os

from cybergold_candidate.quote_budget import QuoteBudget, budget_context, current_budget

REFERENCE_HEADER = b'x-cybergold-owned-quote-mode'
METRICS_HEADER = b'x-cybergold-owned-quote-metrics'
_reference = ContextVar('owned_quote_reference', default=False)
_active = ContextVar('owned_quote_measurement', default=None)
_http_evidence = ContextVar('owned_quote_http_evidence', default=None)


def producer_metrics(budget, state):
    """Fixed request-local clocks and counts, including unsuccessful searches."""
    times, metrics = budget.timings(), {}
    if state['first'] is not None:
        metrics['timeToFirstWholePlanMs'] = round((state['first']-budget.started)*1000, 3)
    search = [times[key] for key in ('selectionMs', 'drainedMs') if times.get(key) is not None]
    if search:
        metrics['searchMs'] = min(search)
    if times.get('terminalMs') is not None:
        metrics['totalMs'] = times['terminalMs']
    if times.get('selectionReason') is not None:
        metrics['selectionReason'] = times['selectionReason']
    metrics.update(ownedQualifiedUpdates=state['updates'], ownedCandidatesStarted=state['started'],
                   ownedCandidatesCompleted=state['completed'])
    return metrics


def install_producer_observation(service, reference_seconds=30):
    """Measure actual completed-plan callbacks on both old and new services."""
    for name in ('get', 'quote'):
        original = getattr(service, name, None)
        if original is None:
            continue

        def decorate(method):
            @wraps(method)
            async def observed(request, on_update=None, **kwargs):
                if _active.get() is not None:
                    return await method(request, on_update, **kwargs)
                budget = current_budget() or (QuoteBudget(initial=reference_seconds) if _reference.get() else QuoteBudget())
                state = {'first': None, 'updates': 0, 'started': 0, 'completed': 0}
                token = _active.set(state)
                async def publish(frame):
                    if frame.get('type') == 'qualified' and not frame.get('value', {}).get('readOnly'):
                        state['updates'] += 1
                        if state['first'] is None:
                            state['first'] = asyncio.get_running_loop().time()
                    if on_update is not None:
                        await on_update(frame)
                try:
                    with budget_context(budget):
                        result = await method(request, publish, **kwargs)
                    metrics = dict(result.get('metrics', {}))
                    metrics.pop('timeToFirstWholePlanMs', None)
                    metrics.update(producer_metrics(budget, state))
                    return {**result, 'metrics': metrics}
                except BaseException:
                    evidence = _http_evidence.get()
                    if evidence is not None:
                        evidence.update(producer_metrics(budget, state))
                    raise
                finally:
                    _active.reset(token)
            return observed
        setattr(service, name, decorate(original))

    candidate = getattr(service, 'candidate', None)
    if candidate is not None:
        @wraps(candidate)
        async def completed(*args, **kwargs):
            state = _active.get()
            if state is not None:
                state['started'] += 1
            result = await candidate(*args, **kwargs)
            if state is not None:
                state['completed'] += 1
            return result
        service.candidate = completed


class OwnedQuoteMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        reference = any(key.lower() == REFERENCE_HEADER and value == b'reference'
                        for key, value in scope.get('headers', []))
        token = _reference.set(reference)
        evidence = {}
        evidence_token = _http_evidence.set(evidence)
        async def observed_send(message):
            if message['type'] == 'http.response.start' and message['status'] >= 400 and evidence:
                message = {**message, 'headers': [*message.get('headers', []),
                    (METRICS_HEADER, json.dumps(evidence, separators=(',', ':')).encode('ascii'))]}
            await send(message)
        try:
            return await self.app(scope, receive, observed_send)
        finally:
            _http_evidence.reset(evidence_token)
            _reference.reset(token)


async def copy_canonical_facts(target_database):
    """Copy only reusable facts; completed quotes and sample namespaces stay out."""
    from psycopg.conninfo import conninfo_to_dict, make_conninfo
    from psycopg.errors import UndefinedTable
    from cybergold_candidate.database import Database
    from cybergold_candidate.uniswap_state import UniswapStore
    parameters = conninfo_to_dict(os.environ['DATABASE_URL'])
    source = Database(os.environ['DATABASE_URL'])
    target = Database(make_conninfo(**{**parameters, 'dbname': target_database}))
    try:
        store = UniswapStore(target, int(os.environ['NEXT_PUBLIC_CHAIN_ID']), os.environ['NEXT_PUBLIC_CORE_DIAMOND_ADDRESS'])
        await store.prepare()
        try:
            async with source.connection() as connection:
                cursor = await connection.execute('SELECT chain_id,core_address,namespace,identity,payload FROM cybergold_uniswap_state')
                rows = await cursor.fetchall()
        except UndefinedTable:
            rows = []  # Ordinary cache miss; the secondary can acquire facts.
        import json
        async with target.connection() as connection:
            async with connection.transaction():
                for row in rows:
                    if row['namespace'].rsplit(':', 1)[-1] in ('inventory', 'observation', 'cursor', 'helpers-configuration'):
                        await connection.execute('INSERT INTO cybergold_uniswap_state VALUES (%s,%s,%s,%s,%s::jsonb)',
                            (row['chain_id'], row['core_address'], row['namespace'], row['identity'], json.dumps(row['payload'])))
    finally:
        await source.close()
        await target.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference-seconds', type=float, default=30)
    parser.add_argument('--copy-canonical-facts')
    args = parser.parse_args()
    if args.copy_canonical_facts is not None:
        asyncio.run(copy_canonical_facts(args.copy_canonical_facts))
        return
    from cybergold_candidate import runtime
    from cybergold_candidate.serve import run
    from cybergold_candidate.telemetry import configure_logging
    create_app = runtime.create_app
    def observed_app(**kwargs):
        install_producer_observation(kwargs['universal_quotes'], args.reference_seconds)
        return create_app(**kwargs)
    runtime.create_app = observed_app
    configure_logging()
    app = runtime.create_configured_app()
    run(OwnedQuoteMiddleware(app), host=os.environ.get('HOST', '127.0.0.1'), port=int(os.environ.get('PORT', '3000')))


if __name__ == '__main__':
    main()
