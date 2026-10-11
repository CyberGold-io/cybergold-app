import { useMemo } from "react";
import type { Address } from "viem";
import { getAddress } from "viem";

type UsePreviewAddressAmountFreshOptions = {
  enabled: boolean;
  expectedAddress?: Address;
  expectedAmount?: bigint;
  previewAddress?: Address;
  previewAmount?: bigint;
};

export function usePreviewAddressAmountFresh({
  enabled,
  expectedAddress,
  expectedAmount,
  previewAddress,
  previewAmount,
}: UsePreviewAddressAmountFreshOptions) {
  return useMemo(() => {
    if (!enabled) return false;
    if (!expectedAddress || expectedAmount === undefined) return false;
    if (!previewAddress || previewAmount === undefined) return false;

    return getAddress(previewAddress) === getAddress(expectedAddress) && previewAmount === expectedAmount;
  }, [enabled, expectedAddress, expectedAmount, previewAddress, previewAmount]);
}
