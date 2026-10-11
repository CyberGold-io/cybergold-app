#!/usr/bin/env python3
"""Keep App PR code unprivileged and map trusted branches to B2B targets."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CI_WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
DOCKERFILE = ROOT / "Dockerfile"
NODE_BASE = (
    "node:26.10.0-bookworm-slim@sha256:"
    "662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2"
)


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


workflow = CI_WORKFLOW.read_text(encoding="utf-8")
push = workflow.split("  push:\n", 1)[1].split("  pull_request:\n", 1)[0]
if push != "    branches:\n      - main\n      - dev\n":
    fail("App push CI must be limited to main and dev")

try:
    branch_policy = workflow.split("  branch_policy:\n", 1)[1].split(
        "  quality_checks:\n", 1
    )[0]
    trusted = workflow.split("  quality_checks:\n", 1)[1].split(
        "  pull_request_checks:\n", 1
    )[0]
    untrusted = workflow.split("  pull_request_checks:\n", 1)[1].split(
        "  browser_smoke:\n", 1
    )[0]
    dependency_review = workflow.split("  dependency-review:\n", 1)[1].split(
        "  secret-scan:\n", 1
    )[0]
    dispatch = workflow.split("  dispatch_b2b_deployment:\n", 1)[1]
except IndexError as exc:
    raise SystemExit("ERROR: App CI trust-boundary jobs are unavailable") from exc

for expected in (
    "    name: branch-policy\n",
    "      pull-requests: read\n",
    "BRANCH_POLICY_REPOSITORY: ${{ github.repository }}",
    "BRANCH_POLICY_HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}",
    "BRANCH_POLICY_BASE_REF: ${{ github.base_ref }}",
    "BRANCH_POLICY_HEAD_REF: ${{ github.head_ref }}",
    "node scripts/check-branch-policy.mjs pull-request",
    "node-version: 26.10.0",
    "GH_TOKEN: ${{ github.token }}",
    "BRANCH_POLICY_REF_NAME: ${{ github.ref_name }}",
    "BRANCH_POLICY_SHA: ${{ github.sha }}",
    "BRANCH_POLICY_BEFORE_SHA: ${{ github.event.before }}",
    "BRANCH_POLICY_FORCED: ${{ github.event.forced }}",
    "BRANCH_POLICY_CREATED: ${{ github.event.created }}",
    "BRANCH_POLICY_DELETED: ${{ github.event.deleted }}",
    'X-GitHub-Api-Version: 2022-11-28',
    '"/repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/pulls?per_page=100"',
    '"/repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}"',
    "for attempt in 1 2 3 4 5; do",
    "sleep \"$((attempt * 2))\"",
    "node scripts/check-branch-policy.mjs push",
):
    if expected not in branch_policy:
        fail(f"the App branch-policy job is missing: {expected}")
if "secrets." in branch_policy:
    fail("the App branch-policy job must not receive an Actions secret")

trusted_push_condition = (
    "    if: >-\n"
    "      needs.branch_policy.result == 'success'\n"
    "      && github.event_name == 'push'\n"
    "      && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/dev')\n"
)
if trusted_push_condition not in trusted:
    fail("the protected-branch quality job must require an exact push to main or dev")
if "    needs:\n      - branch_policy\n" not in trusted:
    fail("the protected-branch quality job must wait for branch-policy admission")
if "secrets." in untrusted or "repository: CyberGold-io/" in untrusted:
    fail("the pull-request job must not receive cross-repository credentials or sources")
for expected in (
    "if: github.event.repository.private == false",
    "actions/dependency-review-action@",
    "if: github.event.repository.private == true",
    "the independent production and development npm audit remains mandatory",
):
    if expected not in dependency_review:
        fail(f"the dependency-review availability boundary is missing: {expected}")

dispatch_condition = (
    "    if: >-\n"
    "      ${{\n"
    "        !cancelled()\n"
    "        && github.event_name == 'push'\n"
    "        && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/dev')\n"
    "        && needs.quality.result == 'success'\n"
    "        && needs['secret-scan'].result == 'success'\n"
    "      }}\n"
)
if dispatch_condition not in dispatch:
    fail(
        "the B2B dispatch job must continue past skipped quality ancestors and "
        "require successful quality and secret-scan results"
    )
for dependency in ("quality", "secret-scan"):
    if f"      - {dependency}\n" not in dispatch:
        fail(f"the B2B dispatch job must need {dependency}")
if "      - branch_policy\n" not in workflow.split("  quality:\n", 1)[1].split(
    "  dependency-review:\n", 1
)[0]:
    fail("the aggregate quality job must require branch-policy admission")
if "GH_TOKEN: ${{ secrets.CYBERGOLD_XREPO_TOKEN }}" not in dispatch:
    fail("the B2B dispatch job must use the existing cross-repository token")
for expected in (
    "refs/heads/main)\n              target=mainnet",
    "refs/heads/dev)\n              target=sandbox",
    "gh workflow run publish-b2b-app.yml",
    "--repo CyberGold-io/cybergold-ops",
    "--ref main",
    '-f "target=${target}"',
    '-f "app_commit=${GITHUB_SHA}"',
    '-f "app_ci_run_id=${GITHUB_RUN_ID}"',
):
    if expected not in dispatch:
        fail(f"the B2B dispatch contract is missing: {expected}")
if "pull_request_target:" in workflow:
    fail("pull_request_target must not expose the B2B dispatch credential")
if workflow.count("secrets.") != trusted.count("secrets.") + dispatch.count("secrets."):
    fail("a PR-runnable App job must not reference Actions secrets")

checkout_blocks = [
    segment.split("\n      - ", 1)[0]
    for segment in workflow.split("uses: actions/checkout@")[1:]
]
if not checkout_blocks or any("persist-credentials: false" not in block for block in checkout_blocks):
    fail("every App checkout must disable persisted credentials")

from_lines = [line for line in DOCKERFILE.read_text(encoding="utf-8").splitlines() if line.startswith("FROM ")]
if not from_lines or any(line.split()[1] != NODE_BASE for line in from_lines):
    fail("every App build stage must use the reviewed immutable Node base digest")

dockerfile = DOCKERFILE.read_text(encoding="utf-8")
for expected_build_identity_line in (
    "ARG CYBERGOLD_APP_COMMIT",
    "ENV NEXT_PUBLIC_CYBERGOLD_APP_COMMIT=${CYBERGOLD_APP_COMMIT}",
):
    if expected_build_identity_line not in dockerfile:
        fail(
            "the App image build must project the exact Ops-provided App commit: "
            f"{expected_build_identity_line}"
        )

print("App release-boundary validation passed.")
