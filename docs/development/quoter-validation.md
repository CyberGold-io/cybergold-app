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

## Current local App workflow

Active scalar and basket exact-input views request wallet-free Economic Quotes
through `POST /api/economic-quotes`. Their display key contains economic inputs,
chain, deployment/configuration and fork generation. It contains no head,
recipient, execution deadline or tolerance. A successful browser observation is
retained across ordinary remounts; time, head arrival, focus and reconnect do
not trigger another quote search for that unchanged request.

The Backend's shared PostgreSQL record lets another browser/API process retrieve
the same complete historical observation, including its original block/context.
Browser memory is a display copy. Clicking **Refresh quote** sends the explicit
`refresh: true` transport flag and starts current-state search, which may replay
the saved plan as a seed. During Refresh the selected quote stays visible. A
failure is shown separately while that previous observation is retained. A late
response for another amount remains attached to that amount's query key.

The Fast Estimator's canonical interface is `POST /api/economic-estimates`, using
the existing scalar model request/packet. It is one Backend estimator; the App
does not add a competing amount formula. A matching measured quote takes
precedence over its advisory estimate. Current tolerance changes recompute only
displayed execution guards from that measured output, without searching again.

On Swap, `POST /api/tx-preparations` replays the selected semantic plan at current
state, binds the original observation's accepted guards and returns an unsigned
Helpers transaction. It does not search for a replacement route. Its existing
600-second execution lifetime starts during preparation, not browsing. Captured
Helpers/adapter binding and previously accepted maxima/minima are preserved.
The App uses the returned funding, spender and calldata for its existing
authorization/submission flow, including required post-approval Market/mixed
simulation and the pure-Core advisory estimation/batch exception. Permit
authorization expiry is independent. Deferred exact-output/historical callers
retain their identified compatibility adapters.

Quote input budgets, declared funding and conversion consumption are different
coordinates. The current search normally funds the complete budget.
`conversionObservations` records each conversion's funded input, simulated
consumption and output in its own currencies; it is not a new lower-funded
whole plan or a mined settlement receipt. Compare per-conversion and receipt
measurements in their own raw units.

The Backend retains its current first-result/detailed passes, eight scalar
configurations, five-second comparison window and first-usable extension of up
to ten seconds. The onchain Uniswap Quoter is retired from production pricing;
the SDK Bridge performs arithmetic and Universal Router remains execution
infrastructure. This document records local implementation, not deployment.

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

The concrete quote-only phase is now available through
`scripts/qualify-quoter-measurements.py`. It reuses the existing wallet qualifier's
fork/RPC/port helpers, creates a new Anvil and disposable Docker databases/APIs,
and invokes `runQuoterBenchmark` through `scripts/run-owned-quoter-benchmark.mts`.
It starts no frontend, browser, wallet or additional worker and does not build
or modify `.next`.

Run it under the same authenticated tooling wrapper as the existing owned-fork
profile, with Node 26, Foundry and Docker available:

```sh
python3 scripts/qualify-quoter-measurements.py \
  --baseline-image "$BASELINE_BACKEND_IMAGE" \
  --candidate-image "$BACKEND_IMAGE" \
  --contracts-json "$CONTRACTS_JSON" \
  --output-dir out/owned-fork/quoter-measurements
```

The wrapper supplies `MAINNET_RPC_URL` privately. The genuine inputs are that
upstream RPC, the selected baseline/candidate images and the contract fixture.
`--funding-json` is optional: a quote needs no funded wallet. USDT uses its
canonical Mainnet address when absent from that manifest; `--usdt-address`
overrides it for an explicit fixture, and decimals are read only from the owned
fork during setup. `--routing-adapter` can select the candidate's actual
configured successor when the old manifest's `helpers.uniswapAdapter` names a
legacy encoding. This quote-only phase does not qualify deployed execution
format. The quote-only phase preserves the source fork's Core pause state and
requires no Safe authority, impersonation or wallet funding. Core and Market
providers return their ordinary quotes or errors independently. Quote measurements send no
swap transaction and no public-chain transaction is sent.

