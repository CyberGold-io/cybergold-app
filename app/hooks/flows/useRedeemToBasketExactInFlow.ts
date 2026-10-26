"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { getAddress,toHex,zeroAddress,type Address } from "viem";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { CORE_TOKEN_KIND,type BasketComponent,type TokenIssueQuoteStatus } from "@/app/types";
import { quoteErrorMessage } from "@/app/utils/quoteErrors";
import { applySlippageFloor, DEFAULT_SLIPPAGE_BPS } from "@/app/utils/swapPolicy";
import { useUniversalExactInputExecution } from "./shared/useUniversalExactInputExecution";
import { useEconomicQuote } from "./quotes/useEconomicQuote";
import type { FlowNetworkFeeEstimateHandlers,SubmitBasketFlowParams } from "./shared/types";

export function useRedeemToBasketExactInFlow({enabled,grossCygldIn,slippageBps=DEFAULT_SLIPPAGE_BPS,onNetworkFeeEstimate,onNetworkFeeEstimateLoadingChange}:
  {enabled:boolean;grossCygldIn:bigint;basketComponents:readonly BasketComponent[]}&FlowNetworkFeeEstimateHandlers){
  const t=useTranslations("Home"),{addresses}=useProtocolConfiguration(),active=enabled&&grossCygldIn>0n;
  const universal=useEconomicQuote({intent:3,inputs:[{currency:addresses.core??zeroAddress,amount:String(grossCygldIn)}],outputCurrency:zeroAddress},active);
  const quote=universal.data,canSubmit=active&&quote!==undefined;
  const projectedCoreOutputs=useMemo(()=>quote?.estimatedRecipientOutputs.map(row=>({...row,kind:row.kind===1?CORE_TOKEN_KIND.ERC1155:CORE_TOKEN_KIND.ERC20,token:row.token as Address,id:BigInt(row.id),amount:BigInt(row.amount)})),[quote]);
  const expectedCoreOutputs=useMemo(()=>quote?.estimatedRecipientOutputs.map(row=>({...row,
    minimumAmount:applySlippageFloor(BigInt(row.amount),slippageBps)})),[quote,slippageBps]);
  const erc20=projectedCoreOutputs?.filter(row=>row.kind===CORE_TOKEN_KIND.ERC20),recovery=projectedCoreOutputs?.filter(row=>row.kind===CORE_TOKEN_KIND.ERC1155&&row.amount>0n);
  const quoteStatus:TokenIssueQuoteStatus=!active?"idle":canSubmit?"success":universal.isError?"failed":"loading";
  const {submit:submitUniversal}=useUniversalExactInputExecution({slippageBps,onNetworkFeeEstimate,onNetworkFeeEstimateLoadingChange});
  const submit=useCallback(async(params:SubmitBasketFlowParams)=>{
    if(!quote||!canSubmit)throw new Error("RedeemToBasketExactIn is not ready");
    return submitUniversal(quote,params);
  },[quote,canSubmit,submitUniversal]);
  return {...universal,quote,universalQuote:quote,grossCygldIn,maximumInputAmount:quote?grossCygldIn:undefined,
    netCygldIn:quote?grossCygldIn-BigInt(quote.fees.coreProtocolFeeCygld)-BigInt(quote.fees.coreHelpersFeeCygld):undefined,
    fees:quote?{protocolFeeCygld:BigInt(quote.fees.coreProtocolFeeCygld),helperFeeCygld:BigInt(quote.fees.coreHelpersFeeCygld),marketFeeCygld:BigInt(quote.fees.marketFeeCygld)}:undefined,
    amountsOut:erc20?.map(row=>row.amount),minimumOutputAmounts:expectedCoreOutputs?.filter(row=>row.kind===0).map(row=>row.minimumAmount),projectedCoreOutputs,
    recoverySharesOut:recovery?.map(row=>row.amount),orderedRecoveryAssets:recovery?.map(row=>getAddress(toHex(row.id,{size:20}))),
    estimatedRetainedInputCharges:quote?.estimatedRetainedInputCharges,quoteStatus,
    refresh:universal.refresh,refreshing:universal.isFetching,
    refreshError:universal.refreshError?quoteErrorMessage(universal.refreshError,t):undefined,
    quoteError:quoteStatus==="failed"?quoteErrorMessage(universal.error??new Error("Quote unavailable"),t):undefined,canSubmit,submit};
}
