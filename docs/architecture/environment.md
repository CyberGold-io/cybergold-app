---
title: Environment configuration
doc_type: architecture
status: active
owner: app-maintainer
created: 2026-09-20
last_reviewed: 2026-10-11
canonical_for: App public and server environment configuration and validation
---

# Environment configuration

Next.js loads `.env.local` and deployment-provided environment variables using
its normal precedence. Do not read or bundle the environment file in components.

Application settings are declared in two modules:

- `app/config/publicEnvironment.ts` exposes browser-safe `NEXT_PUBLIC_*` settings.
- `app/server/environment.ts` exposes `CYBERGOLD_BACKEND_URL` and the optional
  `CYBERGOLD_BACKEND_BEARER_TOKEN` behind `server-only`.

The frontend has no database, private RPC, Safe-service, faucet-service or
indexer-worker credentials. Those belong to `cybergold-backend`. Each public
route selects a fixed backend path from the checked-in generated OpenAPI types;
the incoming URL cannot select an upstream host or a worker-control operation.

Both use `app/config/environmentValidation.ts`. The server instrumentation calls
`validateEnvironment()` at startup to validate all declared application settings.
Consumers read `publicEnv` or `serverEnv`; validation results are cached per value.
The chain ID and chain name are required. Wallet RPC, explorer and WalletConnect
settings remain optional; supplied values must be valid. Errors identify the
setting without printing its value. Feature-specific authorization and policy
checks remain with the operation using the setting.

## Backend deployment configuration

The App has no deployment address environment settings. A fixed same-origin
`GET /api/protocol/config` adapter returns the Backend configured Core, Helpers,
Governance, Staking, product Safe and cached selected Uniswap adapter, along with
the initial token catalog and accepted Sandbox fork generation. Quoter, factory
and route infrastructure addresses stay in the Backend. This GET makes no chain
RPC calls and can return configured roots while the cached adapter observation
is still unavailable.

One client query supplies all consumers. Its cache is scoped to the wallet chain
and fork generation; the QueryClient belongs to the mounted provider rather than
a mutable server module. The shell always renders. Each operation uses its
existing target availability behavior, and an unavailable endpoint recovers
through ordinary focus, reconnect and existing head events. Head events only
refresh configuration when the shared query is stale; there is no extra poller
or per-field/per-quote address RPC.

Trading read/model/quote identities bind the chain, Core, Helpers, selected
adapter and fork generation. Governance probes bind their own configured targets;
a Governance, Staking or Safe-only refresh preserves valid trading quotes. An
accepted quote captures its deployment targets. A wallet operation keeps that
Core, Helpers, adapter and permit spender throughout signing and submission.
Fresh signing context or simulation for a different target raises its ordinary
preparation error rather than retargeting a signature. A response from another
chain cannot supply deployment targets for the selected wallet network.

The Docker capability label `io.cybergold.app.configuration=backend` lets Ops
project only bootstrap settings into this App image; retained older images keep
their existing address environment projection for rollback. Changing Backend
addresses does not require rebuilding the current App.

Keep `process.env.NEXT_PUBLIC_*` accesses explicit in the public configuration
module so Next.js can substitute them in browser bundles. Public configuration
changes require rebuilding the production app. Never import server configuration
into client components or add private credentials to the public module.

OS/framework variables such as `PATH`, `HOME`, and `NODE_ENV` retain their native
meaning. Test-tool credentials such as `SYNPRESS_*` belong to the test harness,
not the application's configuration or browser bundle.

Run `npm test` for configuration and consumer tests. The existing `validate:env`
command additionally checks the selected chain through the fixed head API
(or an explicit tooling RPC); startup
configuration validation does not make network calls.

For a checkout without a deployment profile, CI builds and browser smoke tests
use `tests/fixtures/app.env`. It contains only wallet/network bootstrap configuration. Browser fixtures
supply a synthetic Backend protocol configuration; no fixture supplies a live
RPC service. Run the complete local
checks with `node --env-file=tests/fixtures/app.env scripts/run-ci-checks.mjs`.
Unit tests that import configured application modules apply this fixture only
for their imports or assertions and then restore the previous environment.

## Mobile wallets and WalletConnect

Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to the Project ID of the
CyberGold-owned project in the [Reown dashboard](https://dashboard.reown.com).
This is a public application identifier, not an RPC bearer or wallet key.
Allow `https://app.cybergold.io` and `https://sandbox.cybergold.io` as origins
in that project. Reown permits localhost development; use a separately allowed
HTTPS origin when testing a phone against a workstation.

Direct local launches read the value from `.env.local`. Hosted image publication
reads the same-named **Actions variable in cybergold-app**, passes it through the
public build environment and compiles it into the App. Changing a running
container's environment cannot replace the browser-bundled ID: rebuild and
deliver the image. An empty value leaves injected browser wallets available;
it does not use RainbowKit's shared example project or offer relay-based pairing.

The configured project enables the existing RainbowKit mobile wallet links and
desktop QR pairing. The wallet's network suggestion uses
`NEXT_PUBLIC_WALLET_RPC_URL`; ordinary App reads use fixed same-origin product
APIs. `NEXT_PUBLIC_RPC_URL` is no longer consumed. A phone must be able to reach the wallet RPC without a
private bearer. A desktop loopback URL is not reachable from a separate phone.

Before calling mobile pairing qualified, check the deployed Sandbox on iOS and
Android: open the wallet app from the connection dialog, approve the connection,
return to the App, check the account and chain, then disconnect and reconnect.
Also scan the desktop QR code from a phone. Exercise a custom-network switch on
Sandbox and confirm it proposes the public wallet RPC. Connection approval does
not require signing a message or sending a transaction. Local browser emulation
and synthetic providers do not establish real relay or OS app-return behavior.

References: [RainbowKit configuration](https://rainbowkit.com/docs/installation)
and [Reown project origins](https://docs.reown.com/walletkit/ios/cloud/relay).
