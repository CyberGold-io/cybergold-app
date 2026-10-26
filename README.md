---
title: CyberGold App
doc_type: repository-guide
status: active
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-10-11
canonical_for: App repository overview and validation entry points
---

# CyberGold App

The [focused API adapters](docs/architecture/focused-api-adapters.md) connect
the current frontend and wallet libraries to the Python backend.

Next.js frontend for CyberGold. Its fixed `/api/*` adapters call
`cybergold-backend`, which owns RPC-based recovery discovery, PostgreSQL,
market caches and the dashboard/history indexer. Wallet signing and submission
remain in the browser. The App is part of the
Phase 2 release and is not production-ready until the Ops work-register App
security/release gates close.

Token trading uses one Swap form. The Backend competes Core issuance/redemption
with qualified PAXG/CYGLD market swaps and supplies the selected complete plan;
the App retains the original neutral trading form without a mechanism chooser
or label. Market fees use the Front-end fee label; Core execution retains its
separate Helpers fee. Exact-input quotes compare fee-net output, and exact-output quotes compare the actual fee-inclusive input
required by each executor. Min/max protections and gas remain separate. Core
exact-output redemption burns its selected fixed lot, including its protective
margin. Basket issuance/redemption and recovery settlement retain their distinct
operations. Token MAX uses the wallet budget rather than a universal Core mint cap.

The form renders its amount fields, valuation lines and fee controls immediately.
Expanded fee details keep Protocol, Helpers, Front-end and transaction-fee rows
visible: pending values show `...`, and fees inapplicable to the selected plan
show `—`. Pending token catalogs, balances and requested Basket data retain
their controls and placeholders; MAX uses a stable spinner slot while loading.

The fixed `/api/quotes/trade/model` adapter obtains Backend-ranked indicative
estimates and `/api/quotes/trade/stream` publishes a qualified winner while other
candidates can continue improving it. Models retain separate Core/market family
identities. Indicative models follow the edited amount before exact-quote typing
debounce; tolerance changes retain that debounce. Normal head refresh competes again; the selected plan and deployment
are frozen before wallet preparation. Existing native permits, approvals,
Permit2 fallback and signed-call simulation are reused only for the winner.
No deployment address settings or economic fee-policy changes are introduced.

## Quick start

Requirements: Node.js 26.10.0 and npm.

```bash
npm install
npm run dev
```

For a direct local launch, copy `.env.example` to `.env.local` and fill in any
public settings and `CYBERGOLD_BACKEND_URL`. Keep this file local. Start the
backend API on port 3001 using that repository's documented Python/container
launch, with its own private environment. DB, RPC bearer, Safe-service and
worker credentials belong to the backend. Ops owns generated profiles and the
container/scheduler lifecycle. Use the coordinated Ops profile for local
development that needs the workspace services:

```bash
cd ../cybergold-ops
./scripts/run-local-dapp.sh [MODE]
```

See the Ops fork and service runbook for the available explicit local modes and
their ports. Operators should use an Ops-owned server deployment command for a
remote instance; this repository intentionally has no remote-development env or
SSH-tunnel wrapper.

A local frontend can also use the deployed backend. Set
`CYBERGOLD_BACKEND_URL=https://api.sandbox.cybergold.io`
(or `https://api.app.cybergold.io` for Mainnet), without `/api` appended, and
set the environment's `CYBERGOLD_BACKEND_BEARER_TOKEN` privately in `.env.local`.
The Next.js server adds that bearer to every fixed API adapter; browser-supplied
Authorization is never forwarded. No shared credential belongs in a
`NEXT_PUBLIC_*` variable. Match the wallet chain to the chosen Backend. The App obtains deployment
addresses and its initial token catalog from `/api/protocol/config`; do not put
contract addresses in the App environment. App and Wagmi reads use fixed product APIs on the frontend's own origin and port;
`NEXT_PUBLIC_RPC_URL` is no longer read, including in older environment files.
Configure `NEXT_PUBLIC_WALLET_RPC_URL` separately for wallet network setup.
Without it, wallet suggestions use the public Mainnet/fork RPC or local Anvil URL for the configured chain;
a phone wallet needs an endpoint reachable from the phone. The Sandbox faucet uses the same backend
entry and credential. Restart Next.js after changing its environment.

