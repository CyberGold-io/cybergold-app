import { expect, type Page } from "@playwright/test";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { WalletBalancesSnapshot } from "../../app/utils/walletBalanceSnapshot.ts";
import { openWalletBalanceModal, closeWalletBalanceModal } from "../metamask/token-flows/helpers.ts";
import { walletDisplayMatches } from "./uiEconomics.ts";
import { requireInvariant } from "./regression.ts";

/** Check visible balances against their represented precision; raw wallet/receipt deltas prove settlement. */
export async function expectWalletBalanceDisplay(page: Page, ids: string[], snapshot: WalletBalancesSnapshot,
  config: ProtocolConfiguration, timeout = 30_000) {
  const tokens = [...new Set(ids)].map(id => {
    const token = config.tokens.find(value => value.id === id);
    const read = token?.type === "native" ? snapshot.native : snapshot.tokens.find(value => value.id === id)?.balance;
    requireInvariant(token && read?.status === "success", "wallet-balance-unavailable");
    return { ...token, amount: BigInt(read.value) };
  });
  await openWalletBalanceModal(page);
  try {
    await expect.poll(async () => (await Promise.all(tokens.map(async token => walletDisplayMatches(
      await page.getByTestId(`wallet-balance-amount-${token.id}`).innerText(), token.amount, token.decimals, token.symbol)))).every(Boolean),
    { timeout, intervals: [250, 500, 1000], message: "Wallet balance display does not match the observed balances at its displayed precision" }).toBe(true);
  } finally { await closeWalletBalanceModal(page); }
}
