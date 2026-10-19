---
title: CyberGold App end-to-end test guide
doc_type: test-guide
status: active
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-10-19
canonical_for: App Playwright and Synpress end-to-end test operation
---

# MetaMask E2E Tests

This directory contains the Synpress + Playwright MetaMask flow for CyberGold.

Current coverage:
- connect MetaMask to the app
- handle MetaMask unlock / connect / network confirmation prompts
- open the wallet menu
- verify the balances modal is visible
- verify funded token rows are present
- test issue and redeem basket flows, including exact-in, exact-out, validation, toggle, and quoted-value click behavior

## Files

- *.spec.ts files are the test files, e.g.:
 [connect-and-balances.spec.ts](./metamask/connect-and-balances.spec.ts) - this opens the app, connects MetaMask, and checks balances.
- [testWithMetaMask.ts](./metamask/testWithMetaMask.ts)
  The bridge between Playwright and Synpress. It gives the test a ready-to-use `metamask` fixture.
- [metamask.setup.ts](../wallet-setup/metamask.setup.ts)
  The wallet preparation step. It imports the wallet from the seed phrase and builds the reusable MetaMask cache.

Simple difference:
- `metamask.setup.ts` prepares MetaMask
- `testWithMetaMask.ts` wires that setup into the test runner
- `connect-and-balances.spec.ts` runs the real user flow against the app

## Requirements

- Node.js 26.10.0, matching the repository runtime
- npm
- Playwright browsers installed
- A funded **disposable test-only** wallet seed phrase and password; never use a
  wallet that holds real assets or has been used on a public network
- A running local chain / RPC that matches the app env, typically Anvil

## Environment Variables

These vars are used by the MetaMask flow:

```env
SYNPRESS_WALLET_SEED_PHRASE="word1 word2 word3 ..."
SYNPRESS_WALLET_PASSWORD="your-test-password"
SYNPRESS_EXPECTED_FUNDED_TOKENS="eth,xaut,paxg,usdt,usdc"
```

Notes:
- `SYNPRESS_WALLET_SEED_PHRASE` and `SYNPRESS_WALLET_PASSWORD` are required by `wallet-setup/metamask.setup.ts`.
- `SYNPRESS_EXPECTED_FUNDED_TOKENS` is optional. If set, the test also checks those token rows and amounts.
- App chain/contracts come from `.env.local`. Current application and wallet-library reads use fixed same-origin APIs; Next.js holds `CYBERGOLD_BACKEND_URL` and its private bearer. `NEXT_PUBLIC_RPC_URL` is ignored. `NEXT_PUBLIC_WALLET_RPC_URL` supplies the wallet's network endpoint for signing/submission; it must address the same disposable test chain. See the [environment guide](../docs/architecture/environment.md).

## Install

From the repo root:

```bash
npm install
npm exec --package=playwright@1.60.0 -- playwright install chromium
```

Native Linux is recommended for the MetaMask browser-extension tests. WSL is not recommended because extension automation can be less stable there.

The ordinary hosted browser-smoke job runs `tests/e2e` with Chromium fixtures.
It does not run this MetaMask extension suite or prove real wallet signing.
The extension suite requires its separate disposable funded chain/wallet setup.
Never point its mutating tests at Mainnet or a real-asset wallet. The controlled
deployed Sandbox mode below uses its dedicated disposable test wallet.

### Session-only extension qualification

[wallet-session.spec.ts](./metamask/wallet-session.spec.ts) covers actual MetaMask
connection, reload/disconnect/reconnect, connection rejection and retry, and
recovery from the wrong network. It uses Synpress's disposable Anvil pool and
a new test-only wallet; no protocol funding, deployed backend or transaction
signature is needed. Fixed product API outages are explicit `503` browser
fixtures, and every scenario asserts that no App `/api/rpc` request is made.

Start a local App with `tests/fixtures/app.env` (chain `31337`) and provide the
same disposable Synpress wallet variables used when building the cache. Use a
local origin only. With that server running, select just this file:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3098 PLAYWRIGHT_EXTERNAL_SERVER=1 \
NEXT_PUBLIC_CHAIN_ID=31337 \
npm exec -- playwright test tests/metamask/wallet-session.spec.ts \
  --project=metamask --trace=off --retries=0
