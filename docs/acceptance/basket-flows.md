---
title: CyberGold basket-flow acceptance specification
doc_type: acceptance-specification
status: completed
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-07-23
canonical_for: App basket-flow acceptance requirements
---

# CyberGold Basket Flows Test Acceptance Specification

## Application Overview

CyberGold basket issuance and redemption test plan on /en with MetaMask integration. Includes issue and redeem flows plus middle swap-direction button toggles.

## Mixed-output recovery acceptance

These checks are part of the clean-launch basket flow, not a migration case:

1. Impair an asset and redeem an exact CYGLD amount to BASKET.
   - expect: The BASKET quote contains ordered current ERC-20 reserve outputs.
   - expect: Estimated Core ERC-1155 recovery shares are displayed separately
     by impaired asset and are never counted in basket value or component
     amounts.
   - expect: Execution credits the final wallet with the exact healthy vector
     and bound recovery-asset/share-amount vector from the generic mixed quote.
     Share IDs are derived from impaired-asset addresses.
2. Make BASKET exact-out editable while an impaired leg exists.
   - expect: An exact-output preview derives the gross CYGLD input, after which
     the ordinary exact-input basket executor is submitted with complete mixed
     minima.
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

## Shared Test Data

Use shared values from `tests/test-data/cybergold-flow-data.ts`:

```ts
import { cybergoldFlowData } from "../tests/test-data/cybergold-flow-data";

const { basketIn } = cybergoldFlowData.issueFromBasketExactIn;
const { cygldOut } = cybergoldFlowData.issueFromBasketExactOut;
const { cygldIn } = cybergoldFlowData.redeemToBasketExactIn;
const { basketOut } = cybergoldFlowData.redeemToBasketExactOut;
```

## Test Scenarios

### 1. Issue From Basket Exact In

**Seed:** `tests/seed.spec.ts`

#### 1.1. User provides exact basket token amounts and receives quoted CYGLD output

**File:** `tests/metamask/basket-flows/issueFromBasketExactIn/issueFromBasketExactIn.spec.ts`

**Steps:**
  1. Navigate to /en and ensure page loads
    - expect: Page displays 'You Sell' and 'You Buy' sections
    - expect: Sell section shows 'BASKET' selected by default
    - expect: Buy section shows 'CYGLD' selected
    - expect: If wallet is not connected, swap button displays 'Please connect your wallet'
    - expect: If wallet is connected, swap button remains disabled until valid amounts are entered and a quote is calculated
  2. Connect MetaMask if needed
    - expect: MetaMask popup appears
    - expect: Wallet connects successfully
    - expect: User address is displayed in the navbar
    - expect: Swap button remains disabled until valid input and quote are available
  3. Verify BASKET token balances
    - expect: Open wallet balance modal
    - expect: PAXG balance is at least `basketIn.paxg`
    - expect: XAUt balance is at least `basketIn.xaut`
  4. Verify BASKET composition form appears
    - expect: BASKET composition panel displays below 'You Sell'
    - expect: Two token rows visible: PAXG and XAUt
    - expect: Each row shows token icon, symbol, weight percentage, and input field
    - expect: First token or previously active token is the BASKET driver
  5. Enter `basketIn.paxg` PAXG and wait for quote
    - expect: PAXG input accepts `basketIn.paxg`, its fiat equivalent is displayed
    - expect: XAUt calculation shows `basketIn.xaut`, its fiat equivalent is displayed
    - expect: CYGLD amount and its fiat equivalent may show loading placeholders
    - expect: Quote completes successfully
    - expect: You Buy shows a non-zero quoted CYGLD amount, its fiat equivalent is displayed
    - expect: Protocol fee and Helpers fee are displayed in CYGLD and in fiat
    - expect: Transaction gas fee is displayed in ETH and in fiat
    - expect: Swap button becomes enabled
  6. Submit and approve the transaction
    - expect: Swap button shows loading
    - expect: MetaMask Permit2 signature request appears if required
    - expect: Transaction confirmation modal appears
    - expect: Success toast appears
  7. Verify wallet balances after transaction
    - expect: PAXG balance decreases by `basketIn.paxg`
    - expect: XAUt balance decreases by `basketIn.xaut`
    - expect: CYGLD balance increases by the quoted amount in the You Buy section

