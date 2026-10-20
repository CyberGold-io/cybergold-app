"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatUnits, zeroAddress } from "viem";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { formatMeaningfulDecimalString } from "@/app/utils/formatting";
import type { TradeReceipt } from "@/app/utils/tradeReceipt";
import type { WireRetainedInputCharge } from "@/app/utils/universalExactInput";

function AssetAmount({ currency, amount }: { currency: string; amount: bigint | string }) {
  const { tokens } = useProtocolConfiguration(), locale = useLocale();
  const native = currency.toLowerCase() === zeroAddress;
  const token = tokens.find(token => native ? token.type === "native" : token.type === "erc20" && token.address.toLowerCase() === currency.toLowerCase());
  return <span className="break-all">{token && token.type !== "basket" ? `${formatMeaningfulDecimalString(formatUnits(BigInt(amount), token.decimals), locale)} ${token.symbol}` : `${amount} (${currency})`}</span>;
}

export function ExactInputRetentionDisclosure({ charges }: { charges: readonly WireRetainedInputCharge[] }) {
  const t = useTranslations("Home");
  return <div data-testid="exact-input-retention-disclosure" className="order-4 mt-3 text-xs text-text-muted">
    <p>{t("exactInputRetentionDisclosure")}</p>
    {charges.length > 0 && <dl className="mt-2 space-y-1">{charges.map((row, index) => <div key={index} className="flex justify-between gap-3">
      <dt>{t("estimatedRetainedCharge")}</dt><dd><AssetAmount currency={row.currency} amount={row.amount} /></dd>
    </div>)}</dl>}
  </div>;
}

export function ExactInputSettlement({ receipt }: { receipt: TradeReceipt }) {
  const t = useTranslations("Home");
  return <dl className="mt-2 space-y-1" data-testid="exact-input-settlement">
    {receipt.acquiredInputs?.map((row, index) => <div key={`input-${index}`} className="flex justify-between gap-3"><dt>{t("tradeActualInput")}</dt><dd><AssetAmount currency={row.currency} amount={row.amount} /></dd></div>)}
    {receipt.recipientOutputs?.filter(row => row.kind === 0).map((row, index) => <div key={`output-${index}`} className="flex justify-between gap-3"><dt>{t("tradeActualOutput")}</dt><dd><AssetAmount currency={row.token} amount={row.amount} /></dd></div>)}
    {receipt.retainedInputs?.map((row, index) => <div key={`retained-${index}`} className="flex justify-between gap-3"><dt>{t("retainedProtocolCharge")}</dt><dd><AssetAmount currency={row.currency} amount={row.amount} /></dd></div>)}
    {receipt.retainedCustodian && <div className="flex justify-between gap-3"><dt>{t("retainedCustodian")}</dt><dd className="break-all text-xs">{receipt.retainedCustodian}</dd></div>}
  </dl>;
}
