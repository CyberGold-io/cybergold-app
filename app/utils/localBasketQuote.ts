import { BasketModel } from "./quoteModels.ts";
import type { ProtocolModel } from "./quoteModelStore.ts";
import type { BasketPreviewRequest } from "./basketPreview.ts";
import { cygldBasketInputsForNet, type IssuanceModel } from "./cygldSupply.ts";

/** Indicative display only; exact Helpers results own execution readiness. */
export function localBasketQuote(protocol: ProtocolModel | undefined, mode: BasketPreviewRequest["mode"],
  assets: readonly string[], amount: bigint, components: readonly bigint[], issuance?: IssuanceModel) {
  if (mode === "issue-exact-out" && issuance?.state.assets?.map(a => a.toLowerCase()).join() === assets.map(a => a.toLowerCase()).join()) {
    const componentAmounts = amount > 0n ? cygldBasketInputsForNet(issuance, amount) : undefined;
    return componentAmounts ? { componentAmounts } : undefined;
  }
  if (!protocol || protocol.state.assets.map(a => a.toLowerCase()).join() !== assets.map(a => a.toLowerCase()).join()) return undefined;
  try {
    const basket = new BasketModel(protocol.state);
    if (mode === "issue-exact-out") {
      const value = amount > 0n ? basket.issue(amount, true, false) : undefined;
      return value ? { componentAmounts: value.amounts } : undefined;
    }
    if (mode === "redeem-exact-in") {
      const value = amount > 0n ? basket.redeemIn(amount) : undefined;
      return value ? { componentAmounts: value.slice(0, assets.length) } : undefined;
    }
    if (components.length !== assets.length || !components.some(a => a > 0n)) return undefined;
    if (mode === "issue-exact-in") {
      const value = basket.issueIn([...components]);
      return value && value.net > 0n ? { amount: value.net } : undefined;
    }
    const value = basket.redeemOut([...components, ...protocol.state.recoveryShares.map(() => 0n)]);
    return value && value.gross > 0n ? { amount: value.gross } : undefined;
  } catch { return undefined; }
}
