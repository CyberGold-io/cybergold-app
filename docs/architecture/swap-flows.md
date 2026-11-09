---
title: App swap-flow architecture
doc_type: architecture
status: active
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-11-09
canonical_for: App preview and execution orchestration
---

# App swap-flow architecture

The home form accepts spend amounts only. Receive token and basket amounts
are plain output text that can be selected and copied, with no input border,
editing caret, focus ring or tab stop. Clicking an amount does not activate an
editor; the separate receive-token picker remains interactive. Reversing the pair
clears amounts and the basket driver, then focuses the new spend input. Old
output-driven session drafts retain their pair/preferences and clear amounts;
legitimate input drafts restore without trusting a saved receive quote.

The Backend alone selects among supported Core and Market plans. The App
submits exact-in user intent and executes the complete returned plan without
locally ranking providers or resizing inputs to favor one. The direct-basket
API currently supports Core only; this change adds no Market basket provider.

Reusable whole-quote history belongs to the Backend and is shared across
browsers and users. Each new App request owner asks for the Backend-selected
stream. TanStack Query supplies request/promise status only; inactive quote
slots have zero retention. The App neither initializes a new owner from an
old quote nor scans, retargets, ranks or extrapolates neighboring whole quotes.
This also applies to the deferred exact-out adapter's request slots.

Fast scalar hints come from Backend-produced `/api/economic-estimates` packets
and their optional budget ranges. The Backend supplies the output and fees,
including `cached-upper` and `cached-lower` arithmetic. An explicit Backend
`fullBudget` instruction keeps that estimate visible over its stored, partially
funded fallback while optimization runs. A fully funded quote, an explicit
observed input limit, any fresh selected quote, or attempt settlement ends that
overlay. This only compares returned funding with the entered budget; the App
does not rank or extrapolate output. Hints cannot enable execution or become
accepted bounds. An early Swap still captures the actual stored tuple.
Every qualified and terminal selection replaces the complete tuple together,
including funding, fees, context, limitation evidence and route origins.
Identical terminal snapshots do not need a second display publication.

Only the current owner's accepted tuple remains available during its Refresh,
transport failure or preparation. Input changes create an empty owner; matching
canonical invalidation clears the displayed quote without restoring a prior
observation. An early Swap captures the latest complete tuple synchronously,
stops that owner's refinement and keeps the captured funding/output/bounds
through unsigned preparation. Refused preparation does not restart that stopped
search; a new input or explicit Refresh can start work. The App and fixed Next
stream facade add no whole-search time window.

The existing estimate description and pending presentation remain. Only the
estimated scalar receive number has a subtle three-second opacity pulse.
A different validated receive amount gets one cycle of the same pulse;
metadata-only or same-formatted-amount updates do not restart it. Validated
amounts stay steady while optimization continues. Reduced-motion preferences
disable both forms. Labels, spending and fees keep their existing presentation.

Reload snapshots retain input drafts, selected assets, preferences and static
presentation. They do not restore quote outputs, quote fees, minimum outputs,
consumption, retention disclosures or readiness. Basket snapshots retain the
editable driver amount, while derived amounts wait for Backend facts/models or
quotes. Numeric display retention is limited to its current owner and clears
on a changed key or invalidation.

Exact-in advisory model keys include configuration, generation and input, but
no block head. A head change alone does not restart that model request or the
executable quote stream. Legacy exact-out model keys retain their existing
head scope. Hidden/unmounted views cancel their owned work independently. A completed owner
keeps its current observation on hide/show; interrupted work resumes once. A
new owner still acquires the Backend selection.
Latest execution simulations may have null block coordinates. Those remain
unknown in diagnostics and measurements, rather than becoming block zero or
requiring another header read. Disproof associates an unanchored observation
with its producer observation time, without imposing an age limit.

The App treats generated Core/Helpers ABIs and the current Helpers interface as
executable authority. Each flow previews first, displays gross/net results and
fees, derives user minima, applies bounded deadlines to swap payloads and signed
permits, and submits only on the configured wallet chain. Permit2 basket inputs
use the canonicalized preview amounts in basket-asset order. Swap payloads and
quotes are built off chain; adapters execute reviewed payloads and do not
provide the App's quote authority.

All first-party swap plans are measured and executed through Helpers. The
Backend constructs complete universal plans from the actual Core basket fields
and market routes, then measures their combined execution with Helpers. Its
optional funding refinement can work backward from measured Core consumption
and useful residual conversions; each changed whole plan is simulated again.
The user transaction targets the Helpers diamond with the selected funding,
authorization, recipient, ordering and minimum bindings.

