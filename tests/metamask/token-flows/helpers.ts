import { expect, type Page } from "@playwright/test";
import type { MetaMask } from "@synthetixio/synpress-metamask/playwright";

type SwapSide = "sell" | "buy";

export function parseAmount(value: string | null): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  return Number(cleaned) || 0;
}

export function tokenSymbolPattern(symbol: string) {
  return new RegExp(`\\b${symbol}\\b`, "i");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenPickerRowNamePattern(symbol: string) {
  if (symbol === "BASKET") return /^\s*(BASKET|Gold basket)\b/i;
  return new RegExp(`^\\s*${escapeRegExp(symbol)}\\b`, "i");
}

export async function handleMetaMaskPrompt(page: Page, password: string) {
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
    if (await nextButton.isVisible().catch(() => false)) {
      await nextButton.click();
      await page.waitForTimeout(750);
      return true;
    }

    const connectButton = extensionPage.getByRole("button", { name: /^Connect$/i });
    if (await connectButton.isVisible().catch(() => false)) {
      await connectButton.click();
      await page.waitForTimeout(1000);
      return true;
    }

    const confirmButton = extensionPage.getByRole("button", { name: /^Confirm$/i });
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
      await page.waitForTimeout(1000);
      return true;
    }

    const approveButton = extensionPage.getByRole("button", { name: /^Approve$/i });
    if (await approveButton.isVisible().catch(() => false)) {
      await approveButton.click();
      await page.waitForTimeout(1000);
      return true;
    }

    const footerNextButton = extensionPage.getByTestId("page-container-footer-next");
    if (await footerNextButton.isVisible().catch(() => false)) {
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

export async function approveMetaMaskConnection(page: Page, password: string) {
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

export async function waitForWalletMenu(page: Page, password: string) {
  const walletMenuButton = page.getByRole("button", { name: "Open wallet menu" });
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const handledPrompt = await handleMetaMaskPrompt(page, password);
    if (handledPrompt) continue;

    if (await walletMenuButton.isVisible().catch(() => false)) return;
    await page.waitForTimeout(1000);
  }

  throw new Error("[metamask-connect] Wallet menu did not appear.");
}

export async function connectMetaMaskIfNeeded(page: Page, metamask: MetaMask) {
  const walletMenuButton = page.getByRole("button", { name: "Open wallet menu" });
  if (await walletMenuButton.isVisible().catch(() => false)) return;
  await walletMenuButton.waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
  if (await walletMenuButton.isVisible().catch(() => false)) return;

  await page.bringToFront().catch(() => undefined);

  const connectWalletButton = page.getByRole("button", { name: /^Connect Wallet$/i });
  await expect(connectWalletButton).toBeVisible();
  await connectWalletButton.click();
  await page.bringToFront().catch(() => undefined);

  const metaMaskOption = page.getByRole("button", { name: /^MetaMask$/i });
  await metaMaskOption.waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
  if (!(await metaMaskOption.isVisible().catch(() => false))) {
    await walletMenuButton.waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
    if (await walletMenuButton.isVisible().catch(() => false)) return;
  }
  await expect(metaMaskOption).toBeVisible();
  await metaMaskOption.click();

  await page.waitForTimeout(1500);
  await approveMetaMaskConnection(page, metamask.password);
  await waitForWalletMenu(page, metamask.password);
}

export async function approveMetaMaskPrompts(page: Page, password: string) {
  const deadline = Date.now() + 75_000;

  while (Date.now() < deadline) {
    const handledPrompt = await handleMetaMaskPrompt(page, password);
    if (handledPrompt) continue;

    const successToast = page.getByText(/The transaction was mined successfully/i);
    if (await successToast.isVisible().catch(() => false)) return;

    await page.waitForTimeout(500);
  }

  throw new Error("[metamask-approve] MetaMask approval did not complete in time.");
}

export async function openWalletBalanceModal(page: Page) {
  await page.getByRole("button", { name: "Open wallet menu" }).click();
  await page.getByRole("button", { name: "View balances" }).click();
  await expect(page.getByTestId("wallet-balance-modal")).toBeVisible();
}

export async function closeWalletBalanceModal(page: Page) {
  const closeButton = page.getByRole("button", { name: /Close balances/i });
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(page.getByTestId("wallet-balance-modal")).toBeHidden();
}

export async function getWalletBalance(page: Page, tokenId: string) {
  return parseAmount(await page.getByTestId(`wallet-balance-amount-${tokenId}`).textContent());
}

export async function readWalletBalances(page: Page, tokenIds: string[]) {
  await openWalletBalanceModal(page);
  const balances = Object.fromEntries(
    await Promise.all(
      tokenIds.map(async (tokenId) => [tokenId, await getWalletBalance(page, tokenId)] as const)
    )
  );
  await closeWalletBalanceModal(page);
  return balances;
}

export function getSwapSection(page: Page) {
  return page.locator("#swapsection");
}

export function getSideSection(page: Page, side: SwapSide) {
  const label = side === "sell" ? "You Sell" : "You Buy";
  // A quoted basket renders a summary instead of an amount input. Its token
  // picker remains present, so selecting BASKET must keep the same side scope.
  return page
    .locator("label", { hasText: label })
    .locator('xpath=ancestor::div[.//button[contains(@class, "w-44")]][1]');
}

export function getMainInput(page: Page, side: SwapSide) {
  return getSideSection(page, side).locator('input[type="text"]').first();
}

export async function ensureMainInputEditable(page: Page, side: SwapSide) {
  const input = getMainInput(page, side);
  if (!(await input.isEditable().catch(() => false))) {
    await input.click();
  }
  await expect(input).toBeEditable();
  return input;
}

export function getTokenButton(page: Page, side: SwapSide, symbol?: string) {
  const buttons = getSideSection(page, side).locator('button[class*="w-44"]');
  if (symbol) return buttons.filter({ hasText: tokenSymbolPattern(symbol) }).first();
  return buttons.filter({ hasText: /BASKET|CYGLD|USDC|USDT|ETH|WETH|PAXG|XAUt/i }).first();
}

export async function selectToken(page: Page, side: SwapSide, symbol: string) {
  await getTokenButton(page, side).click();
  const dropdown = page.locator("#dropdown-from").last();
  await expect(dropdown).toBeVisible();
  await dropdown.getByRole("button", { name: tokenPickerRowNamePattern(symbol) }).click();
  await expect(getTokenButton(page, side, symbol)).toBeVisible();
}

export async function selectTokenIfAvailable(page: Page, side: SwapSide, symbol: string) {
  await getTokenButton(page, side).click();
  const dropdown = page.locator("#dropdown-from").last();
  await expect(dropdown).toBeVisible();

  const tokenOption = dropdown.getByRole("button", { name: tokenPickerRowNamePattern(symbol) });
  const isAvailable = await tokenOption.isVisible().catch(() => false);

  if (!isAvailable) {
    await page.mouse.click(10, 10);
    await expect(dropdown).toBeHidden();
    return false;
  }

  await tokenOption.click();
  await expect(getTokenButton(page, side, symbol)).toBeVisible();
  return true;
}

export async function showAllSellTokens(page: Page) {
  const walletOnlySwitch = page.getByRole("switch").first();
  await expect(walletOnlySwitch).toBeVisible();
  const isChecked = await walletOnlySwitch.getAttribute("aria-checked");
  if (isChecked === "true") {
    await walletOnlySwitch.click();
    await expect(walletOnlySwitch).toHaveAttribute("aria-checked", "false");
  }
}

export async function setupIssueFromToken(
  page: Page,
  metamask: MetaMask,
  tokenSymbol: string | readonly string[]
) {
  await page.goto("/en");
  await connectMetaMaskIfNeeded(page, metamask);
  await showAllSellTokens(page);
  const candidateSymbols = Array.isArray(tokenSymbol) ? tokenSymbol : [tokenSymbol];
  let selectedTokenSymbol: string | undefined;

  for (const candidateSymbol of candidateSymbols) {
    if (await selectTokenIfAvailable(page, "sell", candidateSymbol)) {
      selectedTokenSymbol = candidateSymbol;
      break;
    }
  }

  if (!selectedTokenSymbol) {
    throw new Error(`None of the issue-from-token candidates were selectable: ${candidateSymbols.join(", ")}`);
  }

  await expect(getTokenButton(page, "sell", selectedTokenSymbol)).toBeVisible();
  await expect(getTokenButton(page, "buy", "CYGLD")).toBeVisible();
  return selectedTokenSymbol;
}

export async function setupRedeemToToken(page: Page, metamask: MetaMask, tokenSymbol: string) {
  await page.goto("/en");
  await connectMetaMaskIfNeeded(page, metamask);

  await selectToken(page, "sell", "CYGLD");
  await selectToken(page, "buy", tokenSymbol);
  await expect(getTokenButton(page, "sell", "CYGLD")).toBeVisible();
  await expect(getTokenButton(page, "buy", tokenSymbol)).toBeVisible();
}

export async function expectQuotedAmount(page: Page, side: SwapSide) {
  const input = getMainInput(page, side);
  await expect(input).toHaveValue(/^[0-9]/, { timeout: 45_000 });
  const value = parseAmount(await input.inputValue());
  expect(value).toBeGreaterThan(0);
  return value;
}

export async function getSwapButton(page: Page) {
  return page.locator("#swapsection button").last();
}

export async function openFeeDetails(page: Page) {
  const feeButton = page.getByRole("button", { name: /Total Fee/i });
  await expect(feeButton).toBeVisible({ timeout: 45_000 });
  await feeButton.click();
}

export async function expectFeeDetails(page: Page) {
  await openFeeDetails(page);
  await expect(page.getByText(/protocol fee/i)).toBeVisible();
  await expect(page.getByText(/helpers fee/i)).toBeVisible();
  const transactionFeeDetails = page.locator("div", { hasText: /transaction fee/i });
  await expect(transactionFeeDetails.getByText(/^~.*ETH/i).first()).toBeVisible();
}

export async function expectReadyToSwap(page: Page) {
  const swapButton = await getSwapButton(page);
  await expect(swapButton).toBeEnabled({ timeout: 45_000 });
  return swapButton;
}

export async function submitSwapAndExpectSuccess(page: Page, metamask: MetaMask) {
  const swapButton = await expectReadyToSwap(page);
  await swapButton.click();
  await expect(swapButton).toHaveText(/Processing|MetaMask|Quote processing/i, { timeout: 15_000 });
  await approveMetaMaskPrompts(page, metamask.password);
  await expect(page.getByText(/The transaction was mined successfully/i)).toBeVisible({ timeout: 60_000 });
}

export async function expectSwapDisabled(page: Page, label?: RegExp) {
  const swapButton = await getSwapButton(page);
  await expect(swapButton).toBeDisabled();
  if (label) await expect(swapButton).toHaveText(label);
  return swapButton;
}

export async function clickReverseSwapDirection(page: Page) {
  const reverseButton = page.getByRole("button", { name: /Reverse swap direction/i });
  await expect(reverseButton).toBeVisible();
  await reverseButton.click();
}
