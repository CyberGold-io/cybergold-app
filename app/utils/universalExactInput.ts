import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters, zeroAddress, type Address, type Hex } from "viem";
import type { CygldPermit, PermitBatchTransferFromWithSignature } from "../hooks/flows/shared/types";
import type { BasketIssueInput } from "../hooks/flows/shared/usePurchaseAuthorization";
import type { components } from "../contracts/backend/http";
import { quoteResponseError, QuotePreviewError } from "./quoteErrors.ts";
import { diagnosticAttemptId, diagnosticReferences, retainDiagnosticReferences } from "./diagnosticReferences.ts";

/** Mirrors the frozen ITradeExactInput semantic types. ABI bytes are generated from Solidity. */
export const EXACT_INPUT_INTENT = { BuyCygld: 0, SellCygld: 1, IssueBasket: 2, RedeemBasket: 3 } as const;
export type ExactInputIntent = typeof EXACT_INPUT_INTENT[keyof typeof EXACT_INPUT_INTENT];
export type ExactInputAsset = { currency: Address; amount: bigint };
export type WireExactInputAsset = { currency: string; amount: string };
export type ExactInputPlan = {
  intent: ExactInputIntent; inputs: readonly ExactInputAsset[]; outputCurrency: Address; recipient: Address;
  deadline: bigint; minimumOutput: bigint; body: Hex;
};
export type WireExactInputPlan = Omit<ExactInputPlan, "inputs" | "outputCurrency" | "recipient" | "deadline" | "minimumOutput"> & {
  inputs: readonly WireExactInputAsset[]; outputCurrency: string; recipient: string; deadline: string; minimumOutput: string;
};
export type ExactInputFunding = {
  authorizations: readonly { kind: 0 | 1 | 2; permit: CygldPermit }[];
  permit2: PermitBatchTransferFromWithSignature;
};
export type RetainedInputCharge = { currency: Address; amount: bigint; branch: bigint; stage: bigint };
export type WireRetainedInputCharge = { currency: string; amount: string; branch: number | string; stage: number | string };
export type UniversalExactInputRequest = Omit<components["schemas"]["UniversalExactInputRequest"], "inputs"> & { inputs: readonly WireExactInputAsset[] };
export type UniversalExactInputQuote = Omit<components["schemas"]["UniversalExactInputQuote"], "plan"> & { plan: WireExactInputPlan };

export function exactInputPlan(value: WireExactInputPlan): ExactInputPlan {
  return { ...value, inputs: value.inputs.map(input => ({ currency: input.currency as Address, amount: BigInt(input.amount) })),
    outputCurrency: value.outputCurrency as Address, recipient: value.recipient as Address,
    deadline: BigInt(value.deadline), minimumOutput: BigInt(value.minimumOutput) };
}

/** Transaction value is acquired native input, never an allowance or UI spending ceiling. */
export function exactInputNativeValue(plan: ExactInputPlan): bigint {
  return plan.inputs.reduce((sum, input) => input.currency.toLowerCase() === zeroAddress ? sum + input.amount : sum, 0n);
}

export function exactInputPermissions(plan: ExactInputPlan) {
  return plan.inputs.filter(input => input.currency.toLowerCase() !== zeroAddress)
    .map(input => ({ token: input.currency, amount: input.amount }));
}

/** Funding authorization indices include native placeholders; Permit2 remains one compact batch. */
export function exactInputFunding(plan: ExactInputPlan,
  prepared: { inputs: readonly BasketIssueInput[]; permit2: PermitBatchTransferFromWithSignature },
  emptyPermit: CygldPermit): ExactInputFunding {
  let cursor = 0;
  return { authorizations: plan.inputs.map(input => {
    if (input.currency.toLowerCase() === zeroAddress) return { kind: 0, permit: emptyPermit };
    const authorization = prepared.inputs[cursor++];
    return { kind: authorization.authorization, permit: authorization.permit };
  }), permit2: prepared.permit2 };
}

export function retainedInputCharges(value: readonly WireRetainedInputCharge[]): RetainedInputCharge[] {
  return value.map(row => ({ currency: row.currency as Address, amount: BigInt(row.amount),
    branch: BigInt(row.branch), stage: BigInt(row.stage) }));
}

export async function fetchUniversalExactInputQuote(request: UniversalExactInputRequest,
  signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<UniversalExactInputQuote> {
  const attemptId=diagnosticAttemptId(),metadata={attemptId,requestId:undefined as string|undefined};
  const response = await fetchImpl("/api/quotes/universal-exact-input", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json",...(attemptId?{"X-CyberGold-Attempt-Id":attemptId}:{}) }, body: JSON.stringify(request) }).catch(error=>{
      if(signal?.aborted)throw error;
      throw new QuotePreviewError("quote-service-unavailable","Quote service connection failed.",metadata);
    });
  metadata.requestId=response.headers.get("X-CyberGold-Request-Id")??undefined;
  if (!response.ok) { const error=await quoteResponseError(response);retainDiagnosticReferences(error,metadata);throw error; }
  const value:UniversalExactInputQuote=await response.json();
  retainDiagnosticReferences(value,{...metadata,...diagnosticReferences(value)});
  return value;
}

/** Display the accepted basket bounds directly from the producer's executable body. */
export function exactInputBasketMinimums(plan: Pick<WireExactInputPlan, "body">) {
  const [body] = decodeAbiParameters(parseAbiParameters("((uint8 kind,address token,uint256 id,uint256 minimumAmount)[] expectedOutputs)"), plan.body);
  return body.expectedOutputs;
}

/** Preserve accepted scalar and full-vector bounds when an inactive solved-Q journey refreshes its executable plan. */
export function preserveExactInputMinimum(quote: UniversalExactInputQuote, minimum: bigint): UniversalExactInputQuote {
  const bound = BigInt(quote.plan.minimumOutput) > minimum ? quote.plan.minimumOutput : String(minimum);
  return { ...quote, outputMinimum: bound, plan: { ...quote.plan, minimumOutput: bound } };
}
export function preserveExactInputBasketMinimums(quote: UniversalExactInputQuote,
  accepted: readonly { kind: number; token: Address; id: bigint; minimumAmount: bigint }[]): UniversalExactInputQuote {
  const fresh = exactInputBasketMinimums(quote.plan);
  const expectedOutputs = accepted.map(row => {
    const current = fresh.find(value => value.kind === row.kind && value.token.toLowerCase() === row.token.toLowerCase() && value.id === row.id);
    return { ...row, minimumAmount: current && current.minimumAmount > row.minimumAmount ? current.minimumAmount : row.minimumAmount };
  });
  const body = encodeAbiParameters(parseAbiParameters("((uint8 kind,address token,uint256 id,uint256 minimumAmount)[] expectedOutputs)"), [{ expectedOutputs }]);
  return { ...quote, plan: { ...quote.plan, body } };
}
