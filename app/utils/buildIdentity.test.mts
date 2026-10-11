import assert from "node:assert/strict";
import test from "node:test";

import { resolveBuildIdentity } from "./buildIdentity.ts";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";

test("builds a GitHub link for an exact App commit", () => {
  assert.deepEqual(resolveBuildIdentity(COMMIT), {
    commit: COMMIT,
    shortCommit: "12345678",
    url: `https://github.com/CyberGold-io/cybergold-app/commit/${COMMIT}`,
  });
});

test("does not publish a link for absent or malformed build identity", () => {
  assert.equal(resolveBuildIdentity(undefined), null);
  assert.equal(resolveBuildIdentity("12345678"), null);
  assert.equal(resolveBuildIdentity(COMMIT.toUpperCase()), null);
  assert.equal(resolveBuildIdentity(`${COMMIT}0`), null);
});
