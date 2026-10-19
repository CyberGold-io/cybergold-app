import type { Address, Hex } from "viem";
import type { NetworkFeeEstimate } from "@/app/types";
import type { WalletSwapBatch } from "@/app/utils/walletBatch";
import type { ProtocolDeployment } from "@/app/utils/protocolConfiguration";
import type { DiagnosticStage } from "@/app/utils/clientDiagnostics";

export type SubmitBasketFlowParams = {
  owner: Address;
  recipient: Address;
  walletConfirmationTracker?: WalletConfirmationTracker;
  inputFundingMode?: "native" | "erc20";
  feeEstimateSignal?: AbortSignal;
  walletBatch?: WalletSwapBatch;
  deployment?: ProtocolDeployment;
  diagnosticStage?: (stage: DiagnosticStage) => void;
};

export type WalletConfirmationKind =
  | "approval"
  | "signature"
  | "transaction";

export type WalletConfirmationTracker = {
  setTotal: (total: number) => void;
  requestNext: (kind: WalletConfirmationKind, label: string) => void;
};

export type TokenPermissions = {
  token: Address;
  amount: bigint;
};

export type PermitBatchTransferFrom = {
  permitted: TokenPermissions[];
  nonce: bigint;
  deadline: bigint;
};

export type PermitBatchTransferFromWithSignature = {
  permit: PermitBatchTransferFrom;
  signature: Hex;
};

export type PermitTransferFromWithSignature = {
  permitted: TokenPermissions;
  nonce: bigint;
  deadline: bigint;
  signature: Hex;
};

export type CygldPermit = {
  value: bigint;
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
};

export type FlowNetworkFeeEstimateHandlers = {
  slippageBps?: number;
  onNetworkFeeEstimate?: (estimate: NetworkFeeEstimate | null) => void;
  onNetworkFeeEstimateLoadingChange?: (isLoading: boolean) => void;
};
