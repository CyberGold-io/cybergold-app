#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function resolvePullRequests({ repository, refName, sha }, getJson) {
  const associated = getJson(`/repos/${repository}/commits/${sha}/pulls?per_page=100`);
  if (associated.some((pr) => pr.merge_commit_sha === sha)) return associated;

  // GitHub's commit association index can omit a completed merge. The canonical
  // PR list supplies the same metadata; check-branch-policy still admits it.
  for (let page = 1; ; page += 1) {
    const pullRequests = getJson(
      `/repos/${repository}/pulls?state=closed&base=${encodeURIComponent(refName)}` +
      `&sort=updated&direction=desc&per_page=100&page=${page}`,
    );
    const matches = pullRequests.filter((pr) => pr.merge_commit_sha === sha);
    if (matches.length > 0 || pullRequests.length < 100) return matches;
  }
}

function getJson(endpoint) {
  return JSON.parse(execFileSync("gh", [
    "api",
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2022-11-28",
    endpoint,
  ], { encoding: "utf8", maxBuffer: Infinity, stdio: ["ignore", "pipe", "inherit"] }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const pullRequests = resolvePullRequests({
      repository: process.env.BRANCH_POLICY_REPOSITORY,
      refName: process.env.BRANCH_POLICY_REF_NAME,
      sha: process.env.BRANCH_POLICY_SHA,
    }, getJson);
    process.stdout.write(`${JSON.stringify(pullRequests)}\n`);
  } catch (error) {
    process.stderr.write(`ERROR: could not fetch pull-request metadata: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
