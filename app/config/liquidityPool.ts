const poolId = "0x33fd4629a4e190b9a98a8a3758afb7a2639eb740088a04bd4d3016e3ac9d55a4";
const paxg = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";
const cygld = "0x601da021cAF3DB5AA63e700D239b5935C370601d";

const addLiquidityParameters = new URLSearchParams({
  currencyA: paxg,
  currencyB: cygld,
  chain: "ethereum",
  fee: JSON.stringify({ feeAmount: 100, tickSpacing: 1, isDynamic: false }),
  protocolVersion: "v4",
  step: "1",
});

export const LIQUIDITY_POOL = {
  poolId,
  paxg,
  cygld,
  fee: 100,
  tickSpacing: 1,
  hooks: "0x0000000000000000000000000000000000000000",
  poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  positionManager: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
  stateView: "0x7fFE42C4a5DEeA5b0FEC41C94C136Cf115597227",
  // Pool initialization recorded in the mainnet deployment evidence.
  initializationBlock: 25638581n,
  poolUrl: `https://app.uniswap.org/explore/pools/ethereum/${poolId}`,
  positionsUrl: "https://app.uniswap.org/positions",
  // Start a fresh deposit so Uniswap can ask the user for their price range.
  addLiquidityUrl: `https://app.uniswap.org/positions/add/ethereum/${poolId}?${addLiquidityParameters}`,
} as const;
