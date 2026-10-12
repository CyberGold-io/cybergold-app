---
title: App swap-flow architecture
doc_type: architecture
status: active
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-10-12
canonical_for: App preview and execution orchestration
---

# App swap-flow architecture

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

The exact-output token/native UI remains a client-side convenience, not a
second state-changing contract family. It obtains an initial gross CYGLD input
from an exact-output preview, iterates the ordinary exact-input aggregation
preview until the requested aggregate floor is covered, then submits the same
exact-input executor with the complete per-output minima. Holder settlement of
already-owned shares remains pool-scoped: it burns shares only for a positive
current payout, capped by live custody. A zero-output balance stays with its
holder and can participate in later donation, restitution, or resolution
upside.

Direct-basket exact-output redemption follows the same rule: the App calls
`previewRedeemToBasketExactOut` with a complete mixed minimum vector, then calls
the retained `redeemToBasketExactIn` family using the previewed gross
input and a bound complete mixed vector. The requested ERC-20 basket amounts
remain hard minima, so the user-facing exact-output target is preserved.

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
to 1%. It displays the active flow's minimum output for an input budget or its
maximum input for an output target. Market estimates exclude this tolerance.
Routed token/native issuance entered as an input budget still executes a fixed
CYGLD output with that budget as its maximum input; it does not become a new
exact-input contract operation.
Unused input follows the existing Helpers refund behavior.
Output-target redemption still burns the fixed protected CYGLD amount selected
by its solver; the input field displays that actual amount.

Issuance amounts that exceed remaining gross mint capacity keep the requested
amounts visible in red and disable submission. Fees count toward gross mint
capacity, using the same integer fee inversion as Core and Helpers. The warning
retains the uncapped requested output even when a warm model or Helpers preview
clips issuance to the remaining capacity. Either
issuance MAX button selects terms that fit capacity and available wallet funds;
for a basket, all asset balances are solved together after reserving each input's
execution tolerance ceiling. Native input retains the existing gas reserve.
A pending MAX calculation is cancelled when the user changes its form inputs,
tolerance, token pair or wallet.

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
