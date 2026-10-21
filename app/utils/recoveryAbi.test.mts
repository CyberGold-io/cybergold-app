import assert from "node:assert/strict";
import test from "node:test";

import { CORE_DIAMOND_ABI } from "../contracts/generated/coreDiamond.ts";
import { HELPERS_TRADE_EXACT_INPUT_ABI } from "../contracts/generated/helpersTradeExactInput.ts";
import { HELPERS_DIAMOND_ABI } from "../contracts/generated/helpersDiamond.ts";
import {
  GOVERNANCE_DIAMOND_ABI,
  GOVERNANCE_DIAMOND_FUNCTIONS,
  GOVERNANCE_DIAMOND_INTERFACE_ID,
} from "../contracts/generated/governanceDiamond.ts";

type AbiParameter = {
  name: string;
  indexed?: boolean;
  components?: readonly AbiParameter[];
};

type AbiEntry = {
  type: string;
  name?: string;
  inputs?: readonly AbiParameter[];
  outputs?: readonly AbiParameter[];
};

const coreAbi = CORE_DIAMOND_ABI as unknown as readonly AbiEntry[];
const helpersAbi = HELPERS_DIAMOND_ABI as unknown as readonly AbiEntry[];
const governanceAbi = GOVERNANCE_DIAMOND_ABI as unknown as readonly AbiEntry[];

function findEntry(abi: readonly AbiEntry[], type: string, name: string) {
  const entry = abi.find((candidate) => candidate.type === type && candidate.name === name);
  assert.ok(entry, `Missing ${type} ${name}`);
  return entry;
}

function componentNames(parameter: AbiParameter | undefined) {
  return parameter?.components?.map((component) => component.name) ?? [];
}

function inputNames(entry: AbiEntry) {
  return entry.inputs?.map((input) => input.name) ?? [];
}

test("generated Core ABI exposes current recovery/lifecycle state without history concepts", () => {
  for (const eventName of [
    "ReserveLifecycleChanged",
    "RecoveryActivated",
    "RecoveryRehabilitated",
    "RecoverySharesRedeemed",
    "TransferSingle",
    "TransferBatch",
  ]) {
    findEntry(coreAbi, "event", eventName);
  }
  for (const functionName of [
    "coreAttachedRecoveryAssets",
    "outstandingRecoveryAssetCount",
    "outstandingRecoveryAssets",
    "recoveryPool",
    "reserveLifecycle",
    "reserveCustodyStatus",
    "activateAsset",
    "rehabilitateRecoveryAsset",
    "previewRedeemRecoveryShares",
    "redeemRecoveryShares",
  ]) {
    findEntry(coreAbi, "function", functionName);
  }

  for (const removedName of [
    "economicRecoveryAssets",
    "resolveRecoveryPool",
    "RecoveryResolved",
    "recoveryConfigurationHash",
    "activeRecoveryEventIds",
    "recoveryEvent",
    "recoveryPoolByShareId",
    "recoveryPoolAssets",
    "recoveryShareId",
    "recoveryShareAsset",
    "reserveHistoricalAssets",
    "recoveryMode",
    "recoveryEpoch",
    "ReserveCheckpointed",
    "RecoveryRedemptionSettled",
    "ReserveAdmitted",
    "ReserveExitBegun",
    "ReserveInactivated",
    "RecoveryPoolResolved",
    "RecoverySharesSurrendered",
    "surrenderZeroValueRecoveryShares",
    "ZeroEntitlementRecoveryFinalized",
  ]) {
    assert.equal(
      coreAbi.some((entry) => entry.name === removedName),
      false,
      `${removedName} must not remain in the clean-launch ABI`
    );
  }

  assert.deepEqual(
    componentNames(findEntry(coreAbi, "function", "reserveLifecycle").outputs?.[0]),
    [
      "lifecycle",
      "exitEntitlementRaw",
    ]
  );
  assert.deepEqual(
    componentNames(findEntry(coreAbi, "function", "recoveryPool").outputs?.[0]),
    [
      "impaired",
      "coreAttachedShares",
      "externalShares",
      "redeemableRaw",
      "cygldPerAssetRawFp18",
      "cygldSupplyCap",
      "referenceShares",
      "referenceValueCygld",
      "shareDecimals",
    ]
  );
  assert.deepEqual(
    componentNames(findEntry(coreAbi, "function", "activateAsset").inputs?.[0]),
    [
      "asset",
      "expectedLifecycle",
      "expectedBasketHash",
      "expectedActiveAvailableRaw",
      "resultingBasketAssets",
      "resultingTargetsPpm",
      "resultingGoldRefGramsFp18",
    ]
  );
});

