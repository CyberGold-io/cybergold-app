import { HELPERS_DIAMOND_ABI } from "../generated/helpersDiamond.ts";
import { HELPERS_MARKET_ABI } from "../generated/helpersMarket.ts";

/** Execution can target the installed extension without redefining the base ABI. */
export const HELPERS_EXECUTION_ABI = [...HELPERS_DIAMOND_ABI, ...HELPERS_MARKET_ABI] as const;