Browser diagnostics are best effort and never affect quote/execution readiness.
Quote calls carry an optional `X-CyberGold-Attempt-Id`; the fixed Next adapter
forwards the Backend request reference and logs its own transport failures with
safe linkage. Structured errors and accepted quote tuples retain those IDs.
Swap attempts link to the quote and record balance, network, preparation,
authorization, simulation, submission and confirmation stage context with the
selected Core/market family and raw integer bounds. A failure may expose a
copyable reference alongside the localized product message. Error/provider text,
signatures, calldata and private URLs are excluded. Submitted-but-unconfirmed
transactions retain their hash and are rechecked without resubmission.

Page-local quote timing events are also written as structured browser-console
JSON under `cybergold:quote-latency`. One browser monotonic clock observes native
input, fetch dispatch, headers, first bytes, parsed selected frames and committed
display. Selected-frame records retain only diagnostic references, raw input
amounts, quoted output, producer timing metrics, stored/search origin and observed limitation evidence;
they exclude plans, addresses, URLs and wallet data. The first validated display
and the first confirmed full-budget display are separate milestones, so an early
limited quote does not end the full-budget clock. Optional browser long-task
entries identify main-thread blocking intervals, with an explicit observation
support record. They do not identify the responsible function or exclusive CPU
time. Optional resource timing records retain only the browser's numeric fetch,
DNS, connection, request and response timestamps and recognized HTTP protocol for
the same-origin economic stream. They may arrive after completion or abort;
zero or absent phases do not establish an instantaneous operation. Resource
entries have no request UUID and require an unambiguous dispatch-clock join.
Producer metrics retain their producer's clock, including historical metrics on
stored observations; they are not the current HTTP request duration.
Console capture adds no telemetry request or persistent App history; these
best-effort observations do not change quote readiness, timers or cancellation.

Issuance binds the current ordered Core input assets. Redemption has no
healthy/recovery mode split: every Core preview returns one complete canonical
vector whose leading legs are ERC-20 reserve assets and whose trailing legs are
ERC-1155 recovery shares. Helpers aggregate only positive ERC-20 legs into the
selected ERC-20 or native output and forward every positive recovery-share leg
unchanged to the same recipient. The App presents those shares separately and
never includes them in the aggregate token amount or describes them as a claim
on a guaranteed CYGLD value.

Safe execution binds the complete current Core descriptor list and a minimum
for every leg, including structural zeroes. The contract therefore rejects
incompatible current-state drift without an App-maintained historical guard.
An unreadable reserve balance contributes zero live
custody; a redemption may still proceed when another leg is positive and the
unreadable leg's minimum is zero. An all-zero redemption never burns CYGLD.

Output-target entry is deferred. Standalone exact-out basket hooks, Backend
solvers, contract entry points and broad generated API/ABI types remain
available for future work and explicit component diagnostics. The production
page neither imports those form hooks nor creates output-driven requests.
The ordinary spend-budget journeys execute `executeExactInput`. Retained
exact-output/numeric APIs and their specialized Core sizing solver support the
deferred consumers and diagnostics; they are separate from the active economic
quote stream.

Holder settlement of already-owned shares remains pool-scoped: it burns shares
only for a positive current payout, capped by live custody. A zero-output
balance stays with its holder and can participate in later donation,
restitution, or resolution upside.

Preview results contain computed fees, canonical ordering, and current typed
outputs; they do not echo request structs. The App keeps original user intent
locally and combines it with the preview to build the execution request. There
is no recovery-event identity or protocol-history lookup in a flow.

This is the initial clean-launch surface. There is no compatibility or data
migration path for a pre-recovery deployment.

The implemented basket and token flow matrix, validation, toggles, and wallet
outcome assertions are specified in the acceptance documents linked from the
[App index](../README.md).

The expandable fee section exposes execution tolerance from 0% to 1%, defaulting
to 1%. It displays the selected plan's minimum output for the input budget.
Market estimates exclude this tolerance.
The entered amount is an upper budget. The spending field shows the selected
plan's actual declared funding, which can be smaller; the unallocated budget
stays in the wallet. Acquired assets returned by an encoded conversion instead
remain disclosed charges at Helpers. The App executes the selected universal
body and preserves its accepted input maxima and output minima during
preparation. Funding refinement does not change the App's selection policy.

Direct-basket issuance amounts that exceed remaining gross mint capacity keep
the requested amounts visible in red and disable submission. Fees count toward gross mint
capacity, using the same integer fee inversion as Core and Helpers. The warning
retains the uncapped requested output even when a warm model or Helpers preview
clips issuance to the remaining capacity. This Core-specific cap presentation
cannot reject another eligible Backend-selected provider.

