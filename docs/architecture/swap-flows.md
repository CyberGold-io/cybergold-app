---
title: App swap-flow architecture
doc_type: architecture
status: active
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-10-19
canonical_for: App preview and execution orchestration
---

# App swap-flow architecture

The home form accepts spend amounts only. Receive token and basket amounts
are read-only estimates that can be selected and copied. Reversing the pair
clears amounts and the basket driver, then focuses the new spend input. Old
output-driven session drafts retain their pair/preferences and clear amounts;
legitimate input drafts restore without trusting a saved receive quote.

The Backend alone selects among supported Core and Market plans. The App
submits exact-in user intent and executes the complete returned plan without
locally ranking providers or resizing inputs to favor one. The direct-basket
API currently supports Core only; this change adds no Market basket provider.

The App treats generated Core/Helpers ABIs and the current Helpers interface as
executable authority. Each flow previews first, displays gross/net results and
fees, derives user minima, applies bounded deadlines to swap payloads and signed
permits, and submits only on the configured wallet chain. Permit2 basket inputs
use the canonicalized preview amounts in basket-asset order. Swap payloads and
quotes are built off chain; adapters execute reviewed payloads and do not
provide the App's quote authority.

All first-party swap previews and mutations go through Helpers. Routed token
and native flows use the direct-basket Helpers previews as construction probes
for the current required issuance lots or complete redemption vector, then use
the aggregation previews and mutators for the final route. This keeps Helpers'
configurable fee in the same accounting domain throughout construction and
execution. The user transaction targets the Helpers diamond with its
authorization, recipient, ordering, and minimum bindings.

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
Input-budget token/native issuance still uses fixed-output Helpers operations;
the `ExactOut` executor names are necessary to the retained spend-budget flow.

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
Routed token/native issuance entered as an input budget still executes a fixed
CYGLD output with that budget as its maximum input; it does not become a new
exact-input contract operation.
Unused input follows the existing Helpers refund behavior. Input ceilings and
fixed output guarantees remain the Backend-selected plan's actual terms.

Issuance amounts that exceed remaining gross mint capacity keep the requested
amounts visible in red and disable submission. Fees count toward gross mint
capacity, using the same integer fee inversion as Core and Helpers. The warning
retains the uncapped requested output even when a warm model or Helpers preview
clips issuance to the remaining capacity. This Core-specific cap presentation
cannot reject another eligible Backend-selected provider.

Basket MAX depends only on proportions, decimal scales and wallet balances.
It chooses the positive-weight component with the smallest balance divided by
its raw-unit proportion, sets that limiting balance as the raw driver and
floors the derived component budgets in canonical order. Zero-weight members
do not limit MAX; a known zero positive-weight balance produces a zero basket.
Unavailable balances remain unavailable. MAX uses BigInt and keeps its raw
precision independently from shortened display values.

Provider quotes, conversion prices, fees, tolerance and mint capacity do not
resize that basket. A wallet-funded MAX can receive an ordinary Core cap
warning; the user can reduce the spend amount. Token/native MAX retains its
spending balance and native gas reserve. Existing cancellation prevents a
pending MAX from overwriting a later form, token-pair or wallet change.

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
