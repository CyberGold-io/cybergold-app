import type { FlowState } from "../types";

export type ResolveFlowStateParams = {
  sellTokenId?: string;
  buyTokenId?: string;
  isSellInputEnabled: boolean;
  hasBasketComponents: boolean;
  cygldTokenId?: string;
  basketTokenId?: string;
};

export function resolveFlowState({
  sellTokenId,
  buyTokenId,
  isSellInputEnabled,
  hasBasketComponents,
  cygldTokenId = "cygld",
  basketTokenId = "goldbasket",
}: ResolveFlowStateParams): FlowState | undefined {
  if (!sellTokenId || !buyTokenId) return undefined;

  const sellIsCygld = sellTokenId === cygldTokenId;
  const buyIsCygld = buyTokenId === cygldTokenId;
  const sellIsBasket = sellTokenId === basketTokenId;
  const buyIsBasket = buyTokenId === basketTokenId;

  if (!hasBasketComponents && (sellIsBasket || buyIsBasket)) {
    return undefined;
  }

  const inputMode = isSellInputEnabled ? "exact-in" : "exact-out";

  if (sellIsBasket && buyIsCygld) {
    return { direction: "issue", route: "basket", inputMode };
  }

  if (sellIsCygld && buyIsBasket) {
    return { direction: "redeem", route: "basket", inputMode };
  }

  if (!sellIsCygld && !sellIsBasket && buyIsCygld) {
    return { direction: "issue", route: "token", inputMode };
  }

  if (sellIsCygld && !buyIsCygld && !buyIsBasket) {
    return { direction: "redeem", route: "token", inputMode };
  }

  return undefined;
}
