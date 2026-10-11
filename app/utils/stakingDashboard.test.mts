import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the undeployed Staking dashboard never presents fabricated live data", () => {
  const source = readFileSync(
    new URL("../[locale]/dashboard/page.tsx", import.meta.url),
    "utf8"
  );
  const panel = source.slice(
    source.indexOf("{/* STAKING POOL */}"),
    source.indexOf("{/* GOVERNANCE */}")
  );

  assert.match(panel, /stakingDataUnavailableTitle/);
  assert.match(panel, /stakingDataUnavailableDescription/);
  assert.doesNotMatch(panel, /formatFiat\(|Healthy|[0-9]+\s+sleeves|claimRewards/);
});

test("every locale explains that Staking data is unavailable", () => {
  for (const locale of ["en", "fr", "de", "ru"]) {
    const messages = JSON.parse(
      readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")
    ) as { Dashboard: Record<string, string> };

    assert.ok(messages.Dashboard.stakingDataUnavailableTitle);
    assert.ok(messages.Dashboard.stakingDataUnavailableDescription);
  }
});
