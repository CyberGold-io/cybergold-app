---
title: Retained exact output test journeys
doc_type: test-guide
status: active
owner: app-maintainer
created: 2026-10-19
last_reviewed: 2026-10-19
canonical_for: retained App exact output test material
---

# Retained exact output journeys

The current App accepts spend amounts and displays read-only receive estimates.
This directory preserves output-entry browser and MetaMask journeys for a later
feature. It also retains the dormant output-target MAX solver tests and the
generic exact-out form-state case. Ordinary Playwright configurations explicitly
ignore this root; `npm test` discovers only active `app/utils/*.test.mts` files.
All retained TypeScript still participates in the normal type check.

The `e2e` copies preserve the complete original mixed suites, including their
input cases and shared setup, so their former output transitions and assertions
can be reviewed in context. Active copies retain supported input-driven cases.
The `metamask` files were moved with imports redirected to the existing shared
fixtures. Do not count these retained tests as passing current product coverage.

For a future compatible App with output entry restored, explicit collection is:

```sh
npm run test:deferred-exact-out -- --project=chromium
npm run test:deferred-exact-out -- --project=metamask
npm run test:deferred-exact-out:unit
```

The separate Playwright configuration resets the ordinary exclusion and keeps
browser and MetaMask projects distinct. The MetaMask project retains the same
disposable funded wallet and local/fork requirements as the active suite. These
commands do not restore product controls; the UI suites require compatible
future source and are expected to fail against the current receive-only UI.
The retained unit primitives remain executable against their dormant generic
utilities in the current source.

Existing direct provider diagnostics remain usable without output editing:

```sh
APP_BASE_URL=http://127.0.0.1:3098 npm run test:deployed -- \
  --target sandbox --mode quotes \
  --diagnostic-scenario core-redeem-usdc-exact-out \
  --output-dir out/exact-out-diagnostic
```

The same existing `--diagnostic-scenario` option selects a named producer replay
with `--mode sandbox-execution` on the dedicated disposable Sandbox wallet.
Existing target restrictions apply. A named diagnostic is one selected scenario
and one provider assessment, separate from the default 24-case UI matrix.
There is no bulk exact-out mode or amount-mode override.

Keep `matrixTemplates()`'s 48 definitions and the legacy `tradeScenarios` IDs,
Backend API modes, standalone basket output hooks/previews, and contract ABI
operations. Input-budget purchases still require `issueFromTokenExactOut*` and
`issueFromNativeExactOut*`; their active authorization, bounds, refund and receipt
tests remain in ordinary component coverage. Later restoration must rework and
qualify output entry, reverse quotes, MAX, session state and wallet outcomes
against then-current source rather than merely enabling this configuration.
