import type { Address } from "viem";
import type { BasketComponent } from "../types";

type PermittedBasketComponent = {
  token: Address;
  amount: bigint;
};

export function buildPermittedBasketComponents(
  basketComponents: readonly BasketComponent[],
  basketAmounts: readonly bigint[] | undefined
): PermittedBasketComponent[] {
  if (!basketAmounts) return [];
  if (basketAmounts.length !== basketComponents.length) return [];

  return basketComponents
    .map((component, index) => {
      const amount = basketAmounts[index];

      if (!amount || amount <= 0n) return null;

      return {
        token: component.token.address as Address,
        amount,
      };
    })
    .filter((item): item is PermittedBasketComponent => item !== null);
}
