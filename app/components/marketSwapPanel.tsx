"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePublicClient } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";
import { targetChainId } from "@/app/config/chain";
import { useObservedWalletAccount } from "@/app/hooks/useObservedWalletAccount";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { useMarketQuote } from "@/app/hooks/flows/quotes/useMarketQuote";
import { useMarketModel } from "@/app/hooks/flows/quotes/useMarketModel";
import { useMarketSwapExecution } from "@/app/hooks/flows/shared/useMarketSwapExecution";
import { parseInputToBigInt } from "@/app/utils/numberParsing";
import { formatMeaningfulDecimalString, formatPpmAsPercent } from "@/app/utils/formatting";
import { DEFAULT_SLIPPAGE_BPS } from "@/app/utils/swapPolicy";
import { marketRouteProtocols } from "@/app/utils/marketQuote";
import { marketSwapReceipt, type MarketSwapReceipt } from "@/app/utils/marketSwap";
import { diagnosticReason, swapFailureOutcome } from "@/app/utils/clientDiagnostics";
import { waitForAppTransactionReceipt } from "@/app/utils/receiptWait";
import { ExecutionToleranceControl } from "./executionToleranceControl";
import { SwapTransactionNotice, type SwapTransactionNoticeProps } from "./swapTransactionNotice";

