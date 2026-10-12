---
title: Contributing to CyberGold App
doc_type: contributor-guide
status: active
owner: app-maintainer
created: 2026-08-14
last_reviewed: 2026-10-12
canonical_for: CyberGold App public contributor setup and pull-request path
---

# Contributing to CyberGold App

Anyone may fork this repository and propose a change. Public contributors keep
feature branches in their own forks; Write access lets trusted team members
create feature branches inside CyberGold. Neither public visibility nor opening
a PR gives someone permission to merge it.

## Start from upstream dev

Fork `CyberGold-io/cybergold-app` on GitHub, then clone your fork and add the
canonical repository as `upstream`:

```bash
git clone https://github.com/YOUR-GITHUB-USERNAME/cybergold-app.git
cd cybergold-app
git remote add upstream https://github.com/CyberGold-io/cybergold-app.git
git fetch upstream
git switch -c feature/my-change upstream/dev
```

Replace the example username and `my-change` slug with your own values. `origin`
points to your fork and `upstream` to CyberGold. Trusted contributors working
inside CyberGold can instead create the feature branch from `origin/dev`.
Keep changes focused and unfinished work on the feature branch.

## Validate locally

Use Node.js 26.10.0 and npm. The workflow-pin and generated-ABI checks read
the public Protocol and Helpers checkouts beside the App. Clone missing
siblings; the recursive Helpers checkout also initializes its recorded
Protocol and other dependency pins:

```bash
git clone --branch dev https://github.com/CyberGold-io/cybergold-protocol.git ../cybergold-protocol
git clone --branch dev --recurse-submodules https://github.com/CyberGold-io/cybergold-helpers.git ../cybergold-helpers
npm ci
node --env-file=tests/fixtures/app.env scripts/run-ci-checks.mjs
```

Run the relevant browser tests for UI changes:

```bash
npx playwright install chromium
set -a
source tests/fixtures/app.env
set +a
npm run test:e2e -- --project=chromium
```

These commands use the same nonsecret environment fixture as CI. The
[test guide](tests/README.md) explains browser and wallet fixtures. Report
which wallet or live-chain tests you ran and which were unavailable; do not
present skipped coverage as a pass. These source checks use repository fixtures
and do not require private Ops access. For an interactive local frontend, use
`.env.example` and your own local backend; shared service credentials are not
needed to submit a PR. Maintainers test accepted product changes on the shared
Sandbox after integration.

## Propose and integrate

1. Push the feature branch to your fork (or the CyberGold repository if you
   have Write access): `git push -u origin feature/my-change`.
2. Open a PR with **base repository `CyberGold-io/cybergold-app` and base branch
   `dev`**. Describe the change, its documentation impact and validation results.
3. Existing PR CI checks the candidate. Before merging, an authorized
   maintainer verifies the actual head/base repositories and branches and
   reviews the changes, including workflows and policy scripts. The maintainer
   uses GitHub's merge-commit method after the required checks pass. Public
   contributors cannot merge their own or other contributors' PRs.
4. Maintainers test integrated product changes in the shared Sandbox. A PR
   itself does not publish or deploy. The Sandbox contains all accepted `dev`
   changes, rather than a separate environment for each PR.
5. Release promotion is a PR from CyberGold's own exact `dev` branch into
   `main`. Contributors do not open feature-to-`main` or fork-to-`main` PRs.

The owner and `core-team` can merge into `dev`. The owner and Ksenia can
merge App `main` promotions. The selected rules for both branches require PRs
and the existing CI checks, with zero mandatory approving reviews. Authorized authors
can merge their own valid PRs after CI passes; review comments and voluntary
approvals remain useful. Direct pushes, force pushes and deletion are outside
the protected-branch workflow. Human Admin access stays with the owner.

GitHub Free native protections restrict merge actors and require PRs and the
existing CI checks. Branch-policy CI reports candidate-controlled feedback;
maintainers verify the permitted source/target relationship before accepting a
PR. No separate bot or exclusive merger service is part of this workflow.

Write permission has broader GitHub capabilities than merging `dev`; the
selected actor restrictions apply specifically to the protected branches.
The [branch workflow](docs/development/branch-workflow.md) explains promotion
and the source/delivery boundary. Maintainers verify live GitHub protections
when installing this prepared public policy; documentation alone does not
assert that those settings are active.

## Licensing

Contributions to AGPL-covered project code are offered under **AGPL-3.0-only**.
Preserve existing MIT, other explicit grants, and third-party attribution and
license notices. See [licensing scope](LICENSING.md). Do not include private
credentials or private operational configuration in a contribution.
