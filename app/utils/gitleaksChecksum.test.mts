import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("the Gitleaks installer fails closed on its mismatched archive fixture", () => {
  const installer = new URL("../../scripts/install-gitleaks.sh", import.meta.url);
  const fixture = new URL(
    "../../scripts/fixtures/gitleaks/mismatched-archive.txt",
    import.meta.url
  );
  const destination = new URL(
    "../../out/test-gitleaks-mismatch",
    import.meta.url
  );
  const mismatch = spawnSync("bash", [installer.pathname, destination.pathname], {
    env: {
      ...process.env,
      GITLEAKS_ASSET_SOURCE: fixture.pathname,
    },
  });

  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr.toString(), /SHA-256 mismatch/);
});
