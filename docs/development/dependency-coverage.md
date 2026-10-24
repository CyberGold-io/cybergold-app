---
title: App dependency coverage and remediation
doc_type: development-guide
status: active
owner: app-maintainer
created: 2026-09-26
last_reviewed: 2026-10-24
canonical_for: App dependency manifest coverage and reviewed remediation limits
---

# App dependency coverage and remediation

## Coverage

The September 26 source inventory contains one npm project: root
`package.json` and `package-lock.json`. There are no nested package manifests,
vendored dependency trees, or submodules. The lockfile records production,
development, and optional npm dependencies. The GitHub SBOM observation in the
Ops Dependabot workplan confirms npm ingestion; a parseable manifest with zero
reported dependency counts alone is not proof of complete graph coverage.

`.github/dependabot.yml` requests weekly npm, GitHub Actions, and Docker
proposals against `dev`. The Docker entry covers the root `Dockerfile`, which
uses the same literal Node tag/digest in its dependency, builder, and runtime
stages. Adopt each accepted proposal onto a `feature/*` branch as described in
[the branch workflow](branch-workflow.md). This retains the existing branch
policy. The configuration must reach the default branch before GitHub starts
using it. Dependabot security alerts describe the default branch, and remain
open until the corresponding fix is promoted through the normal release path.

CI audits all npm dependency scopes through
`node scripts/check-dependency-audit.mjs`, which runs
`npm audit --json --audit-level=low`.
This includes vulnerable development tools that the former `--omit=dev` check
excluded, and also fails on moderate and low findings apart from the specific
owner-accepted exception below. npm's advisory view is
not identical to GitHub's alert view; the source audit and default-branch
alert status remain separate results.

The separate `Dependabot alerts` workflow checks every open GitHub alert on
`main` pushes, daily, and on manual request. Its read-only token retrieves all
pages and all severities, including findings without a fix. API failures do
not count as a clean result. This default-branch monitor remains separate
from pull-request checks and the deployment aggregate: outstanding alerts on
`main` cannot deadlock the feature and `dev` changes needed to fix them.
No alert is dismissed or excluded by an advisory allowlist.

### October 3 accepted development exception

