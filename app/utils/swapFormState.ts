import type { Address } from "viem";

const SWAP_FORM_SESSION_STORAGE_KEY = "cg:swap-form-state:v1";

export type PersistedSwapFormState = {
  showOnlyWalletTokens?: boolean;
  sellAmount?: string;
  sellTokenId?: string;
  buyTokenId?: string;
  driverToken?: Address;
  driverAmountStr?: string;
};

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function normalizePersistedSwapFormState(
  value: unknown
): PersistedSwapFormState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const wasOutputDriven = record.isSellInputEnabled === false;
  const driverToken =
    !wasOutputDriven && typeof record.driverToken === "string" && ADDRESS_PATTERN.test(record.driverToken)
      ? (record.driverToken as Address)
      : undefined;

  return {
    showOnlyWalletTokens:
      typeof record.showOnlyWalletTokens === "boolean"
        ? record.showOnlyWalletTokens
        : undefined,
    sellAmount: !wasOutputDriven && typeof record.sellAmount === "string" ? record.sellAmount : undefined,
    sellTokenId: typeof record.sellTokenId === "string" ? record.sellTokenId : undefined,
    buyTokenId: typeof record.buyTokenId === "string" ? record.buyTokenId : undefined,
    driverToken,
    driverAmountStr:
      !wasOutputDriven && typeof record.driverAmountStr === "string" ? record.driverAmountStr : undefined,
  };
}

export function readPersistedSwapFormState() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(SWAP_FORM_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizePersistedSwapFormState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writePersistedSwapFormState(value: PersistedSwapFormState) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    SWAP_FORM_SESSION_STORAGE_KEY,
    JSON.stringify(normalizePersistedSwapFormState(value))
  );
}
