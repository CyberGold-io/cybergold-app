import test from "node:test";
import assert from "node:assert/strict";
import { coreTrade, marketTrade } from "../../tests/fixtures/trade-quote.mts";
import { observeTradeSelection, TRADE_SELECTION_EVENT, type TradeSelectionObservation } from "./tradeSelectionObservation.ts";

test("selection observation preserves each provider's actual captured plan without sharing mutable objects", () => {
  for (const quote of [coreTrade(), marketTrade()]) {
    const original = structuredClone(quote);
    let observed: TradeSelectionObservation | undefined;
    observeTradeSelection({ attemptId: "swap-attempt", quote }, value => {
      observed = value;
      value.quote!.quotedOutput = "1";
      value.quote!.context.blockNumber = "999";
    });
    assert.equal(observed?.attemptId, "swap-attempt");
    assert.equal(observed?.quote?.strategy, quote.strategy);
    assert.deepEqual(quote, original);
  }
});

test("basket observation binds the entire raw input vector at the click", () => {
  const basketRequest = { mode: "issue-exact-in" as const, maximumAmountsIn: ["100", "250"] };
  let observed: TradeSelectionObservation | undefined;
  observeTradeSelection({ attemptId: "basket-attempt", basketRequest }, value => { observed = value; });
  basketRequest.maximumAmountsIn[0] = "999";
  assert.deepEqual(observed?.basketRequest, { mode: "issue-exact-in", maximumAmountsIn: ["100", "250"] });
});

test("an unavailable observer cannot change submission behavior", () => {
  assert.doesNotThrow(() => observeTradeSelection({ attemptId: "attempt", quote: coreTrade() }, () => {
    throw new Error("Observer unavailable");
  }));
  assert.equal(TRADE_SELECTION_EVENT, "cybergold:trade-selection");
});

test('basket click preserves its exact preview even after a newer preview arrives', async()=>{
  const {basketPreviewResult,basketPreviewObservation}=await import('./basketPreview.ts');
  const {captureBasketSelection,observedBasketProviderEvidence}=await import('../../tests/trading/providerEvidence.ts');
  const preview={mode:'issue-exact-in',helpers:'0x'+'a'.repeat(40),context:{chainId:31338,blockNumber:'100',blockHash:'0x'+'b'.repeat(64),observedAt:'2026-10-18T08:00:00Z'},result:{netCygldOut:'20',amountsInExact:['10'],orderedCoreAssets:['0x'+'c'.repeat(40)],fees:{protocolFeeCygld:'0',helperFeeCygld:'0'}}} as import('./basketPreview.ts').BasketPreview;
  const basketRequest={mode:'issue-exact-in' as const,maximumAmountsIn:['10']};
  const quote=basketPreviewResult(preview);let captured:TradeSelectionObservation|undefined;
  observeTradeSelection({basketRequest,basketPreview:basketPreviewObservation({...quote})},value=>{captured=value;});
  if ('netCygldOut' in preview.result) preview.result.netCygldOut='999';
  const winner=captureBasketSelection(captured!);
  assert.equal((winner.selectedPlan!.preview as Record<string,unknown>).netCygldOut,'20');
  assert.equal(winner.selectedProvider,'core');
  assert.deepEqual((winner.selectedPlan!.basketRequest as Record<string,unknown>).maximumAmountsIn,['10']);
  const changedBudget=captureBasketSelection({...captured!,basketRequest:{mode:'issue-exact-in',maximumAmountsIn:['20']}});
  assert.notEqual(changedBudget.planDigest,winner.planDigest);
  const scenario={id:'core-issue-basket-exact-in-medium',asset:'BASKET',side:'buy',inputMode:'exact-in',amountRaw:'10',basketAmounts:['10'],basketAssets:['0x'+'c'.repeat(40)]} as import('../../tests/trading/matrix.ts').MatrixScenario;
  const later=observedBasketProviderEvidence([{path:'/api/quotes/basket-preview',status:200,request:basketRequest,terminal:{type:'complete',value:preview}}],scenario);
  assert.equal((later.core.selectedPlan!.preview as Record<string,unknown>).netCygldOut,'999');
  assert.notEqual(later.core.planDigest,winner.planDigest);
  assert.equal((winner.selectedPlan!.preview as Record<string,unknown>).netCygldOut,'20');
  assert.deepEqual(captureBasketSelection({basketRequest}),{});
});
