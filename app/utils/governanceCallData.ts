import {
  decodeFunctionData,
  parseAbi,
  type Abi,
  type AbiFunction,
  type AbiParameter,
  type Hex,
} from "viem";
import { CORE_DIAMOND_ABI } from "../contracts/generated/coreDiamond.ts";
import { HELPERS_DIAMOND_ABI } from "../contracts/generated/helpersDiamond.ts";
import { STAKING_DIAMOND_ABI } from "../contracts/generated/stakingDiamond.ts";

export type GovernanceDecodedCallArgument = {
  name: string;
  type: string;
  value: unknown;
};

export type GovernanceDecodedCall =
  | {
      kind: "decoded";
      selector?: Hex;
      functionName: string;
      functionSignature: string;
      args: GovernanceDecodedCallArgument[];
      rawData: Hex;
    }
  | {
      kind: "empty";
      selector?: Hex;
      rawData: Hex;
      args: [];
    }
  | {
      kind: "unknown";
      selector?: Hex;
      rawData: Hex;
      args: [];
    };

const OTHER_GOVERNANCE_CALL_ABI = parseAbi([
  "function grantTimelockRole(bytes32 role, address account)",
  "function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function execute(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt)",
  "function setVotingDelay(uint48 newVotingDelay)",
  "function setVotingPeriod(uint32 newVotingPeriod)",
  "function setProposalThreshold(uint256 newProposalThreshold)",
  "function updateDelay(uint256 newDelay)",
  "function cancel(bytes32 id)",
] satisfies readonly string[]) as Abi;

function buildFunctionSignature(fn: AbiFunction) {
  return `${fn.name}(${fn.inputs.map((input) => input.type).join(",")})`;
}

const GOVERNANCE_FUNCTIONS = Array.from(
  new Map(
    ([
      ...CORE_DIAMOND_ABI,
      ...STAKING_DIAMOND_ABI,
      ...HELPERS_DIAMOND_ABI,
      ...OTHER_GOVERNANCE_CALL_ABI,
    ] as unknown as Abi)
      .filter((item): item is AbiFunction => item.type === "function")
      .map((item) => [buildFunctionSignature(item), item] as const)
  ).values()
);

function argumentLabel(input: AbiParameter, index: number) {
  return input.name && input.name.length > 0 ? input.name : `arg${index + 1}`;
}

export function decodeGovernanceCallData(data: Hex): GovernanceDecodedCall {
  const selector = data.length >= 10 ? (data.slice(0, 10) as Hex) : undefined;
  if (data === "0x") {
    return { kind: "empty", selector, rawData: data, args: [] };
  }

  try {
    const decoded = decodeFunctionData({
      abi: GOVERNANCE_FUNCTIONS,
      data,
    });
    const abiFunction = GOVERNANCE_FUNCTIONS.find(
      (candidate) =>
        candidate.name === decoded.functionName &&
        candidate.inputs.length === (decoded.args?.length ?? 0)
    );
    if (!abiFunction) {
      return { kind: "unknown", selector, rawData: data, args: [] };
    }
    return {
      kind: "decoded",
      selector,
      functionName: decoded.functionName,
      functionSignature: buildFunctionSignature(abiFunction),
      args: abiFunction.inputs.map((input, index) => ({
        name: argumentLabel(input, index),
        type: input.type,
        value: decoded.args?.[index],
      })),
      rawData: data,
    };
  } catch {
    return { kind: "unknown", selector, rawData: data, args: [] };
  }
}
