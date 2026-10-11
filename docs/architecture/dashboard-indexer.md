---
title: Dashboard indexer architecture
doc_type: architecture
status: active
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-10-03
canonical_for: App on-chain dashboard data flow
---

# Dashboard indexer architecture

The server-side indexer reconciles canonical logs and block-pinned reads into
Postgres, keyed by chain ID. `GET /api/dashboard/onchain-summary` returns the
latest protocol state and time-bucketed issuance, redemption, supply, and
transfer activity. Connected views show an explicit unavailable or `N/A` state
rather than substituting mock values.

Ethereum Mainnet reconciliation uses the RPC `finalized` block as its pinned
anchor. The isolated chain-31338 Sandbox fork uses `latest`: Anvil's
`finalized` tag trails its head by 64 blocks, so a newly restarted fork can
otherwise remain below its own fork point with no transactions to mine the
missing blocks. The Sandbox indexer still pins each pass to a block hash and
checks it before committing; the fork-generation transition invalidates the
old fork suffix after a restart.

The dashboard polls its cached summary every 30 seconds. Both desktop and
mobile Refresh Data buttons immediately fetch that summary again. Refresh
does not initiate reconciliation or advance Mainnet finality: a confirmed swap
appears once its block is finalized and the worker publishes the corresponding
snapshot. The page shows the snapshot timestamp and explains this Mainnet
finality delay. Supply, net flow, transferred CYGLD and chart tooltips display up to
six fractional digits, so an initial supply such as `0.155517` is visible.

Backing ratio, traded CYGLD peg, and historical market-price series do not yet
have an authoritative data source. Their cards and panels explicitly remain
unavailable even after indexed history catches up. The separate CYGLD gold
reference uses the configured snapshot gold weight and a non-stale gold quote;
it is neither a traded CYGLD spot price nor a redemption guarantee. Missing
snapshot weight or gold data never falls back to a hard-coded weight or price.
Fiat conversions also require non-stale FX when the selected currency is not
USD. Governance proposal counts and timelock status remain explicitly unavailable
until a verified data source is connected to that dashboard tab.

## Recovery current state

Recovery is an asset-keyed current-state product. The indexer discovers reserve
assets from `ReserveLifecycleChanged` and recovery assets from
`RecoveryActivated`. Historical event discovery retains flagged or external-only
assets absent from the bounded `coreAttachedRecoveryAssets` list. For every
discovered asset, the snapshot reads the complete current pool and lifecycle at
one pinned block and reconciles their shared fields. It never constructs a
separate recovery identity or historical ledger.

The dashboard keeps redeemable pool liability, current live custody, and
current Active available custody separate. A failed token-balance read is
explicitly unavailable and contributes zero live custody; no stored balance
substitutes for the failed read. Raw wallet balances never substitute for
lifecycle, pool, or Core custody state.

Recovery-share ownership is materialized from canonical ERC-1155
`TransferSingle` and `TransferBatch` logs. Share IDs are derived from asset
addresses when the current pool is joined to a balance. Repeated same-asset
impairments therefore remain one fungible balance. These projections remain
available to history/dashboard consumers; they no longer supply the wallet
portfolio API.

### Indexer-free wallet portfolio

`GET /api/recovery/shares?holder=…` uses a dedicated server RPC reader, without
PostgreSQL, log replay, or an indexer worker. It captures a latest block hash,
reads `outstandingRecoveryAssets(offset,64)`, and batches repeated-wallet
`balanceOfBatch` plus pool/lifecycle/custody reads. Every state read uses that
hash with `requireCanonical=true`; canonicality is also checked before and after
each page. A returned page is explicitly incomplete until `complete=true`;
continue with `offset=nextOffset&blockHash=snapshotBlockHash`. There is no
256-position completeness ceiling. The browser only replaces its last complete
portfolio after all pages reconcile, and restarts from a new hash after failure.

Pool pages are shared across wallets. Balance caches additionally include the
holder. Both are bounded to 128 entries with a 10-second TTL, keyed by chain,
Core, block hash, schema and offset; canonicality is checked even on cache hits.
HTTP responses are `no-store`: height-only ETags or stale HTTP responses cannot
identify an Anvil reset retaining chain `31338` and the same address. Latest
snapshots are not finality guarantees. A reset/reorg invalidates continuation;
no pages from different snapshots may be spliced together.

Recovery payouts are contract previews in both modes: live capped custody while
impaired, reserved external liability after rehabilitation. Unreadable custody,
zero payout and pause are distinct states. One native-decimal share can pay at
most one underlying token. The submit path simulates the exact transaction
with minimum output and expected wallet/chain before asking for a signature;
neither a preview nor a simulation guarantees later execution. Optional Fund
failure never prevents ownership discovery. The existing 15-second refresh
retains complete data with stale/error status and never replaces every retry
with the initial-loading spinner.

## Governance Recovery Fund current state

When the Backend Governance address is configured, the indexer reads
the trusted Core, the Governance Diamond's `paused()` state, and the three-field
treasury tuple at the same pinned block. For each current recovery asset it reads
`assetRecoveryFund(asset)` and the protected
`acquiredRecoveryShares(asset)` live-inventory getter. The App uses that single
getter result for both its compatibility `governanceBalance` field and
`acquiredShares`; it does not perform a duplicate Core balance read or maintain
a second inventory ledger. The result is keyed by asset-derived share ID plus
current generation.

The App derives remaining coverage, cumulative payout, remaining commitment,
available CYGLD, and deficit from those current values. It verifies aggregate
commitment and block-pinned purchase previews before presenting an offer. There
is no fund identity, by-ID lookup, terms hash, Core proxy snapshot, or replayed
Fund ledger. A missing Governance configuration is `not-configured`; a failed
read or reconciliation is `unavailable-or-inconsistent`. Neither state is
rendered as empty or funded.

Fund-owned share redemption is submitted directly to Core. The canonical
`RecoverySharesRedeemed` Core event is indexed as the redemption outcome; there
is no Governance settlement wrapper or duplicate Governance redemption event.
New facilities have a typed CYGLD reference-value admission ceiling in the
contract. The App never compares numerical CYGLD commitment with native share
quantity (`M<=Q`) or revalidates a frozen offer against new admission anchors.
Wallet-page offers read their frozen terms and exact purchase preview at the
portfolio hash, independently of the full indexed aggregate Fund snapshot.

## Canonical synchronization and clean launch

On each relevant canonical log, the indexer refetches the complete affected
current view at that block. It rewinds the configured reorg window, removes
orphaned projections, replays canonical logs needed for discovery and ERC-1155
ownership, and writes the current snapshot atomically.

For the B2B Mainnet indexed deployment, those reconciliation requests use the
private indexer RPC gateway. The App retains its deliberate request pacing and
records every request in the reconciliation receipt, while the gateway owns
upstream selection, provider quotas, and capacity handling. The App therefore
does not impose a second total-request ceiling that could reject a valid
reconciliation before the gateway has applied its policy.

This is a clean-launch schema. An indexer-version or configured-address change
clears disposable recovery balances and current snapshots, resets the cursor to
the deployment block, and rebuilds them from canonical data. There are no
legacy recovery/fund tables, dual reads, aliases, backfill translations, or
old-ID redirects.

The fork-local Safe indexing and unauthenticated quote-cache models are not a
production trust boundary. Their production design and abuse controls remain
blocked under `APP-M13-M14-M16-M17-L03` in the Ops work register.
