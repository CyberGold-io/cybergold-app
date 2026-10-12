import { expect, type Page } from "@playwright/test";

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

export async function notification(page: Page) {
  const context = page.context();
  const extensionId = new URL(context.serviceWorkers()[0].url()).host;
  const popup = context.pages().find(candidate => candidate.url().includes("notification.html"))
    ?? context.pages().find(candidate => candidate.url().startsWith(`chrome-extension://${extensionId}/`))
    ?? await context.newPage();
  // Keep a native request view that is already open: reloading it races the
  // extension's own request navigation. Foreground the view so headed Linux
  // Chromium can render and interact with its controls normally.
  await popup.bringToFront();
  if (!popup.url().includes("notification.html")) {
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
  await page.getByRole("button", { name: "Connect Wallet", exact: true }).first().click();
  const option = page.getByRole("button", { name: /^MetaMask\b/ });
  const connected = page.getByRole("button", { name: "Open wallet menu" });
  await expect.poll(async () => {
    if (await option.isVisible() || await connected.isVisible()) return true;
    for (const popup of page.context().pages().filter(candidate => candidate.url().includes("notification.html"))) {
      if (await popup.getByTestId("confirm-btn").isVisible()) return true;
    }
    return false;
  }, { timeout: 15000 }).toBeTruthy();
  if (await option.isVisible()) await option.click();
}
