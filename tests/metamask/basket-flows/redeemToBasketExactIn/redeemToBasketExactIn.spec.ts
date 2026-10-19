// spec: specs/cybergold-basket-flows.plan.md
// seed: tests/seed.spec.ts

import type { Page } from "@playwright/test";
import type { MetaMask } from "@synthetixio/synpress-metamask/playwright";
import { expect, test } from "../../testWithMetaMask";
import { cybergoldFlowData } from "../../../test-data/cybergold-flow-data";
import { selectToken } from "../../token-flows/helpers";

const { cygldIn } = cybergoldFlowData.redeemToBasketExactIn;

function parseAmount(value: string | null): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  return Number(cleaned) || 0;
}

function expectAtLeastWithTolerance(received: number, expected: number) {
  expect(received).toBeGreaterThanOrEqual(expected - 1e-9);
}

async function handleMetaMaskPrompt(page: Page, password: string) {
  const extensionPages = page
    .context()
    .pages()
    .filter((openPage) => openPage.url().startsWith("chrome-extension://"));

  for (const extensionPage of extensionPages) {
    const passwordInput = extensionPage.getByTestId("unlock-password");
    const shouldUnlock = await passwordInput.isVisible().catch(() => false);

    if (shouldUnlock) {
      await passwordInput.fill(password);
      await extensionPage.getByTestId("unlock-submit").click();
      await page.waitForTimeout(1000);
      return true;
    }

    const nextButton = extensionPage.getByRole("button", { name: /^Next$/i });
    const nextVisible = await nextButton.isVisible().catch(() => false);
    if (nextVisible) {
      await nextButton.click();
      await page.waitForTimeout(750);
      return true;
    }

    const connectButton = extensionPage.getByRole("button", { name: /^Connect$/i });
    const connectVisible = await connectButton.isVisible().catch(() => false);
    if (connectVisible) {
      await connectButton.click();
      await page.waitForTimeout(1000);
      return true;
    }

    const confirmButton = extensionPage.getByRole("button", { name: /^Confirm$/i });
    const confirmVisible = await confirmButton.isVisible().catch(() => false);
    if (confirmVisible) {
      await confirmButton.click();
      await page.waitForTimeout(1000);
      return true;
    }

    const approveButton = extensionPage.getByRole("button", { name: /^Approve$/i });
    const approveVisible = await approveButton.isVisible().catch(() => false);
    if (approveVisible) {
      await approveButton.click();
      await page.waitForTimeout(1000);
      return true;
    }

    const footerNextButton = extensionPage.getByTestId("page-container-footer-next");
    const footerNextVisible = await footerNextButton.isVisible().catch(() => false);
    if (footerNextVisible) {
      const footerText = ((await footerNextButton.textContent().catch(() => "")) ?? "").trim();
      if (/connect|confirm|approve|next/i.test(footerText)) {
        await footerNextButton.click();
        await page.waitForTimeout(1000);
        return true;
      }
    }
  }

  return false;
}

