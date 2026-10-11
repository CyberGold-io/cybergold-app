import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Address } from "viem";
import { createGovernanceSurfaces, getGovernanceSurface, GOVERNANCE_SURFACES } from "../[locale]/governance/_lib/governanceSurfaces.ts";
import {
  hasGovernanceNavigationAccess,
  resolveDiamondGovernanceAuthority,
  resolveOwnerAuthorityProbe,
} from "./governanceAuthority.ts";

test("Core, Staking, and Governance expose one dynamic-Safe pause surface", () => {
  const core = getGovernanceSurface("core");
  const staking = getGovernanceSurface("staking");
  const governance = getGovernanceSurface("governance-diamond");

  assert.equal(core.sections[0]?.id, "pause");
  assert.deepEqual(
    core.sections[0]?.actions.map((action) => action.functionSignature),
    ["pause()", "unpause()"]
  );
  assert.deepEqual(core.sections[0]?.requiredRoleIds, []);
  assert.equal(core.roles.some((role) => role.id === "PAUSER_ROLE"), false);

  assert.equal(staking.sections[0]?.id, "pause");
  assert.deepEqual(
    staking.sections[0]?.actions.map((action) => action.functionSignature),
    ["pause()", "unpause()"]
  );
  assert.deepEqual(staking.sections[0]?.requiredRoleIds, []);
  assert.equal(staking.roles.some((role) => role.id === "PAUSER_ROLE"), false);

  assert.equal(governance.sections[0]?.id, "pause");
  assert.deepEqual(
    governance.sections[0]?.actions.map((action) => action.functionSignature),
    ["pause()", "unpause()"]
  );
  assert.deepEqual(governance.sections[0]?.requiredRoleIds, []);
  assert.deepEqual(
    governance.sections[0]?.actions.map((action) => action.requiredRoleId),
    ["SAFE_OWNER", "SAFE_WALLET"]
  );
  assert.equal(
    governance.roles.some((role) => role.id === "PAUSER_ROLE"),
    false
  );
  assert.match(
    governance.sections[0]?.description ?? "",
    /Recovery Fund activation, purchases, and redemption/
  );
  assert.match(
    governance.sections[0]?.description ?? "",
    /protected CYGLD outflows, and allowance increases/
  );
  assert.match(
    governance.sections[0]?.description ?? "",
    /All Core recovery-share redemption, including Fund-owned inventory, remains governed by the Core pause/
  );
  assert.equal(governance.sections.some((section) => section.id === "treasury-pause"), false);
});

