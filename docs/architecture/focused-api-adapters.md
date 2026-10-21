---
title: Focused API adapter release
doc_type: architecture
status: active
owner: app-maintainer
created: 2026-10-01
last_reviewed: 2026-10-11
canonical_for: Focused API frontend capability before consumer deployment
---

# Focused API adapters

The fixed `GET /api/governance/helpers-facts` route serves Helpers fee, Permit2,
wrapped native token, owner, approved adapters and pause state from the configured
backend contract at one canonical block. Additive adapter publication precedes
consumer migration in both environments. The governance controller, navigation/role
owner and pause displays, passive Permit2 address and adapter-approval hooks share TanStack Query with existing
freshness settings and fork-generation cleanup. A failed allowlist stays unknown;
approval membership uses the same EnumerableSet as the pinned Helpers getter.
The existing action form still requires an observed boolean before encoding a
transaction. Signing, submission and pre-signing Permit2 verification remain
in their existing flows. This migration adds no generic target/provider interface.

The additive `GET /api/account/wallet-balances` adapter uses the installed
backend's fixed token/native-balance operation and generated HTTP contract.
The private Next.js server holds its credential. Its earlier separate adapter
release precedes the wallet hook in both environments, so retained frontend
images continue serving requests from newer browser tabs. The hook now shares
a five-second TanStack Query keyed by holder, chain, Core and fork generation.
Known zero and wide integer amounts are preserved. Failed reads remain
unavailable; an unavailable total is not displayed as zero. Account changes
switch queries, and existing fork cleanup cancels/removes old observations.
There is no ERC20 balance RPC fallback. RainbowKit's separate native balance,
ENS and receipt consumers remain in the migration inventory. Three Chromium
cases cover the normal/partial/outage modal and account changes; canonical
unit cases cover precision, query sharing and generation invalidation.

The five-second balance setting is a freshness threshold, not polling. The sell
token picker shows a spinner while its wallet-only choices initially load;
settled failures and cached background refreshes do not keep that spinner active.
Public display fallbacks survive reloads separately from live configuration:
`displayTokens` restores only selector metadata, while operation addresses,
token inputs and trading identity continue to come from the live configuration
query. Gold and FX hooks restore parsed observations as SWR fallback data after
hydration, retain their original acquisition age and stale status, and perform
the existing Backend refresh. Stale supplier fallbacks still render normally
and do not replace the persistent fresh observation. Wallet state, executable quotes, pause/cap/fee
facts and deployment roots are excluded from this persistent display cache.
Ordinary wallet and native reads send `purpose=display`, select one latest block and retain canonical
hash pinning for each asset, without repeating the chain check or rereading the
block afterward. Swap submission sends `purpose=swap-preflight` on its fresh
wallet read to retain those existing checks before checking the spending assets.
Unmarked requests from retained App versions and open tabs keep the backend's
existing checks. Retained backends ignore either marker, so both rollout orders
preserve those earlier consumers.

The additive `/api/governance/core-facts` adapter serves Core treasury, basket
hash, fees, supply limits and Safe authority using generated backend types. It is published to
both environments before the controller hook moves, preserving the route for
newer tabs during a retained frontend rollback. The private Next.js server
holds the backend bearer; the browser receives lossless amounts and per-field
failures. The controller and Core Safe-authority discovery now share a 30-second
TanStack Query keyed by chain, Core and fork generation over this fixed route.
It restores the existing bigint/optional-field configuration shape and retains
request cancellation. An API outage remains unavailable, without retrying the
eight reads through browser RPC. A missing or failed optional Safe field remains
unavailable; a known zero address retains the original authority normalization.
Safe bytecode, owners/threshold probes, nonce, signing and submission remain
in their owning preparation/library slices. Separately configured Staking and
Governance diamond Safe authorities keep their original target reads until
their corresponding focused API slice lands. A Core outage does not select
those reads or substitute another authority.

The four basket preview hooks now use the fixed
`POST /api/quotes/basket-preview` adapter. Its generated mode-specific contract
preserves raw decimal integer amounts, asset order and fees; the hook restores
the existing bigint result shapes. TanStack Query retains two-second freshness,
five-second polling and request cancellation. The Next.js server holds the
backend credential. A failed quote stays unavailable; it is not retried through
generic browser RPC. Wallet signing and submission are unchanged.

Canonical frontend checks and two Chromium cases qualify all four modes and
the unavailable-quote display. Backend source, native image and installed
capability evidence are recorded in the Ops workplan. A Sandbox with no CYGLD
supply can legitimately reject redemptions with Core `InsufficientSupply`;
the API does not fabricate a quote for that state.

## Safe principal adapter capability

