---
title: CyberGold basket flow acceptance
doc_type: acceptance-specification
status: active
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-10-19
canonical_for: App basket-flow acceptance requirements
---

# CyberGold basket flow acceptance

The active form supports input-driven purchases and redemptions. Users edit
what they spend and receive a read-only estimate. Backend and contract
exact-out capabilities remain retained for later work. The
[prior two-mode specification](deferred/basket-flows.md) preserves the deferred
acceptance cases; it does not describe active output entry.

## Input driven acceptance

1. Enter each supported spend asset and obtain an exact-in quote. The receive
   amount displays the selected plan's estimate and minimum received.
2. Focus, click, type or paste into the receive amount or any receive basket
   component. No output-target mode, request or amount mutation is activated;
   estimates remain selectable and copyable.
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

## Wallet limited proportional MAX

Choose the positive-weight asset whose wallet balance divided by its raw-unit
basket proportion is smallest. Use that full raw balance as the driver and
floor the other derived component budgets in canonical order. Compare ratios
with BigInt; ties use canonical order. Zero-weight members do not limit MAX;
a known zero positive-weight balance produces a zero basket, and unavailable
balances remain unavailable.

Verify unequal weights, mixed decimals, tiny values, ties and wide integers.
Quoted/submitted amounts retain full raw precision despite shortened display.
Changing provider, conversion price, fees, tolerance or mint capacity cannot
change MAX. Quote-specific capacity errors remain ordinary quote outcomes;
MAX does not silently shrink the spend budget. Native token gas reservation
belongs to its separate single-token MAX flow.

## Mixed output recovery acceptance

These checks are part of the clean-launch basket flow, not a migration case:

1. Impair an asset and redeem an exact CYGLD amount to BASKET.
   - expect: The BASKET quote contains ordered current ERC-20 reserve outputs.
   - expect: Estimated Core ERC-1155 recovery shares are displayed separately
     by impaired asset and are never counted in basket value or component
     amounts.
   - expect: Execution credits the final wallet with the exact healthy vector
     and bound recovery-asset/share-amount vector from the generic mixed quote.
     Share IDs are derived from impaired-asset addresses.
2. Focus, select and copy received BASKET component estimates.
   - expect: Components remain read-only; no output-target quote is sent.
   - expect: The ordinary exact-input redemption retains complete mixed minima.
3. Change the basket or impaired-asset set after a basket quote and submit the
   stale form.
   - expect: Complete descriptor binding rejects the stale execution without a
     mode, epoch, transition nonce, or historical guard.
4. Issue CYGLD while an impaired pool exists.
   - expect: Issuance uses only the current ordered Core inputs and does not
     select a recovery-specific function family.
5. Make one live reserve balance unreadable.
   - expect: Its redemption output is zero. Other positive outputs may proceed
     with a zero minimum for that leg; an all-zero redemption is rejected before
     burn.
