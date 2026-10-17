import { expect, type Locator, type Page } from "@playwright/test";
import type { WalletRequestDiagnostic } from "../trading/runnerDiagnostics";

export async function addLocalNetwork(page: Page, node: { rpcUrl: string; chainId: number }, name: string) {
  await page.bringToFront();
  await page.waitForFunction(() => Boolean((window as unknown as { ethereum?: unknown }).ethereum));
  const pending = page.evaluate(network => {
    const provider = (window as unknown as { ethereum: { request: (input: unknown) => Promise<unknown> } }).ethereum;
    return provider.request({ method: "wallet_addEthereumChain", params: [{
      chainId: `0x${network.chainId.toString(16)}`, chainName: network.name,
      rpcUrls: [network.rpcUrl], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    }] });
  }, { chainId: node.chainId, rpcUrl: node.rpcUrl, name });
  void pending.catch(() => undefined);
  const notice = await notification(page);
  await notice.getByTestId("confirm-footer-button").click();
  await pending;
}

/** Keep the native click locator identical for selection and confirmation. */
export function walletRequestButton(page: Page, reject = false) {
  return reject ? page.getByTestId("confirm-footer-cancel-button")
    : page.getByTestId("confirm-footer-button").or(page.getByTestId("confirm-btn"))
      .or(page.locator('.page-container__footer [data-testid="page-container-footer-next"]'));
}

export async function notification(page: Page, observe?: (value: Pick<WalletRequestDiagnostic, "notificationSelection" | "notificationViewCount">) => void,
  action?: (view: Page) => Locator) {
  const context = page.context();
  const extensionId = new URL(context.serviceWorkers()[0].url()).host;
  const views = context.pages();
  let popup: Page | undefined;
  let selectedAction = false;
  let selection: WalletRequestDiagnostic["notificationSelection"] = "existing-notification";
  // Prefer this caller's visible native control over an older blank view.
  // The actual click retains its ordinary strictness, enabled wait and errors.
  if (action) for (const candidate of views) {
    if (!candidate.url().startsWith(`chrome-extension://${extensionId}/`)) continue;
    try {
      if (await action(candidate).isVisible()) {
        popup = candidate; selectedAction = true;
        selection = candidate.url().includes("notification.html") ? "existing-notification" : "existing-extension";
        break;
      }
    } catch { /* Closed or ambiguous views retain the ordinary fallback. */ }
  }
  if (!popup) popup = views.find(candidate => candidate.url().includes("notification.html"));
  if (!popup) {
    popup = context.pages().find(candidate => candidate.url().startsWith(`chrome-extension://${extensionId}/`));
    selection = "existing-extension";
  }
  if (!popup) { popup = await context.newPage(); selection = "created"; }
  try { observe?.({ notificationSelection: selection,
    notificationViewCount: views.filter(candidate => candidate.url().includes("notification.html")).length }); }
  catch { /* Optional observations never change native request selection. */ }
  // Keep a native request view that is already open: reloading it races the
  // extension's own request navigation. Foreground the view so headed Linux
  // Chromium can render and interact with its controls normally.
  await popup.bringToFront();
  if (!selectedAction && !popup.url().includes("notification.html")) {
    await popup.goto(`chrome-extension://${extensionId}/notification.html`, { waitUntil: "domcontentloaded" });
  }
  popup.setDefaultTimeout(30000);
  return popup;
}

export async function switchLocalNetwork(page: Page, chainId: number) {
  const current = await page.evaluate(() => (window as unknown as { ethereum: { request: (input: unknown) => Promise<unknown> } }).ethereum.request({ method: "eth_chainId" }));
  if (current === `0x${chainId.toString(16)}`) return;
  const pending = page.evaluate(id => (window as unknown as {
    ethereum: { request: (input: unknown) => Promise<unknown> };
  }).ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${id.toString(16)}` }] }), chainId);
  void pending.catch(() => undefined);
  const popup = await notification(page);
  await popup.getByTestId("confirm-footer-button").click();
  await pending;
}

export async function connectWallet(page: Page) {
  const menu = page.getByRole("button", { name: "Open wallet menu" });
  if (await menu.isVisible()) return;
  const popup = await notification(page);
  const confirm = popup.getByTestId("confirm-btn");
  await expect.poll(async () => await menu.isVisible() || await confirm.isVisible(), { timeout: 15000 }).toBeTruthy();
  if (await menu.isVisible()) return;
  await confirm.click();
}

export async function requestConnection(page: Page) {
  const option = page.getByRole("button", { name: /^MetaMask\b/ });
  const connected = page.getByRole("button", { name: "Open wallet menu" });
  const ready = async () => {
    if (await option.isVisible() || await connected.isVisible()) return true;
    for (const popup of page.context().pages().filter(candidate => candidate.url().includes("notification.html"))) {
      if (await popup.getByTestId("confirm-btn").isVisible()) return true;
    }
    return false;
  };
  // A connected wallet or an open chooser/prompt already satisfies this step.
  // Bound ordinary UI actions by the existing connection-readiness allowance,
  // including when the regression project's action timeout is unlimited.
  if (await connected.isVisible()) return;
  if (!await ready()) await page.getByRole("button", { name: "Connect Wallet", exact: true }).first().click({ timeout: 15000 });
  await expect.poll(ready, { timeout: 15000 }).toBeTruthy();
  if (await option.isVisible()) await option.click({ timeout: 15000 });
}