The fixed `GET /api/governance/safe-principal?address=0x…` adapter forwards
principal observations using the private Next.js backend credential. Generated
contracts preserve bytecode, owners, a raw decimal threshold, per-field failures
and canonical block context. It accepts no browser bearer and adds no signing
or authority interpretation. Publish this capability to both environments before
moving the existing Safe-principal consumers, so retained frontend images serve
the route for newer browser tabs. A transport failure remains unavailable.

## Earlier additive adapter release

This release adds fixed `/api/protocol/facts` and `/api/pools/snapshot` routes
without moving the existing UI consumers. Both use the private Next.js backend
client and forward no browser bearer. The generated HTTP types are additive;
the pool backend capability follows separately under H27.

Publish this unchanged adapter tree to Sandbox and Mainnet before publishing
the focused UI consumers. The retained frontend then serves these routes when
a browser tab loaded from the later UI remains open through rollback. The
backend capabilities are installed before their respective consumer releases.
The Ops H25 handoff records these ordinary branch-mapped releases; no custom
router, approval gate or browser credential is introduced.

The dependency patches from the already-qualified facts branch are included:
Next.js 16.3.8, Axios 1.20.0 and Hono 4.13.7. Existing browser reads, quote math,
wallet submission and public RPC hosts remain in use in this adapter release.
Static/build/unit checks and the existing browser suite qualify the old UI
with the additive routes. Source qualification is distinct from installation.

The basket warning also distinguishes individual failed Multicall reads from a
successful empty basket. Transport failures offer retry wording and do not tell
the user that the configured Core is missing. No RPC operation or transaction
policy changes.

### Safe principal browser consumers

Governance authority discovery and role-member Safe detection share the fixed
Safe principal API query by configured chain, principal address and fork
generation. Each field selector retains independent loading/error behavior;
known empty code remains an EOA, while unavailable code cannot become an EOA.
Authority compatibility, role membership and existing freshness are unchanged.
Other diamond discovery, Safe nonce/simulation and signing remain separate
operations. There is no passive code/owners/threshold browser RPC fallback.

## Token valuations from authoritative pools

Swap and the wallet balance modal derive USD estimates from
`POST /api/pools/snapshot`. The four configured V3 price bridges retain their
historical request bodies and shared five-second TanStack queries. The Backend
`GET /api/pools/catalog` adds known V2/V3/V4 pool identities from its existing
monthly inventory. Catalog reads use an ordinary shared query without a client
poller; catalog and snapshot queries are canceled/removed by the existing fork
reset. Catalog V2/V3 addresses avoid a second factory lookup. V4 query/cache
keys include PoolManager, PoolId/full PoolKey, spacing and hooks, so same-fee
pools remain distinct.

Prices propagate by token address rather than snapshot-array position. The
existing USDC and gold-reference anchors, token decimals, integer square-root
conversion and basket weights remain; canonical raw marginal ratios also
price V2/V4 pools. A V4 snapshot exposes active liquidity, price, LP/protocol
fees and tick/bitmap coverage. Its manager's global ERC20 balances do not
establish pool reserves or TVL, so those balances remain unknown. Missing
catalog/state leaves existing prices or ordinary unknown values available;
there is no browser RPC fallback or browser swap engine. Core/NAV reference
valuation, wallet control, signing and submission retain their existing policy.

Legacy pool-cache client types derive from the canonical Backend schemas and
preserve generic identity/state fields. An explicit adapter selects Backend
route search and retains typed V2/V3/V4 plans; existing V3 callback callers keep
their prior behavior. SDK swap arithmetic and best-route qualification remain
Backend responsibilities.

Faucet failures carry a stable `code` and a `correlationId` matching the Backend
error log. The wallet panel translates the code into quota, unavailable service,
in-progress, conflict or unconfirmed-funding feedback. A timeout or malformed
reply does not establish that no funds arrived. The reference stays selectable
and copyable inside the wallet panel, including its mobile modal. The fixed App
adapter passes Backend response bytes and existing retry/request-ID headers
through; its own transport failures return a safe code and correlated log.
Retained Backend responses without these optional details use status-based
feedback, with generic conflicts treated as unconfirmed outcomes. Funding
request identity retains its existing semantics and is separate from the error
reference. Focused unit and browser cases cover these failure boundaries.

The native token-permit candidate adds fixed `/api/tokens/metadata`,
`/api/account/token-permit` and `/api/transaction/token-approval-gas` adapters.
Callers supply concrete token/holder/amount data; provider and method selection
remain on the Backend. Metadata includes per-field failures and network/address
identity. Fresh permit context includes owner nonce, Helpers allowance and an
optional qualified standard domain. An opt-in
`/api/governance/helpers-facts?tokenPermitIssuance=true` request reports whether
the issuance selector is installed through the existing router-facts boundary.
The optional `basketPermitIssuance=true` query reports each mixed basket selector
independently. Absent selectors retain existing Permit2 execution; an unavailable observation
is a read error. Publish compatible Backend capabilities before this App
consumer. The shared issuance facet may be installed independently because
older targets retain their Permit2 executors and sufficient Helpers allowance
remains usable. Source tests do
not establish installation or physical-wallet qualification.

