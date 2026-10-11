---
title: CyberGold token-flow acceptance specification
doc_type: acceptance-specification
status: completed
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-09-22
canonical_for: App token-flow acceptance requirements
---

# CyberGold Token Flows Test Acceptance Specification

## Application Overview

CyberGold token-route issuance and redemption test plan on /en with MetaMask integration. Covers CYGLD issuance from a single non-CYGLD token and CYGLD redemption to a single non-CYGLD token, including exact-in, exact-out/min-out, middle swap-direction button toggles, and quoted-value click mode changes.

## Mixed-output recovery acceptance

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
3. Make the exact-out token side editable while an impaired leg exists.
   - expect: The App derives a gross CYGLD input with previews and submits the
     ordinary exact-in token/native executor with a final aggregate floor and
     complete Core minima.
   - expect: Any recovery shares projected by the final preview remain visible
     and are forwarded unchanged.
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

## Shared Test Data

Add token-route values to `tests/test-data/cybergold-flow-data.ts`:

```ts
export const cybergoldFlowData = {
  // existing basket-flow values...
  issueFromTokenExactIn: {
    tokenCases: [
      { tokenSymbol: "PAXG", tokenIn: "0.1" },
      { tokenSymbol: "USDC", tokenIn: "100" },
      { tokenSymbol: "ETH", tokenIn: "0.1" },
    ],
  },
  issueFromTokenExactOut: {
    tokenSymbol: "USDC",
    cygldOut: "10",
  },
  redeemToTokenExactIn: {
    tokenSymbol: "USDC",
    cygldIn: "10",
  },
  redeemToTokenExactOut: {
    tokenSymbol: "USDC",
    tokenOut: "10",
  },
} as const;
```

For `issueFromTokenExactIn.spec.ts`, cover PAXG `0.1`, USDC `100`, and ETH `0.1` in sequence. For the other token-route specs, use USDC for primary coverage because the funded wallet setup already expects USDC. Confirm values against `tests/seed.spec.ts` and the current wallet balances before implementing.

## Test Scenarios

### 1. Issue From Token Exact In

**Seed:** `tests/seed.spec.ts`

#### 1.1. User provides exact PAXG, USDC, and ETH inputs in sequence and receives quoted CYGLD outputs

**File:** `tests/metamask/token-flows/issueFromTokenExactIn/issueFromTokenExactIn.spec.ts`

**Steps:**
  1. Navigate to /en and ensure page loads
    - expect: Page displays 'You Sell' and 'You Buy' sections
    - expect: A non-CYGLD sell token can be selected
    - expect: CYGLD is selected in You Buy after choosing the sell token
    - expect: If wallet is not connected, swap button displays 'Please connect your wallet'
    - expect: If wallet is connected, swap button remains disabled until valid input and quote are available
  2. Connect MetaMask if needed
    - expect: MetaMask popup appears
    - expect: Wallet connects successfully
    - expect: User address is displayed in the navbar
  3. For each configured token case, PAXG `0.1`, USDC `100`, and ETH `0.1`, perform the same exact-in issue flow
    - expect: Token picker opens
    - expect: Token row for the current token is visible and selectable
    - expect: You Sell shows the current token
    - expect: You Buy shows CYGLD
    - expect: Selected token balance is at least `0.1`
    - expect: Sell input accepts `0.1`
    - expect: Sell fiat equivalent is displayed
    - expect: Quote processing begins and may show progress
    - expect: You Buy shows a non-zero quoted CYGLD amount
    - expect: CYGLD fiat equivalent is displayed
    - expect: Protocol fee and Helpers fee are displayed in CYGLD and in fiat
    - expect: Transaction gas fee is displayed in ETH and in fiat
    - expect: Swap button becomes enabled
    - expect: Swap button shows loading after submit
    - expect: MetaMask Permit2 signature request appears for PAXG and USDC if required
    - expect: ETH input handles WETH wrap and approval steps if required
    - expect: Transaction confirmation modal appears
    - expect: Success toast appears
    - expect: Selected token balance decreases
    - expect: CYGLD balance increases

