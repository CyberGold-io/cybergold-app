import type {
  BasketComponent,
  BasketToken,
  GoldBasket,
  ProtocolBasketData,
} from "../types";


export function buildBasketFromProtocolData(
  protocolBasketData: ProtocolBasketData
): GoldBasket | null {
  if (!protocolBasketData) return null;

  const [
    basketComponentAddresses,
    basketComponentTargetsPpm,
    goldRefGramsFp18,
    basketComponentDecimals,
    basketComponentNames,
    basketComponentSymbols,
    cygldPerUnitFp18,
  ] = protocolBasketData;

  const count = basketComponentSymbols.length;
  const lengthsMatch =
    basketComponentAddresses.length === count &&
    basketComponentTargetsPpm.length === count &&
    goldRefGramsFp18.length === count &&
    basketComponentDecimals.length === count &&
    basketComponentNames.length === count &&
    cygldPerUnitFp18.length === count;

  if (!lengthsMatch) return null;

  const components: BasketComponent[] = basketComponentSymbols.map((symbol, index) => {
    const token: BasketToken = {
      id: symbol.toLowerCase(),
      symbol,
      name: basketComponentNames?.[index] ?? symbol,
      type: "erc20",
      address: basketComponentAddresses[index],
      decimals: basketComponentDecimals[index],
    };

    return {
      token,
      targetWeight: basketComponentTargetsPpm[index] ?? 0n,
    };
  });

  return {
    id: "goldbasket",
    symbol: "BASKET",
    name: "Gold basket",
    type: "basket",
    components,
  };
}
