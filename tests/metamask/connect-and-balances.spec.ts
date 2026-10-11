import type { Page } from "@playwright/test";
import { expect, test } from "./testWithMetaMask";

test.setTimeout(120_000);

const zeroBalancePattern = /^0(?:[\s.,]0+)?\s+[A-Za-z]+$/;
const expectedFundedTokenIds = (process.env.SYNPRESS_EXPECTED_FUNDED_TOKENS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

// Handling MetaMask prompts: unlock, connect, confirm, or approve.
async function handleMetaMaskPrompt(page: Page, password: string) {
  const extensionPages = page
    .context()
    .pages()
    .filter((openPage) => openPage.url().startsWith("chrome-extension://"));

  for (const extensionPage of extensionPages) {
    const passwordInput = extensionPage.getByTestId("unlock-password");
    const shouldUnlock = await passwordInput.isVisible().catch(() => false);

    if (shouldUnlock) {
      console.log("[metamask-connect] unlocking-extension-page", extensionPage.url());
      await passwordInput.fill(password);
      await extensionPage.getByTestId("unlock-submit").click();
      await page.waitForTimeout(1000);
      return true;
    }

    const nextButton = extensionPage.getByRole("button", { name: /^Next$/i });
    const nextVisible = await nextButton.isVisible().catch(() => false);
    if (nextVisible) {
      console.log("[metamask-connect] clicking-next", extensionPage.url());
      await nextButton.click();
      await page.waitForTimeout(750);
      return true;
    }

    const connectButton = extensionPage.getByRole("button", { name: /^Connect$/i });
    const connectVisible = await connectButton.isVisible().catch(() => false);
    if (connectVisible) {
      console.log("[metamask-connect] clicking-connect", extensionPage.url());
      await connectButton.click();
      await page.waitForTimeout(1000);
      return true;
    }

    const confirmButton = extensionPage.getByRole("button", { name: /^Confirm$/i });
    const confirmVisible = await confirmButton.isVisible().catch(() => false);
    if (confirmVisible) {
      console.log("[metamask-connect] clicking-confirm", extensionPage.url());
      await confirmButton.click();
      await page.waitForTimeout(1000);
      return true;
    }

    const approveButton = extensionPage.getByRole("button", { name: /^Approve$/i });
    const approveVisible = await approveButton.isVisible().catch(() => false);
    if (approveVisible) {
      console.log("[metamask-connect] clicking-approve", extensionPage.url());
      await approveButton.click();
      await page.waitForTimeout(1000);
      return true;
    }

    const footerNextButton = extensionPage.getByTestId("page-container-footer-next");
    const footerNextVisible = await footerNextButton.isVisible().catch(() => false);
    if (footerNextVisible) {
      const footerText = (await footerNextButton.textContent().catch(() => ""))?.trim() ?? "";
      if (/connect|confirm|approve|next/i.test(footerText)) {
        console.log("[metamask-connect] clicking-footer-next", extensionPage.url(), footerText);
        await footerNextButton.click();
        await page.waitForTimeout(1000);
        return true;
      }
    }
  }

  return false;
}

// Waiting until MetaMask has finished its side of the connection flow.
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

  throw new Error(
    `[metamask-connect] No actionable MetaMask connection popup appeared. Open pages: ${JSON.stringify(
      page.context().pages().map((openPage) => openPage.url())
    )}`
  );
}

