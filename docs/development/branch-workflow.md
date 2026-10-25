---
title: App branch and promotion workflow
doc_type: development-guide
status: active
owner: app-maintainer
created: 2026-08-14
last_reviewed: 2026-10-25
canonical_for: CyberGold App feature integration and dev-to-main promotion
---

# App branch and promotion workflow

## Contribution and promotion path

```text
feature/* in a contributor fork or CyberGold, created from CyberGold dev
  -> PR into CyberGold dev
  -> existing CI and authorized merge commit
  -> integrated Sandbox testing
  -> PR from CyberGold's exact dev into main
  -> authorized merge commit and the existing release path
```

The owner and `core-team`, including Ksenia, can create feature branches inside
CyberGold and merge PRs into `dev`. Anyone else may create branches in a fork
and propose a feature-to-`dev` PR. The owner and Ksenia can merge App
`main` promotions.

The selected rules keep `dev` and `main` long-lived and protected: PRs and
existing required CI apply to administrators as well; force pushes and deletion
are disabled. Zero approving reviews are mandatory, allowing an authorized author
to merge their own PR after CI passes. Voluntary review approval does not confer
merge permission. Human Admin access stays with the owner; trusted contributors
have Write. Write also enables broader repository capabilities, including
Actions and secret management, so it is not a dev-only permission.

Only `feature/*` may target `dev`, from this repository or a fork. Only the
canonical CyberGold repository's exact `dev` branch may target `main`. GitHub
lets a contributor select `main` in the PR form. Maintainers do not accept a
feature or fork head into `main`, including a fork branch named `dev`; they
verify the actual head and base repositories and branches before merging.
Keep unfinished changes on feature branches: a `dev` promotion
includes every integrated feature, rather than selecting one feature again.

Use GitHub's merge-commit method for feature integration and promotion. Squash
and rebase merges are disabled so the long-lived `dev` ancestry is preserved.
Hotfixes follow the same feature-to-`dev`-to-`main` route. Correct a faulty
integration with an ordinary revert PR into `dev`.

## CI and delivery

Ordinary fork PR CI uses a read-only token and receives no repository secrets.
GitHub Free native protections enforce the selected merge actors, required PRs
and existing required CI checks. Branch-policy CI uses candidate-controlled
source and provides feedback; it does not independently enforce the permitted
source/base relationship. Before accepting a PR, the authorized maintainer
verifies that relationship and reviews the proposed changes, including
workflows and policy scripts. This workflow uses maintainer checks without a
separate bot or exclusive merger service. Maintainers verify the selected
hosted protections during rollout; this document alone does not establish that
they are active.

PR jobs do not publish images. A completed successful App CI push run on
`dev` or `main` starts `publish-image.yml` in this public repository using
standard GitHub-hosted runners. It checks the exact green CI run and current
branch head, builds without registry credentials using the public settings in
`deploy/public-build/`, then publishes the immutable image and updates the
mapped private GHCR package's `desired` tag. `dev` maps to Sandbox; `main` maps
to Mainnet. The branch head is checked before build and registry publication.

Ordinary App releases do not dispatch a workflow in private Ops, check out Ops,
or require its cross-repository token. Ops continues to own host deployment,
private runtime configuration, backend placement and candidate health. Its
existing host controller discovers `desired` and adopts the exact digest.
CI success, image publication and actual host adoption are separate results;
maintainers check the App image-publication workflow, the served version and
the integrated behavior before promotion.

The image packages remain private and keep their existing names. Before the
first release, grant this App repository Write access under each package's
**Manage Actions access**, and copy the public
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` Actions variable from Ops to App.
`publish-image.yml` uses the repository's `GITHUB_TOKEN` with `packages: write`
only in the publication job. Workflow-run triggers use the workflow on the
default branch: merge this workflow through `dev` into `main` before expecting
it to handle later completed App CI runs. No server runtime update is needed;
the images retain the profile, source and runtime labels already consumed by
the host controller. `io.cybergold.profile.sha256` identifies the checked-in
public build profile; private runtime configuration keeps its separate host
identity. The shared Sandbox contains several accepted features at once.

The build transfers its image through a one-day Actions artifact. Readers of
this public repository can download that archive, which contains public App
code and public build settings. Private runtime configuration stays on the
host; the two GHCR packages retain their private access controls.

Public contributors can use local source fixtures and submit PRs without Ops
access or shared credentials. Maintainers handle deployment evidence and
operations; access to private Ops is not a contribution prerequisite.

## Dependency proposals and contributor entry point

Dependabot proposals target `dev`, but generated `dependabot/*` heads do not
satisfy the existing `feature/*` policy. Adopt an appropriate update onto a
feature branch from `dev`, review the exact dependency revision, and run the
normal checks. Promotion to the default `main` branch is needed before a fixed
advisory can disappear from that branch's dependency alerts.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for fork setup and local validation.
