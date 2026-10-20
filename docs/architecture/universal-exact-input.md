---
title: Universal exact-input App integration
doc_type: architecture
status: active
owner: app-maintainer
created: 2026-10-20
last_reviewed: 2026-10-20
canonical_for: Universal exact-input App consumers and local verification
---

# Universal exact-input App integration

Local implementation targets the input-only `origin/dev` App baseline at
`6f8e098`. Deployment, selector retirement and Backend release configuration
remain separate operations. The App does not manufacture an installed address.
An unconfigured universal quote service returns its ordinary unavailable error.

## Active callers

| Journey | Quote producer | Submission |
| --- | --- | --- |
| Token/native purchase or sale | `POST /api/quotes/universal-exact-input`, intent 0 or 1 | `useUniversalExactInputExecution` |
| Direct exact basket issuance | Same endpoint, intent 2, full ordered explicit input vector | Same executor |
| Direct exact basket redemption | Same endpoint, intent 3, exact CYGLD input | Same executor |
| Operational wallet runner, exact input | Same endpoint, all four intents | The captured universal plan and aggregate receipt |

The visible quote supplies complete fees, minima, output and physical retained
input estimates before submission. The click freezes the plan before any wallet
work. Native ETH is address zero; `msg.value` is exactly the sum of native inputs.
Every token approval or signed trade permission covers its declared acquisition,
not a larger UI ceiling. Existing sufficient allowances are reused. Permit2 setup
approvals use the exact amount in this path; its signed permission is one compact
batch. Native inputs retain their aligned empty allowance placeholder. Direct
basket plans renew at the existing quote deadline, matching scalar freshness.

The bound engine applies its existing adapter approval check when an AMM stage
executes. The App does not require an adapter observation for identity or
share-only operations. Market/mixed funding completes before its existing
mandatory signed-call simulation; Core fee estimation remains advisory.

Core and Market charges remain separate. Returned input is a disclosed protocol
charge retained in Helpers for its owner; it is not a refund or additional wallet
debit. Estimated fee totals include priced retained assets once, and remain
unavailable if an estimated retained asset cannot be priced. Receipt settlement
uses only `ExactInputExecuted` for this operation, even when underlying Core
logs coexist. Full input/output vectors, recovery shares, measured retained
physical assets, fee beneficiary and custodian remain distinct. Share-only Core
sales can have a zero scalar output minimum.

## Retained and inactive callers

The published page has no output-target editing journey. Its old Core sale
sizing sources remain useful numerical previews. The inactive scalar and basket
output-target Core sale handlers now acquire fresh universal bytes at the solved
gross CYGLD input, and retain accepted scalar or complete-vector minima. They do
not promote old adapter calldata. Descriptor changes meet the existing contract
binding checks. This is source preparation, not a claim that deferred UX was
activated or exercised in a browser.

True exact-output purchase and Market execution remain on their existing
interfaces. The shared basket purchase and Market executors now accept only exact
output; the unused shared redemption executor was removed. Old exact-input
selected intents normalize to fresh universal plans and preserve accepted bounds.
Unused low-level retired-selector hooks were removed. Test-only ABI augmentation
keeps historical function descriptors for past receipts and frozen fixtures;
the product execution ABI contains only the current 45 functions. The
operational runner's old fixture branches can still decode historical contracts;
fresh exact-input observations and solved output-target Core sale observations
produce universal plans.

Read-only basket/token previews, MAX sizing and lightweight trade models retain
their numerical interfaces. A provisional model is not an executable plan.

## ABI and verification

`app/contracts/abi-inputs/HelpersDiamond.json` and `HelpersMarket.json` are the
current compiled 43-function base and one-function Market snapshots from the
Helpers candidate worktree. `helpersTradeExactInput.json` is its compiled
one-function Solidity interface ABI. `scripts/generate-contract-abis.mjs` generates the wallet module;
`--check` detects drift. `scripts/generate-universal-exact-input-fixtures.mjs`
produces four-intent calldata fixtures, including mixed Core/Market branches and
V2/V3/V4 steps. The App also consumes the canonical Python producer corpus in
`tests/fixtures/universal-exact-input-backend.json`, shared with Solidity tests.

Unit verification covers lossless physical funding, aligned compact Permit2
authorization, pre-wallet capture, signed-call simulation, aggregate settlement,
retention including input gains, full vectors and fee accounting. Type checking,
linting and the Node App suite are local checks. Active Playwright fixtures use
fresh universal bodies, exact acquisition and the aggregate receipt. They cover
native funding, split/mixed plans, token permits, compact Permit2, wallet batching,
quote cancellation and deadline renewal, retention disclosure and settlement.
The canonical endpoint returns one complete JSON plan; indicative models remain
separate from executable terms. Deferred exact-output fixtures retain their
historical transport. No deployed release or live wallet execution is claimed
by these checks.

The 2026-10-20 local candidate passed 950 Node tests, a production build,
type checking, linting, ABI generation checks and release-boundary checks.
Chromium passed 341 tests against that production build; five existing Sandbox
reset tests require chain 31338 and were skipped on the chain 31337 fixture.
The vendored Backend schema identifies local, unpublished commit
`008833b1fd43236cd8a7a5988e3ebda0aa14bdf1` and records matching artifact hashes.