#### 1.2. Quote fails when token balance is insufficient

**File:** `tests/metamask/token-flows/issueFromTokenExactIn/issueFromTokenExactIn-validation.spec.ts`

**Steps:**
  1. Open /en with wallet connected and select the configured sell token
    - expect: You Sell shows the selected token
    - expect: You Buy shows CYGLD
  2. Enter a token amount greater than the wallet balance
    - expect: Sell amount remains visible and appears in red
    - expect: Quote may fail or be prevented
    - expect: Swap button remains disabled; a completed quote is not required for the excessive amount
  3. Reduce the input to an amount covered by the connected wallet
    - expect: If the wallet can cover `issueFromTokenExactIn.tokenIn`, use that value
    - expect: Otherwise use a safely lower amount derived from the displayed wallet balance
    - expect: Warning disappears
    - expect: Quote recalculates and succeeds
    - expect: CYGLD output appears in You Buy
    - expect: Swap button becomes enabled

#### 1.3. Middle Toggle: Issue From Token Exact In -> Redeem To Token Exact Out

**File:** `tests/metamask/token-flows/issueFromTokenExactIn/middleToggle-issueFromTokenExactIn-toRedeemToTokenExactOut.spec.ts`

**Steps:**
  1. Start from Issue From Token Exact In using the USDC `100` exact-in case with a quoted CYGLD output
    - expect: You Sell shows editable selected-token input
    - expect: You Buy shows quoted CYGLD output
    - expect: A middle direction toggle button is visible
  2. Click the middle toggle button
    - expect: You Sell and You Buy sections swap
    - expect: CYGLD appears in You Sell
    - expect: Selected token appears in You Buy
    - expect: The original selected-token amount moves to You Buy
  3. Verify redeem-to-token exact-out behavior
    - expect: Quote triggers for the new flow
    - expect: Required CYGLD input is calculated
    - expect: Fee details update accordingly
    - expect: Swap button remains disabled until refreshed quote completes

#### 1.4. Quoted CYGLD Click: Issue From Token Exact In -> Issue From Token Exact Out

**File:** `tests/metamask/token-flows/issueFromTokenExactIn/quotedCygldClick-exactIn-toExactOut.spec.ts`

**Steps:**
  1. Start from Issue From Token Exact In with PAXG `0.1` and a quoted CYGLD output
    - expect: You Sell PAXG input remains editable
    - expect: You Buy displays the quoted CYGLD amount
  2. Click the quoted CYGLD amount in You Buy
    - expect: CYGLD amount in You Buy becomes editable
    - expect: The quoted CYGLD value is preserved as the exact-out target
    - expect: PAXG sell amount becomes quoted
  3. Verify exact-out issue behavior
    - expect: Required PAXG input is recalculated and shown as a non-zero quoted amount
    - expect: CYGLD remains displayed as an editable target
    - expect: Fee details update for the exact-out issue flow

### 2. Issue From Token Exact Out

**Seed:** `tests/seed.spec.ts`

#### 2.1. User requests exact CYGLD output and app calculates required token input

**File:** `tests/metamask/token-flows/issueFromTokenExactOut/issueFromTokenExactOut.spec.ts`

**Steps:**
  1. Navigate to /en with MetaMask connected and sufficient selected-token balance
    - expect: Page loads
    - expect: Wallet is connected
  2. Select `issueFromTokenExactOut.tokenSymbol` in You Sell and CYGLD in You Buy
    - expect: You Sell shows the selected token
    - expect: You Buy shows CYGLD
  3. Enter `issueFromTokenExactOut.cygldOut` CYGLD desired output in You Buy
    - expect: CYGLD input shows the requested amount
    - expect: Quote processing begins
    - expect: Selected-token amount may show loading or placeholder state
  4. Wait for quote completion
    - expect: You Sell updates with required selected-token amount
    - expect: Required selected-token amount is greater than zero
    - expect: Fiat equivalents are displayed
    - expect: Quote status is success
  5. Verify fee details
    - expect: Protocol fee and Helpers fee are displayed in CYGLD and in fiat
    - expect: Transaction gas fee is displayed in ETH and in fiat
    - expect: Fees reflect the gross CYGLD target
  6. Submit and approve the transaction
    - expect: Required selected-token amount fits wallet capacity
    - expect: Swap button shows loading
    - expect: MetaMask Permit2 signature request appears for ERC20 input if required
    - expect: Transaction confirmation modal appears
    - expect: Success toast appears
  7. Verify wallet balances after transaction
    - expect: Selected token balance decreases by quoted amount in You Sell section
    - expect: CYGLD balance increases by `issueFromTokenExactOut.cygldOut`