`npm run validate:env` checks the running frontend's fixed chain observation at `http://localhost:3000` by default. For another port, set `NEXT_PUBLIC_APP_ORIGIN` in `.env.local`.
Operators can still use the tooling-only `RPC_VALIDATION_URL` and
`RPC_AUTHORIZATION` override. These do not configure the browser transport.

The deployed App remains public: its visitors do not need this service bearer.
The bearer identifies a remote frontend server, not a wallet or end user.
Server-deployed App containers continue to use their existing private backend
network connection. Origin forwarding remains compatible with retained older
backends, but the current backend does not use Origin to authorize the faucet.

The recovery-share portfolio below Swap reads the current Core registry,
wallet ERC-1155 balances and settlement previews through server-side RPC. It
does not require PostgreSQL or an indexer snapshot. The generated profile must
point to the upgraded Core on the selected chain; an unavailable read remains
an explicit error rather than an assertion that the wallet has no shares.
Shares use each underlying asset's decimals, and payouts are capped at one
underlying token per share. Paused Core state disables settlement.

Core permit name/nonce and Permit2 verification/nonce/allowance reads use fixed
`/api/account/core-permit` and `/api/account/permit2` adapters. Each preparation
gets fresh server observations; failed reads do not substitute a zero nonce or
retry through browser RPC. The browser retains the configured signing domain
and spender, value/deadline, wallet chain check, signing, approval and submission.
Attached Core recovery assets for exact-output redemption and EIP-1559 fee
estimates use fixed `/api/protocol/recovery-assets` and `/api/transaction/fees`
adapters. Empty asset lists and observed zero fees remain valid observations;
failed reads stay unavailable. Existing redemption minima, fee display rules
and browser query timings are retained. Unsigned preparation, receipt/replacement
observations, native wallet balances and ENS records also use fixed operations.
The production Wagmi client has no generic RPC fallback; wallet control, signing
and submission remain browser-owned. The current App has retired `/api/rpc`; older open tabs must reload. Retained
images keep their own compatibility adapter and backend contract. Public wallet
RPC hosts remain available.

Dashboard, history and indexed Fund views still use the authenticated internal
backend worker. Their public requests read cached models and never initiate
reconciliation. The worker's private listener holds
`ONCHAIN_INDEXER_WORKER_TOKEN`; no worker-control route is exposed by the
frontend. Its behavior is described in the
[runtime profile guide](docs/development/runtime-profiles.md).

Swap diagnostics retain an optional numeric wallet/RPC error code and only the
four-byte selector from structured EVM revert bytes. Generic internal wallet
errors are not classified as contract reverts solely from Viem's wrapper name.
Error text, encoded arguments, calldata and signatures are excluded; collection
remains best effort and never changes submission or creates a retry.

## Validation

The wallet button loads its panel code immediately. All seven token rows are
visible while their reads are pending. One `/api/account/wallet-balances` request
is shared between the swap and wallet panel. The backend combines the six ERC20
`balanceOf` reads and Multicall3's `getEthBalance` in one `aggregate3` call at
`0xcA11bde05977b3631167028862bE2a173976CA11`, using one canonical block and
preserving each failed asset independently. Balances arrive together; prices
and liquidity positions load separately. Unknown amounts and values show `...`,
and a transport outage retains the last known snapshot. Changing wallet or Sandbox fork uses separate
query state. Swap submission still checks a fresh complete wallet snapshot
before requesting signatures or transactions.

Connected wallets also see each selected token's balance at the lower right of
the sell and buy fields on desktop and mobile, with MAX beside the sell balance.
Amounts use a six-digit display budget including leading zeros, preserving the
full integer part for larger balances. Positive amounts below the display
precision show `<0.00001`. The exact localized balance is available on hover and
to screen readers. Known zero balances display `0`; pending or unavailable
balances display `...`. The virtual BASKET selection has no aggregate token balance.

