---
title: App runtime profiles
doc_type: development-guide
status: active
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-09-20
canonical_for: App environment and startup modes
---

# App runtime profiles

Following the repository split, the frontend consumes public `NEXT_PUBLIC_*`
settings and `CYBERGOLD_BACKEND_URL` only. The database, RPC, Safe and indexer
configuration described below belongs to `cybergold-backend`. Internal worker
requests go to its private worker listener, not the public Next.js server.
Ops is adapting its existing container profiles under Plan E; the owner-run
installation handoff remains the authority for when a server has adopted the
split. Existing installed combined App releases continue using their saved
configuration until that cutover.

The active `.env.local` is generated. Runtime-profile definitions and lifecycle
automation are owned by `cybergold-ops`, including RPC and Safe Transaction
Service connections, database provisioning, indexer scheduling, container startup,
and chain and bytecode preflight checks. The App repository consumes the
generated environment and intentionally does not define a remote-development
profile or SSH-tunnel lifecycle.

Use `scripts/run-local-dapp.sh [MODE]` from `cybergold-ops` for supported local
instances. Use the corresponding Ops-owned deployment command and runbook for a
server instance. Profile and command names state where the App runs and which
chain source it uses; do not infer topology from a generic "remote" label.

The dashboard keys rows by `chain_id`, so profiles using different chain IDs do
not collide. Use a separate `DATABASE_URL` when physical database isolation is
needed, including independent forks that deliberately share a chain ID.
`SKIP_RPC_VALIDATION=1` is an offline-development escape hatch and must not be
used as release evidence.

Environment names and generated values are owned by the Ops env catalog and
validated at the App boundary by `npm run validate:env`. Secrets belong only in
ignored operator files.

## On-chain indexer worker

Public dashboard, indexed Recovery Fund, and Safe-event requests read bounded
persisted models only. They never reconcile logs or call RPC. Recovery wallet
discovery is now the separate bounded RPC path described below. A trusted
scheduler must instead send `POST /api/internal/onchain-indexer/reconcile` with
`Authorization: Bearer <ONCHAIN_INDEXER_WORKER_TOKEN>`. The token is a
server-only secret of at least 32 bytes; an absent or shorter token disables the
worker endpoint. Keep the endpoint behind the deployment's private scheduler or
service network even though bearer authentication is still mandatory.

### Recovery wallet discovery configuration

The recovery portfolio requires `RPC_URL`, `NEXT_PUBLIC_CHAIN_ID`, and
the Backend configured Core address matching a Core with the immediate-recovery
ABI. It forwards the server-only `RPC_AUTHORIZATION` value to `RPC_URL`,
independently of the indexer transport and its lease. Neither `DATABASE_URL` nor
`ONCHAIN_INDEXER_*` is required for this API. An optional
Backend Governance address enables Fund offers independently.
Do not copy credentials into any `NEXT_PUBLIC_*` variable.

`RECOVERY_PORTFOLIO_MODE` defaults to `rpc`. An explicit `not-configured` value
is allowed only under non-production Node environments, displays an honest
development-profile notice, and does not assert absence of shares. Production
rejects that value; missing/invalid RPC/Core configuration returns HTTP 503.
This setting neither hides the component globally nor weakens production
discovery failures. Profile generation remains Ops-owned.

The Network response is HTTP 200 with `status=ready`, one block number/hash,
`complete` and `nextOffset`. A complete empty balance list proves no positions
at that snapshot only. Continuations must retain `blockHash`; invalid parameters
return 400. RPC/ABI/read inconsistencies return 503 with a sanitized error;
upstream HTTP 429 retains sanitized backpressure and `Retry-After` timing.
The deliberate development opt-out returns
200 with `status=not-configured`, `enabled=false`, `complete=false`.
All pages are `no-store` at HTTP level; bounded 10-second server caches remain
behind block canonicality checks. See the dashboard architecture document for
hash-pinned pagination and Anvil reset behavior.

Schedule one call at the desired refresh cadence. Concurrent calls are rejected
by a shared database advisory lock, so multiple App instances cannot start the
same reconciliation pass. A successful call updates the block-keyed recovery
portfolio and dashboard models atomically with recovery-share balances. Safe
events use the same worker and an explicit configured Safe-address allowlist.