// After MetaMask is done, wait for the app UI to switch into the connected-wallet state.
async function waitForWalletMenu(page: Page, password: string) {
  // Wallet menu button - a round button with the three dots - an indicator that a wallet is connected:
  const walletMenuButton = page.getByRole("button", { name: "Open wallet menu" });
  // An indicator that MetaMask connection is still processing:
  const openingMetaMaskDialog = page.getByText(/Opening MetaMask/i);
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const handledPrompt = await handleMetaMaskPrompt(page, password);
    if (handledPrompt) {
      continue;
    }

    await page.bringToFront().catch(() => undefined);

    const walletMenuVisible = await walletMenuButton.isVisible().catch(() => false);
    if (walletMenuVisible) {
      return;
    }

    const loadingVisible = await openingMetaMaskDialog.isVisible().catch(() => false);
    // Debugging in case MetaMask is still connecting:
    const visibleButtons = await page
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons
          .map((button) => {
            const label =
              button.getAttribute("aria-label") ??
              button.textContent?.trim() ??
              "";

            return label.replace(/\s+/g, " ").trim();
          })
          .filter(Boolean)
          .slice(0, 12)
      )
      .catch(() => []);

    console.log("[metamask-connect] waiting-for-wallet-menu", {
      loadingVisible,
      url: page.url(),
      visibleButtons,
    });

    await page.waitForTimeout(1000);
  }

  throw new Error(
    `[metamask-connect] Wallet menu did not appear. Visible buttons: ${JSON.stringify(
      await page
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons
            .map((button) => {
              const label =
                button.getAttribute("aria-label") ??
                button.textContent?.trim() ??
                "";

              return label.replace(/\s+/g, " ").trim();
            })
            .filter(Boolean)
            .slice(0, 20)
        )
        .catch(() => [])
    )}`
  );
}

test("connects MetaMask to the CyberGold app and shows funded balances", async ({ page, metamask }) => {
  // Open the app and start the wallet connection flow.
  await page.goto("/en");
  await page.bringToFront().catch(() => undefined);

  const connectWalletButton = page.getByRole("button", {
    name: /^Connect Wallet$/i,
  });

  await expect(connectWalletButton).toBeVisible();
  await connectWalletButton.click();
  await page.bringToFront().catch(() => undefined);
  const metaMaskOption = page.getByRole("button", { name: /^MetaMask$/i });
  await expect(metaMaskOption).toBeVisible();
  await metaMaskOption.click();

  const walletMenuButton = page.getByRole("button", { name: "Open wallet menu" });
  const alreadyConnected = await walletMenuButton.isVisible().catch(() => false);

  if (!alreadyConnected) {
    // MetaMask may open more than one prompt, so let the helper finish that flow first.
    await page.waitForTimeout(1500);
    console.log(
      "[metamask-connect] pages-after-click",
      page.context().pages().map((openPage) => openPage.url())
    );

    try {
      await approveMetaMaskConnection(page, metamask.password);
    } catch (error) {
      console.log(
        "[metamask-connect] pages-on-connect-error",
        page.context().pages().map((openPage) => openPage.url())
      );
      throw error;
    }
  }

  // Once connected (round button with the three dots is visible), open the balances modal and verify funded assets are visible.
  await waitForWalletMenu(page, metamask.password);
  await expect(walletMenuButton).toBeVisible({ timeout: 10_000 });

  await walletMenuButton.click();
  await page.getByRole("button", { name: "View balances" }).click();

  const walletBalanceModal = page.getByTestId("wallet-balance-modal");
  await expect(walletBalanceModal).toBeVisible();
  await expect(
    walletBalanceModal.getByRole("heading", { name: "Your assets" })
  ).toBeVisible();

  // Checking if ETH balance is visible:
  await expect(page.getByTestId("wallet-balance-row-eth")).toBeVisible();
  // Chechking if the total balance is not a placeholder like "--" or "...":
  await expect(page.getByTestId("wallet-balance-total")).not.toHaveText(
    /^(?:--|\.\.\.)$/
  );

  // Checking if funded tokens are visible and have non-zero balances:
  for (const tokenId of expectedFundedTokenIds) {
    await expect(page.getByTestId(`wallet-balance-row-${tokenId}`)).toBeVisible();
    await expect(page.getByTestId(`wallet-balance-amount-${tokenId}`)).not.toHaveText(
      zeroBalancePattern
    );
  }
});
