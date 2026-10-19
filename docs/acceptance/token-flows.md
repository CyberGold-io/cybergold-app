---
title: CyberGold token and native flow acceptance
doc_type: acceptance-specification
status: active
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-10-19
canonical_for: App token-flow acceptance requirements
---

# CyberGold token and native flow acceptance

The active form supports input-driven purchases and redemptions. Users edit
what they spend and receive a read-only estimate. Backend and contract
exact-out capabilities remain retained for later work. The
[prior two-mode specification](deferred/token-flows.md) preserves the deferred
acceptance cases; it does not describe active output entry.

## Input driven acceptance

1. Enter each supported spend asset and obtain an exact-in quote. The receive
   amount displays the selected plan's estimate and minimum received.
2. Select and copy the receive amount or any receive basket component as plain
   text. Clicking an amount does not focus an input or show an editing caret,
   border or focus ring. Typing or pasting cannot activate an output-target
   mode, request or amount mutation.
3. Reverse the token pair. Both amounts and the basket driver clear, focus
   moves to the new spend field, and a new quote requires new spend input.
4. Restore an old output-driven session. Pair and filter preferences remain;
   amounts and driver clear. An ordinary spend draft restores and requotes.
5. Submit a Backend-selected plan. The App never ranks competing providers
   or overrides the selected strategy using local models, mint cap or MAX.
   A Core-specific quote failure cannot erase a qualified Market plan.
6. Preserve tolerance, input ceilings, canonical ordering, refunds, existing
   permissions, wallet rejection and original receipt recovery. Input-budget
   token/native purchases still use the required ExactOut Helpers selectors.
7. Keep the complete exact-out definitions and component diagnostics. Ordinary
   product matrices contain 24 exact-in journeys; future UI cases are excluded
   from normal collection with separate configuration and restoration notes.

## Mixed output recovery acceptance

These checks are part of the clean-launch token flow, not a migration case:

1. Impair an asset, then open or refresh `/en`.
   - expect: The recovery disclosure identifies the Core ERC-1155 collection,
     without a mode, epoch, event, or incident ID.
   - expect: It states that ERC-20 output and recovery shares are separate and
     that recovery-share value is not guaranteed.
2. Enter an exact CYGLD amount for token redemption.
   - expect: The quote aggregates positive ERC-20 legs into the selected output
     token and displays projected ERC-1155 recovery shares separately by
     impaired asset.
   - expect: Submit credits the selected token and the bound recovery
     share vector to the final wallet; recovery shares are not included in the
     aggregate token amount.
3. Select and copy the received-token estimate while an impaired leg exists.
   - expect: The receive amount remains read-only; no output-target quote is sent.
   - expect: Recovery shares remain separate and are bound by the selected input-driven plan.
4. Change the basket or impaired-asset set after a quote and submit the stale
   form.
   - expect: Complete descriptor binding makes execution revert without relying
     on an App-maintained mode, epoch, or transition nonce.
5. Make one reserve balance unreadable while another leg remains positive.
   - expect: The unreadable leg is valued at zero; submission can proceed only
     with a zero minimum for that leg and positive aggregate output elsewhere.
   - expect: An all-zero result is rejected before CYGLD is burned.
6. Disconnect the RPC or make the current-state preview unavailable.
   - expect: The affected quote and submission fail closed; no cached
     historical recovery state is used as economic authority.
7. Transfer ERC-1155 recovery shares between wallets and refresh through a
   reorg or fork reset without a recovery database or indexer worker.
   - expect: `/api/recovery/shares` and the wallet recovery-share panel show
     only balances from one complete canonical block-hash snapshot, without
     requiring an airdrop. A failed refresh retains the last complete snapshot
     with a stale warning and disables settlement.
8. Redeem shares while their asset is impaired, then rehabilitate the asset
   while another wallet still holds shares and redeem those shares as well.
   - expect: Positive-output burns are available in both modes when Core is
     unpaused and the token transfer succeeds. There is no resolution wait.
     Impaired payout follows capped live custody; rehabilitated payout uses
     the external reservation. Share amounts use the asset's decimals, and
     one share pays at most one underlying token.
   - expect: The wallet panel shows the asset, pool mode, attached and external
     share quantities, and current underlying payout. A successful burn
     refreshes the portfolio. A blocked transfer reverts the burn; an
     unreadable or zero-output quote cannot be submitted. A zero-output share
     balance remains visible for possible later recovery, subject to the cap.
9. Impair the same asset again while external shares remain outstanding.
   - expect: The same share ID is reused, new and old balances are fungible,
     and the wallet displays one aggregate balance against the updated pool.
10. Activate an Asset Recovery Fund generation, then open the dashboard and a
    holder wallet.
    - expect: The dashboard identifies the exact Core, impaired asset, current
      generation, coverage/purchased/remaining shares, the single live
      Governance acquired-share inventory, initial/paid/remaining CYGLD
      commitment, aggregate allowance exposure, available CYGLD, and treasury
      deficit. It exposes no duplicate Core-balance read, separate fund ID,
      terms hash, or Core proxy snapshot.
    - expect: The wallet shows the exact Governance preview for the lesser of
      its aggregate share balance and remaining current capacity.
11. Purchase shares in multiple transactions with a rounding remainder.
    - expect: Indexed paid and remaining amounts equal the cumulative on-chain
      formula and the exact Governance lens preview; per-transfer truncation is
      never accumulated independently.
12. Impair the same asset after its Fund generation was activated.
    - expect: The old and new shares remain one fungible balance, current
      coverage does not grow, and current unfunded interest is explicit.
13. Rehabilitate the Core asset while unused Fund commitment remains.
    - expect: The no-expiry commitment remains reserved; pause or rehabilitation
      does not release it. No closure, cancellation, repricing, or top-up action
      is shown.
14. Remove the Governance address or make a pinned current read fail Fund
    reconciliation.
    - expect: The Fund is respectively `not configured` or `unavailable or
      inconsistent`; no coverage is inferred. Positive-output Core holder
      redemption remains independently available.

Steps 10–13 require a disposable Fund fixture. Governance is not deployed on
the current Mainnet or its refreshed B2B fork, so those targets must show Fund
offers as not configured. Mainnet Core remains paused; transactional acceptance
uses the authorized fork only. Passing synthetic browser tests does not record
completion of these real-wallet acceptance steps.
