---
title: Quoter validation measurements
doc_type: development-guide
status: active
owner: app-maintainer
created: 2026-10-26
last_reviewed: 2026-10-26
canonical_for: App Quoter benchmark loop and measurement report semantics
---

# Quoter validation measurements

The existing public quote, Sandbox execution and owned-local-fork profiles remain
the environment/fixture owners. `tests/trading/quoterBenchmark.ts` adds the serial
paired measurement loop; it does not reset a deployed service, start another
worker, or alter the standard 24-journey operating matrix.

`focusedUsdtCases(configuration)` supplies separate exact raw-input cases for
0.01, 0.02, 0.04, 0.06, 0.08 and 0.10 USDT. It uses configured token addresses
and decimals and performs no valuation/pool reads that would warm the measured
Backend. These are supplemental benchmark cases, not additional scheduled trades.

## Running through the owned-profile orchestrator

The qualifier supplies an ordinary local module exporting `benchmark`, with
`profile`, `cases`, `conditions`, `repetitions`, `prepare` and `measure` operations.
An optional exported `close` performs the qualifier's existing final cleanup.
Run with the project's pinned Node runtime:

```sh
node scripts/run-quoter-benchmark.mts \
  --adapter out/owned-fork/quoter-measurements.mts \
  --output out/owned-fork/quoter-measurements.json
```

The adapter is supplied by the existing owned-fork orchestration. It is not a new
network service or arbitrary browser-origin flag. It must actually reset or retain
the owned resources in `prepare(attempt)` before returning its cache/state receipt;
the runner awaits that operation before starting the request timer. There is no
default no-op reset or CLI flag that merely relabels a request as cold. Each
repetition alternates baseline/candidate order and runs serially. Raw rows and
partial checkpoints retain failures rather than hiding them in success averages.

The current foundation provides the loop and report contract. Wiring a real
owned-fork adapter and collecting fixed-state baseline/candidate evidence remains
necessary before claiming end-to-end cold/warm benchmark completion.

## Cache conditions

The receipt lists reset/preserved resources and the actual starting block/hash.

| Condition | Required operation in the owned-profile adapter |
| --- | --- |
| `application-cold` | Recreate API/SDK process and empty test-owned application data/coverage; do not reset a public or shared fork. |
| `process-cold-database-warm` | Recreate API/SDK process, retain database evidence and force a real search. |
| `warm-search` | Keep process/SDK/state and force a search instead of answering with a completed cached quote. |
| `shared-quote-hit` | Keep a completed quote and perform ordinary lookup from another client/process. |
| `warm-changed-state` | Retain dependencies, change only the owned fixture state and observe catch-up/requalification. |

Existing wallet-execution isolation continues recreating its caches per attempt.
Do not weaken those assertions for warm quote-only measurements. Upstream RPC-node
caches remain uncontrolled. Derive valuation/request amounts outside the measured
Backend; otherwise preliminary reads would contaminate an application-cold run.

## Distinct timing and accuracy coordinates

The active exact-input JSON observer retains producer `metrics` fields when
supplied: `timeToFirstWholePlanMs`, `searchMs`, `totalMs` and `selectionReason`.
These are stored as `producerTimings`, independently of client `durationMs` and
browser journey duration. Missing first-plan time stays absent; JSON arrival is
not substituted for it. The existing Ops public-runner projection currently
omits `producerTimings`; preserving that optional field is part of the remaining
profile integration. This App-local report change alone does not update deployed
runner artifacts or monitoring.

`outputError()` compares raw integer output coordinates, recording signed delta,
absolute error and signed parts-per-million error. A zero reference has an
explicit unavailable relative error, not division by zero. The same route,
starting state, amount and fee treatment must be used for estimator error. Whole
plan output against a slower search is reported separately as a reference gap;
that reference is best observed within its coverage, not a global optimum.
Economic value/gas efficiency remains in the existing `quoteQuality.ts` layer.

Reports distinguish successful `search` and `lookup` distributions and retain
timeouts/failures. Initial small repetition counts have median/min/max, not a
misleading tail-percentile claim. Adapter measurements contain only projected
public economic amounts/context and counters; no wallet material, calldata,
signatures, credentials or raw provider errors belong in them.