```

The test-only prompt driver uses MetaMask's current confirmation test IDs rather
than Synpress's older settings/footer selectors. Synpress supplies wallet setup
and the disposable Anvil pool; the fixture imports the test wallet into a fresh
private Chromium profile for each case. This scoped local run
is separate from the funded issue/redeem suite and the hosted Chromium job; it
adds no required CI job or repository-protection setting.

### Current fixed API funded qualification

[qualify-fixed-api-wallet.py](../scripts/qualify-fixed-api-wallet.py) exports the
committed App source, builds a production frontend, and starts an owned Anvil,
the actual Python backend image and disposable PostgreSQL 18. It generates a
new wallet and Synpress cache, funds only that local wallet from the Protocol
fixture, and unpauses only the local Core copy using the approved contract
bundle. There is no deployed server change or public-chain transaction.

With Node 26.10.0, the locked App dependencies (`npm ci`), Foundry 1.7.1,
Python 3.13, Docker and Playwright browsers installed, run from the workspace:

```bash
cybergold-ops/scripts/with-authenticated-rpc.sh -- \
  python3 cybergold-app/scripts/qualify-fixed-api-wallet.py \
  --backend-image ghcr.io/cybergold-io/cybergold-backend-b2b-sandbox@sha256:f8d5b2790f409a086e8f1b90d57ed88fbea0ecd0c39819da86cac6c652badb4e \
  --contracts-json cybergold-ops/deploy/config/mainnet-app-contracts.json \
  --funding-json cybergold-protocol/config/deploy-config.json \
  --output-dir cybergold-app/out/wallet-qualification
