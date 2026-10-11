"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";

import { type Address } from "viem";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";

import { EXPECTED_CHAIN_ID } from "@/app/utils/expectedChain";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { getLocaleDecimalSeparator } from "@/app/utils/formatting";
import { formatRecoveryShareAmount, recoverySharePrecisionQuery } from "@/app/utils/recoverySharePrecision";

/** Share precision belongs to the permanent ID, not current basket membership. */
export function RecoveryShareAmount({ asset, amount }: { asset: Address; amount: bigint }) {
  const { core: CORE_DIAMOND_ADDRESS } = useProtocolConfiguration().addresses;
  const t = useTranslations("RecoveryShares");
  const locale = useLocale();
  const generation = useSandboxForkGeneration();
  const { data } = useQuery({ ...recoverySharePrecisionQuery(asset, EXPECTED_CHAIN_ID, CORE_DIAMOND_ADDRESS, generation), enabled: Boolean(CORE_DIAMOND_ADDRESS) });
  return <>{data ? t("balance", { amount: formatRecoveryShareAmount(amount, data.shareDecimals).replace(".", getLocaleDecimalSeparator(locale)) }) : t("amountUnavailable")}</>;
}