#### 2.2. Quote fails when calculated token input would exceed wallet balance

**File:** `tests/metamask/token-flows/issueFromTokenExactOut/issueFromTokenExactOut-validation.spec.ts`

**Steps:**
  1. Request an overlarge CYGLD output
    - expect: Quote processes or fails with an actionable quote error
    - expect: Required token input is unavailable for swap or, if calculated, appears in red and exceeds wallet balance.
    - expect: Swap button remains disabled; a completed quote is not required for the excessive amount
  2. Reduce output request to `issueFromTokenExactOut.cygldOut`
    - expect: Quote recalculates
    - expect: Required selected-token amount fits wallet balance
    - expect: Warning disappears
    - expect: Swap button becomes enabled

#### 2.3. Middle Toggle: Issue From Token Exact Out -> Redeem To Token Exact In

**File:** `tests/metamask/token-flows/issueFromTokenExactOut/middleToggle-issueFromTokenExactOut-toRedeemToTokenExactIn.spec.ts`

**Steps:**
  1. Start with exact-out issue and quoted selected-token input
    - expect: You Sell shows quoted selected-token amount
    - expect: You Buy shows editable CYGLD target
    - expect: A middle direction toggle button is visible
  2. Click the middle toggle button
    - expect: You Sell and You Buy sections swap
    - expect: CYGLD appears in You Sell
    - expect: Selected token appears in You Buy
    - expect: The requested CYGLD amount moves to You Sell
  3. Verify redeem-to-token exact-in behavior
    - expect: Quote triggers for the new flow
    - expect: Selected-token output is quoted
    - expect: Fee details update accordingly
    - expect: Swap button remains disabled until refreshed quote completes

#### 2.4. Quoted Token Click: Issue From Token Exact Out -> Issue From Token Exact In

**File:** `tests/metamask/token-flows/issueFromTokenExactOut/quotedTokenClick-exactOut-toExactIn.spec.ts`

**Steps:**
  1. Start from Issue From Token Exact Out with quoted selected-token input
    - expect: CYGLD remains editable
    - expect: Selected-token input is quoted
  2. Click the quoted selected-token amount in You Sell
    - expect: Selected-token input becomes editable
    - expect: CYGLD becomes quoted in You Buy
  3. Verify exact-in issue behavior
    - expect: Selected-token input is editable in You Sell
    - expect: CYGLD output is displayed as a quoted amount
    - expect: Swap button remains disabled until a refreshed quote is calculated

### 3. Redeem To Token Exact In

**Seed:** `tests/seed.spec.ts`

#### 3.1. User provides exact CYGLD input and receives quoted token output

**File:** `tests/metamask/token-flows/redeemToTokenExactIn/redeemToTokenExactIn.spec.ts`

