import type { Address } from "viem";

function strip0x(hex: string) {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

// uint24 fee => 3 bytes => 6 hex chars
function feeToUint24Hex(fee: number) {
  if (!Number.isInteger(fee) || fee < 0 || fee > 0xffffff) {
    throw new Error(`Invalid Uniswap V3 fee: ${fee}`);
  }
  return fee.toString(16).padStart(6, "0");
}

export function encodeV3PathDirect(params: {
  tokenIn: Address;
  tokenOut: Address;
  fee: number; 
}): `0x${string}` {
  const a = strip0x(params.tokenIn).toLowerCase();  // 40 hex chars
  const b = strip0x(params.tokenOut).toLowerCase();
  const f = feeToUint24Hex(params.fee);

  return (`0x${a}${f}${b}`) as `0x${string}`;
}

export function encodeV3PathViaWeth(params: {
  tokenIn: Address;
  tokenOut: Address;
  weth: Address;
  feeInToWeth?: number;  
  feeWethToOut?: number; 
}): `0x${string}` {
  const {
    tokenIn,
    tokenOut,
    weth,
    feeInToWeth = 3000, // fallback value
    feeWethToOut = 3000, // fallback value
  } = params;

  const a = strip0x(tokenIn).toLowerCase();
  const m = strip0x(weth).toLowerCase();
  const b = strip0x(tokenOut).toLowerCase();

  const f1 = feeToUint24Hex(feeInToWeth);
  const f2 = feeToUint24Hex(feeWethToOut);

  // tokenIn + fee1 + weth + fee2 + tokenOut
  return (`0x${a}${f1}${m}${f2}${b}`) as `0x${string}`;
}

export function encodeV3PathMultiHop(params: {
  tokens: readonly Address[];
  fees: readonly number[];
}): `0x${string}` {
  const { tokens, fees } = params;

  if (tokens.length < 2) {
    throw new Error("A Uniswap V3 path requires at least two tokens");
  }
  if (fees.length !== tokens.length - 1) {
    throw new Error("The number of fees must be exactly one less than the number of tokens");
  }

  let encoded = `0x${strip0x(tokens[0]).toLowerCase()}`;
  for (let index = 0; index < fees.length; index += 1) {
    encoded += `${feeToUint24Hex(fees[index])}${strip0x(tokens[index + 1]).toLowerCase()}`;
  }

  return encoded as `0x${string}`;
}