The wallet panel includes a collapsible Liquidity Positions section for the
Ethereum PAXG/CYGLD Uniswap V4 pool. Opening the wallet panel reads its position
NFTs, deposited token amounts and unclaimed fees through the backend's fixed
`/api/account/liquidity-positions` operation. All position reads use one block
snapshot. The section displays the position count, combined estimated value in
the selected fiat currency and gold unit, and the PAXG/CYGLD quantities. Values
reuse the wallet's PAXG and CYGLD prices, fiat preferences and gold display
conversion. The collapsed row shows the combined total, including unclaimed
fees, aligned with the token balances. Refresh balances also refreshes positions
while the wallet panel is open.

See my positions and Add liquidity open Uniswap on Ethereum mainnet. The
Sandbox section labels that destination explicitly and warns that its fork
data may differ from mainnet. The add-liquidity link selects this pool and starts
a fresh deposit without a saved price range or amount. Local review requires
the matching backend implementation; both feature checkouts can remain local
until the owner accepts the prototype.

```bash
npm run ci-check
npm run test:e2e
```

MetaMask tests require a disposable test-only wallet. Never supply a seed that
holds real assets or has been used on a public network.

See the [App documentation index](docs/README.md) for runtime profiles, indexer
behavior, swap-flow architecture, acceptance specifications, and E2E guidance.

## Contribution and promotion flow

Create development work from `dev` on a lowercase `feature/*` branch. Merge it
through a pull request into `dev`, qualify that exact integration head on
Sandbox, and promote only the exact `dev` head through a merge-commit pull
request into `main`. Direct protected-branch pushes are not an accepted release
path. Start with [CONTRIBUTING.md](CONTRIBUTING.md), then see the
[branch and promotion workflow](docs/development/branch-workflow.md) for the
checked-in admission controls and remaining live GitHub-protection requirement.

The [fixed library client qualification](docs/architecture/fixed-library-client-qualification.json) records native balance/ENS/NFT/receipt/revert transport, connected RainbowKit and fork-generation cleanup. The current clients and App RPC-route retirement are published in both environments. The [E2E guide](tests/README.md#current-fixed-api-funded-qualification) also provides the disposable actual-MetaMask/Python qualification command. Hosted extension execution is separate from GitHub required merge checks.


## Head-aware quote freshness

One shared lightweight head watcher refreshes active protocol facts, previews,
routes and transaction fee pricing only when the block hash changes, including
a replacement at the same height. Mainnet waits near the next 12-second slot,
then probes briefly each second; Sandbox automining uses a one-second head
probe. Startup and page resume check immediately. New input keeps its existing
200 ms debounce and starts a fresh quote without waiting for a slot. Ordinary
receipt confirmations and finalized observations still require chain evidence.

Route observations share in-flight work and support A→B→A reuse for ten seconds
within the same chain, fork generation and head. Adapter calldata remains exact;
a stable ten-second preview deadline avoids accidental cache misses. A completed
quote stays visible while the same input refreshes; provisional quotes remain
display-only and execution readiness retains its existing checks. Fee observers
and signed execution preparation share the same fee observation. Signed gas
simulation still runs for the actual transaction inputs; its gas units are
repriced with the current head's fee data.

Gold/FX freshness follows `fetchedAt`, including an expiry update on screen,
rather than starting a new browser lifetime when an old value arrives. Successful fresh
gold and FX observations also restore optional display fallbacks after browser
hydration while the normal Backend refresh runs. The token selector retains
Backend-managed labels, decimals and token metadata across reloads; those display
rows never supply deployment targets, executable quotes, wallet balances or
authority facts. Trading continues to use the current Backend configuration.
Unavailable browser storage falls back to the ordinary requests. Vendored
backend source metadata explicitly names each file's SHA-256 digest; it is
provenance documentation, with no runtime consumer or secret-scan exception.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for public fork setup, local validation
and the feature-to-`dev` contribution path. The project license is
**AGPL-3.0-only**; [LICENSE](LICENSE) contains the full text.
[Licensing scope](LICENSING.md) preserves existing MIT and other third-party
notices and explains corresponding-source obligations.

## Dependency security

The owner-approved [dependency security policy](DEPENDENCY_SECURITY.md) requires
PRs to pass `dependency-security` for every unaccepted finding, including
development and transitive dependencies. Remediate through CyberGold-maintained
parents; any risk exception needs a specific owner decision. See the policy for
current GitHub plan limits and local validation.
