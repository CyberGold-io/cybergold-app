"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Hex } from "viem";
import { swapFailureOutcome } from "../utils/clientDiagnostics";
import { getEtherscanBaseUrl } from "../utils/getEtherscanBaseUrl";

export type SwapTransactionNoticeProps = {
  hash?: Hex;
  batchId?: string;
  outcome: "unconfirmed" | "reverted" | "failed";
  recheck: () => Promise<unknown>;
};

export function SwapTransactionNotice({ hash, outcome, recheck }: SwapTransactionNoticeProps) {
  const t = useTranslations("Home");
  const [status, setStatus] = useState<"unconfirmed" | "reverted" | "failed" | "confirmed">(outcome);
  const [confirmedHash, setConfirmedHash] = useState(hash);
  const [isChecking, setIsChecking] = useState(false);
  const explorer = getEtherscanBaseUrl();

  const check = async () => {
    setIsChecking(true);
    try {
      const result = await recheck() as { transactionHash?: Hex } | undefined;
      if (result?.transactionHash) setConfirmedHash(result.transactionHash);
      setStatus("confirmed");
    } catch (error) {
      setStatus(swapFailureOutcome(error, true));
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div role="status" className="order-5 rounded-2xl border border-swap-container-border bg-background-swap p-3 text-sm text-text-input">
      <p className="font-semibold">{t(status === "confirmed" ? "transactionConfirmed" : status === "reverted" ? "transactionReverted" : status === "failed" ? "transactionFailed" : "confirmationUnavailable")}</p>
      {status === "unconfirmed" && <p className="mt-1 text-xs">{t("confirmationUnavailableDescription")}</p>}
      {confirmedHash && <p className="mt-2 break-all font-mono text-xs">{confirmedHash}</p>}
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {explorer && confirmedHash && <a className="underline" href={`${explorer}/tx/${confirmedHash}`} target="_blank" rel="noopener noreferrer">{t("viewTransaction")}</a>}
        {status === "unconfirmed" && <button type="button" className="underline disabled:opacity-60" onClick={() => void check()} disabled={isChecking}>{t(isChecking ? "checkingConfirmation" : "checkConfirmation")}</button>}
      </div>
    </div>
  );
}
