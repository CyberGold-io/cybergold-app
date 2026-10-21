export type SwapFeePreferences = { detailsOpen?: boolean; slippageBps?: number };

/** Also embedded before hydration; browser storage is optional. */
export function readSwapFeePreferences(storage?: Pick<Storage, "getItem">): SwapFeePreferences {
  try {
    const source = storage ?? (typeof window === "undefined" ? undefined : window.sessionStorage);
    const value = JSON.parse(source?.getItem("cg:swap-fee-preferences:v1") ?? "null");
    if (!value || typeof value !== "object") return {};
    return {
      detailsOpen: typeof value.detailsOpen === "boolean" ? value.detailsOpen : undefined,
      slippageBps: Number.isInteger(value.slippageBps) && value.slippageBps >= 0 && value.slippageBps <= 100
        ? value.slippageBps : undefined,
    };
  } catch { return {}; }
}

export function writeSwapFeePreferences(value: SwapFeePreferences) {
  try { window.sessionStorage.setItem("cg:swap-fee-preferences:v1", JSON.stringify(value)); }
  catch { /* Preferences must not interrupt disclosure or amount editing. */ }
}
