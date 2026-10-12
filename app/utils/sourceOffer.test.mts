// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import nextProxyTesting from "next/dist/experimental/testing/server/middleware-testing-utils.js";
import { retainedSourceOffers } from "../source-offers.ts";
import { sourceOffer, sourcePage } from "./sourceOffer.ts";

const { unstable_doesMiddlewareMatch } = nextProxyTesting;

test("source discovery bypasses locale routing while product pages keep it", () => {
  const proxy = readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
  const matcherLiteral = proxy.match(/matcher: '([^']+)'/)![1];
  const config = { matcher: JSON.parse(`"${matcherLiteral}"`) };
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/source" }), false);
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/source/index.html" }), false);
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/en" }), true);
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/en/governance" }), true);
});

test("current source archives and rollback offers remain available after retirement", async () => {
  const appVersion = "a886a7a692f9f559d41b7760704e1ecae0770590";
  const backendVersion = "8594a405243a21082fb146f3f8236efc665d64d5";
  const page = await sourcePage(appVersion, async () => ({ version: backendVersion }));
  const staticPage = readFileSync(new URL("../../public/source/index.html", import.meta.url), "utf8");
  assert.ok(page.includes(sourceOffer("cybergold-app", appVersion).downloadUrl!));
  assert.ok(page.includes(sourceOffer("cybergold-backend", backendVersion).downloadUrl!));
  assert.equal(sourceOffer("cybergold-backend", backendVersion).downloadUrl,
    `https://github.com/CyberGold-io/cybergold-backend/archive/${backendVersion}.tar.gz`);
  for (const retained of retainedSourceOffers) {
    assert.ok(page.includes(retained.downloadUrl)); assert.ok(staticPage.includes(retained.downloadUrl));
    assert.equal(sourceOffer(retained.repository, retained.version).downloadUrl, retained.downloadUrl);
  }
  assert.ok(page.includes("corresponding-source-1c69aff1d186e9fd19c404a9d3f5be0186c52616"));
  assert.ok(page.includes("corresponding-source-43c412967a44ed5b9095b8b6748b9418ef6792c9"));
  for (const retiredVersion of [
    "847990c5f5ff412aa2be235423790e28fe11a876",
    "ab8526199a33d81aca84f05c70b4a683993c242d",
    "728ca83dc890f6aeb0d67af8c1ef710f15b20e59",
  ]) {
    assert.ok(!page.includes(retiredVersion)); assert.ok(!staticPage.includes(retiredVersion));
  }
  assert.ok(page.includes(sourceOffer("cybergold-app", appVersion).dependencySourcesUrl));
  assert.ok(page.includes(sourceOffer("cybergold-backend", backendVersion).dependencySourcesUrl));
  assert.ok(page.includes("Library source and build controls"));
});

test("Backend failure preserves the current App source and retained links", async () => {
  const commit = "e".repeat(40);
  const page = await sourcePage(commit, async () => { throw new Error("fixture-private-value"); });
  assert.ok(page.includes(`/archive/${commit}.tar.gz`));
  assert.ok(page.includes("https://github.com/CyberGold-io/cybergold-backend"));
  assert.ok(!page.includes("fixture-private-value"));
  assert.equal(sourceOffer("cybergold-app", commit).dependencySourcesUrl,
    "https://github.com/CyberGold-io/cybergold-app/releases/download/dependency-source-2026-10-12/dependency-source-index.json");
});

test("only fixed GitHub URLs are rendered and release text is escaped", async () => {
  const page = await sourcePage('<script>fixture</script>', async () => ({ version: '" onclick="fixture' }));
  assert.ok(!page.includes('<script>fixture</script>')); assert.ok(!page.includes('href="javascript:'));
  assert.ok(page.includes("&lt;script&gt;"));
  assert.equal(sourceOffer("cybergold-app", undefined).downloadUrl, null);
});
