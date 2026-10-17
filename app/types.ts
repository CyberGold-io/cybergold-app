import type { Address } from "viem";
import type { basket, spendableToken } from "./config/tokens.ts";
import type { MarketRoutePlan } from "./utils/marketQuote.ts";
import type { components } from "./contracts/backend/http";

export type TokenType = spendableToken | basket;

export type ProtocolBasketData =
  | readonly [
      assets: readonly `0x${string}`[],
      targetsPpm: readonly bigint[],
      goldRefGramsFp18: readonly bigint[],
      decimals: readonly number[],
      names: readonly string[],
      symbols: readonly string[],
      cygldPerUnitFp18: readonly bigint[]
    ]
  | undefined;

export type BasketToken = {
  id: string;
  symbol: string;
  name: string;
  type: "erc20";
  address: `0x${string}`;
  decimals: number;
};

export type BasketComponent = {
      token: BasketToken;
      targetWeight: bigint; // target weight as a bigint in parts per million (ppm), e.g. 500,000 for 50% weight
};

export type GoldBasket = {
  id: "goldbasket";
  symbol: "BASKET";
  name: "Gold basket";
  type: "basket";
  components: BasketComponent[];
};

export type ProtocolBasketShape = {
  data?: ProtocolBasketData;
};
export type BasketComponentsMapBigInt = Record<`0x${string}`, bigint>; // token address + amount as bigint

export type Prefill = {
  main: string;
  mainRaw: bigint;
  components: string[];
  componentRaws: bigint[];
}

export type FlowState = {
  direction: "issue" | "redeem";
  route: "basket" | "token";
  inputMode: "exact-in" | "exact-out";
}

export type SwapToQuote = {
  adapter: Address;
  outputAsset: Address;
  amountIn: bigint;
  minimumAmountOut: bigint;
  data: `0x${string}`;
  routePlan?: MarketRoutePlan;
};

export type SwapFromQuote = {
  adapter: Address;
  inputAsset: Address;
  minimumAmountOut: bigint;
  data: `0x${string}`;
  routePlan?: MarketRoutePlan;
};

/** App-local route quote. `inputAmount` is never encoded in Helpers calldata. */
export type RoutedSwapFromQuote = SwapFromQuote & {
  inputAmount: bigint;
};

export type SwapQuote = SwapToQuote | RoutedSwapFromQuote;

export const CORE_TOKEN_KIND = {
  ERC20: 0,
  ERC1155: 1,
} as const;

export type CoreTokenKind =
  (typeof CORE_TOKEN_KIND)[keyof typeof CORE_TOKEN_KIND];

export type CoreTokenAmount = {
  kind: CoreTokenKind;
  token: Address;
  id: bigint;
  amount: bigint;
};

export type CoreTokenMinimum = {
  kind: CoreTokenKind;
  token: Address;
  id: bigint;
  minimumAmount: bigint;
};

export type HelperFees = {
  protocolFeeCygld: bigint;
  helperFeeCygld: bigint;
};

export type BasketComponentsMapString = Record<`0x${string}`, string>;

export type QuoteMode = "exact-in" | "exact-out";

export type QuoteRoute = NonNullable<components["schemas"]["RouteSearch"]["results"][number]["best"]>["route"];
export type QuoteDex = components["schemas"]["PoolSnapshot"]["dex"];

export type QuoteTarget = {
  inputAsset: Address;
  outputAsset: Address;
  amount: bigint;
};

export type RouteQuoteCandidate = {
  path: `0x${string}`;
  quote: bigint;
  route: QuoteRoute;
  feeInfo: string;
  routePlan?: MarketRoutePlan;
};

type WireCachedPool = Extract<components["schemas"]["PoolResult"], { entries: unknown }>["entries"][number];
type WirePoolLookup = Extract<components["schemas"]["PoolRequest"], { action: "list-pools" }>;
type WirePoolObservation = Extract<components["schemas"]["PoolRequest"], { action: "record-observations" }>["entries"][number];

export type CachedPoolCandidate = Omit<WireCachedPool, "token0" | "token1" | "poolAddress"> & {
  token0: Address;
  token1: Address;
  poolAddress?: Address;
};

export type PoolCacheLookupPair = Omit<WirePoolLookup["pairs"][number], "tokenA" | "tokenB"> & {
  tokenA: Address;
  tokenB: Address;
};

export type PoolCacheLookupParams = Omit<WirePoolLookup, "action" | "pairs"> & {
  pairs: readonly PoolCacheLookupPair[];
};

export type PoolCacheObservation = Omit<WirePoolObservation, "tokenA" | "tokenB" | "poolAddress"> & {
  tokenA: Address;
  tokenB: Address;
  poolAddress?: Address;
};

export type PoolCacheRecordParams = {
  entries: readonly PoolCacheObservation[];
};

export type QuotePoolCacheClient = {
  listPools: (params: PoolCacheLookupParams) => Promise<CachedPoolCandidate[]>;
  recordObservations: (params: PoolCacheRecordParams) => Promise<void>;
};

export type RouteSearchProgress = {
  completed: number;
  total: number;
  percent: number;
};

export type NetworkFeeEstimate = {
    wei: bigint;
    gas: bigint;
    maxFeePerGas: bigint;
    mode: "simulated" | "approx";
  };

export type TokenIssueQuoteStatus = "idle" | "loading" | "success" | "failed";
