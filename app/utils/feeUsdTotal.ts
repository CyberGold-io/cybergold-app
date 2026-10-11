import { formatUnits } from "viem";
import type { erc20Token } from "../config/tokens";

type FeesLike = {
  protocolFeeCygld: bigint;
  helperFeeCygld: bigint;
};

type ComputeTotalFeeUsdParams = {
  activeFees?: FeesLike;
  cygldDecimals: number;
  cygldPriceUsd?: number;
  cygldTokenId: string;
  networkFeeUsd?: number;
  networkFeeWei?: bigint;
  prices?: Record<string, number | undefined>;
  tokenAddressMap: ReadonlyMap<string, erc20Token>;
};

export function computeTotalFeeUsd(
  params: ComputeTotalFeeUsdParams
): number | undefined {
  const {
    activeFees,
    cygldDecimals,
    cygldPriceUsd,
    networkFeeUsd,
    networkFeeWei,
  } = params;
  if (!activeFees) return undefined;

  const normalizedCygldUsdPrice =
    typeof cygldPriceUsd === "number" && Number.isFinite(cygldPriceUsd)
      ? cygldPriceUsd
      : undefined;

  let totalUsd = 0;
  let hasPricedFee = false;
  let hasUnpricedFee = false;

  const addPricedFee = (amountUsd: number | undefined) => {
    if (amountUsd !== undefined && Number.isFinite(amountUsd)) {
      totalUsd += amountUsd;
      hasPricedFee = true;
      return;
    }

    hasUnpricedFee = true;
  };

  if (activeFees.protocolFeeCygld > 0n) {
    addPricedFee(
      normalizedCygldUsdPrice !== undefined
        ? Number(formatUnits(activeFees.protocolFeeCygld, cygldDecimals)) * normalizedCygldUsdPrice
        : undefined
    );
  }

  if (activeFees.helperFeeCygld > 0n) {
    addPricedFee(
      normalizedCygldUsdPrice !== undefined
        ? Number(formatUnits(activeFees.helperFeeCygld, cygldDecimals)) * normalizedCygldUsdPrice
        : undefined
    );
  }

  if (networkFeeWei !== undefined && networkFeeWei > 0n) {
    addPricedFee(networkFeeUsd);
  }

  return hasPricedFee && !hasUnpricedFee ? totalUsd : undefined;
}
