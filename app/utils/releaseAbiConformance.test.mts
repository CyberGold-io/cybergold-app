import assert from "node:assert/strict";
import test from "node:test";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
const { GOVERNANCE_SURFACES } = await withEnvironment(appEnvironment, () =>
  import("../[locale]/governance/_lib/governanceSurfaces.ts")
);
import {
  CORE_DIAMOND_ABI,
  CORE_DIAMOND_ERC165_ADVERTISED,
  CORE_DIAMOND_FUNCTIONS,
  CORE_DIAMOND_INTERFACE_ID,
} from "../contracts/generated/coreDiamond.ts";
import {
  GOVERNANCE_DIAMOND_ABI,
  GOVERNANCE_DIAMOND_ERC165_ADVERTISED,
  GOVERNANCE_DIAMOND_FUNCTIONS,
  GOVERNANCE_DIAMOND_INTERFACE_ID,
} from "../contracts/generated/governanceDiamond.ts";
import {
  HELPERS_DIAMOND_ABI,
  HELPERS_DIAMOND_ERC165_ADVERTISED,
  HELPERS_DIAMOND_FUNCTIONS,
  HELPERS_DIAMOND_INTERFACE_ID,
} from "../contracts/generated/helpersDiamond.ts";
import {
  STAKING_DIAMOND_ABI,
  STAKING_DIAMOND_ERC165_ADVERTISED,
  STAKING_DIAMOND_FUNCTIONS,
  STAKING_DIAMOND_INTERFACE_ID,
} from "../contracts/generated/stakingDiamond.ts";

const RELEASES = {
  core: {
    abi: CORE_DIAMOND_ABI,
    erc165Advertised: CORE_DIAMOND_ERC165_ADVERTISED,
    governanceActionsTargetDiamond: true,
    functions: CORE_DIAMOND_FUNCTIONS,
    interfaceId: CORE_DIAMOND_INTERFACE_ID,
  },
  helpers: {
    abi: HELPERS_DIAMOND_ABI,
    erc165Advertised: HELPERS_DIAMOND_ERC165_ADVERTISED,
    governanceActionsTargetDiamond: true,
    functions: HELPERS_DIAMOND_FUNCTIONS,
    interfaceId: HELPERS_DIAMOND_INTERFACE_ID,
  },
  "governance-diamond": {
    abi: GOVERNANCE_DIAMOND_ABI,
    erc165Advertised: GOVERNANCE_DIAMOND_ERC165_ADVERTISED,
    // This surface also presents actions targeting its TimelockController.
    governanceActionsTargetDiamond: false,
    functions: GOVERNANCE_DIAMOND_FUNCTIONS,
    interfaceId: GOVERNANCE_DIAMOND_INTERFACE_ID,
  },
  staking: {
    abi: STAKING_DIAMOND_ABI,
    erc165Advertised: STAKING_DIAMOND_ERC165_ADVERTISED,
    governanceActionsTargetDiamond: true,
    functions: STAKING_DIAMOND_FUNCTIONS,
    interfaceId: STAKING_DIAMOND_INTERFACE_ID,
  },
} as const;

for (const [surfaceId, release] of Object.entries(RELEASES)) {
  if (release.governanceActionsTargetDiamond) {
    test(`${surfaceId} governance actions conform to the generated release ABI`, () => {
      const surface = GOVERNANCE_SURFACES.find((candidate) => candidate.id === surfaceId);
      assert.ok(surface, `missing governance surface: ${surfaceId}`);

      const signatures = new Set<string>(release.functions.map((entry) => entry.signature));
      for (const action of surface.sections.flatMap((section) => section.actions)) {
        assert.ok(
          signatures.has(action.functionSignature),
          `${surfaceId} governance action ${action.id} uses a non-release signature: ${action.functionSignature}`
        );
      }
    });
  }

  test(`${surfaceId} generated ABI and selector catalog are internally consistent`, () => {
    const abiFunctionNames = new Set<string>(
      release.abi.filter((item) => item.type === "function").map((item) => item.name)
    );
    for (const entry of release.functions) {
      assert.ok(abiFunctionNames.has(entry.signature.slice(0, entry.signature.indexOf("("))));
      assert.match(entry.selector, /^0x[0-9a-f]{8}$/);
    }
    assert.match(release.interfaceId, /^0x[0-9a-f]{8}$/);
    assert.equal(typeof release.erc165Advertised, "boolean");
  });
}

test("generated modules preserve each diamond's ERC-165 advertisement policy", () => {
  assert.equal(CORE_DIAMOND_ERC165_ADVERTISED, false);
  assert.equal(GOVERNANCE_DIAMOND_ERC165_ADVERTISED, false);
  assert.equal(HELPERS_DIAMOND_ERC165_ADVERTISED, false);
  assert.equal(STAKING_DIAMOND_ERC165_ADVERTISED, true);
});