**Steps:**
  1. Navigate to /en with MetaMask connected and sufficient CYGLD balance
    - expect: Page loads
    - expect: Wallet is connected
    - expect: CYGLD balance is at least `redeemToTokenExactIn.cygldIn`
  2. Select CYGLD as the sell token and `redeemToTokenExactIn.tokenSymbol` as the buy token
    - expect: Token picker modal opens
    - expect: CYGLD is listed and selectable
    - expect: Selected output token is listed and selectable
    - expect: You Sell shows CYGLD
    - expect: You Buy shows the selected token
  3. Enter `redeemToTokenExactIn.cygldIn` CYGLD in You Sell
    - expect: CYGLD input is editable
    - expect: Value appears in the input
    - expect: Quote processing begins
  4. Wait for quote completion
    - expect: You Buy shows non-zero selected-token output
    - expect: Fiat equivalents are displayed
    - expect: Quote status is success
  5. Verify fee details
    - expect: Protocol fee and Helpers fee are displayed in CYGLD and in fiat
    - expect: Transaction gas fee is displayed in ETH and in fiat
  6. Submit and approve redemption
    - expect: Swap button shows loading
    - expect: MetaMask permit signature modal appears if required for CYGLD
    - expect: Transaction confirmation appears
    - expect: If ETH is selected as output through WETH routing, unwrap step is handled if required
    - expect: Success toast appears
  7. Verify wallet balances
    - expect: CYGLD balance decreases by `redeemToTokenExactIn.cygldIn`
    - expect: Selected token balance increases by the quoted amount in the You Buy section

#### 3.2. Quote fails with zero or invalid CYGLD input

**File:** `tests/metamask/token-flows/redeemToTokenExactIn/redeemToTokenExactIn-validation.spec.ts`

**Steps:**
  1. Set up Redeem To Token Exact In
    - expect: You Sell shows CYGLD
    - expect: You Buy shows the selected output token
  2. Leave CYGLD input empty or enter zero
    - expect: CYGLD input is empty or zero
    - expect: Output token amount remains empty or placeholder
    - expect: Swap button is disabled
    - expect: Button text indicates invalid amounts
  3. Enter an excessive CYGLD amount
    - expect: Excessive CYGLD amount is displayed, formatted if needed
    - expect: Swap button remains disabled; a completed quote is not required for the excessive amount
  4. Enter `redeemToTokenExactIn.cygldIn`
    - expect: Quote triggers
    - expect: Output token amount is calculated
    - expect: Swap button becomes enabled

#### 3.3. Middle Toggle: Redeem To Token Exact In -> Issue From Token Exact Out

**File:** `tests/metamask/token-flows/redeemToTokenExactIn/middleToggle-redeemToTokenExactIn-toIssueFromTokenExactOut.spec.ts`

**Steps:**
  1. Start from Redeem To Token Exact In with quoted selected-token output
    - expect: You Sell shows editable CYGLD input
    - expect: You Buy shows quoted selected-token output
    - expect: A middle direction toggle button is visible
  2. Click the middle toggle button
    - expect: You Sell and You Buy sections swap
    - expect: Selected token appears in You Sell
    - expect: CYGLD appears in You Buy
    - expect: The original CYGLD amount moves to You Buy
  3. Verify Issue From Token Exact Out flow
    - expect: Quote triggers for the new exact-out issue flow
    - expect: Required selected-token input is calculated
    - expect: Fee details update accordingly
    - expect: Swap button remains disabled until refreshed quote completes

#### 3.4. Quoted Token Click: Redeem To Token Exact In -> Redeem To Token Exact Out

**File:** `tests/metamask/token-flows/redeemToTokenExactIn/quotedTokenClick-exactIn-toExactOut.spec.ts`

**Steps:**
  1. Start from Redeem To Token Exact In with quoted selected-token output
    - expect: You Sell shows editable CYGLD input
    - expect: You Buy shows quoted selected-token output
  2. Click the quoted selected-token amount in You Buy
    - expect: CYGLD becomes quoted in You Sell
    - expect: Selected-token output becomes editable in You Buy
    - expect: The editable selected-token output keeps the clicked quote value, allowing small quote-refresh drift
  3. Verify Redeem To Token Exact Out behavior
    - expect: Selected-token output is editable as exact-out/min-out target
    - expect: CYGLD input is displayed as a quoted required amount
    - expect: Swap button remains disabled until refreshed quote completes

### 4. Redeem To Token Exact Out / Min Out

**Seed:** `tests/seed.spec.ts`

#### 4.1. User requests exact token output and app calculates required CYGLD input

**File:** `tests/metamask/token-flows/redeemToTokenExactOut/redeemToTokenExactOut.spec.ts`