#### 1.2. Quote fails when basket token balance is insufficient

**File:** `tests/metamask/basket-flows/issueFromBasketExactIn/issueFromBasketExactIn-validation.spec.ts`

**Steps:**
  1. Open /en with wallet connected and insufficient BASKET balances
    - expect: Page loads with BASKET selected in You Sell
  2. Enter 100 PAXG into the BASKET composition
    - expect: PAXG shows 100
    - expect: Swap button remains disabled; a completed quote is not required for the excessive amount
  3. Correct the input amount
    - expect: Quote succeeds
    - expect: CYGLD output appears in You Buy
    - expect: Swap button becomes enabled

#### 1.3. Middle Toggle: Issue From Basket Exact In -> Redeem To Basket Exact Out

**File:** `tests/metamask/basket-flows/issueFromBasketExactIn/middleToggle-issueFromBasketExactIn-toRedeemToBasketExactOut.spec.ts`

**Steps:**
  1. Set up exact-in issue with PAXG `basketIn.paxg` and XAUt `basketIn.xaut`
    - expect: BASKET inputs are visible in You Sell
    - expect: Quoted CYGLD output appears in You Buy
    - expect: A middle direction toggle button is visible
  2. Click the middle toggle button
    - expect: You Sell and You Buy sections swap
    - expect: CYGLD appears in You Sell
    - expect: BASKET appears in You Buy
    - expect: BASKET amounts PAXG `basketIn.paxg` and XAUt `basketIn.xaut` move to the You Buy section 
  3. Verify exact-out redemption behavior
    - expect: Quote triggers for the new exact-out redemption flow
    - expect: Fee details update accordingly
    - expect: Swap button becomes ready after quote

#### 1.4. Quoted CYGLD Click: Issue From Basket Exact In -> Issue From Basket Exact Out

**File:** `tests/metamask/basket-flows/issueFromBasketExactIn/quotedCygldClick-exactIn-toExactOut.spec.ts`

**Steps:**
  1. Start from Issue From Basket Exact In with a quoted CYGLD output
    - expect: You Buy displays the quoted CYGLD amount
    - expect: You Sell BASKET inputs remain stable
  2. Click the quoted CYGLD amount in You Buy
    - expect: The CYGLD amount in You Buy becomes editable
    - expect: BASKET component values become quoted
  3. Verify exact-out issue behavior
    - expect: BASKET component values are shown as quoted amounts
    - expect: CYGLD amount remains displayed in You Buy as an editable input value
    - expect: Swap button remains enabled once the quote is available

### 2. Issue From Basket Exact Out

**Seed:** `tests/seed.spec.ts`

#### 2.1. User requests exact CYGLD output and app calculates required basket inputs

**File:** `tests/metamask/basket-flows/issueFromBasketExactOut/issueFromBasketExactOut.spec.ts`

**Steps:**
  1. Navigate to /en with MetaMask connected and sufficient BASKET balances
    - expect: Page loads with BASKET in You Sell and CYGLD in You Buy
  2. Enter `cygldOut` CYGLD desired output
    - expect: CYGLD input shows `cygldOut`
    - expect: Quote processing begins
    - expect: BASKET amounts and fiat equivalents may show loading placeholders
  3. Wait for quote completion
    - expect: BASKET composition updates with required PAXG and XAUt amounts and their fiat equivalents
    - expect: You Sell shows the BASKET summary in fiat equivalent
  4. Verify calculated requirements
    - expect: PAXG required amount > 0
    - expect: XAUt required amount > 0
    - expect: fiat equivalents are shown
    - expect: Quote status is success
  5. Verify fee details
    - expect: Protocol fee and Helpers fee are displayed in CYGLD and in fiat
    - expect: Transaction gas fee is displayed in ETH and in fiat
    - expect: Fees reflect the gross CYGLD target
  6. Verify wallet sufficiency and submit
    - expect: No balance warnings appear
    - expect: Required component amounts fit wallet capacity
    - expect: Swap button shows loading
    - expect: MetaMask Permit2 signature modal appears
    - expect: Success toast appears
  7. Verify wallet balances after transaction
    - expect: PAXG balance decreases by quoted amount in You Sell section
    - expect: XAUt balance decreases by quoted amount in You Sell section
    - expect: CYGLD balance increases by `cygldOut` in the You Buy section


