---
title: CyberGold App end-to-end test guide
doc_type: test-guide
status: active
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-10-12
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
The extension suite requires its separate disposable funded chain/wallet setup;
never point its mutating tests at the deployed App or a real-asset wallet.

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

The command runs the three session/network scenarios plus
[fixed-api-roundtrips.spec.ts](./metamask/fixed-api-roundtrips.spec.ts): sixteen
PAXG/USDC/ETH/basket UI paths across both amount modes, typed signatures, native wallet
confirmations and transaction rejection. Successful balance changes and mined
receipts are real observations from the Python API and owned fork. Funded
responses are not intercepted. Every case asserts zero attempted App
`/api/rpc` calls. This focused qualification does not claim every case in the
broader token/basket acceptance specifications. It also runs
`regression-execution.spec.ts` using the shared 20-case inventory: PAXG, USDC,
ETH and basket Core issue/redeem exact-in/out, plus PAXG market buy/sell
exact-in/out. Independent provider tests use the existing intent/market APIs;
they never force a route in the production UI. MetaMask signs the constructed
operation, and the suite verifies the mined selector, Helpers operation event,
integer input ceiling/output floor, fees/refunds and basket ordering. Native
permit, Permit2, ordinary allowance and mixed-basket funding are recorded.
Every scenario remains unavailable until its receipt assertions pass. The
sixteen UI trades remain separate evidence of automatic route selection, with
actual mined operation and bound assertions recorded in `regression-ui.json`.

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
results/logs remain in the output directory. A successful `qualification.json`
records the exact App commit, test file hashes, backend image, fork anchor and
wallet transaction receipts. Hosted execution and GitHub required merge checks
are separate workstreams; this command introduces no required CI job.

### Deployed regression runner

`tests/trading/scenarios.ts` is the common inventory. `tests/trading/regression.ts`
checks actual fixed API responses, including terminal NDJSON errors inside
HTTP 200; an indicative model or provisional estimate cannot satisfy a case.
`tests/trading/browserQuotes.ts` additionally opens the public App and enters
both amount modes for each supported token/basket pair without interception or
a wallet. It records the family actually selected by the unified form.

Run public-origin read-only checks with the pinned Node/runtime/browser:

```bash
APP_BASE_URL=https://sandbox.cybergold.io npm run test:deployed -- \
  --target sandbox --mode quotes --output-dir out/deployed-sandbox
APP_BASE_URL=https://app.cybergold.io npm run test:deployed -- \
  --target mainnet --mode quotes --output-dir out/deployed-mainnet
```

Use the actual configured public origins when they differ from these examples.
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
each fork refresh, sharing one request ID across both serial suites. Ambiguous
funding results reuse that identity; the runner never resets the shared fork.
Do not reuse a wallet that has held real assets. Mainnet execution uses
`--target mainnet --mode fork-execution` on a host with Python, Docker and
Foundry; provide `BACKEND_IMAGE`, `CONTRACTS_JSON`, `FUNDING_JSON` and the existing
private tooling `MAINNET_RPC_URL`. This delegates to the canonical qualifier,
which creates its own chain. An arbitrary origin is never relabeled a fork.

The stable output is `report.json`, schema `cybergold.trade-regression.v1`, with
per-case pass/fail/unavailable/skipped status, layer/family/mode, safe references,
amount bounds, block context and receipt/authorization observations. Any failure
or unavailable case gives exit code 1 after saving the report. Wallet runs keep
trace, screenshot, video and write retries off; no raw HTTP bodies, signatures,
onboarding or private provider URLs enter the regression report. Runtime output
belongs in ignored `out/`; scheduled B2B execution and retention are owned by
Ops and remain advisory rather than a new CI/release gate.
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