The archive-free finalized reconciliation path is separately opt-in with
`ONCHAIN_INDEXER_ARCHIVE_FREE_FINALIZED_MODE=1`; it remains off when the value
is absent. On chain ID `1`, this mode also requires an explicit nonzero
`ONCHAIN_INDEXER_START_BLOCK` and never probes historical bytecode to discover
deployment. Its default in-process cadence is 60 seconds and can be overridden
with `ONCHAIN_INDEXER_RECONCILE_INTERVAL_MS`. Normal scheduler calls honor that
cadence; an authenticated operator can use `?force=1` for an immediate manual
pass. Address-scoped raw journaling is an independent, off-by-default switch,
`ONCHAIN_INDEXER_ADDRESS_SCOPED_RAW_LOGS=1`. Ops must not enable either switch
until its deployment profile and rollback/canary procedure explicitly support
them. In that path, each configured Core, Governance, or Safe chunk is one
planned `eth_getLogs` request. A failed range is split deterministically until
it succeeds only when the private gateway returns its exact authenticated HTTP
413 range-reduction contract, or when direct-provider mode exposes one of the
narrowly recognized response-size status/error codes. Rate limits, auth or
chain errors, lease loss, timeouts, malformed responses, and generic transport
failures are terminal and never trigger a split storm. A one-block failure is
terminal. Raw-log transports disable
automatic retries so application-observed base and adaptive attempts remain
separately accountable.

Restored raw evidence is consumed only when the independent
`ONCHAIN_INDEXER_RAW_JOURNAL_REPLAY_ENABLED=1` switch is enabled. Replay
requires address-scoped archive-free finalized mode and one contiguous,
block-hash-verified interval beginning at the configured Core, Governance, or
Safe recovery start. Unknown topics remain in `onchain_raw_logs`; only known
topics enter the disposable projections. A restored interval that starts after
the configured recovery start is non-authoritative and fails closed until an
operator resets its coverage metadata and performs a complete provider
backfill. The App never fills only the provider tail and calls that interval
complete.

`ONCHAIN_INDEXER_RECOVERY_SHARE_V2_ENABLED=1` selects the additive,
checkpointed `onchain_recovery_share_balances_v2` read model. It replays the
local indexed transfer tail when its prior block hash and profile remain
canonical, and performs a bounded local rebuild on identity drift. The retained
rollback image still reads the legacy balance table, so the new image continues
its full lifetime replay and 100,000-log ceiling during coexistence. That cost
and ceiling can be retired only after rollback compatibility is formally
closed.

`ONCHAIN_INDEXER_FINALIZED_MULTICALL_ENABLED=1` batches compatible finalized
snapshot `readContract` calls through canonical Multicall3. Each call and batch
remains bound to the captured block hash with `requireCanonical=true`; call
count, total and per-batch calldata are bounded, and one wrapper instance may
issue at most 32 provider `eth_call` requests across all sequential flushes.
Exhausting any Multicall budget is a terminal reconciliation failure; optional
snapshot readers cannot convert it into a partial/null accepted receipt.
`allowFailure=true` preserves each individual call's prior semantic result.
Other RPC families are not folded into these batches. Both switches remain off
by default.

The Mainnet backend has one ordinary private broker URL for server-side
Ethereum JSON-RPC: `http://rpc-broker:19546`, at `POST /`. Its indexer uses
`ONCHAIN_INDEXER_RPC_URL` with `ONCHAIN_INDEXER_RPC_AUTHORIZATION`; API serving
uses private `RPC_URL` / `RPC_AUTHORIZATION`. The Sandbox backend uses its
configured fork transport. No RPC, DB or worker credential is configured in
the frontend.

Current App and Wagmi reads use fixed same-origin operations; Next.js adds its
remote backend bearer privately when configured. `NEXT_PUBLIC_RPC_URL` is no
longer consumed. `NEXT_PUBLIC_WALLET_RPC_URL` supplies wallet network metadata;
public Mainnet/fork RPC hosts remain available. Wallet control, signing and
submission remain browser-owned. The backend does not encode broker supplier
policy; credentials, pacing, retry and failover remain with the broker.

Local environment validation uses the fixed App chain API by
default. An explicit tooling-only `RPC_VALIDATION_URL` / `RPC_AUTHORIZATION`
retains its direct JSON-RPC behavior, independently of frontend runtime reads.

The authenticated controller POST uses the exact request keys `kind`,
`formatVersion`, and `mode`. The modes are `allow-exact-receipt-noop` for the
active periodic slot and `require-worker-run` for a candidate canary. A
candidate always invokes the worker; the active slot may return
`deferred-cadence` when a completed result is still within the configured
interval. Empty legacy POST bodies remain temporarily accepted for installed
pre-versioned controllers.