#### 2.2. Quote fails when calculated basket input would exceed wallet balance

**File:** `tests/metamask/basket-flows/issueFromBasketExactOut/issueFromBasketExactOut-validation.spec.ts`

**Steps:**
  1. Request 100000 CYGLD output on a low-balance wallet
    - expect: Excessive CYGLD output remains visible, formatted if needed
    - expect: Swap button remains disabled; a completed quote is not required for the excessive amount
  2. Reduce output request to 10 CYGLD
    - expect: Quote recalculates
    - expect: Required BASKET amounts fit wallet balance
    - expect: Swap button becomes enabled

#### 2.3. Middle Toggle: Issue From Basket Exact Out -> Redeem To Basket Exact In

**File:** `tests/metamask/basket-flows/issueFromBasketExactOut/middleToggle-issueFromBasketExactOut-toRedeemToBasketExactIn.spec.ts`

**Steps:**
  1. Start with exact-out issue and quoted BASKET amounts
    - expect: You Sell shows BASKET with quoted component amounts
    - expect: You Buy shows editable `cygldOut` CYGLD
    - expect: A middle direction toggle button is visible
  2. Click the middle toggle button
    - expect: You Sell and You Buy sections swap
    - expect: CYGLD appears in You Sell
    - expect: BASKET appears in You Buy
    - expect: The `cygldOut` CYGLD moves to You Sell as the editable exact-in amount
  3. Verify exact-in redemption behavior
    - expect: Quote triggers for the new exact-in redemption flow
    - expect: Fee details update accordingly
    - expect: Swap button becomes ready after quote

#### 2.4. Quoted Basket Click: Issue From Basket Exact Out -> Issue From Basket Exact In

**File:** `tests/metamask/basket-flows/issueFromBasketExactOut/quotedBasketClick-exactOut-toExactIn.spec.ts`

**Steps:**
  1. Start from Issue From Basket Exact Out by clicking the CYGLD field in You Buy and entering `cygldOut`
    - expect: CYGLD field becomes editable before filling
    - expect: CYGLD input shows `cygldOut`
    - expect: BASKET amounts are quoted before clicking a basket amount
  2. Click a quoted PAXG or XAUt amount
    - expect: BASKET component inputs become editable
    - expect: If the clicked quoted amount is not automatically preserved in the driver input, fill the driver with the quoted amount from the exact-out quote
    - expect: CYGLD becomes quoted in You Buy
  3. Verify exact-in issue behavior
    - expect: BASKET inputs are editable in You Sell section for exact-in entry
    - expect: CYGLD output is displayed as a quoted amount
    - expect: Swap button remains disabled until a refreshed quote is calculated

### 3. Redeem To Basket Exact In

**Seed:** `tests/seed.spec.ts`

#### 3.1. User provides exact CYGLD input and receives quoted basket token outputs

**File:** `tests/metamask/basket-flows/redeemToBasketExactIn/redeemToBasketExactIn.spec.ts`

**Steps:**
  1. Navigate to /en with MetaMask connected and sufficient CYGLD balance
    - expect: Page loads
    - expect: Wallet is connected
    - expect: CYGLD balance is at least `cygldIn`
  2. Select CYGLD as the sell token
    - expect: Token picker modal opens
    - expect: CYGLD is listed and selectable
    - expect: You Sell shows CYGLD
    - expect: You Buy shows BASKET
  3. Enter `cygldIn` CYGLD in the sell input
    - expect: CYGLD input is editable
    - expect: Value `cygldIn` appears
  4. Wait for quote completion
    - expect: BASKET composition populates with PAXG and XAUt outputs
    - expect: Quote status is success
  5. Verify quoted  outputs and fees
    - expect: PAXG output is shown
    - expect: XAUt output is shown
    - expect: Both amounts are greater than zero
    - expect: Fiat equivalents are displayed
    - expect: Protocol fee and Helpers fee are displayed in CYGLD and in fiat
    - expect: Transaction gas fee is displayed in ETH and in fiat
  6. Submit and approve redemption
    - expect: Swap button shows loading
    - expect: MetaMask permit signature modal appears
    - expect: Confirm is clicked
    - expect: Transaction confirmation appears
    - expect: Success toast appears
  7. Verify wallet balances
    - expect: CYGLD balance decreases by `cygldIn`
    - expect: PAXG balance increases by the quoted amount in the You Buy section  
    - expect: XAUt balance increases by the quoted amount in the You Buy section  

