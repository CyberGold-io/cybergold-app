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

test("current App and Backend select their own exact retained offers", async () => {
  const app = retainedSourceOffers.find((item) => item.repository === "cybergold-app")!;
  const backend = retainedSourceOffers.find((item) => item.repository === "cybergold-backend")!;
  const page = await sourcePage(app.version, async () => ({ version: backend.version }));
  assert.ok(page.includes(app.downloadUrl)); assert.ok(page.includes(backend.downloadUrl));
  assert.ok(page.includes(app.version)); assert.ok(page.includes(backend.version));
  assert.equal(sourceOffer("cybergold-app", app.version).downloadUrl, app.downloadUrl);
  assert.ok(page.includes(sourceOffer("cybergold-app", app.version).dependencySourcesUrl));
  assert.ok(page.includes(sourceOffer("cybergold-backend", backend.version).dependencySourcesUrl));
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
