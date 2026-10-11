import type { Address } from "viem";

interface poolConfig {
  id: string;
  address: Address;
  token0: string;
  token1: string;
  fee: number;
};

// Pools (assumption that 1 USDC = 1 USD): USDC/USDT, USDC/WETH, XAUt/WETH, PAXG/WETH
export const pools: poolConfig[] = [
    { id: "usdc-usdt", address: "0x3416cf6c708da44db2624d63ea0aaef7113527c6" as Address, token0: "usdc", token1: "usdt", fee: 100 },
    { id: "usdc-weth", address: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640" as Address, token0: "usdc", token1: "weth", fee: 500 },
    { id: "xaut-weth", address: "0x3E04d683f7187BC0293e05006203AcCB29311767" as Address, token0: "xaut", token1: "weth", fee: 10000 },
    { id: "paxg-weth", address: "0x8a7e585048bda875e64024118c506b14f78166dd" as Address, token0: "paxg", token1: "weth", fee: 3000 },
];
