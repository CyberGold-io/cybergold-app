import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGovernanceDeploymentAddressBook,
  extendGovernanceAddressBook,
  getGovernanceAddressLabel,
} from "./governanceAddressBook.ts";

test("deployment labels come from Backend configuration and preserve the configured Safe", () => {
  const entries = buildGovernanceDeploymentAddressBook({
    core: "0x00000000000000000000000000000000000000a1",
    helpers: "0x00000000000000000000000000000000000000b2",
    safe: "0x00000000000000000000000000000000000000c3",
    adapter: "0x00000000000000000000000000000000000000d4",
  });
  const labels = new Map(entries.map((entry) => [entry.address.toLowerCase(), entry.label]));

  assert.equal(labels.get("0x00000000000000000000000000000000000000a1"), "Core Diamond");
  assert.equal(labels.get("0x00000000000000000000000000000000000000b2"), "Helpers Diamond");
  assert.equal(labels.get("0x00000000000000000000000000000000000000c3"), "Governance Safe");
  assert.equal(labels.get("0x00000000000000000000000000000000000000d4"), "Uniswap Adapter");
});

test("independent configuration snapshots do not leak addresses or require optional deployments", () => {
  const previous = buildGovernanceDeploymentAddressBook({
    core: "0x00000000000000000000000000000000000000a1",
  });
  assert.deepEqual(buildGovernanceDeploymentAddressBook(), []);
  const next = buildGovernanceDeploymentAddressBook({
    core: "0x00000000000000000000000000000000000000b2",
  });
  assert.equal(previous[0]?.address.toLowerCase(), "0x00000000000000000000000000000000000000a1");
  assert.equal(next[0]?.address.toLowerCase(), "0x00000000000000000000000000000000000000b2");
  assert.equal(previous.some(entry => entry.label === "Staking Diamond"), false);
});

test("extendGovernanceAddressBook overlays discovered addresses", () => {
  const addressBook = extendGovernanceAddressBook(
    [{ address: "0x00000000000000000000000000000000000000a1", label: "Core Diamond" }],
    [{ address: "0x00000000000000000000000000000000000000b2", label: "Reserve" }]
  );

  assert.equal(getGovernanceAddressLabel(addressBook, "0x00000000000000000000000000000000000000A1"), "Core Diamond");
  assert.equal(getGovernanceAddressLabel(addressBook, "0x00000000000000000000000000000000000000b2"), "Reserve");
});
