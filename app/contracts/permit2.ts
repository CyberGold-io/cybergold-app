export const permit2Abi = [
  {
    type: "function",
    name: "nonceBitmap",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "wordPos", type: "uint256" },
    ],
    outputs: [{ name: "bitmap", type: "uint256" }],
  },
] as const;
