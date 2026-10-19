// spec: specs/cybergold-basket-flows.plan.md
// seed: tests/seed.spec.ts

import type { Page } from "@playwright/test";
import type { MetaMask } from "@synthetixio/synpress-metamask/playwright";
import { expect, test } from "../../../../metamask/testWithMetaMask";
import { cybergoldFlowData } from "../../../../test-data/cybergold-flow-data";
import { selectToken } from "../../../../metamask/token-flows/helpers";

const { cygldIn } = cybergoldFlowData.redeemToBasketExactIn;

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
    if (observedAction) return;
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
    if (walletMenuVisible) return;

    await page.waitForTimeout(1000);
  }

  throw new Error("[metamask-connect] Wallet menu did not appear.");
}

async function connectMetaMaskIfNeeded(page: Page, metamask: MetaMask) {
  const walletMenuButton = page.getByRole("button", { name: "Open wallet menu" });
  if (await walletMenuButton.isVisible().catch(() => false)) return;

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

async function getSellMainInput(page: Page) {
  return page.getByRole("textbox").first();
}

async function getBuyMainInput(page: Page) {
  return page.locator('label', { hasText: 'You Buy' }).locator('..').locator('input').first();
}

async function getBasketComponentValue(page: Page, symbol: string) {
  const basketForm = page.locator('[id="basket composition form"]');
  return basketForm.locator('div', { hasText: symbol }).locator('button, input').first();
}

async function getSwapButton(page: Page) {
  return page.locator('#swapsection button').last();
}

async function openFeeDetails(page: Page) {
  const feeButton = page.getByRole("button", { name: /Total Fee/i });
  await expect(feeButton).toBeVisible();
  await feeButton.click();
}

test.describe("Redeem To Basket Exact In", () => {
  test("Middle Toggle: Redeem To Basket Exact In -> Issue From Basket Exact Out", async ({ page, metamask }) => {
    await page.goto("/en");
    await connectMetaMaskIfNeeded(page, metamask);

    await selectToken(page, "sell", "CYGLD");
    await selectToken(page, "buy", "BASKET");
    const reverseButton = page.getByRole("button", { name: /Reverse swap direction/i });
    await expect(reverseButton).toBeVisible();

    await page.bringToFront().catch(() => undefined);
    const sellInput = await getSellMainInput(page);
    await sellInput.click();
    await sellInput.fill(cygldIn);
    await expect(sellInput).toHaveValue(cygldIn);

    const paxgOutput = await getBasketComponentValue(page, "PAXG");
    const xautOutput = await getBasketComponentValue(page, "XAUt");
    await expect(paxgOutput).toBeVisible();
    await expect(xautOutput).toBeVisible();
    await expect(paxgOutput).toHaveText(/^[0-9]/, { timeout: 30000 });
    await expect(xautOutput).toHaveText(/^[0-9]/, { timeout: 30000 });

    await reverseButton.click();

    await expect(page.getByRole("button", { name: /BASKET/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /CYGLD/i }).first()).toBeVisible();

    const buyInput = await getBuyMainInput(page);
    const swapButton = await getSwapButton(page);
    await expect(swapButton).toBeDisabled();
    await expect(buyInput).toBeEditable();
    await expect(buyInput).toHaveValue(cygldIn);

    const quotedPaxg = await getBasketComponentValue(page, "PAXG");
    const quotedXaut = await getBasketComponentValue(page, "XAUt");
    await expect(quotedPaxg).toHaveText(/^[0-9]/, { timeout: 30000 });
    await expect(quotedXaut).toHaveText(/^[0-9]/, { timeout: 30000 });

    await openFeeDetails(page);
    await expect(page.getByText(/protocol fee/i)).toBeVisible();
    await expect(page.getByText(/helpers fee/i)).toBeVisible();
    await expect(swapButton).toBeEnabled({ timeout: 30000 });
  });
});