## Unified token trading

The home page has one neutral token trading form without a mechanism chooser or
selected-strategy label. `POST /api/quotes/trade/stream` sends
side, exact-in mode, counter-token/native selection, amount, recipient,
deadline and tolerance. The Backend assembles and competes Core and market
candidates, publishes each improving qualified winner, and returns the selected
complete tagged provider request/quote. The App does not assemble basket targets,
rank families or rebuild an executor payload. A Core failure cannot erase a
qualified market winner. Initially only PAXG/CYGLD market trading is qualified;
native ETH and other configured tokens retain Core routing. Basket operations
and recovery settlement remain distinct.

Exact-in competition uses fee-net output. Min/max protections and gas are
separate. Backend exact-out modes and their fee-inclusive expected-input
comparison remain available for explicit diagnostics and deferred feature
work; the production form creates no output-target requests. Generated HTTP
contracts and passthrough adapters retain those capabilities.
Token MAX uses the spending wallet budget, so a Core mint cap cannot restrict a
qualified market purchase.

`POST /api/quotes/trade/model` obtains organic family models and a Backend-ranked
estimate. Warm acquisition reuses caches; cold acquisition may load lightweight
baselines through existing shared Backend facts. An unavailable model does not
block exact quoting. Core and market models keep their family and deployment
namespaces. No generic browser RPC or swap computation fallback is added.
The indicative model receives the validated raw amount independently of exact
search debounce. Tolerance remains debounced, and obsolete work retains existing
cancellation and configuration/head isolation.

One shared query/stream retains the first qualified plan during optimization.
Ordinary head refresh starts a fresh competition without automatically restricting
it to the previously selected family. Input, deployment and fork changes isolate
cached models and abort obsolete work. Before wallet preparation, the App captures
the complete selected plan, targets and terms. Later better candidates cannot
retarget a signature or change its displayed terms. Only the selected executor
prepares permits or transactions; specialized basket actions keep their existing
execution path.

Market fee rows and receipts use the Front-end fee label, independently of the
Core Helpers fee. The App consumes the Backend's selected fee rate and frozen CYGLD fee amount,
complete V2/V3/V4 route, explicit routed sale input, net output and inclusive
input bounds. It defines no token classification or fee-rate policy and does
not rebuild a generic route as a V3 packed path. Core execution continues to
consume its own complete Backend quote and adapter payload.
Expanded fee details render fixed Protocol, Helpers, Front-end and transaction
rows before their data arrives. Unknown amounts, valuations and bounds display
`...`; an inapplicable fee displays `—`. Token catalogs, balances, requested
Basket composition and MAX controls retain their shell while loading. These
placeholders do not supply amounts or plans to execution. The action mirrors
the existing submission requirement for an actual ready flow.

Market execution uses the scoped `swapExactInput`/`swapExactOutput` selectors.
Native token permits name Helpers as spender and cover the declared inclusive
input lot or maximum. The authorization hook queries
`/api/governance/helpers-facts?marketSwap=true` for the selected market operation,
independently of issuance selectors. Sufficient Helpers allowance and the
existing Permit2 fallback remain available. Rejecting a wallet signature ends
the attempt without another approval prompt. SDK route qualification precedes
signing, with compatible Quoter verification when available; the actual signed
permit-and-swap call is simulated through
`/api/transaction/helpers-execution` before transaction confirmation.

`MarketSwapExecuted` supplies actual venue input, net recipient output,
original-input and output-excess refunds, CYGLD fee and actual beneficiary.
The common receipt reports total CYGLD debit for sales, including that fee.
Core `Issued`/`Redeemed` events retain measured input/output and distinct recovery
share amounts. Atomic/SDK batch confirmations reuse their already-returned logs
without another receipt read.
The quoted fee-recipient observation is advisory; receipts use the emitted
beneficiary. Exact-output excess returns to the payer, while exact-input
settlement delivers favorable output to the selected recipient.

The generated `helpersMarket.ts` ABI supplements the current Helpers base ABI.
The universal exact-input candidate uses 43 base functions, one retained Market
exact-output function and one universal function. The generator defaults to the
compiled snapshots under `app/contracts/abi-inputs`; candidate worktrees may
pass `--market-source` to `scripts/generate-contract-abis.mjs` or set
`CYBERGOLD_HELPERS_MARKET_ABI_SOURCE` for the normal generation/check command.
The existing base ABI source may likewise be selected with `--helpers-source`
or `CYBERGOLD_HELPERS_ABI_SOURCE`. These are local build inputs, not public App
settings. Unit and mocked browser evidence do not establish selector installation
or physical Ledger acceptance.
