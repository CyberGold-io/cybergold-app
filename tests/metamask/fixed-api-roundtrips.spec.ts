import { errors, type Page } from "@playwright/test";
import { expect, test } from "./testWithMetaMask";
import { addLocalNetwork, connectWallet, notification, requestConnection, switchLocalNetwork } from "./wallet-ui";
import { getMainInput, getSwapButton, parseAmount, readWalletBalances, selectToken, showAllSellTokens } from "./token-flows/helpers";

async function approveUntilMined(page: Page) {
  const success = page.getByText(/The transaction was mined successfully/i);
  const failure = page.getByText(/^Transaction failed$/i);
  let openedStep = "";
  await expect.poll(async () => {
    if (await failure.isVisible()) throw new Error((await page.locator("[data-sonner-toast]").allTextContents()).join(" | "));
    if (await success.isVisible()) return true;
    const step = await (await getSwapButton(page)).innerText();
    if (!/^MetaMask \d+ of \d+:/.test(step)) return false;
    let popup = page.context().pages().find(candidate => candidate.url().includes("notification.html"));
    if (step !== openedStep || !popup) {
      popup = await notification(page);
      openedStep = step;
    }
    if (popup) {
      // Current extension controls for transaction and typed-signature requests.
      const confirm = popup.getByTestId("confirm-footer-button").or(popup.getByTestId("confirm-btn"));
      // A native request can navigate or close between polls. Let one click
      // check visibility/enabled state atomically, then re-read the App result.
      try {
        await confirm.click({ timeout: 1000 });
      } catch (error) {
        if (!(error instanceof errors.TimeoutError) && !popup.isClosed()) throw error;
      }
    }
    return false;
  }, { timeout: 90000, intervals: [250, 500, 1000] }).toBe(true);
}

async function balancesAfter(page: Page, ids: string[], accept: (value: Record<string, number>) => boolean) {
  let balances: Record<string, number> = {};
  await expect.poll(async () => {
    balances = await readWalletBalances(page, ids);
    return accept(balances);
  }, { timeout: 30000, intervals: [250, 500, 1000] }).toBe(true);
  return balances;
}

// Run with the disposable local protocol/backend fixture described in the E2E
// guide. MetaMask signs only against the fixture's independently owned Anvil.
// Responses are real fixed API reads, not intercepted product/receipt fixtures.
test("funded MetaMask token and basket roundtrips use fixed Python APIs", async ({ page }) => {
  // The native Linux case reached its final basket step after nine minutes.
  // Keep per-operation deadlines, with room for the final redemption.
  test.setTimeout(900000);
  page.setDefaultTimeout(15000);
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID);
  const rpcUrl = process.env.NEXT_PUBLIC_WALLET_RPC_URL!;
  const genericRequests: string[] = [];
  const successfulReads = new Set<string>();
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/rpc") genericRequests.push(request.url());
  });
  page.on("response", async response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/") && response.status() === 200) successfulReads.add(path);
    if (path.startsWith("/api/quotes/") && response.status() >= 400) {
      console.log("Quote API error:", path, response.status(), (await response.text().catch(() => "Response body unavailable")).slice(0, 1000));
    }
  });
  await page.goto("/en");
  await addLocalNetwork(page, { chainId, rpcUrl }, "CyberGold Disposable Wallet Fork");
  await switchLocalNetwork(page, chainId);
  await requestConnection(page);
  await connectWallet(page);
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible({ timeout: 20000 });

  async function prepare(sell: string, buy: string, amount: string, side: "sell" | "buy" = "sell") {
    await page.goto("/en");
    await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible({ timeout: 20000 });
    await showAllSellTokens(page);
    await selectToken(page, "sell", sell);
    await selectToken(page, "buy", buy);
    const input = getMainInput(page, side);
    await input.click();
    await input.fill(amount);
    const quotedSide = side === "sell" ? "buy" : "sell";
    const quotedToken = quotedSide === "buy" ? buy : sell;
    if (quotedToken === "BASKET") {
      const amounts = page.locator(`#${quotedSide}-basket-composition`).getByRole("button");
      // The funded fixture contains PAXG and XAUt. Quoted basket amounts are
      // buttons, while the editable token side retains its ordinary input.
      await expect(amounts).toHaveCount(2);
      for (const amount of await amounts.all()) {
        await expect.poll(async () => parseAmount(await amount.innerText()), { timeout: 60000 }).toBeGreaterThan(0);
      }
    } else {
      await expect.poll(async () => Number(await getMainInput(page, quotedSide).inputValue()), { timeout: 60000 }).toBeGreaterThan(0);
    }
    await expect(await getSwapButton(page)).toBeEnabled({ timeout: 60000 });
  }
  async function submit() {
    await (await getSwapButton(page)).click();
    await approveUntilMined(page);
  }

  await prepare("ETH", "CYGLD", "0.1");
  const beforeRejected = await readWalletBalances(page, ["cygld"]);
  await (await getSwapButton(page)).click();
  // Product preparation precedes the actual wallet request. Open the native
  // request view when the App reports that request, rather than an empty view.
  await expect(await getSwapButton(page)).toHaveText(/^MetaMask \d+ of \d+:/, { timeout: 60000 });
  const rejected = await notification(page);
  await rejected.getByTestId("confirm-footer-cancel-button").click();
  await expect(page.getByText(/^Transaction failed$/i)).toBeVisible({ timeout: 20000 });
  expect((await readWalletBalances(page, ["cygld"])).cygld).toBe(beforeRejected.cygld);

  for (const { symbol, id, amount } of [
    { symbol: "PAXG", id: "paxg", amount: "0.1" },
    { symbol: "USDC", id: "usdc", amount: "100" },
    { symbol: "ETH", id: "eth", amount: "0.1" },
  ]) {
    await test.step(`Issue from ${symbol}`, async () => {
      await prepare(symbol, "CYGLD", amount);
      const before = await readWalletBalances(page, [id, "cygld"]);
      await submit();
      await balancesAfter(page, [id, "cygld"], after => after[id] < before[id] && after.cygld > before.cygld);
    });
  }
  for (const { symbol, id } of [
    { symbol: "PAXG", id: "paxg" }, { symbol: "USDC", id: "usdc" }, { symbol: "ETH", id: "eth" },
  ]) {
    await test.step(`Redeem to ${symbol}`, async () => {
      await prepare("CYGLD", symbol, "0.5");
      const before = await readWalletBalances(page, [id, "cygld"]);
      await submit();
      await balancesAfter(page, [id, "cygld"], after => after[id] > before[id] && after.cygld < before.cygld);
    });
  }
  await test.step("Issue from basket", async () => {
    await prepare("BASKET", "CYGLD", "0.5", "buy");
    const before = await readWalletBalances(page, ["paxg", "xaut", "cygld"]);
    await submit();
    await balancesAfter(page, ["paxg", "xaut", "cygld"], after => after.cygld > before.cygld && after.paxg < before.paxg && after.xaut < before.xaut);
  });
  await test.step("Redeem to basket", async () => {
    await prepare("CYGLD", "BASKET", "0.5");
    const before = await readWalletBalances(page, ["paxg", "xaut", "cygld"]);
    await submit();
    await balancesAfter(page, ["paxg", "xaut", "cygld"], after => after.cygld < before.cygld && after.paxg > before.paxg && after.xaut > before.xaut);
  });
  expect(genericRequests).toEqual([]);
  expect(successfulReads.has("/api/account/wallet-balances")).toBe(true);
  console.log(JSON.stringify({ genericAppRpcRequests: genericRequests.length, successfulFixedApiPaths: [...successfulReads].sort() }));
});
