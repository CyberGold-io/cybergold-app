import { expect, test, type Page } from "@playwright/test";
import { protocolConfigurationFixture as config } from "../fixtures/protocol-configuration";
import { expectWalletBalanceDisplay } from "../trading/uiWalletDisplay";
import { readWalletBalances } from "../metamask/token-flows/helpers";
import type { WalletBalancesSnapshot } from "../../app/utils/walletBalanceSnapshot";

async function modal(page: Page) {
  await page.setContent(`<button aria-label="Open wallet menu">Wallet</button>
    <div data-testid="wallet-balance-modal" hidden>
      <p data-testid="wallet-balance-amount-paxg">5.599 PAXG</p>
      <button aria-label="Close balances">Close</button>
    </div>`);
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[data-testid="wallet-balance-modal"]')!;
    document.querySelector('[aria-label="Open wallet menu"]')!.addEventListener("click", () => { dialog.hidden = false; });
    document.querySelector('[aria-label="Close balances"]')!.addEventListener("click", () => { dialog.hidden = true; });
  });
}

const snapshot = (amount: bigint) => ({ native: { status: "success", value: "1" },
  tokens: [{ id: "paxg", balance: { status: "success", value: String(amount) } }] }) as WalletBalancesSnapshot;

test("real modal observation accepts a settled amount hidden by rounding, closes, and can read again", async ({ page }) => {
  await modal(page);
  await expectWalletBalanceDisplay(page, ["paxg"], snapshot(5598763902343388700n), config);
  await expectWalletBalanceDisplay(page, ["paxg"], snapshot(5599004135968125793n), config);
  await expect(page.getByTestId("wallet-balance-modal")).toBeHidden();
  expect(await readWalletBalances(page, ["paxg"])).toEqual({ paxg: 5.599 });
  expect(await page.evaluate(() => "ethereum" in window)).toBe(false);
});

test("a real display mismatch remains a failure and closes its modal for the next case", async ({ page }) => {
  await modal(page);
  await expect(expectWalletBalanceDisplay(page, ["paxg"], snapshot(5600000000000000000n), config, 100)).rejects.toThrow("Wallet balance display does not match");
  await expect(page.getByTestId("wallet-balance-modal")).toBeHidden();
  expect(await readWalletBalances(page, ["paxg"])).toEqual({ paxg: 5.599 });
});

test("shared balance reads clean up an already-open modal when a token read fails", async ({ page }) => {
  await modal(page);
  page.setDefaultTimeout(100);
  await page.getByRole("button", { name: "Open wallet menu", exact: true }).click();
  await expect(readWalletBalances(page, ["missing-token"])).rejects.toThrow();
  await expect(page.getByTestId("wallet-balance-modal")).toBeHidden();
  expect(await readWalletBalances(page, ["paxg"])).toEqual({ paxg: 5.599 });
});
