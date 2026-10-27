import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function url(relativePath: string) {
  return new URL(relativePath, import.meta.url);
}

function read(relativePath: string) {
  return readFileSync(url(relativePath), "utf8");
}

test("swap submission uses bound current-state previews without a global recovery mode", () => {
  const page = read("../[locale]/page.tsx");
  const tokenPreview = read(
    "../hooks/cybergold-helpers/usePreviewRedeemToTokenExactIn.ts"
  );
  const basketExactOutFlow = read(
    "../hooks/flows/useRedeemToBasketExactOutFlow.ts"
  );
  const tokenFlow = read("../hooks/flows/useTradeFlow.ts");
  const tokenExecution = read("./tradeExecution.ts");
  assert.match(page, /enabled: isActiveTokenFlow && !quoteInputPending/);
  assert.doesNotMatch(
    page,
    /coreRecovery|isRecoveryMode|recoveryEpoch|assertFreshRecoveryRoute|recoveryExactOutUnavailable/
  );
  for (const preview of [read("../hooks/protocol/useBasketPreview.ts"), tokenPreview]) {
    assert.doesNotMatch(preview, /refetchInterval/);
  }
  assert.match(basketExactOutFlow, /usePreviewRedeemToBasketExactOut/);
  assert.match(basketExactOutFlow, /preserveExactInputBasketMinimums/);
  assert.match(tokenFlow, /useTradeQuote/);
  assert.match(tokenExecution, /preserveExactInputMinimum/);
  for (const flow of [basketExactOutFlow, tokenFlow, tokenExecution]) assert.doesNotMatch(flow, /recoveryMode|recoveryEpoch/);
  assert.match(basketExactOutFlow, /recoveryAssetsRead\.isError\) return "failed"/);
  assert.doesNotMatch(tokenFlow, /usePreviewCoreIssueFromBasketExactOut|usePreviewCoreRedeemExactIn/);
  assert.equal(existsSync(url("../hooks/cybergold/useCoreRecoveryState.ts")), false);
  assert.equal(existsSync(url("../hooks/cybergold/useCoreBasketTransactions.ts")), false);
  assert.equal(
    existsSync(url("../hooks/cybergold/usePreviewCoreIssueFromBasketExactOut.ts")),
    false
  );
  assert.equal(
    existsSync(url("../hooks/cybergold/usePreviewCoreRedeemExactIn.ts")),
    false
  );
});

test("first-party redemption flows bind one complete mixed output vector", () => {
  const basketFlow = read("../hooks/flows/useRedeemToBasketExactInFlow.ts");
  const tokenFlow = read("../hooks/flows/useTradeFlow.ts"), tokenExecution = read("./tradeExecution.ts");
  assert.match(basketFlow, /projectedCoreOutputs/); assert.match(tokenFlow, /projectedCoreOutputs/);
  assert.match(basketFlow, /expectedCoreOutputs/); assert.match(tokenExecution, /preserveExactInputMinimum/);
  for (const flow of [basketFlow, tokenFlow]) assert.match(flow, /CORE_TOKEN_KIND\.ERC1155/);
  for (const flow of [basketFlow, tokenFlow, tokenExecution]) assert.doesNotMatch(flow,
    /expectedOrderedHealthyAssets|expectedOrderedRecoveryAssets|minimumRecoverySharesOut|expectedRecoveryEpoch|RecoveryBinding|recoveryBinding/);
  assert.match(basketFlow, /applySlippageFloor\(BigInt\(row\.amount\),slippageBps\)/);
  assert.match(basketFlow, /useEconomicQuote\(\{\s*intent:\s*3/);
  assert.match(basketFlow, /quote\?\.estimatedRecipientOutputs/);
  assert.match(tokenExecution, /fetchUniversalExactInputQuote/);
  assert.doesNotMatch(tokenExecution, /callValue|minAmountOut/);
});

test("recovery UI presents current pool and lifecycle state without causes/history", () => {
  const dashboard = read(
    "../[locale]/dashboard/_core/panels/RecoveryOverviewPanel.tsx"
  );
  const portfolioHook = read("../hooks/cybergold/useRecoverySharePortfolio.ts");
  const holderPortfolio = read("../components/recoverySharePortfolio.tsx");

  assert.match(dashboard, /pool\.impaired/);
  assert.match(dashboard, /pool\.custody\.liveRawCustody/);
  assert.match(dashboard, /pool\.custody\.activeAvailableRaw/);
  assert.match(dashboard, /pool\.custody\.poolRawDeficit/);
  assert.match(dashboard, /pool\.lifecycle\.lifecycle/);
  assert.match(dashboard, /reserve\.exitEntitlementRaw/);
  assert.match(portfolioHook, /mergeRecoveryPortfolioPages/);
  assert.match(portfolioHook, /complete\.snapshotBlockHash/);
  assert.match(portfolioHook, /isStale/);
  assert.match(holderPortfolio, /pool\.shareDecimals/);
  assert.match(holderPortfolio, /entry\.expectedPayoutRaw/);
  assert.doesNotMatch(holderPortfolio, /Ring-fenced pool liability|Current active backing|Current generation/);
  for (const source of [dashboard, portfolioHook, holderPortfolio]) {
    assert.doesNotMatch(
      source,
      /inactiveReason|exitFinalizationReason|RecoveryEvent|eventId|facilityId|termsHash/
    );
  }
});

test("wallet share discovery uses focused account reads and settlement uses asset-derived IDs", () => {
  const hook = read("../hooks/cybergold/useRecoverySharePortfolio.ts");
  const portfolio = read("../components/recoverySharePortfolio.tsx");
  const settlement = read("../hooks/cybergold/useRecoveryShareSettlement.ts");

  assert.match(hook, /\/api\/recovery\/shares\?\$\{params\}/);
  assert.match(hook, /new URLSearchParams\(\{ holder: holder! \}\)/);
  assert.match(hook, /if \(activeHolder\.current !== key \|\| !holder\) return;/);
  assert.match(hook, /queryKey: \["recovery-shares", EXPECTED_CHAIN_ID, CORE_DIAMOND_ADDRESS, key\]/);
  assert.match(portfolio, /settlement\.redeem/);
  assert.doesNotMatch(portfolio, /surrender/i);
  assert.match(portfolio, /entry\.expectedPayoutRaw > 0n/);
  assert.match(portfolio, /t\("zeroPayout"\)/);
  assert.match(portfolio, /t\("description"\)/);
  assert.match(settlement, /await simulateRecoveryRedemption/);
  assert.match(portfolio, /useRecoveryShareSettlement\(holder\)/);
  assert.match(settlement, /params\.asset/);
  assert.match(settlement, /assertWalletOnExpectedAccount\(walletClient, expectedHolder\)/);
  assert.doesNotMatch(settlement, /shareId|surrender/i);
});
