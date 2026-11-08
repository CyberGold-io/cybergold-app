import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { resolvePullRequests } from "../../scripts/fetch-branch-policy-pull-requests.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repository = "CyberGold-io/cybergold-app";
const sha = "a".repeat(40);
const beforeSha = "b".repeat(40);
const headSha = "c".repeat(40);
const input = { repository, refName: "dev", sha };

function mergedPullRequest(refName = "dev") {
  return {
    merged_at: "2026-11-04T09:55:23Z",
    merge_commit_sha: sha,
    base: { ref: refName, repo: { full_name: repository } },
    head: {
      ref: refName === "dev" ? "feature/route-search" : "dev",
      repo: { full_name: repository },
      sha: headSha,
    },
  };
}

function webMergeCommit() {
  return {
    sha,
    committer: { login: "web-flow" },
    commit: {
      committer: { name: "GitHub", email: "noreply@github.com" },
      verification: {
        verified: true,
        reason: "valid",
        signature: "-----BEGIN PGP SIGNATURE-----\nfixture\n-----END PGP SIGNATURE-----",
      },
    },
    parents: [{ sha: beforeSha }, { sha: headSha }],
  };
}

function validate(pullRequests, commit = webMergeCommit(), refName = "dev") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "app-branch-policy-lookup-"));
  try {
    const pullRequestsFile = path.join(dir, "pull-requests.json");
    const commitFile = path.join(dir, "commit.json");
    writeFileSync(pullRequestsFile, JSON.stringify(pullRequests));
    writeFileSync(commitFile, JSON.stringify(commit));
    return spawnSync(process.execPath, ["scripts/check-branch-policy.mjs", "push"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        BRANCH_POLICY_REPOSITORY: repository,
        BRANCH_POLICY_REF_NAME: refName,
        BRANCH_POLICY_SHA: sha,
        BRANCH_POLICY_BEFORE_SHA: beforeSha,
        BRANCH_POLICY_FORCED: "false",
        BRANCH_POLICY_CREATED: "false",
        BRANCH_POLICY_DELETED: "false",
        BRANCH_POLICY_PULL_REQUESTS_FILE: pullRequestsFile,
        BRANCH_POLICY_COMMIT_FILE: commitFile,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("matching commit association uses the existing fast path", () => {
  const associated = [mergedPullRequest()];
  const calls = [];
  const result = resolvePullRequests(input, (endpoint) => {
    calls.push(endpoint);
    return associated;
  });
  assert.equal(result, associated);
  assert.deepEqual(calls, [`/repos/${repository}/commits/${sha}/pulls?per_page=100`]);
});

for (const refName of ["dev", "main"]) {
  test(`empty commit association falls back to the canonical merged PR for ${refName}`, () => {
    const canonical = mergedPullRequest(refName);
    const calls = [];
    const result = resolvePullRequests({ ...input, refName }, (endpoint) => {
      calls.push(endpoint);
      return calls.length === 1 ? [] : [canonical];
    });
    assert.deepEqual(result, [canonical]);
    assert.equal(calls[1], `/repos/${repository}/pulls?state=closed&base=${refName}&sort=updated&direction=desc&per_page=100&page=1`);
    const validation = validate(result, webMergeCommit(), refName);
    assert.equal(validation.status, 0, validation.stderr);
  });
}

test("fallback searches subsequent pages and ignores unrelated associated PRs", () => {
  const unrelated = { ...mergedPullRequest(), merge_commit_sha: "d".repeat(40) };
  const canonical = mergedPullRequest();
  const calls = [];
  const result = resolvePullRequests(input, (endpoint) => {
    calls.push(endpoint);
    if (calls.length === 1) return [unrelated];
    if (calls.length === 2) return Array.from({ length: 100 }, () => unrelated);
    return [unrelated, canonical];
  });
  assert.deepEqual(result, [canonical]);
  assert.match(calls[2], /&page=2$/);
});

test("a closed PR for another merge SHA remains an ordinary failed admission", () => {
  let calls = 0;
  const result = resolvePullRequests(input, () => ++calls === 1 ? [] : [
    { ...mergedPullRequest(), merge_commit_sha: "d".repeat(40) },
  ]);
  assert.deepEqual(result, []);
  assert.equal(calls, 2);
  const validation = validate(result);
  assert.equal(validation.status, 1);
  assert.match(validation.stderr, /not the merge result of an allowed pull request/);
});

test("an exhausted canonical PR list returns no match", () => {
  let calls = 0;
  const result = resolvePullRequests(input, () => {
    calls += 1;
    return [];
  });
  assert.deepEqual(result, []);
  assert.equal(calls, 2);
});

test("canonical lookup errors propagate instead of admitting a merge", () => {
  let calls = 0;
  assert.throws(() => resolvePullRequests(input, () => {
    if (++calls === 1) return [];
    throw new Error("GitHub HTTP 503");
  }), /GitHub HTTP 503/);
});

test("CLI accepts canonical PR pages larger than the default subprocess buffer", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "app-branch-policy-api-"));
  try {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const fixture = path.join(dir, "pull-request.json");
    const canonical = { ...mergedPullRequest(), body: "x".repeat(2 * 1024 * 1024) };
    writeFileSync(fixture, JSON.stringify(canonical));
    writeFileSync(path.join(bin, "gh"), `#!/usr/bin/env node
const fs = require("node:fs");
const endpoint = process.argv.at(-1);
const pr = JSON.parse(fs.readFileSync(process.env.LOOKUP_FIXTURE, "utf8"));
process.stdout.write(JSON.stringify(endpoint.includes("/commits/") ? [] : [pr]));
`, { mode: 0o755 });
    const result = spawnSync(process.execPath, ["scripts/fetch-branch-policy-pull-requests.mjs"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: Infinity,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        LOOKUP_FIXTURE: fixture,
        BRANCH_POLICY_REPOSITORY: repository,
        BRANCH_POLICY_REF_NAME: "dev",
        BRANCH_POLICY_SHA: sha,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [canonical]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [name, mutate, message] of [
  ["different PR head", (pr) => { pr.head.sha = "d".repeat(40); }, /not the merge result/],
  ["disallowed PR source", (pr) => { pr.head.ref = "dev"; }, /not the merge result/],
  ["different base repository", (pr) => { pr.base.repo.full_name = "other/repository"; }, /not the merge result/],
  ["unmerged PR", (pr) => { pr.merged_at = null; }, /not the merge result/],
  ["reversed commit parents", (_pr, commit) => { commit.parents.reverse(); }, /ordered merge commit/],
  ["unsigned commit", (_pr, commit) => { commit.commit.verification.verified = false; }, /GitHub-web signed/],
]) {
  test(`canonical fallback retains rejection of ${name}`, () => {
    const canonical = mergedPullRequest();
    const commit = webMergeCommit();
    mutate(canonical, commit);
    let calls = 0;
    const result = resolvePullRequests(input, () => ++calls === 1 ? [] : [canonical]);
    const validation = validate(result, commit);
    assert.equal(validation.status, 1);
    assert.match(validation.stderr, message);
  });
}
