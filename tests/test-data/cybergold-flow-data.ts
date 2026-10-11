export const cybergoldFlowData = {
  issueFromBasketExactIn: {
    basketIn: {
      paxg: "0.3",
      xaut: "0.2",
    },
  },
  issueFromBasketExactOut: {
    cygldOut: "10",
  },
  redeemToBasketExactIn: {
    cygldIn: "10",
  },
  redeemToBasketExactOut: {
    basketOut: {
      paxg: "0.3",
      xaut: "0.2",
    },
  },
  issueFromTokenExactIn: {
    tokenSymbol: "PAXG",
    tokenId: "paxg",
    fallbackTokenSymbol: "ETH",
    fallbackTokenId: "eth",
    tokenIn: "0.1",
    tokenCases: [
      { tokenSymbol: "PAXG", tokenId: "paxg", tokenIn: "0.1" },
      { tokenSymbol: "USDC", tokenId: "usdc", tokenIn: "100" },
      { tokenSymbol: "ETH", tokenId: "eth", tokenIn: "0.1" },
    ],
  },
  issueFromTokenExactOut: {
    tokenSymbol: "USDC",
    tokenId: "usdc",
    cygldOut: "10",
  },
  redeemToTokenExactIn: {
    tokenSymbol: "USDC",
    tokenId: "usdc",
    cygldIn: "10",
  },
  redeemToTokenExactOut: {
    tokenSymbol: "USDC",
    tokenId: "usdc",
    tokenOut: "10",
  },
} as const;
