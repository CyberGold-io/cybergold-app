export function resolveTokenImagePath(tokenIdOrSymbol: string, isDarkMode: boolean) {
  const normalized = tokenIdOrSymbol.toLowerCase();

  if (/^\d+:0x[0-9a-f]{40}$/.test(normalized)) return "/tokens/erc20.svg";

  if (normalized === "eth" && isDarkMode) {
    return "/tokens/eth-purple.png";
  }

  return `/tokens/${normalized}.png`;
}