**Steps:**
  1. Navigate to /en with MetaMask connected and sufficient CYGLD balance
    - expect: Page loads
    - expect: Wallet is connected
  2. Select CYGLD as the sell token and `redeemToTokenExactOut.tokenSymbol` as the buy token
    - expect: You Sell shows CYGLD
    - expect: You Buy shows the selected token
  3. Enter `redeemToTokenExactOut.tokenOut` in You Buy
    - expect: Selected-token output input shows the requested value
    - expect: Quote processing begins
  4. Wait for quote completion
    - expect: You Sell updates with required CYGLD amount
    - expect: Required CYGLD amount is greater than zero
    - expect: Fiat equivalents are displayed
    - expect: Quote status is success
  5. Verify fee details
    - expect: Protocol fee and Helpers fee are displayed in CYGLD and in fiat
    - expect: Transaction gas fee is displayed in ETH and in fiat
  6. Submit and approve redemption
    - expect: Required CYGLD amount fits wallet capacity
    - expect: Swap button shows loading
    - expect: MetaMask permit signature modal appears if required
    - expect: Transaction confirmation modal appears
    - expect: Success toast appears
  7. Verify wallet balances
    - expect: CYGLD balance decreases by calculated amount in You Sell section
    - expect: Selected token balance increases by at least `redeemToTokenExactOut.tokenOut`

#### 4.2. Quote fails when requested token output is impossible or too small

**File:** `tests/metamask/token-flows/redeemToTokenExactOut/redeemToTokenExactOut-validation.spec.ts`

**Steps:**
  1. Request an overlarge selected-token output
    - expect: Required CYGLD input is unavailable for swap or, if calculated, appears in red and exceeds wallet balance
    - expect: Swap button remains disabled; a completed quote is not required for the excessive amount
  2. Request a dust-sized selected-token output if the route has a minimum output threshold
    - expect: Quote fails with an amount-too-small or route-unavailable state
    - expect: Swap button remains disabled
  3. Reduce or increase output to `redeemToTokenExactOut.tokenOut`
    - expect: Quote recalculates
    - expect: Required CYGLD fits wallet balance
    - expect: Warning disappears
    - expect: Swap button becomes enabled

#### 4.3. Middle Toggle: Redeem To Token Exact Out -> Issue From Token Exact In

**File:** `tests/metamask/token-flows/redeemToTokenExactOut/middleToggle-redeemToTokenExactOut-toIssueFromTokenExactIn.spec.ts`

**Steps:**
  1. Start from Redeem To Token Exact Out with selected-token output set to `redeemToTokenExactOut.tokenOut`
    - expect: You Sell shows quoted CYGLD amount
    - expect: You Buy shows editable selected-token output target
    - expect: A middle direction toggle button is visible
  2. Click the middle toggle button
    - expect: You Sell and You Buy sections swap
    - expect: Selected token appears in You Sell with `redeemToTokenExactOut.tokenOut`
    - expect: CYGLD appears in You Buy
  3. Verify Issue From Token Exact In flow
    - expect: Quote triggers for the new exact-in issue flow
    - expect: CYGLD output is quoted
    - expect: Fee details update accordingly
    - expect: Swap button remains disabled until refreshed quote completes

#### 4.4. Quoted CYGLD Click: Redeem To Token Exact Out -> Redeem To Token Exact In

**File:** `tests/metamask/token-flows/redeemToTokenExactOut/quotedCygldClick-exactOut-toExactIn.spec.ts`

**Steps:**
  1. Start from Redeem To Token Exact Out with quoted CYGLD input
    - expect: You Buy shows editable selected-token output target
    - expect: You Sell shows quoted CYGLD amount
  2. Click the quoted CYGLD amount in You Sell
    - expect: CYGLD becomes editable in You Sell
    - expect: The editable CYGLD input keeps the clicked quote value, allowing small quote-refresh drift
    - expect: Selected-token output becomes quoted in You Buy
  3. Verify Redeem To Token Exact In flow
    - expect: CYGLD input is editable in You Sell
    - expect: Selected-token output is displayed as a quoted result in You Buy
    - expect: Swap button remains disabled until refreshed quote completes
