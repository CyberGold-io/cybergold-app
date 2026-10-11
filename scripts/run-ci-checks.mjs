#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logDir = path.join(root, "out", "ci");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function positiveInteger(raw, name) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const defaultJobs = Math.min(3, os.availableParallelism());
const maxJobs = positiveInteger(process.env.APP_CI_JOBS ?? String(defaultJobs), "APP_CI_JOBS");
const buildWarningPatterns = [
  /Compiled with warnings/i,
  /Module not found: Can't resolve/i,
  /(?:^|\n)\s*⚠\s/m,
];
const informationalBuildMessages = [
  /^[ \t]*⚠ No build cache found\. Please configure build caching for faster rebuilds\. Read more: https:\/\/nextjs\.org\/docs\/messages\/no-cache[ \t]*\r?$/gm,
];

function unexpectedBuildOutput(contents) {
  return informationalBuildMessages.reduce(
    (remaining, pattern) => remaining.replace(pattern, ""),
    contents,
  );
}

const phases = [
  {
    name: "generated-source preflight",
    checks: [
      ["branch-policy", ["scripts/check-branch-policy.mjs", "--self-test"], process.execPath],
      ["naming", ["run", "check:naming"]],
      ["docs", ["run", "check:docs"]],
      ["workflows", ["run", "check:workflows"]],
      ["release-boundaries", ["run", "check:release-boundaries"]],
      ["abis", ["run", "check:abis"]],
    ],
  },
  {
    name: "static and unit checks",
    checks: [
      ["lint", ["run", "lint"]],
      ["unit", ["test"]],
      ["typecheck", ["run", "typecheck"]],
    ],
  },
  {
    // Next build owns .next and therefore remains isolated from tsc.
    name: "production build",
    jobs: 1,
    checks: [["build", ["run", "build"]]],
  },
];

function runCheck([name, args, executable = npmCommand]) {
  return new Promise((resolve) => {
    const logPath = path.join(logDir, `${name}.log`);
    const output = fs.createWriteStream(logPath, { flags: "w" });
    const started = performance.now();
    let settled = false;
    const child = spawn(executable, args, {
      cwd: root,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });

    const finish = (code, detail = "") => {
      if (settled) return;
      settled = true;
      const elapsedSeconds = (performance.now() - started) / 1000;
      if (detail) output.write(`ERROR: ${detail}\n`);
      output.end(() => {
        let resolvedCode = code;
        if (name === "build" && code === 0) {
          const contents = fs.readFileSync(logPath, "utf8");
          const unexpectedOutput = unexpectedBuildOutput(contents);
          if (buildWarningPatterns.some((pattern) => pattern.test(unexpectedOutput))) {
            resolvedCode = 1;
            fs.appendFileSync(
              logPath,
              "ERROR: production build emitted a warning; warning-free output is required.\n"
            );
          }
        }
        resolve({ name, code: resolvedCode, elapsedSeconds, logPath });
      });
    };
    child.on("error", (error) => finish(127, `could not start check: ${error.message}`));
    child.on("close", (code, signal) => {
      finish(code ?? 1, signal ? `terminated by signal ${signal}` : "");
    });
  });
}

async function runBounded(checks, jobs) {
  const results = new Array(checks.length);
  let next = 0;
  async function worker() {
    while (next < checks.length) {
      const index = next;
      next += 1;
      const result = await runCheck(checks[index]);
      results[index] = result;
      const outcome = result.code === 0 ? "passed" : `failed (${result.code})`;
      process.stdout.write(`==> ${result.name} ${outcome} in ${result.elapsedSeconds.toFixed(1)}s\n`);
    }
  }
  const workers = Math.min(jobs, checks.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function printLogs(results) {
  for (const result of results) {
    process.stdout.write(
      `\n===== ${result.name}: exit ${result.code}, ${result.elapsedSeconds.toFixed(1)}s =====\n`,
    );
    const contents = fs.readFileSync(result.logPath, "utf8");
    process.stdout.write(contents);
    if (contents && !contents.endsWith("\n")) process.stdout.write("\n");
  }
}

async function main() {
  fs.mkdirSync(logDir, { recursive: true });
  for (const phase of phases) {
    const jobs = phase.jobs ?? maxJobs;
    process.stdout.write(
      `Running ${phase.name} with at most ${Math.min(jobs, phase.checks.length)} concurrent process(es)...\n`,
    );
    const results = await runBounded(phase.checks, jobs);
    printLogs(results);
    const failed = results.filter((result) => result.code !== 0);
    if (failed.length > 0) {
      process.stderr.write(`App CI checks failed: ${failed.map((result) => result.name).join(", ")}\n`);
      return 1;
    }
  }
  process.stdout.write("App CI checks passed.\n");
  return 0;
}

process.exitCode = await main();
