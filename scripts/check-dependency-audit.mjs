#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Owner accepted this development-only advisory on 2026-10-03. Keep it visible;
// no other advisory or production dependency is covered by this exception.
export const ACCEPTED_ADVISORY = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";

export function assessAudit(report, lockfile) {
  const findings = Object.entries(report.vulnerabilities);
  const accepted = new Set();
  const reasons = new Map();

  function rejectionReason(name, finding) {
    if (finding.nodes.length === 0) return `${name}: no dependency paths were reported`;
    for (const node of finding.nodes) {
      if (lockfile.packages[node]?.dev !== true) {
        return `${name}: ${node} is not a development-only dependency`;
      }
    }
    if (finding.via.length === 0) return `${name}: no advisory cause was reported`;
    for (const cause of finding.via) {
      if (typeof cause === "string") {
        if (!accepted.has(cause)) return `${name}: inherits a blocking finding from ${cause}`;
      } else if (cause.url !== ACCEPTED_ADVISORY) {
        return `${name}: advisory ${cause.url} has no accepted exception`;
      }
    }
    return null;
  }

  // npm also reports the parents affected by a vulnerable dependency. Accept
  // those only when every underlying cause resolves to the same exception.
  let changed;
  do {
    changed = false;
    for (const [name, finding] of findings) {
      if (accepted.has(name)) continue;
      const reason = rejectionReason(name, finding);
      if (reason === null) {
        accepted.add(name);
        changed = true;
      } else {
        reasons.set(name, reason);
      }
    }
  } while (changed);

  return {
    accepted: [...accepted],
    rejected: findings.filter(([name]) => !accepted.has(name)).map(([name]) => reasons.get(name)),
  };
}

function main() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["audit", "--json", "--audit-level=low"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`npm audit exited with ${result.status ?? result.signal}`);
  }
  const report = JSON.parse(result.stdout);
  if (report.error) throw new Error(`npm audit failed: ${report.error.summary}`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const assessment = assessAudit(report, lockfile);
  for (const name of assessment.accepted) {
    console.log(`Accepted development-only exception: ${name} via ${ACCEPTED_ADVISORY}`);
  }
  for (const reason of assessment.rejected) console.error(`Blocked audit finding: ${reason}`);
  if (assessment.rejected.length > 0) return 1;
  console.log("All-scope dependency audit passed with only the owner-accepted development exception.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