```

The wrapper uses the separate local tooling RPC credential; no backend bearer
or existing wallet seed is needed. Pull the private backend image with normal
registry access first, or pass an already-built local Python image. On Linux
run the command under `xvfb-run -a` if no desktop display is available. The
extension runs in headed mode; a virtual display supplies its browser windows.

The command runs the session/network scenarios and the shared 24-scenario UI
matrix in [fixed-api-roundtrips.spec.ts](./metamask/fixed-api-roundtrips.spec.ts).
It enters PAXG, USDC, native ETH and basket buy/sell exact-input intents
at three nominal sizes, signs through MetaMask, and checks actual operation,
integer bounds, fees, refunds, native gas and wallet effects on its owned fork.
The other qualified provider plan receives a separate retained-plan execution
check. The existing ordinary allowance, permit/Permit2, mixed-basket funding,
rejection and cleanup assertions remain in component tests and explicit
independent diagnostic cases; the legacy 20 producer inventory is not a second
operating matrix. Controlled browser fixtures with synthetic providers/receipts
are UI integration evidence, not qualification of actual provider settlement.

### Independent Sandbox scenarios and the sequential suite

The private Sandbox suite uses the same UI matrix and settlement assertions as
the sequential suite. Its host orchestrator captures the complete Sandbox Anvil
state overlay and loads it over the same original immutable fork base. This
preserves Sandbox changes that do not change its block header, without later
lazy reads from the mutable Sandbox. The dedicated test wallet inherits its
Sandbox balances; preparation then saves a CYGLD bootstrap, an owned snapshot
and one frozen matrix. A source-state digest identifies the captured overlay.
The upstream base alone never substitutes for Sandbox state, and the host never
restores the shared Sandbox.

Both UI suites use funded PAXG for the one-time wallet cancellation check before
the PAXG bootstrap. The check still requires a real MetaMask rejection and an
unchanged CYGLD balance. It does not require an unrelated ETH route to quote
before other scenarios can start. All six active native ETH scenarios remain in
the matrix, with both directions and three nominal sizes. The twelve both-mode
ETH definitions remain available with the complete retained capability inventory.

Before every winner or alternate attempt, the host restores that prepared owned
snapshot, recreates the private PostgreSQL database and Backend process, and
restarts the private frontend with an empty runtime cache. This is an explicit
**cold cache baseline**; it does not copy live shared caches. Each attempt starts
a new Playwright process and private Chromium profile, imports the same
disposable wallet, and reconnects it. Wallet pending requests, nonce observations,
permissions, App browser storage and browser query caches do not carry across
attempts. The restored chain contains the same wallet balances, approvals and
account nonce before each compared attempt.
The private node advances one second per mined block after each restore, so
automining does not introduce different wall-clock timestamps between roles.

The UI winner is executed first. Its original unsigned provider selection stays
in the private fixture workspace. After a separate full reset, the alternate
uses that exact captured losing plan through the existing retained-plan
revalidation and wallet execution contract. A revalidated plan has a separate
digest. A missing, unsupported or unqualified alternate is reported as not
attempted; it is not counted as a successful transaction. Preparation/bootstrap
transactions are fixture evidence, not matrix passes.

The internal wallet phases are `TRADE_REGRESSION_PRIVATE_PHASE=prepare`, `winner`
and `alternate`. The host supplies the scenario, frozen matrix, private selection
file and reset evidence. The report labels the suite `independent`, records
source and prepared block anchors and the cold-cache generation, and labels
alternate comparisons `restored-baseline`. Those fields are observations of
the owning host's reset operation; the wallet process performs no chain or cache
reset itself. The separate `sequential` suite retains the existing warm-state
behavior, including changes caused by earlier settled trades.

The cache command uses Synpress's extension download and wallet setup with the
same current Chromium as the tests; an old browser's Linux profile is not reused.
Synpress supplies the session Anvil pool. The shared fixture uses Playwright to
explicitly load the extension and import the disposable wallet into a fresh
private profile because the pinned Synpress startup driver omits the load
argument needed by current Chromium. The driver opens MetaMask's native request
view when Chromium does not automatically open a notification window, keeps an
already-open request view without reloading it, and foregrounds native controls
before interacting. It uses native MetaMask 13.13.1 controls without modifying the extension or substituting
its provider responses.
The fixture closes and discards each private profile; the runner removes its own
services, chain, credentials and cache even when a test fails. Nonsecret
results/logs remain in the output directory. `qualification.json` records the
available App/backend identities, test file hashes and fork anchor before wallet
tests, then records pass/fail, the bounded failure stage/class and each owned
cleanup outcome even after failures. Successful runs also record wallet
transaction receipts. Hosted execution and GitHub required merge checks
are separate workstreams; this command introduces no required CI job.

### Deployed regression runner

[matrix.ts](./trading/matrix.ts) retains the complete capability definitions: four
counterasset choices (PAXG, USDC, native ETH, basket), two directions, two amount
modes and three nominal dollar tiers ($1/$100/$10,000), totaling 48 definitions.
Its shared active selector chooses exact-input journeys for ordinary quote,
wallet, private independent and fork matrices. This means **24 primary UI
journeys, 48 Core/Market assessment slots and up to 48 trade executions**,
comprising 24 UI winners and 24 retained alternates when qualified. Setup, approvals,
supplementary tests and diagnostic repetitions have separate counts.

The complete `matrixTemplates()` inventory and legacy `tradeScenarios` keep their
exact-output definitions and stable IDs. Existing explicitly named provider
diagnostics remain separate and retain their actual selected amount mode; they
report one selected scenario and one provider assessment. This change adds no
bulk provider mode, amount-mode flag or output-editing switch. Diagnostic/full
run policy remains independent: full runs finish the selected exact-input
inventory. Component exact-output execution tests remain necessary for
input-budget purchases.

The low-level browser observer's omitted-inventory compatibility fallback uses
eight legacy exact-input Core seeds. Operating entry points supply the sized
24-case matrix explicitly; the fallback is not a second operating profile.

Case IDs retain the existing `core-issue` and `core-redeem` economic-family
labels for report compatibility. Those labels do not choose the provider:
`selectedProvider` and the separate provider/execution records identify whether
Core or Market supplied and executed the selected plan.

One recorded valuation snapshot sizes the edited side using rational integer
arithmetic and floor rounding to token raw units. It declares USDC=$1, derives
marginal prices from the product's configured reference-pool observations,
treats ETH as WETH for valuation, and values CYGLD through the observed basket
weights/conversions. This is an indicative sizing basis, not a guaranteed
execution price or liquidation value; gas is excluded. Basket edits retain the
complete ordered vector produced by the UI's target-weight/decimal rule.
Failed observations do not block unrelated scenarios: cases lacking their
required valuation report `valuation-unavailable` before entering an amount.
Amounts are never silently raised, shrunk or replaced with invented prices.

Quote mode drives this inventory in an unconnected browser and records the
actual unified-form selection. Complete mode enters the same inventory through
the connected UI and captures the exact selected plan at Swap. Provider
availability and search outcome remain independent; a retained qualified plan
can coexist with a later search timeout. Current automatic Market eligibility
is typed-adapter non-native PAXG. Other token and basket Market assessments
remain explicitly unsupported until product capability changes; missing
evidence is unknown, not successful or unsupported by inference.

For an already-running **local** App/backend fixture, read-only examples are:

```bash
APP_BASE_URL=http://127.0.0.1:3098 npm run test:deployed -- \
  --target sandbox --mode quotes --output-dir out/matrix-quotes
APP_BASE_URL=http://127.0.0.1:3098 npm run test:deployed -- \
  --target sandbox --mode quotes --diagnostic-scenario core-redeem-usdc-exact-out-small \
  --output-dir out/diagnostic-usdc