The default quote-only fork uses chain ID **1** to exercise Mainnet's immutable
raw-read cache policy. Its URL is still the newly owned local Anvil. The existing
wallet-execution qualifier remains on **31338**. `--chain-id 31338` measures
Sandbox policy instead, where completed same-header raw reads are deliberately
not retained. Each report records its chain ID and image/platform scope.

C1 empties the owned database and recreates API/SDK state. C2 primes then restarts
the API while retaining database data. Warm search explicitly refreshes. Shared
reuse primes one API and observes a second process on the same database; the
baseline's legacy endpoint is recorded as search if it searches again. W3
restores the common snapshot and mines a block at a fixed timestamp: this is a
**header-only advance**, with unchanged pool reserves. Failed priming remains
visible before the measured retry. Request readiness uses the API's in-memory
`/metrics` endpoint, without benchmark-requested quote/model/configuration warm-up.
The API's existing lifespan independently schedules Helpers configuration/header
reads. That native startup work is not disabled: API/schema startup is recorded
in preparation time, while the first quote starts with a new SDK process and
empty owned pool/model/quote caches. It does not establish a completely cold
upstream node, header or connection cache. Cleanup removes only
the containers/network created by the phase and restores its fork snapshot.

The output records selected quote amounts, actual operation/source, cache/state
receipts and timings. Recognized public API failure codes/status are retained;
provider messages, credentials, calldata and wallet material are omitted. Legacy
and candidate images both mount the same read-only `owned-quoter-runtime.py`
entrypoint. It observes the existing qualified-whole-plan callbacks, providing
actual first-plan time even when the old JSON response lacked it. A stored hit
keeps those historical clocks with `producerTimingScope: stored-observation`;
its lookup time is the current client request duration.
On an unsuccessful search the same mounted fixture adds fixed request-local
clocks/counters to a private response header, leaving the public error body
unchanged. Reports retain these as `producerFailureTimings`. An actual producer
stop reason of `timeout` is counted as a timeout even when the public code remains
`quote-no-route`; an immediate no-route failure is kept separate. A search that
never produced a whole plan has no first-plan time. No process-global counter
differences or upstream error prose are used for these observations.
Upstream RPC caches and host scheduling remain uncontrolled.

After the entire paired latency cohort finishes, an optional accuracy phase runs
outside every primary request timer. For each case it restores the same snapshot
and header condition, copies only canonical inventory/pool/cursor/Helpers facts
into an isolated database, and starts a fresh secondary API. Completed quotes
and model samples are not copied. That process observes the Fast Estimator
before revealing the target's exact answer, then performs a reference search.
These are **fresh-secondary whole-trade** estimates: the predicted and selected
routes may differ, so their gap is not a same-route arithmetic error. Errors are
computed only when the estimate's own observation context matches the quote;
unknown or different contexts retain quantities without a fabricated error.
For Market estimates, route source contexts take priority over an older packet
context. All route sources must agree to identify a comparison state because the
estimator does not identify its winning route; mixed sources remain unknown.

The reference uses the existing scheduler with a **30-second initial window and
the ordinary 10-second extension**. A constant private header enables this only
inside the mounted owned fixture; production APIs/settings are unchanged. Normal
requests keep five plus ten seconds, including requests following a reference
failure. Reports retain reference output/funding, configured search coverage,
actual candidates started/completed and qualified callback updates. The result
is the best observed within that coverage, not a global optimum. Reference state
and quote writes stay in the isolated secondary database, and reference RPC work
cannot warm a later primary-latency request because the complete latency cohort
runs first.

Accuracy duration, availability, failures, whole-trade estimate error and
reference gap are separate fields. A failed accuracy request does not invalidate
a successful quote, and a successful reference does not turn a failed primary
quote into a success. Per-group summaries retain available/reference counts and
same-state mean/worst absolute estimate error in integer ppm. The resource and
instrumentation controls use disposable fake command/HTTP boundaries and actual
local budget/callback clocks; their test durations are not claimed benchmark
results. Actual baseline/candidate runs and selected-plan wallet/receipt
comparisons remain pending under WS7.4; the plumbing alone does not complete it.

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

For a shared stored-quote hit, the quote's producer metrics still describe its
original search. Record lookup request duration and stored/search source
separately; do not report those retained search metrics as a new lookup search.
The API/browser profile observers now recognize economic observations and
separately bind transaction preparation before wire-plan execution.

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