The owner accepted [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
for development dependencies on October 3, 2026. This `braces` stack-exhaustion
advisory was published September 18 and reviewed/updated October 2; no patched
release is available. It reaches the existing Next.js lint tooling through
`micromatch` and `fast-glob`. The production audit is clean, and the standalone
App output excludes this tooling. Crafted nested patterns can still crash the
development tool; this exception accepts that risk, not a repaired dependency.

The wrapper reports the accepted advisory and its affected development parents.
Every reported instance must be development-only in the npm lockfile, and every
underlying cause must resolve to that exact advisory. A production instance,
another advisory, or an audit service/process error still fails the existing
audit job. GitHub Dependabot alerts remain visible and are not dismissed. Remove
the exception when a supported remediation becomes available.

Docker base images are outside the npm audit. Dependabot Docker proposals
track the root image references; they do not constitute a vulnerability scan
of every operating-system package installed inside the image. The separately
published Protocol/Helpers ABI artifacts and remote services are also outside
this npm inventory. Their owning release and image checks remain necessary;
Dependabot npm coverage is not a general supply chain attestation.

## October 24 Zod compatibility patches

The dependency candidate uses the genuine upstream `zod 4.6.7` package for
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Its bounded-collection fix runs before element validation. No Zod source is
modified, and its vulnerable `zod/v3` compatibility export is not substituted
for the fixed implementation. This advisory has no accepted audit exception.

The installed Synpress packages still declare Zod 3. The local compatibility
patches preserve their `0.0.14` version and wallet-test APIs:

- [Synpress Cache](../../patches/@synthetixio+synpress-cache+0.0.14.patch)
  replaces the removed `.returns()` builder with
  `z.function({ output: z.promise(z.void()) })` in its source importer and both
  published bundles. Wallet setup still validates its hash and function,
  forwards its arguments, rejects non-void results, and propagates failures.
- [Synpress MetaMask](../../patches/@synthetixio+synpress-metamask+0.0.14.patch)
  regenerates the Network and GasSettings declarations and declaration maps
  against Zod 4 from unchanged source validators. Its runtime validation rules
  stay the same.

Both patches derive from the installed official npm distributions and retain
their [Synpress MIT notice](../../patches/SYNPRESS-LICENSE.txt). The upstream
[wallet importer](https://github.com/synpress/synpress/blob/dev/packages/cache/src/utils/importWalletSetupFile.ts)
still uses the old builder. Remove these patches when reviewed upstream
releases support the fixed Zod API; requalify the actual importer and MetaMask
validators when changing their parent versions. The existing all-scope audit
continues to report unrelated findings and service errors normally.

The production wallet dependencies use the same fixed implementation. Their
patches retain the existing RainbowKit connector list and provider behavior:

- [AppKit Wallet 1.7.8](../../patches/@reown+appkit-wallet+1.7.8.patch)
  makes the existing optional RPC response and two optional RPC parameter
  fields explicit, and flattens three existing union chains without changing
  their alternatives or order. Numeric and string chain IDs and the existing
  `{ message }` error payload remain supported. Its generated declarations use
  Zod 4 rather than the incompatible Zod 3 class signatures.
- [CDP SDK 1.51.0](../../patches/@coinbase+cdp-sdk+1.51.0.patch)
  supplies the string key schema explicitly to the typed-data record and adds
  a public ABI type annotation for portable declarations. Genuine Zod 4.6.7
  already accepts its old record call at runtime, but its TypeScript signature
  requires both arguments. ESM and CommonJS policy validators and the policy
  declarations/maps are regenerated from the included source.
- [ABIType 1.3.0](../../patches/abitype+1.3.0.patch) is selected for the
  installed 1.x consumers; its published peer range supports Zod 4. Its public
  TypedData annotation prevents declaration emission from expanding an invalid
  index-signature combination. Both official runtime entry points are retained
  byte for byte; the patch changes the source annotation and generated types
  and declaration map, plus the ESM debug map.

The AppKit source comes from the exact
[`@reown/appkit-wallet@1.7.8` tag](https://github.com/reown-com/appkit/tree/c2e3e52181b723c220935ea7e4ebd1e73c4d9ea2/packages/wallet/src),
not newer unmerged wire-protocol changes. Its
[Apache-2.0 notice](../../patches/APPKIT-WALLET-LICENSE.txt) is retained.
CDP uses the source included in the official `@coinbase/cdp-sdk@1.51.0` npm
package, with its [MIT notice](../../patches/COINBASE-CDP-SDK-LICENSE.txt).
ABIType uses the official `abitype@1.3.0` npm package and retains its
[MIT notice](../../patches/ABITYPE-LICENSE.txt). Newer AppKit licensing and
provider releases are not adopted by these patches.

Runtime qualification uses actual exported schemas and nonempty valid/invalid
frame, address, ABI and policy data. Generated declarations are additionally
compiled with TypeScript 5.9.3, `strict: true` and `skipLibCheck: false`, and
checked by an independent typed consumer. A CDP/Zod 4 schema composed with an
ABIType/Zod 3 schema throws on ordinary valid addresses and ABI policies; the
resolved graph must therefore use genuine Zod 4 consistently. Package version
or constructor-only checks do not establish this compatibility.

Two upstream validation differences are recorded: Zod 4 accepts an RFC-valid
apostrophe in an email address that the installed Zod 3 rejected, and ABIType
1.3.0 rejects malformed Solidity parameter identifiers previously accepted by
its partial regex match. The migration adds no email pattern, client-side
limits, relay restrictions or wallet policy to reproduce those old outcomes.

For future regeneration, use the pinned TypeScript compiler with a temporary
project-root configuration such as the following ABIType declaration build:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "skipLibCheck": false, "esModuleInterop": true,
    "declaration": true, "emitDeclarationOnly": true, "declarationMap": true,
    "rootDir": "node_modules/abitype/src", "outDir": "rebuild/abitype-types",
    "types": ["node"]
  },
  "files": ["node_modules/abitype/src/zod.ts"]
}
```

Run `node node_modules/typescript/lib/tsc.js -p zod-rebuild.json` after saving
that temporary configuration. Rebuild ABIType declarations first so CDP
consumes its public Zod 4 declarations. For AppKit, set `rootDir` to
`node_modules/@reown/appkit-wallet` and include
`src/W3mFrameSchema.ts`, `src/W3mFrameConstants.ts` and
`src/W3mFrameTypes.ts` beneath that root. For CDP, use
`node_modules/@coinbase/cdp-sdk/src` and include
`policies/evmSchema.ts`, `policies/solanaSchema.ts` and `policies/types.ts`.
Use separate temporary output directories. An isolated strict AppKit rebuild
also supplies the official `@types/big.js@7.0.0` declarations for AppKit
Common's existing `big.js` import; this is build tooling, not a new production
dependency or an ignored type error.

For the changed AppKit/CDP runtime files, use the same source inputs with
`emitDeclarationOnly: false`, `declaration: false` and `sourceMap: true`.
CDP's separate CommonJS build uses `module: CommonJS` and
`moduleResolution: Node`; verify the actual CommonJS entry with Node rather
than copying ESM output into that directory. Preserve ABIType's official
runtimes. Replace only the reviewed files named in each patch, retain the
corresponding maps, regenerate the package patch, and test a clean `npm ci`.
Remove temporary configuration/output files. Requalify the installed ESM and
CommonJS schemas and strict declaration consumer whenever these parents
change, then run the existing App source and browser checks.

The pinned patch installer runs through the ordinary npm postinstall hook.
Docker dependency stages copy `patches/` before `npm ci`, so local, CI and
container builds use the same reviewed changes. Installing with lifecycle
scripts disabled does not apply the patches. Source qualification remains
separate from the existing Sandbox and Mainnet acceptance workflow.

## September 27 runtime candidate

The coordinated candidate uses React and React DOM `19.3.0`, matching React
type definitions, and Node `26.10.0` with Node 26 type definitions. The engine
range, `.nvmrc`, CI jobs, development setup and all three immutable Docker
stages select Node 26 together. The existing release-boundary check retains
the exact image digest; changing that digest does not weaken the branch or
credential boundaries.

Node 26 is still **Current**, not LTS, on September 27. The
[Node release policy](https://nodejs.org/en/about/previous-releases) recommends
LTS for production. Local qualification of this candidate is separate from
the later Sandbox and Mainnet release decisions.

Recovery-share redemption now awaits the connected wallet client at action
time. Browser coverage includes deliberately delayed client readiness and
account/chain changes during simulation. It retains the existing live-wallet
checks and does not disable redemption based on a background query's loading
state.

The inherited `valtio@1.13.2` dependency pinned `use-sync-external-store@1.2.0`,
whose declared React peers stopped at 18, excluding both React 19.2 and 19.3.
A version-scoped override now selects `use-sync-external-store@1.6.0` for that
Valtio version. This MIT-licensed version already exists in the App's graph,
declares React 19 support, and retains the `shim/index.js` export consumed by
Valtio. The lockfile removes the obsolete nested 1.2.0 copy; no other package
version changes. A clean `npm ci --strict-peer-deps` and the installed peer
graph both pass without force or legacy-peer flags.

Local qualification also exercises AppKit's actual `useAppKitProvider` hook
and `ProviderUtil` controller under React 19.3 StrictMode: mount, provider/id
replacement, batched state changes, disconnect, unmount and remount all pass.
The selected shim delegates to React's native `useSyncExternalStore`. These
synthetic-provider checks establish state-subscription compatibility, not
relay pairing or signed-transaction acceptance. Remove this scoped override
when the reviewed parent wallet baseline supports a compatible shim itself.

## September 26 fixes

Compatible lockfile refreshes update vulnerable `js-yaml`, `browserslist`,
`baseline-browser-mapping`, and all three installed `brace-expansion` lines.
The existing Hono and PostCSS overrides advance to `4.13.5` and `8.5.23`.

MetaMask tests import the official `@synthetixio/synpress-core`,
`@synthetixio/synpress-cache`, and `@synthetixio/synpress-metamask/playwright`
exports directly. These are the same exports the former Synpress umbrella
re-exported. Its unused Phantom and Ethereum wallet mock dependencies are
removed, eliminating the Ethers 5 / `elliptic` path without dropping the
MetaMask suite. The cache command invokes the published cache package CLI.

Synpress Cache `0.0.14` pins outdated build tools even in its latest release.
The `glob@^10` override scoped to that package selects `glob 10.5.0`.
Build-tool overrides select the directly declared `tsup 8.5.0` and
`esbuild 0.25.12` pins. Glob and tsup retain their major versions. Esbuild is
validated
against the wallet setup transform and compilation APIs that Synpress uses;
this is a deliberate replacement of its pre-1.0 pin. Tsup `8.5.0` is outside the
GitHub alert's affected range `<=8.3.4`, despite that alert having no
`first_patched_version` metadata. The selected tsup release supports esbuild
`^0.25.0`; its newer `8.5.1` release selects esbuild `^0.27.0`, which currently
introduces another advisory. The glob version selector preserves the unrelated
glob 7 dependency under rimraf. The lockfile is generated and
clean-installed with CI's npm `10.9.8`. Esbuild and tsup are direct development
tools because Synpress's generated setup module imports them as external
packages from the project root; their overrides reuse those exact pins.

## Wallet leaf dependency compatibility

The remaining wallet alerts can be addressed without replacing the wallet
integration or adopting a differently licensed provider:

- MetaMask SDK, its communication layer, and MetaMask Utils receive UUID
  `11.1.1` through overrides scoped to those consumers. Inspection of their
  published distributions identified the `v4` and `validate` APIs and named
  CommonJS/ESM exports. The compatibility test exercises the actual resolved
  consumers, deterministic v4 generation, random v4 output, and validation.
  The patched version retains those APIs, so the older UUID 8/9 pins need not
  force a wallet integration migration.
- All installed WalletConnect Utils `2.21.0` and `2.21.1` copies receive
  `query-string 9.5.1`, whose supported dependency is the patched
  `decode-uri-component ^0.5.0`. These utility distributions declare the old
  query parser but contain no query-string/decoder import in their published
  CommonJS/ESM bundles or sourcemaps. The compatibility test loads every utility
  copy, round-trips WalletConnect URIs, and imports the replacement query parser
  to check valid and malformed percent-encoded input. Full App build and browser
  checks additionally cover module loading. The decoder alone is not overridden:
  its patched ESM-only interface is incompatible with the old parser's callable
  CommonJS import.

The exact compatibility tests are in
[walletDependencyCompatibility.test.mts](../../app/utils/walletDependencyCompatibility.test.mts).
Revisit these replacements when updating their parent packages; they are
reviewed against the installed consumers, not a claim that every older consumer
supports a dependency major upgrade.

Mobile-wallet qualification also found a QR rendering incompatibility:
RainbowKit's `cuer 0.0.3` calls `qr` with `border: 0`, but `qr 0.6.0` and
`0.7.0` reject that argument. Opening WalletConnect's QR dialog crashed the App.
The scoped `cuer@0.0.3 → qr 0.5.5` override restores its supported rendering
contract; it does not change other QR consumers or the wallet provider. The
compatibility test calls the installed Cuer renderer with a synthetic pairing
URI. Remove this pin when a reviewed Cuer/RainbowKit release supports the newer
encoder, and recheck QR rendering and the all-scope dependency audit.

The final all-scope npm audit reports zero vulnerabilities. The proposed
lockfile removes affected versions for all 29 open GitHub alert instances in
the September 26 baseline. GitHub's default-branch alerts still require the
normal feature-to-`dev`-to-`main` promotion and a subsequent GitHub rescan.

A future WalletConnect provider upgrade is separate work: the installed Wagmi
connector explicitly holds its provider pin because newer provider/AppKit
versions changed licensing. This remediation does not require that upgrade.
Deploying App changes remains subject to the existing Sandbox qualification
and Mainnet promotion workflow. Passing source checks does not establish host
adoption or real-wallet transaction acceptance.