#### 3.2. Quote fails with zero or negative CYGLD input

**File:** `tests/metamask/basket-flows/redeemToBasketExactIn/redeemToBasketExactIn-validation.spec.ts`

**Steps:**
  1. Set up Redeem To Basket Exact In with CYGLD selected
    - expect: You Sell shows CYGLD
    - expect: You Buy shows BASKET
  2. Leave CYGLD input empty or zero
    - expect: CYGLD input is empty or zero
    - expect: Basket composition shows placeholder values
    - expect: Swap button is disabled
    - expect: Button text indicates invalid amounts
  3. Enter an excessive CYGLD amount
    - expect: Excessive CYGLD amount is displayed, formatted if needed
    - expect: Swap button remains disabled; a completed quote is not required for the excessive amount
  4. Enter `cygldIn` CYGLD
    - expect: Quote recalculates
    - expect: Basket output amounts are calculated
    - expect: Swap button becomes enabled
    - expect: Quote triggers
    - expect: Basket amounts are calculated
    - expect: Swap button becomes enabled

#### 3.3. Middle Toggle: Redeem To Basket Exact In -> Issue From Basket Exact Out

**File:** `tests/metamask/basket-flows/redeemToBasketExactIn/middleToggle-redeemToBasketExactIn-toIssueFromBasketExactOut.spec.ts`

**Steps:**
  1. Start from Redeem To Basket Exact In with `cygldIn` CYGLD and quoted BASKET outputs
    - expect: You Sell shows editable CYGLD input
    - expect: You Buy shows quoted BASKET outputs
    - expect: A middle direction toggle button is visible
  2. Click the middle toggle button
    - expect: You Sell and You Buy sections swap
    - expect: BASKET appears in You Sell
    - expect: CYGLD appears in You Buy
    - expect: The `cygldIn` CYGLD moves to You Buy as the editable exact-out target amount
  3. Verify Issue From Basket Exact Out flow
    - expect: Quote triggers for the new exact-out issue flow
    - expect: Fee details update accordingly
    - expect: Swap button remains disabled until refreshed quote completes    

#### 3.4. Quoted Basket Click: Redeem To Basket Exact In -> Redeem To Basket Exact Out

**File:** `tests/metamask/basket-flows/redeemToBasketExactIn/quotedBasketClick-exactIn-toExactOut.spec.ts`

**Steps:**
  1. Start from Redeem To Basket Exact In with quoted BASKET outputs
    - expect: You Sell shows editable CYGLD input
    - expect: You Buy shows non-zero quoted PAXG and XAUt outputs
  2. Click a quoted BASKET component or BASKET summary
    - expect: CYGLD becomes quoted in You Sell
    - expect: BASKET outputs become editable in You Buy
    - expect: If the clicked quoted amount is not automatically preserved in the driver input, fill the driver with the quoted amount from the exact-in quote
  3. Verify Redeem To Basket Exact Out flow
    - expect: BASKET outputs are editable as exact-out targets in You Buy
    - expect: CYGLD input is recalculated and displayed as a non-zero quoted value in You Sell
    - expect: Swap button becomes enabled after the refreshed quote completes


### 4. Redeem To Basket Exact Out

**Seed:** `tests/seed.spec.ts`

#### 4.1. User requests exact basket token outputs and app calculates required CYGLD input

**File:** `tests/metamask/basket-flows/redeemToBasketExactOut/redeemToBasketExactOut.spec.ts`