test("Core discovery and outcome events carry asset/current-state fields only", () => {
  const activation = findEntry(coreAbi, "event", "RecoveryActivated");
  assert.deepEqual(inputNames(activation), [
    "asset",
    "addedCoreAttachedShares",
  ]);
  assert.equal(activation.inputs?.[0]?.indexed, true);

  const resolution = findEntry(coreAbi, "event", "RecoveryRehabilitated");
  assert.deepEqual(inputNames(resolution), [
    "asset",
    "totalPoolRaw",
    "coreRaw",
    "externalRaw",
  ]);
  assert.equal(resolution.inputs?.[0]?.indexed, true);

  assert.deepEqual(
    inputNames(findEntry(coreAbi, "event", "RecoverySharesRedeemed")),
    ["asset", "account", "recipient", "shares", "liabilityReleasedRaw", "rawAmountOut"]
  );
  for (const callbackError of [
    "AccountCallbackFailed",
    "AccountCallbackMagicMismatch",
    "AccountCallbackReturnMalformed",
  ]) {
    findEntry(coreAbi, "error", callbackError);
  }
});

test("Helpers preserves current-state previews and universal redemption binding", () => {
  assert.deepEqual(
    componentNames(
      findEntry(helpersAbi, "function", "previewRedeemToBasketExactIn")
        .outputs?.[0]
    ),
    ["projectedCoreOutputs", "fees"]
  );
  assert.deepEqual(
    componentNames(
      findEntry(helpersAbi, "function", "previewRedeemToBasketExactOut")
        .outputs?.[0]
    ),
    ["grossCygldIn", "projectedCoreOutputs", "fees"]
  );
  assert.deepEqual(
    componentNames(
      findEntry(helpersAbi, "function", "previewRedeemToTokenExactIn")
        .outputs?.[0]
    ),
    ["minimumAmountOut", "projectedCoreOutputs", "fees"]
  );
  assert.equal(helpersAbi.some(entry=>entry.type==="function"&&entry.name==="redeemToBasketExactInWithPermit"),false);
  assert.deepEqual(componentNames(findEntry(HELPERS_TRADE_EXACT_INPUT_ABI,"function","executeExactInput").inputs?.[0]),
    ["intent","inputs","outputCurrency","recipient","deadline","minimumOutput","body"]);

  const serialized = JSON.stringify(helpersAbi);
  assert.doesNotMatch(
    serialized,
    /RecoveryBinding|recoveryShareCollection|recoveryMode|recoveryEpoch|expectedRecovery|orderedHealthy|orderedRecovery/
  );
  for (const entry of helpersAbi) {
    assert.doesNotMatch(entry.name ?? "", /^quote|RecoveryRedeem|recoveryRedeem/);
  }
});

test("Helpers previews use preview naming and no-echo construction results", () => {
  assert.deepEqual(
    componentNames(
      findEntry(helpersAbi, "function", "previewIssueFromBasketExactIn")
        .outputs?.[0]
    ),
    ["netCygldOut", "fees", "amountsInExact", "orderedCoreAssets"]
  );
  assert.deepEqual(
    componentNames(
      findEntry(helpersAbi, "function", "previewIssueFromBasketExactOut")
        .outputs?.[0]
    ),
    ["fees", "amountsInExact", "orderedCoreAssets"]
  );
  assert.deepEqual(
    componentNames(
      findEntry(helpersAbi, "function", "previewIssueFromTokenExactIn")
        .outputs?.[0]
    ),
    ["netCygldOut", "fees", "orderedCoreAssets"]
  );
  for (const functionName of [
    "previewIssueFromBasketExactIn",
    "previewIssueFromBasketExactOut",
    "previewIssueFromTokenExactIn",
    "previewIssueFromTokenExactOut",
    "previewRedeemToBasketExactIn",
    "previewRedeemToBasketExactOut",
    "previewRedeemToTokenExactIn",
  ]) {
    findEntry(helpersAbi, "function", functionName);
  }
  for (const entry of helpersAbi) {
    assert.doesNotMatch(entry.name ?? "", /^quote/);
  }
});

