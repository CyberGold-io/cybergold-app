"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { zeroAddress } from "viem";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import type { BasketComponent, TokenIssueQuoteStatus } from "@/app/types";
import { quoteErrorMessage } from "@/app/utils/quoteErrors";
import { applySlippageFloor, DEFAULT_SLIPPAGE_BPS } from "@/app/utils/swapPolicy";
import { useUniversalExactInputExecution } from "./shared/useUniversalExactInputExecution";
import { useEconomicQuote } from "./quotes/useEconomicQuote";
import type { FlowNetworkFeeEstimateHandlers, SubmitBasketFlowParams } from "./shared/types";
import type { TradeQuoteResult } from "@/app/utils/tradeQuote";

export function useIssueFromBasketExactInFlow({ enabled, amountsIn, basketComponents,
  slippageBps=DEFAULT_SLIPPAGE_BPS,onNetworkFeeEstimate,onNetworkFeeEstimateLoadingChange }:
  { enabled:boolean; amountsIn:readonly bigint[]; basketComponents:readonly BasketComponent[] } & FlowNetworkFeeEstimateHandlers) {
  const t=useTranslations("Home"),{addresses}=useProtocolConfiguration();
  const inputs=useMemo(()=>basketComponents.map((row,index)=>({currency:row.token.address,amount:String(amountsIn[index]??0n)})),[basketComponents,amountsIn]);
  const active=enabled&&amountsIn.length===basketComponents.length&&amountsIn.some(amount=>amount>0n);
  const universal=useEconomicQuote({intent:2,inputs,outputCurrency:addresses.core??zeroAddress},active);
  const quote=universal.data,canSubmit=active&&quote!==undefined&&BigInt(quote.quotedOutput)>0n;
  const quoteStatus:TokenIssueQuoteStatus=!active?"idle":canSubmit?"success":universal.isError?"failed":"loading";
  const {submit:submitUniversal}=useUniversalExactInputExecution({slippageBps,onNetworkFeeEstimate,onNetworkFeeEstimateLoadingChange});
  const submit=useCallback(async(params:SubmitBasketFlowParams)=>{
    if(!quote||!canSubmit)throw new Error("IssueFromBasketExactIn is not ready");
    return submitUniversal(quote,params);
  },[quote,canSubmit,submitUniversal]);
  const captureUniversalReady = universal.captureReady;
  const captureSubmission=useCallback(()=>{
    const captured=captureUniversalReady();
    if(!captured||BigInt(captured.quotedOutput)<=0n)return undefined;
    const acceptedBounds={inputs:structuredClone(captured.inputs),minimumOutput:String(applySlippageFloor(BigInt(captured.quotedOutput),slippageBps))};
    return {selectedTrade:undefined as TradeQuoteResult|undefined,universalQuote:captured,
      submit:(params:SubmitBasketFlowParams)=>submitUniversal(captured,params,acceptedBounds)};
  },[captureUniversalReady,slippageBps,submitUniversal]);
  return {...universal,quote,universalQuote:quote,netCygldOut:quote?BigInt(quote.quotedOutput):undefined,
    minimumOutputAmount:quote?applySlippageFloor(BigInt(quote.quotedOutput),slippageBps):undefined,
    maximumInputAmounts:quote?.inputs.map(row=>BigInt(row.amount)),amountsInUsed:quote?.inputs.map(row=>BigInt(row.amount)),
    permitted:quote?.inputs.map(row=>({token:row.currency as `0x${string}`,amount:BigInt(row.amount)}))??[],
    fees:quote?{protocolFeeCygld:BigInt(quote.fees.coreProtocolFeeCygld),helperFeeCygld:BigInt(quote.fees.coreHelpersFeeCygld),marketFeeCygld:BigInt(quote.fees.marketFeeCygld)}:undefined,
    estimatedRetainedInputCharges:quote?.estimatedRetainedInputCharges,quoteStatus,
    refresh:universal.refresh,refreshing:universal.isFetching,captureSubmission,stopSearch:universal.stopSearch,
    refreshError:universal.refreshError?quoteErrorMessage(universal.refreshError,t):undefined,
    quoteError:quoteStatus==="failed"?quoteErrorMessage(universal.error??new Error("Quote unavailable"),t):undefined,canSubmit,submit};
}