Each bounded pass uses the configured endpoint and reports dashboard history
progress in the versioned response: dashboard start block, indexed-through
block and date, finalized network block and date, and percentage. Progress is
reported after the pass, not presented as a false live stream. The current
Mainnet and Sandbox profiles use a 30-second reconcile interval, 500 blocks per
Dashboard/Safe pass, and a 2,000-block Safe event request bound.

The current App has retired `/api/rpc`; older open tabs must reload. Retained
frontend images keep their own adapter, and their backend contract retains
read-only JSON-RPC validation. Current fixed-API clients use the private backend
through Next.js. Public wallet RPC hosts remain available. An unavailable
supplier returns the existing controlled failure.

After a successful partial catch-up lease is released, one database transaction
advances the committed Core and per-Safe scan checkpoints; the next lease starts
there even though no acceptance receipt exists yet. A failed pass cannot advance
those checkpoints. The reconciliation POST reports such a successful bounded but
partial pass as `incomplete` with HTTP `202`; it reports `reconciled` with HTTP
`200` only after the captured anchor is complete. Accepted periodic cadence
deferral also uses HTTP `200`, while lock contention reports `busy` with HTTP
`409`. Legacy responses remain the exact `{ "status": ... }` body; versioned
v2 responses preserve the same status and add `dashboardHistoryProgress` when
the App has completed a bounded finalized-history pass. Only a pass that reaches and
snapshots the captured anchor,
then releases successfully, atomically publishes the versioned `partial=false`
receipt. An authenticated `GET /api/internal/onchain-indexer/reconcile` returns
that receipt and otherwise returns `503`, including while a lease is active or
after a successful partial checkpoint. The receipt binds the runtime-config and
gateway revisions, reconciliation and finalized-anchor identities, raw,
Dashboard, state-snapshot, and every Safe cursor/count/version, request counters,
and completion time. It never contains the client or lease token. If release is
ambiguous, health stays unavailable through the lease's advertised expiry; a
successful later run can recover sooner. The v3 Ops controller must additionally
reject a null runtime-config ID and enforce its deployment-specific maximum
receipt age and finalized-anchor lag before treating this receipt endpoint as
healthy.

Receipt format v2 accounts at the App transport boundary for every worker RPC
attempt, including failures and adaptive range re-requests. Its strict
`rpcRequests` object contains `totalAttempts`, `failedAttempts`,
`adaptiveRetryAttempts`, exact `byMethod` counters for `eth_call`,
`eth_chainId`, `eth_getBlockByHash`, `eth_getBlockByNumber`, `eth_getCode`, and
`eth_getLogs`, plus the retained planned/actual/failure/source detail under
`ethGetLogs`. The transport is unbatched, has zero Viem retries, and fails
before sending an unlisted method or a 73rd worker attempt. Therefore any
completed v2 receipt is bounded to 72 worker attempts; a budget failure cannot
publish a receipt or advance the committed Core/Safe lease checkpoint. The v2
receipt uses the new
`completed_reconciliation_receipt_v2` state key. The former v1 key is left
untouched for rollback coexistence but is neither parsed nor accepted as v2
evidence. No gateway-enabled v1 image has been admitted or published: the
first feature-to-`dev` image that can enable this gateway contract must carry
v2, while the retained pre-feature slots remain on the gateway-disabled legacy
reconcile path.

Raw-journal and working projection rows are intentionally provisional during a
lease. They are not rolled back wholesale on failure. Only the committed Core
and per-Safe boundaries and the complete receipt are acceptance state: a later
lease plans from the last committed boundary and idempotently replaces/replays
any provisional overlap. Operational plans must describe this replay guarantee,
not promise a database-wide transaction rollback.

The generated runtime profile must set `ONCHAIN_INDEXER_MAX_BLOCKS_PER_RUN`,
`ONCHAIN_INDEXER_CHUNK_SIZE`, `ONCHAIN_INDEXER_REORG_WINDOW`,
`SAFE_EVENT_INDEXER_MAX_BLOCKS_PER_RUN`, `SAFE_EVENT_INDEXER_CHUNK_BLOCKS`, and
`SAFE_EVENT_INDEXER_REORG_WINDOW` within the source-enforced ceilings. Public
recovery and Safe reads additionally apply shared database rate, concurrency,
timeout, body-size, hash-count, and cardinality limits. A worker failure leaves
the previous complete snapshot readable; it never exposes a partially rebuilt
model.