test("Governance Safe discovery does not infer authority from diamond storage", () => {
  const source = readFileSync(
    new URL("../hooks/useGovernanceSafe.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /getStorageAt|DIAMOND_OWNER_SLOT|diamond-storage/);
});

test("Core and Helpers governance resolve independent live authority identities", () => {
  const coreDiamond =
    "0x1111111111111111111111111111111111111111" as Address;
  const helpersDiamond =
    "0x2222222222222222222222222222222222222222" as Address;
  const helpersOwner =
    "0x3333333333333333333333333333333333333333" as Address;

  assert.deepEqual(
    resolveDiamondGovernanceAuthority("core", coreDiamond, helpersOwner),
    {
      authorityKind: "emergency-authority",
      authorityAddress: coreDiamond,
    }
  );
  assert.deepEqual(
    resolveDiamondGovernanceAuthority(
      "helpers",
      helpersDiamond,
      helpersOwner
    ),
    {
      authorityKind: "owner",
      authorityAddress: helpersOwner,
    }
  );
});

test("governance navigation grants either Core or Helpers authority without conflating them", () => {
  const coreSafeOwner =
    "0x1111111111111111111111111111111111111111" as Address;
  const helpersOwner =
    "0x2222222222222222222222222222222222222222" as Address;
  const outsider =
    "0x3333333333333333333333333333333333333333" as Address;

  assert.equal(
    hasGovernanceNavigationAccess(coreSafeOwner, [
      [coreSafeOwner],
      [helpersOwner],
    ]),
    true
  );
  assert.equal(
    hasGovernanceNavigationAccess(helpersOwner, [
      [coreSafeOwner],
      [helpersOwner],
    ]),
    true
  );
  assert.equal(
    hasGovernanceNavigationAccess(outsider, [
      [coreSafeOwner],
      [helpersOwner],
    ]),
    false
  );
});

test("owner authority probes allow proven EOAs and fail closed on contract probe failures", () => {
  const helpersOwner =
    "0x2222222222222222222222222222222222222222" as Address;
  const safeOwner =
    "0x4444444444444444444444444444444444444444" as Address;

  assert.deepEqual(
    resolveOwnerAuthorityProbe({
      authorityAddress: helpersOwner,
      bytecode: undefined,
      codeProbeStatus: "success",
      safeOwners: [],
      safeProbeStatus: "idle",
    }),
    {
      source: "owner-direct",
      owners: [helpersOwner],
      threshold: 1,
    }
  );
  assert.deepEqual(
    resolveOwnerAuthorityProbe({
      authorityAddress: helpersOwner,
      bytecode: "0x6000",
      codeProbeStatus: "success",
      safeOwners: [],
      safeProbeStatus: "error",
    }),
    {
      source: "unknown",
      owners: [],
      failure: "safe-probe-failed",
    }
  );
  assert.deepEqual(
    resolveOwnerAuthorityProbe({
      authorityAddress: helpersOwner,
      bytecode: "0x6000",
      codeProbeStatus: "success",
      safeOwners: [safeOwner],
      safeThreshold: 1,
      safeProbeStatus: "success",
    }),
    {
      source: "owner-safe",
      owners: [safeOwner],
      safeAddress: helpersOwner,
      threshold: 1,
    }
  );
});

test("every locale describes the complete Governance pause boundary", () => {
  const expected = {
    en: {
      paused: "Governance paused · Fund actions and protected outflows unavailable",
      unpaused: "Governance pause inactive · Redemption still follows Core pause",
    },
    de: {
      paused: "Governance pausiert · Fondsaktionen und geschützte Abflüsse nicht verfügbar",
      unpaused: "Governance-Pause inaktiv · Rücknahme folgt weiterhin der Core-Pause",
    },
    fr: {
      paused: "Gouvernance en pause · Actions du fonds et sorties protégées indisponibles",
      unpaused: "Pause de gouvernance inactive · Le rachat reste soumis à la pause du Core",
    },
    ru: {
      paused: "Управление приостановлено · Операции фонда и защищённые исходящие переводы недоступны",
      unpaused: "Пауза управления неактивна · Погашение по-прежнему зависит от паузы Core",
    },
  } as const;

  for (const [locale, policy] of Object.entries(expected)) {
    const messages = JSON.parse(
      readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")
    ) as { Dashboard: Record<string, string> };
    assert.equal(messages.Dashboard.recoveryFundGovernancePaused, policy.paused);
    assert.equal(messages.Dashboard.recoveryFundGovernanceUnpaused, policy.unpaused);
  }
});


test("reactive governance deployments leave existing targets and shared navigation metadata intact", () => {
  const coreA = "0x1111111111111111111111111111111111111111" as Address;
  const coreB = "0x2222222222222222222222222222222222222222" as Address;
  const helpers = "0x3333333333333333333333333333333333333333" as Address;
  const safe = "0x4444444444444444444444444444444444444444" as Address;
  const first = createGovernanceSurfaces({ core: coreA, helpers, safe });
  const preparedTarget = first.find(surface => surface.id === "core")!.address;
  const second = createGovernanceSurfaces({ core: coreB });

  assert.equal(getGovernanceSurface("core", { core: coreB }).address, coreB);
  assert.equal(second.find(surface => surface.id === "core")!.address, coreB);
  assert.equal(preparedTarget, coreA);
  assert.equal(first.find(surface => surface.id === "core")!.address, coreA);
  assert.equal(first.find(surface => surface.id === "helpers")!.address, helpers);
  assert.equal(first.find(surface => surface.id === "safe")!.address, safe);
  assert.equal(second.find(surface => surface.id === "helpers")!.address, undefined);
  assert.equal(second.find(surface => surface.id === "staking")!.address, undefined);
  assert.ok(GOVERNANCE_SURFACES.every(surface => surface.address === undefined));
});