**Steps:**
  1. Navigate to /en with MetaMask connected and sufficient CYGLD balance
    - expect: Page loads
    - expect: Wallet is connected
    - expect: CYGLD balance is sufficient for the requested `basketOut` targets
  2. Set up CYGLD as sell token and BASKET as buy token
    - expect: CYGLD is selected directly from the You Sell token dropdown
    - expect: You Sell shows CYGLD
    - expect: You Buy shows BASKET
    - expect: BASKET composition appears
  3. Activate exact-out mode for BASKET
    - action: Enter `cygldIn` CYGLD to get a temporary BASKET quote, then click the quoted PAXG side
    - expect: PAXG becomes editable as the exact-out target
  4. Enter `basketOut.paxg` PAXG as exact BASKET output
    - expect: PAXG input shows `basketOut.paxg`
    - expect: XAUt calculation shows `basketOut.xaut`
    - expect: PAXG remains `basketOut.paxg` when XAUt is calculated
  5. Wait for quote completion
    - expect: Quote spinner appears
    - expect: You Sell updates with the required CYGLD amount
    - expect: Quote status is success
  5. Verify results and fees
    - expect: CYGLD amount is greater than zero
    - expect: Fiat equivalent is displayed
    - expect: Quote status indicates success
    - expect: Protocol and Helpers fees are shown in CYGLD and in fiat
    - expect: Transaction gas fee is displayed in ETH and in fiat
  6. Submit and approve redemption
    - expect: Swap button shows loading
    - expect: MetaMask permit signature modal appears
    - expect: Transaction confirmation modal appears
    - expect: Success toast appears
  7. Verify wallet balances
    - expect: CYGLD balance decreases by calculated amount in You Sell section
    - expect: PAXG balance increases by `basketOut.paxg`
    - expect: XAUt balance increases by `basketOut.xaut`

#### 4.2. Quote fails when requested basket outputs exceed available CYGLD

**File:** `tests/metamask/basket-flows/redeemToBasketExactOut/redeemToBasketExactOut-validation.spec.ts`

**Steps:**
  1. Request PAXG: 10 
    - expect: PAXG input shows 10
  2. Observe quote behavior
    - expect: Quote may fail or show required CYGLD > available balance or insufficient protocol supply error
    - expect: Swap button remains disabled; a completed quote is not required for the excessive amount
  3. Reduce outputs to minimal values
    - expect: Quote recalculates
    - expect: Required CYGLD fits wallet balance
    - expect: Swap button becomes enabled

#### 4.3. Middle Toggle: Redeem To Basket Exact Out -> Issue From Basket Exact In

**File:** `tests/metamask/basket-flows/redeemToBasketExactOut/middleToggle-redeemToBasketExactOut-toIssueFromBasketExactIn.spec.ts`

**Steps:**
  1. Start from Redeem To Basket Exact Out with BASKET outputs set to `basketOut.paxg` PAXG and `basketOut.xaut` XAUt
    - expect: You Sell shows quoted CYGLD amount
    - expect: You Buy shows editable exact-out BASKET targets
    - expect: A middle direction toggle button is visible
  2. Click the middle toggle button
    - expect: You Sell and You Buy sections swap
    - expect: BASKET appears in You Sell with `basketOut.paxg` PAXG and `basketOut.xaut` XAUt amounts
    - expect: CYGLD appears in You Buy
  3. Verify Issue From Basket Exact In flow
    - expect: Quote triggers for the new exact-in issue flow
    - expect: Fee details update accordingly
    - expect: Swap button remains disabled until refreshed quote completes


#### 4.4. Quoted CYGLD Click: Redeem To Basket Exact Out -> Redeem To Basket Exact In

**File:** `tests/metamask/basket-flows/redeemToBasketExactOut/quotedCygldClick-exactOut-toExactIn.spec.ts`

**Steps:**
  1. Start from Redeem To Basket Exact Out with quoted CYGLD output
    - expect: You Buy shows exact-out BASKET targets
    - expect: You Sell shows quoted CYGLD amount
  2. Click the quoted CYGLD amount in You Sell
    - expect: CYGLD becomes editable in You Sell
    - expect: The quoted CYGLD amount is preserved as the exact-in driver, or is re-entered from the captured quote if the UI clears it
    - expect: BASKET outputs become quoted in You Buy
  3. Verify Redeem To Basket Exact In flow
    - expect: CYGLD input is editable in You Sell
    - expect: PAXG and XAUt are displayed as quoted result buttons in You Buy
    - expect: Swap button is enabled after the refreshed quote completes