Basket MAX first derives a wallet-funded proportional upper budget using
canonical basket order, decimal scales and BigInt arithmetic. Zero-weight
members do not limit that budget; unavailable balances remain unavailable.
The App sends `{driverToken, maximumAmountsIn}` to
`POST /api/quotes/basket-max`. The Backend owns the executable limit, including
current Core mint capacity and preview semantics, and returns the raw driver,
canonical component amounts and net CYGLD output. A wallet limit can keep the
full proportional budget; a tighter mint limit reduces it, and exhausted
capacity returns zero.

The App retains the returned canonical component vector for display and the
ordinary `issue-exact-in` basket preview before submission. It does not
rederive that vector from older App proportions or let an older capacity model
disable a validated MAX; ordinary Backend preview capacity errors still apply.
Manual input clears the MAX vector and restores local proportional entry. Raw
component budgets keep their precision independently from shortened display
values. Execution tolerance remains part of the ordinary quote. A failed MAX
request preserves the current amount and quote and reports the existing quote error toast.
Existing cancellation prevents a pending MAX from overwriting a later manual
edit, form, token-pair, wallet or configuration change. Token/native MAX retains
its spending balance and native gas reserve.

Token and direct-basket purchases share one authorization builder. It reuses
sufficient Helpers allowance, including legacy unlimited allowance. Otherwise,
qualified standard ERC2612 inputs use exact per-trade native permits where the
corresponding selector is installed. Unsupported inputs use exact Permit2
permissions. Their token-to-Permit2 setup approval is reusable and unlimited;
this is the only newly requested unlimited approval. The App offers no unlimited
permission control. USDT resets a nonzero insufficient setup allowance before
replacement; ordinary tokens receive no blanket reset.

Mixed basket executors retain the full Core input order, including zero members,
and assign allowance, native permit or Permit2 to each input. The one Permit2
batch permission contains only its inputs in relative Core order. All-native or
all-allowance baskets need no Permit2 signature. Basket execution still pulls
fresh Core lots within the signed ceilings, so execution below a ceiling can
leave finite native allowance. Missing mixed selectors retain the existing
Permit2 basket executor. Missing single native selectors retain its existing
Permit2 executor. These observations use the existing router-facts boundary.

Fresh owner nonces and Helpers allowance come from the focused token-permit API;
the Backend shares its thirty-day capability cache across imports and flows.
Unavailable reads remain read errors. Unknown domains, DAI-style permits and
observed absence of standard permits use Permit2. The established wallet typed
format errors can use exact ordinary Helpers approval. User rejection ends the
attempt and preserves its form. Execution errors never relabel permit support
or automatically retry authorization. A partially signed SDK group is never
replayed or replaced. Redemption likewise reuses sufficient CYGLD allowance or
signs an exact native permit with the established Core domain producer.

For an eligible selected MetaMask extension, every required typed permission is
submitted in one flat SDK 0.33.1 `metamask_batch` call, even a singleton. Native
token permissions precede the optional compact Permit2 permission. All necessary
reset/setup approvals and the execution then use one transaction
`metamask_batch`, even a singleton. The SDK owns their sequence; the App does not
queue individual requests. MetaMask still shows separate EOA confirmations and
the transaction group is not atomic. Supported atomic wallets retain one
`wallet_sendCalls` transaction bundle; eligible MetaMask accounts independently
use the same SDK signature group. Other wallets or unavailable SDK transports
retain ordinary signing and submission. Signed execution estimation finishes
before submission when no pending batch approval prevents simulation, using the
existing optional fee-error behavior. Captured owners and configured chain IDs
remain bound to writes. Receipt rechecks do not resend transactions.

Address import resolves ERC20 metadata through the Backend and retains identity
as chain ID plus address. Configured CYGLD and WETH keep their identities; ETH
remains separate. Observed precision controls amount entry and MAX, unreadable
precision remains unresolved, and unreadable balances remain unavailable.
Imported tokens participate in wallet filtering, the wallet panel and fresh
spending-balance checks. Imports survive language changes in session storage.
Generic tokens have a neutral icon and no invented fiat price. The route API
already consumes token addresses, so an import uses its ordinary route search
and can receive an ordinary no-liquidity-route result. Import and authorization
never create liquidity. Metadata discovery is separate from amount typing;
selected-token balance queries use `purpose=balance` to skip optional permit
discovery, are cancellable, are keyed by wallet/network/fork, and do not poll
hidden tabs. Signing still obtains fresh permit context independently.