async function approveMetaMaskConnection(page: Page, password: string) {
  const deadline = Date.now() + 30_000;
  let observedAction = false;

  while (Date.now() < deadline) {
    const handledPrompt = await handleMetaMaskPrompt(page, password);
    if (handledPrompt) {
      observedAction = true;
      continue;
    }

    if (observedAction) {
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error("[metamask-connect] No actionable MetaMask connection popup appeared.");
}

async function waitForWalletMenu(page: Page, password: string) {
  const walletMenuButton = page.getByRole("button", { name: "Open wallet menu" });
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const handledPrompt = await handleMetaMaskPrompt(page, password);
    if (handledPrompt) continue;

    const walletMenuVisible = await walletMenuButton.isVisible().catch(() => false);
    if (walletMenuVisible) {
      return;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error("[metamask-connect] Wallet menu did not appear.");
}

async function connectMetaMaskIfNeeded(page: Page, metamask: MetaMask) {
  const walletMenuButton = page.getByRole("button", { name: "Open wallet menu" });
  if (await walletMenuButton.isVisible().catch(() => false)) {
    return;
  }

  await page.bringToFront().catch(() => undefined);

  const connectWalletButton = page.getByRole("button", { name: /^Connect Wallet$/i });
  await expect(connectWalletButton).toBeVisible();
  await connectWalletButton.click();
  await page.bringToFront().catch(() => undefined);

  const metaMaskOption = page.getByRole("button", { name: /^MetaMask$/i });
  await expect(metaMaskOption).toBeVisible();
  await metaMaskOption.click();

  await page.waitForTimeout(1500);
  await approveMetaMaskConnection(page, metamask.password);
  await waitForWalletMenu(page, metamask.password);
}

async function openWalletBalanceModal(page: Page) {
  await page.getByRole("button", { name: "Open wallet menu" }).click();
  await page.getByRole("button", { name: "View balances" }).click();
  const walletBalanceModal = page.getByTestId("wallet-balance-modal");
  await expect(walletBalanceModal).toBeVisible();
}

async function closeWalletBalanceModal(page: Page) {
  const closeButton = page.getByRole("button", { name: /Close balances/i });
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(page.getByTestId("wallet-balance-modal")).toBeHidden();
}

async function getWalletBalance(page: Page, tokenId: string) {
  return parseAmount(
    await page
      .getByTestId(`wallet-balance-amount-${tokenId}`)
      .textContent()
  );
}

async function getSellMainInput(page: Page) {
  return page.getByRole("textbox").first();
}

async function getBasketComponentValue(page: Page, symbol: string) {
  const basketForm = page.locator("#buy-basket-composition");
  return basketForm.getByRole("textbox", { name: `Buy amount (${symbol})`, exact: true });
}

async function getSwapButton(page: Page) {
  return page.locator('#swapsection button').last();
}

async function openFeeDetails(page: Page) {
  const feeButton = page.getByRole("button", { name: /Total Fee/i });
  await expect(feeButton).toBeVisible();
  await feeButton.click();
}

async function approveMetaMaskPrompts(page: Page, password: string) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const handledPrompt = await handleMetaMaskPrompt(page, password);
    if (handledPrompt) {
      continue;
    }

    const successToast = page.getByText(/The transaction was mined successfully/i);
    if (await successToast.isVisible().catch(() => false)) {
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error("[metamask-approve] MetaMask approval did not complete in time.");
}

test.describe("Redeem To Basket Exact In", () => {
  test("User provides exact CYGLD input and receives quoted basket token outputs", async ({ page, metamask }) => {
    await page.goto("/en");
    await connectMetaMaskIfNeeded(page, metamask);

    await selectToken(page, "sell", "CYGLD");
    await selectToken(page, "buy", "BASKET");

    await openWalletBalanceModal(page);
    const initialCygldBalance = await getWalletBalance(page, "cygld");
    const initialPaxgBalance = await getWalletBalance(page, "paxg");
    const initialXautBalance = await getWalletBalance(page, "xaut");
    await closeWalletBalanceModal(page);
    expect(initialCygldBalance).toBeGreaterThanOrEqual(Number(cygldIn));

    await page.bringToFront().catch(() => undefined);
    const sellInput = await getSellMainInput(page);
    await sellInput.click();
    await sellInput.fill(cygldIn);
    await expect(sellInput).toHaveValue(cygldIn);

    const basketForm = page.locator("#buy-basket-composition");
    await expect(basketForm).toBeVisible();

    const paxgOutput = await getBasketComponentValue(page, "PAXG");
    const xautOutput = await getBasketComponentValue(page, "XAUt");
    await expect(paxgOutput).toBeVisible();
    await expect(paxgOutput).toHaveValue(/^[0-9]/, { timeout: 30000 });
    await expect(xautOutput).toBeVisible();
    await expect(xautOutput).toHaveValue(/^[0-9]/, { timeout: 30000 });

    await openFeeDetails(page);
    await expect(page.getByText(/protocol fee/i)).toBeVisible();
    await expect(page.getByText(/helpers fee/i)).toBeVisible();
    const transactionFeeDetails = page.locator('div', { hasText: /transaction fee/i });
    await expect(transactionFeeDetails.getByText(/^~.*ETH/i).first()).toBeVisible();

    const insufficientBalanceWarning = page.getByText(/insufficient balance|exceeds wallet balance|not enough/i);
    await expect(insufficientBalanceWarning).not.toBeVisible({ timeout: 3000 });

    const swapButton = await getSwapButton(page);
    await expect(swapButton).toBeEnabled();
    await swapButton.click();

    await expect(swapButton).toHaveText(/Processing|MetaMask|Quote processing/i, { timeout: 15000 });
    await approveMetaMaskPrompts(page, metamask.password);
    await expect(page.getByText(/The transaction was mined successfully/i)).toBeVisible({ timeout: 60000 });

    await openWalletBalanceModal(page);
    const finalCygldBalance = await getWalletBalance(page, "cygld");
    const finalPaxgBalance = await getWalletBalance(page, "paxg");
    const finalXautBalance = await getWalletBalance(page, "xaut");
    await closeWalletBalanceModal(page);

    expectAtLeastWithTolerance(initialCygldBalance - finalCygldBalance, Number(cygldIn));
    expect(finalPaxgBalance).toBeGreaterThan(initialPaxgBalance);
    expect(finalXautBalance).toBeGreaterThan(initialXautBalance);
  });
});
