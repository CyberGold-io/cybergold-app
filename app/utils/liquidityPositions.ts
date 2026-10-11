import type { components } from "../contracts/backend/http";

export type LiquidityPositionsSnapshot = components["schemas"]["LiquidityPositions"];
export type LiquidityPosition = LiquidityPositionsSnapshot["positions"][number];