```

The diagnostic example is one new forced-Core producer request using the resolved
small scenario's raw amount and recorded valuation; it does not replay an old quote or overwrite a previous result. The
legacy definitions remain in [scenarios.ts](./trading/scenarios.ts) for explicit
producer checks and unique contract controls. Both legacy IDs and current resolved
matrix IDs (with optional `ui-` prefix) are accepted for a single new diagnostic attempt. A declared repetition manifest
records repetitions, concurrency and cold/warm reset/preserve conditions;
ordinary matrix operation adds no hidden retry.

Configure the local fixture origin before using these examples.
No Backend bearer or wallet seed is required. Older releases may lack diagnostic
headers; `observations.correlationAvailable` records whether they were observed.
Missing routes/capabilities are explicit unavailable results, never passing
execution coverage. `quotedOperation` describes quote construction; only
`layer: execution` with a mined `actualOperation` establishes execution.

Sandbox signing is separate and serial. Supply a dedicated disposable Sandbox
wallet through the runner's private environment (`SYNPRESS_WALLET_SEED_PHRASE`,
`SYNPRESS_WALLET_PASSWORD`, `NEXT_PUBLIC_WALLET_RPC_URL`) and invoke
`--target sandbox --mode sandbox-execution`. That mode never signs chain 1.
The runner funds that dedicated wallet through the existing public faucet after
each fork refresh, using the batch request identity. Ambiguous
funding results reuse that identity; the runner never resets the shared fork.
Do not reuse a wallet that has held real assets. Mainnet execution uses
`--target mainnet --mode fork-execution` on a host with Python, Docker and
Foundry; provide `BACKEND_IMAGE`, `CONTRACTS_JSON`, `FUNDING_JSON` and the existing
private tooling `MAINNET_RPC_URL`. This delegates to the canonical qualifier,
which creates its own chain. An arbitrary origin is never relabeled a fork.

The stable output is `report.json`, schema `cybergold.trade-regression.v1`, with
per-case pass/fail/unavailable/skipped status, size/valuation identity, provider summaries, separate alternate execution, layer/family/mode, safe references,
amount bounds, block context and receipt/authorization observations. Any failure
or unavailable primary case gives exit code 1 after saving the report; an attempted alternate failure also fails the runner without changing a successful primary journey. Wallet runs keep
trace, screenshot, video and write retries off; no raw HTTP bodies, signatures,
onboarding or private provider URLs enter the regression report. Runtime output
belongs in ignored `out/`; scheduled B2B execution and retention are owned by
Ops and remain advisory rather than a new CI/release gate.
Alternate execution uses the captured losing plan through the existing retained-plan
revalidation API. Its original and revalidated plan digests, references and
`comparisonState: sequential-state` remain separate. The winner can already
have moved pools, spent balances or changed approvals: this is not an equal
prestate experiment and the shared Sandbox is never reset. A changed or failed
revalidation is its own observed attempt, not proof the original quote executed.
If the winning submission is unknown, the alternate is not attempted and records
`predecessor-submission-unknown`; this preserves completion of the active trade.
A missing transaction hash after wallet submission may still mean an unknown
outcome; it is not automatically classified as nothing submitted.

UI and independent execution evidence retain `receipt.refunds` as ordered
`{ asset, amount }` rows from every matching Helpers `DustRefunded` event for
the payer, including native input and other basket assets. Amounts are raw
integer strings; repeated asset rows remain separate. An empty array records
no matching refund events, while an absent field means they were not captured.
The existing scalar `inputRefund` keeps its input-token meaning. These extra
event rows do not establish all-asset wallet reconciliation or total value:
selected input/output bounds and wallet checks retain their existing scope.

Funding behavior is unchanged. The existing faucet and fixed 5-CYGLD bootstrap
are not assumed sufficient for every $10,000 case. Ordinary funding, balance,
capacity and setup failures remain visible; no test silently resizes a size or
increases a quota. Full settlement qualification needs a declared sufficiently
funded disposable fixture and actual receipts before claiming coverage.

`runnerOutcome` also retains a failed child process when completed scenarios
passed; partial scenario evidence is preserved. Cancellation is forwarded to
the qualifier so its owned child processes, containers and credentials are
cleaned up. Optional release revisions are observations, never prerequisites.

On Linux you may also need:

```bash
sudo env "PATH=$PATH" npx playwright install-deps chromium
```

## Running the Tests

### 1. Provide the Synpress wallet vars

The MetaMask npm commands now load values from `.env.local` before launching Synpress or Playwright, so the default path is simply to keep these values in `.env.local`.

If you want to override them for the current shell, or if `.env.local` is missing, export them manually.

If your shell can safely load `.env.local`:

```bash
set -a
source .env.local
set +a
```

Or export just the Synpress vars manually:

```bash
export SYNPRESS_WALLET_SEED_PHRASE="..."
export SYNPRESS_WALLET_PASSWORD="..."
export SYNPRESS_EXPECTED_FUNDED_TOKENS="eth,xaut,paxg,usdt,usdc"
```

### 2. Build or refresh the MetaMask cache

```bash
npm run test:e2e:metamask:cache -- --force --debug
```

This uses `wallet-setup/metamask.setup.ts` to:
- open a clean MetaMask extension
- import the wallet from the seed phrase
- finish onboarding
- store the prepared state in Synpress cache

### 3. Run the MetaMask test

```bash
npm run test:e2e:metamask
```

For the most reliable MetaMask automation, run from a native Linux checkout:

```bash
npm install
npm exec --package=playwright@1.60.0 -- playwright install chromium
npm run test:e2e:metamask
```

## When to Rebuild the Cache

Rebuild the MetaMask cache when any of these change:

- `wallet-setup/metamask.setup.ts`
- `SYNPRESS_WALLET_SEED_PHRASE`
- `SYNPRESS_WALLET_PASSWORD`
- Synpress / Playwright / MetaMask-related dependencies
- `.cache-synpress` was deleted
- MetaMask opens onboarding again during the test

Command:

```bash
npm run test:e2e:metamask:cache -- --force --debug
```

## What the Current Test Does

`connect-and-balances.spec.ts` currently:

1. Opens `/en`
2. Clicks `Connect Wallet`
3. Chooses `MetaMask`
4. Handles MetaMask prompts:
   - unlock
   - connect
   - confirm / approve
   - local network confirmation when needed
5. Waits for the app to show the connected wallet menu
6. Opens `View balances`
7. Verifies:
   - the balances modal is visible
   - the ETH row exists
   - total balance is not a loading placeholder
   - expected funded token rows are visible and non-zero

## Basket Flow Tests

The basket flow specs live in `metamask/basket-flows` and cover the four swap modes:

- `Issue From Basket Exact In`
  The user enters exact PAXG and XAUt basket inputs. The app quotes the CYGLD output, shows fee details, submits through MetaMask, and verifies CYGLD increases while basket-token balances decrease. Validation checks insufficient basket-token balance. Toggle and quoted-CYGLD click tests verify switching to the matching exact-out or redeem mode preserves the quote correctly.
- `Issue From Basket Exact Out`
  The user requests an exact CYGLD output. The app calculates the required PAXG and XAUt inputs, keeps calculated basket fields read-only, shows fee details, and submits through MetaMask. Validation checks that an overlarge CYGLD request disables the swap. Toggle and quoted-basket click tests verify conversion to exact-in and redeem flows.
- `Redeem To Basket Exact In`
  The user enters exact CYGLD input. The app quotes PAXG and XAUt outputs, shows fee details, submits through MetaMask, and verifies CYGLD decreases while basket-token balances increase. Validation checks zero or negative CYGLD input. Toggle and quoted-basket click tests verify switching to issue exact-out or redeem exact-out.
- `Redeem To Basket Exact Out`
  The user requests exact PAXG and XAUt basket outputs. The app calculates the required CYGLD input, keeps the calculated CYGLD field read-only, shows fee details, and submits through MetaMask. Validation checks impossible basket output requests. Toggle and quoted-CYGLD click tests verify switching to issue exact-in or redeem exact-in.

## Troubleshooting

### `SYNPRESS_WALLET_SEED_PHRASE is required`

The shell running the test does not have the Synpress env vars exported.

Fix:
- export the Synpress vars manually, or
- load them before running the cache/test command

### `Cache for ... does not exist`

The Synpress cache has not been built yet, or it was deleted.

Fix:

```bash
npm run test:e2e:metamask:cache -- --force --debug
```

### MetaMask opens onboarding again

The cache is stale or missing.

Fix:
- rebuild the cache
- make sure `.cache-synpress` was not deleted

### The app fails with invalid addresses

Your `.env.local` likely has a malformed address.

Check:
- `NEXT_PUBLIC_*ADDRESS` values are valid `0x...` addresses

### The test stalls after `Connect`

In this repo, MetaMask may show extra prompts after the initial connection, especially for the local Anvil network. The test handles those prompts in `connect-and-balances.spec.ts`, so if this regresses:

- inspect the `[metamask-connect] ...` logs
- check whether MetaMask now shows a new button label or popup type

## macOS

The test commands are the same on macOS:

```bash
npm run test:e2e:metamask:cache -- --force --debug
npm run test:e2e:metamask
```