export function MarketSwapPanel() {
  const { addresses, tokenAddresses } = useProtocolConfiguration();
  const t = useTranslations("MarketSwap"), home = useTranslations("Home"), locale = useLocale();
  const { address, isConnected } = useObservedWalletAccount();
  const { openConnectModal } = useConnectModal();
  const publicClient = usePublicClient({ chainId: targetChainId }), client = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [mode, setMode] = useState<"exact-in" | "exact-out">("exact-in");
  const [amount, setAmount] = useState(""), [recipientDraft, setRecipient] = useState("");
  const [slippageBps, setSlippage] = useState(DEFAULT_SLIPPAGE_BPS);
  const [pending, setPending] = useState(false), [error, setError] = useState<string>();
  const [receipt, setReceipt] = useState<MarketSwapReceipt>();
  const [notice, setNotice] = useState<SwapTransactionNoticeProps>();
  const rawAmount = parseInputToBigInt(amount, 18, locale) ?? 0n;
  const debounced = useDebouncedValue(String(rawAmount), 100);
  const recipient = (recipientDraft.trim() || address || zeroAddress) as Address;
  const recipientValid = isAddress(recipient);
  const localEstimate = useMarketModel({ side, mode, counterToken: tokenAddresses.PAXG ?? "",
    adapter: addresses.adapter }, rawAmount);
  const quote = useMarketQuote({ side, mode, counterToken: tokenAddresses.PAXG ?? "",
    recipient, amount: debounced, slippageBps }, rawAmount > 0n && BigInt(debounced) > 0n && recipientValid && Boolean(tokenAddresses.PAXG));
  const execution = useMarketSwapExecution();
  const inputSymbol = side === "buy" ? "PAXG" : "CYGLD", outputSymbol = side === "buy" ? "CYGLD" : "PAXG";
  const drivingSymbol = mode === "exact-in" ? inputSymbol : outputSymbol;
  const current = debounced === String(rawAmount) ? quote.data : undefined;
  const format = (raw: bigint) => formatMeaningfulDecimalString(formatUnits(raw, 18), locale);
  const display = current ? mode === "exact-in" ? current.netOutput : current.totalInput
    : localEstimate ?? (debounced === String(rawAmount) ? quote.estimate : undefined);

  const confirm = async (hash: Hex, payer: Address, helpers: Address) => {
    if (!publicClient) throw new Error("Public client is unavailable");
    const confirmed = await waitForAppTransactionReceipt(publicClient, { hash });
    if (confirmed.status !== "success") {
      const failure = new Error("Market swap reverted"); failure.name = "TransactionRevertedError"; throw failure;
    }
    setReceipt(marketSwapReceipt(confirmed.logs, helpers, payer));
    void client.invalidateQueries({ queryKey: ["wallet-balances"] });
    void client.invalidateQueries({ queryKey: ["market-quote"] });
    return confirmed;
  };
  const submit = async () => {
    if (!isConnected || !address) { openConnectModal?.(); return; }
    if (!current || pending) return;
    // Capture the complete accepted economics and payer before any wallet UI.
    const accepted = current, payer = address, helpers = requireProtocolAddress(current.deployment?.helpers ?? addresses.helpers, "Helpers");
    setPending(true); setError(undefined); setNotice(undefined); setReceipt(undefined);
    let hash: Hex | undefined;
    try {
      hash = await execution.submit(accepted, payer);
      await confirm(hash, payer, helpers);
    } catch (failure) {
      if (hash) {
        const submittedHash = hash;
        setNotice({ hash, outcome: swapFailureOutcome(failure, true), recheck: () => confirm(submittedHash, payer, helpers) });
      } else setError(t(diagnosticReason(failure) === "wallet_rejected" ? "cancelled" : "failed"));
    } finally { setPending(false); }
  };

  return <div className="swap-page-background relative z-10 flex flex-1 flex-col py-6">
    <section className="glass-container swap-panel-surface mx-auto flex w-full max-w-lg flex-col gap-4 rounded-3xl p-5 text-text-input"
      aria-labelledby="market-title" data-testid="market-swap-panel">
      <div><h1 id="market-title" className="text-lg font-semibold">{t("title")}</h1><p className="mt-1 text-sm text-text-minor-data">{t("description")}</p></div>
      <div className="flex gap-2" aria-label={t("market")}>
        {(["buy", "sell"] as const).map(value => <button key={value} type="button" disabled={pending}
          aria-pressed={side === value} onClick={() => { setSide(value); setReceipt(undefined); }}
          className={`flex-1 rounded-xl border p-2 ${side === value ? "border-gold-cg" : "border-swap-container-border"}`}>{t(value)}</button>)}
      </div>
      <div className="flex gap-3 text-sm">
        {(["exact-in", "exact-out"] as const).map(value => <button key={value} type="button" disabled={pending}
          aria-pressed={mode === value} onClick={() => setMode(value)} className={mode === value ? "underline" : "text-text-minor-data"}>{t(value === "exact-in" ? "exactInput" : "exactOutput")}</button>)}
      </div>
      <label htmlFor="market-amount" className="text-sm">{t("amount", { token: drivingSymbol })}</label>
      <input id="market-amount" inputMode="decimal" type="text" autoComplete="off" value={amount} disabled={pending}
        className="rounded-2xl border border-swap-container-border bg-background-swap p-3 text-xl tabular-nums"
        onChange={event => { setAmount(event.currentTarget.value); setReceipt(undefined); }} />
      <div className="flex justify-between" data-testid="market-quote-display">
        <span>{t(mode === "exact-in" ? "output" : "input")}</span>
        <span className="tabular-nums">{display !== undefined ? `${current ? "" : "~ "}${format(display)} ${mode === "exact-in" ? outputSymbol : inputSymbol}` : "—"}</span>
      </div>
      {!current && quote.loading && <p role="status" className="text-xs text-text-minor-data">{t(display === undefined ? "prepare" : "estimate")}</p>}
      {quote.error && <p role="alert" className="text-sm text-text-amber">{quote.error}</p>}
      <label htmlFor="market-recipient" className="text-sm">{t("recipient")}</label>
      <input id="market-recipient" type="text" autoComplete="off" value={recipientDraft} placeholder={address ?? "0x…"} disabled={pending}
        aria-describedby="market-recipient-hint" className="min-w-0 rounded-xl border border-swap-container-border bg-background-swap p-2 font-mono text-xs"
        onChange={event => setRecipient(event.currentTarget.value)} />
      <p id="market-recipient-hint" className="text-xs text-text-minor-data">{t("recipientHint")}</p>
      {!recipientValid && <p role="alert" className="text-sm text-text-amber">{t("invalidRecipient")}</p>}
      {current && <dl className="space-y-2 border-t border-swap-container-border pt-3 text-sm" data-testid="market-quote-details">
        <div className="flex justify-between gap-2"><dt>{t("fee", { rate: formatPpmAsPercent(current.value.fee.ratePpm)?.replace("%", "") ?? "" })}</dt><dd>{format(current.feeCygld)} CYGLD</dd></div>
        <div className="flex justify-between gap-2"><dt>{t(mode === "exact-in" ? "minimum" : "maximum")}</dt><dd>{format(mode === "exact-in" ? current.outputMinimum : current.inputMaximum)} {mode === "exact-in" ? outputSymbol : inputSymbol}</dd></div>
        <div className="flex justify-between gap-2"><dt>{t("route")}</dt><dd>{marketRouteProtocols(current.value.plan.route).map(protocol => `Uniswap ${protocol.toUpperCase()}`).join(" / ")}</dd></div>
        <div className="flex justify-between gap-2"><dt>{t("impact")}</dt><dd>{current.value.priceImpactPpm === undefined ? "—" : formatPpmAsPercent(BigInt(current.value.priceImpactPpm))}</dd></div>
        {current.value.feeBeneficiaryDisplay && <div><dt>{t("feeRecipient")}</dt><dd className="break-all font-mono text-xs">{current.value.feeBeneficiaryDisplay.address}</dd></div>}
      </dl>}
      <ExecutionToleranceControl value={slippageBps} onChange={setSlippage} disabled={pending} />
      <p className="text-xs text-text-minor-data">{t("refundHint")}</p>
      {error && <p role="alert" className="text-sm text-text-amber">{error}</p>}
      {notice && <SwapTransactionNotice {...notice} />}
      {receipt && <div role="status" data-testid="market-swap-receipt" className="rounded-xl border border-swap-container-border p-3 text-sm">
        <p className="font-semibold">{t("confirmed")}</p>
        <dl className="mt-2 space-y-1">
          {([["actualInput", receipt.swapInput, inputSymbol], ["actualOutput", receipt.amountOut, outputSymbol],
            ["inputRefund", receipt.inputRefund, inputSymbol], ["outputRefund", receipt.outputRefund, outputSymbol],
            ["receiptFee", receipt.feeCygld, "CYGLD"]] as const).map(([label, raw, symbol]) => <div key={label} className="flex justify-between gap-2"><dt>{t(label)}</dt><dd>{format(raw)} {symbol}</dd></div>)}
          <div><dt>{t("feeRecipient")}</dt><dd className="break-all font-mono text-xs">{receipt.feeRecipient}</dd></div>
        </dl>
      </div>}
      <button type="button" onClick={() => void submit()} disabled={pending || (isConnected && !current)}
        className="rounded-2xl bg-gold-cg p-3 font-semibold text-black disabled:opacity-50">{pending ? t("pending") : isConnected ? t("swap") : home("pleaseConnectWallet")}</button>
    </section>
  </div>;
}
