interface token {
  id: string;
  symbol: string;
  name: string;
}

export interface nativeToken extends token {
  type: "native";
  decimals: number;
}

export interface erc20Token extends token {
  type: "erc20";
  address: `0x${string}`;
  decimals: number;
  chainId?: number;
  imported?: boolean;
}

export type spendableToken = nativeToken | erc20Token;

export interface basket extends token {
  type: "basket";
  components: { token: erc20Token; targetWeight: bigint }[];
}