test("generated Governance ABI freezes asset-plus-generation current Fund state", () => {
  assert.equal(GOVERNANCE_DIAMOND_INTERFACE_ID, "0x3290c796");
  assert.equal(GOVERNANCE_DIAMOND_FUNCTIONS.length, 98);
  for (const eventName of [
    "RecoveryFundInitialized",
    "AssetRecoveryFundActivated",
    "RecoverySharesPurchased",
  ]) {
    findEntry(governanceAbi, "event", eventName);
  }
  for (const functionName of [
    "activateAssetRecoveryFund",
    "assetRecoveryFund",
    "previewAssetRecoveryFundPurchase",
    "recoveryFundTreasuryStatus",
    "acquiredRecoveryShares",
    "trustedRecoveryFundCore",
    "paused",
    "onCygldApprovalChange",
    "onCygldOutflow",
    "onRecoveryShareOutflow",
    "onRecoveryShareRedemption",
  ]) {
    findEntry(governanceAbi, "function", functionName);
  }
  assert.deepEqual(
    GOVERNANCE_DIAMOND_FUNCTIONS
      .filter((entry) => entry.signature.startsWith("onCygld")
        || entry.signature.startsWith("onRecoveryShare"))
      .map((entry) => [entry.signature, entry.selector]),
    [
      [
        "onRecoveryShareRedemption(address,uint256,address,uint256,uint256)",
        "0x54b02e3b",
      ],
      [
        "onCygldOutflow(address,address,uint256,uint256,uint256)",
        "0x8886834b",
      ],
      [
        "onRecoveryShareOutflow(address,address,uint256[],uint256[])",
        "0xc723c768",
      ],
      [
        "onCygldApprovalChange(address,uint256,uint256,uint256,uint256)",
        "0xc8a81e3b",
      ],
    ]
  );

  assert.deepEqual(
    componentNames(findEntry(governanceAbi, "function", "assetRecoveryFund").outputs?.[0]),
    ["generation", "coverageShares", "purchasedShares", "initialCygldCommitment"]
  );
  assert.deepEqual(
    componentNames(
      findEntry(governanceAbi, "function", "activateAssetRecoveryFund").inputs?.[0]
    ),
    [
      "impairedAsset",
      "expectedNextGeneration",
      "expectedCoverageShares",
      "cygldCommitment",
    ]
  );
  assert.deepEqual(
    findEntry(governanceAbi, "function", "recoveryFundTreasuryStatus").outputs?.map(
      (output) => output.name
    ),
    ["balance", "allowanceExposure", "committed"]
  );
  assert.deepEqual(
    inputNames(findEntry(governanceAbi, "event", "AssetRecoveryFundActivated")),
    ["impairedAsset", "generation", "coverageShares", "cygldCommitment"]
  );
  assert.deepEqual(
    inputNames(findEntry(governanceAbi, "event", "RecoverySharesPurchased")),
    ["impairedAsset", "generation", "seller", "shares", "cygldAmount"]
  );
  assert.equal(
    governanceAbi.some((entry) => entry.name === "activeAssetRecoveryFund"),
    false
  );
  for (const removedName of [
    "AcquiredRecoverySharesSurrendered",
    "surrenderAcquiredRecoveryShares",
    "RecoveryFundPurchasesAlreadyPaused",
    "RecoveryFundPurchasesAlreadyUnpaused",
    "RecoveryFundPurchasesArePaused",
    "RecoveryFundEmergencyAuthorityUnauthorized",
    "RecoveryFundPurchasesPaused",
    "RecoveryFundPurchasesUnpaused",
    "pauseRecoveryFundPurchases",
    "recoveryFundPurchasesPaused",
    "unpauseRecoveryFundPurchases",
    "AcquiredRecoverySharesRedeemed",
    "redeemAcquiredRecoveryShares",
    "RecoveryFundSettlementAccountingMismatch",
  ]) {
    assert.equal(
      governanceAbi.some((entry) => entry.name === removedName),
      false,
      `${removedName} must not remain in the clean-launch ABI`
    );
  }
  for (const callbackError of [
    "RecoveryFundCygldCommitmentDeficit",
    "RecoveryFundCygldPostStateMismatch",
    "RecoveryFundRecoveryShareOutflowForbidden",
    "RecoveryFundTrustedCoreBatchRejected",
    "RecoveryFundTrustedCoreCallbackOnly",
    "RecoveryFundTrustedCoreInvalid",
  ]) {
    findEntry(governanceAbi, "error", callbackError);
  }
  assert.doesNotMatch(JSON.stringify(governanceAbi), /facilityId|termsHash|corePoolViewHash/);
});
