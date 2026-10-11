import assert from "node:assert/strict";
import test from "node:test";

import { ACCEPTED_ADVISORY, assessAudit } from "../../scripts/check-dependency-audit.mjs";

function fixture() {
  return {
    report: { vulnerabilities: {
      lint: { nodes: ["node_modules/lint"], via: ["glob"] },
      glob: { nodes: ["node_modules/glob"], via: ["braces"] },
      braces: { nodes: ["node_modules/braces"], via: [{ url: ACCEPTED_ADVISORY }] },
    } },
    lockfile: { packages: {
      "node_modules/lint": { dev: true },
      "node_modules/glob": { dev: true },
      "node_modules/braces": { dev: true },
    } },
  };
}

test("accepts only the approved development advisory and its affected development parents", () => {
  const { report, lockfile } = fixture();
  const result = assessAudit(report, lockfile);
  assert.deepEqual(result.accepted.sort(), ["braces", "glob", "lint"]);
  assert.deepEqual(result.rejected, []);
});

test("the same advisory in production still blocks every affected parent", () => {
  const { report, lockfile } = fixture();
  lockfile.packages["node_modules/braces"].dev = false;
  const result = assessAudit(report, lockfile);
  assert.deepEqual(result.accepted, []);
  assert.equal(result.rejected.length, 3);
  assert.ok(result.rejected.includes("braces: node_modules/braces is not a development-only dependency"));
});

test("a production parent cannot inherit a development exception", () => {
  const { report, lockfile } = fixture();
  lockfile.packages["node_modules/lint"].dev = false;
  const result = assessAudit(report, lockfile);
  assert.deepEqual(result.accepted.sort(), ["braces", "glob"]);
  assert.deepEqual(result.rejected, ["lint: node_modules/lint is not a development-only dependency"]);
});

test("a second advisory on the same development package is never hidden", () => {
  const { report, lockfile } = fixture();
  report.vulnerabilities.braces.via.push({ url: "https://github.com/advisories/GHSA-other" });
  const result = assessAudit(report, lockfile);
  assert.deepEqual(result.accepted, []);
  assert.equal(result.rejected.length, 3);
  assert.ok(result.rejected.includes("braces: advisory https://github.com/advisories/GHSA-other has no accepted exception"));
});

test("unrelated findings still block while the approved finding stays visible", () => {
  const { report, lockfile } = fixture();
  const result = assessAudit({ vulnerabilities: { ...report.vulnerabilities,
    other: { nodes: ["node_modules/other"], via: [{ url: "https://github.com/advisories/GHSA-other" }] },
  } }, { packages: { ...lockfile.packages, "node_modules/other": { dev: true } } });
  assert.deepEqual(result.accepted.sort(), ["braces", "glob", "lint"]);
  assert.deepEqual(result.rejected, ["other: advisory https://github.com/advisories/GHSA-other has no accepted exception"]);
});

test("every installed instance must be development-only", () => {
  const { report, lockfile } = fixture();
  report.vulnerabilities.braces.nodes.push("node_modules/runtime/node_modules/braces");
  const result = assessAudit(report, { packages: { ...lockfile.packages,
    "node_modules/runtime/node_modules/braces": { dev: false },
  } });
  assert.deepEqual(result.accepted, []);
  assert.ok(result.rejected.includes("braces: node_modules/runtime/node_modules/braces is not a development-only dependency"));
});

test("unknown paths and missing causes do not acquire an exception", () => {
  const { report, lockfile } = fixture();
  report.vulnerabilities.braces.nodes = ["node_modules/unknown"];
  assert.equal(assessAudit(report, lockfile).accepted.length, 0);
  report.vulnerabilities.braces.nodes = ["node_modules/braces"];
  report.vulnerabilities.braces.via = [];
  assert.equal(assessAudit(report, lockfile).accepted.length, 0);
});

test("a clean audit passes while malformed audit output remains an error", () => {
  assert.deepEqual(assessAudit({ vulnerabilities: {} }, { packages: {} }), { accepted: [], rejected: [] });
  assert.throws(() => assessAudit({}, { packages: {} }));
});
