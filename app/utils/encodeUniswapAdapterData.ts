import { encodeAbiParameters, parseAbiParameters } from "viem";

export function encodeUniswapAdapterData(
  path: `0x${string}`,
  amountLimit: bigint,
  deadline: bigint,
  exactIn: boolean
): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters("bytes path, uint256 amountLimit, uint256 deadline, bool exactIn"),
    [path, amountLimit, deadline, exactIn]
  );
}
