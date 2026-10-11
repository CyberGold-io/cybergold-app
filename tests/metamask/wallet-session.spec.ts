import type { Page } from "@playwright/test";
import { expect, test } from "./testWithMetaMask";
import { addLocalNetwork, connectWallet, notification, requestConnection, switchLocalNetwork } from "./wallet-ui";

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "1");

// These session tests use new local Anvil nodes and the disposable Synpress
// wallet. Product-data outages are explicit fixtures; no installed backend or
// funded protocol account is needed and no transaction is signed or submitted.
async function installProductOutage(page: Page) {
  const genericRequests: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/rpc") genericRequests.push(request.url());
  });
  await page.route("**/api/**", route => route.fulfill({
    status: 503, json: { error: "Product data unavailable in wallet-session fixture." },
  }));
  return genericRequests;
}


test("MetaMask connection survives reload, disconnect and reconnect", async ({ page, createAnvilNode }) => {
  const genericRequests = await installProductOutage(page);
  const node = await createAnvilNode({ chainId });
  await page.goto("/en");
  await addLocalNetwork(page, node, "CyberGold Session Anvil");
  await switchLocalNetwork(page, node.chainId);
  await requestConnection(page);
  await connectWallet(page);
  const menu = page.getByRole("button", { name: "Open wallet menu" });
  await expect(menu).toBeVisible({ timeout: 20000 });
  await page.reload();
  await expect(menu).toBeVisible({ timeout: 20000 });
  await menu.click();
  await page.getByRole("button", { name: "Disconnect wallet", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await requestConnection(page);
  // MetaMask may retain the origin permission after a DApp disconnect. The
  // app must reconnect either way; approve only if a new prompt appears.
  await connectWallet(page);
  await expect(menu).toBeVisible({ timeout: 20000 });
  expect(genericRequests).toEqual([]);
});

test("MetaMask connection rejection can be retried", async ({ page, createAnvilNode }) => {
  const genericRequests = await installProductOutage(page);
  const node = await createAnvilNode({ chainId });
  await page.goto("/en");
  await addLocalNetwork(page, node, "CyberGold Session Anvil");
  await requestConnection(page);
  const popup = await notification(page);
  await popup.getByTestId("cancel-btn").click();
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect Wallet", exact: true })).toBeEnabled();
  const close = page.getByRole("button", { name: "Close", exact: true });
  if (await close.isVisible()) await close.click();
  await requestConnection(page);
  await connectWallet(page);
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible({ timeout: 20000 });
  expect(genericRequests).toEqual([]);
});


test("MetaMask wrong-network controls recover to the configured chain", async ({ page, createAnvilNode }) => {
  const genericRequests = await installProductOutage(page);
  const node = await createAnvilNode({ chainId });
  const other = await createAnvilNode({ chainId: chainId + 1 });
  await page.goto("/en");
  await addLocalNetwork(page, node, "CyberGold Session Anvil");
  await requestConnection(page);
  await connectWallet(page);
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible({ timeout: 20000 });
  await addLocalNetwork(page, other, "CyberGold Other Anvil");
  await switchLocalNetwork(page, other.chainId);
  const recovery = page.getByRole("button", { name: /^Use / });
  await expect(recovery).toBeVisible();
  await recovery.click();
  await expect.poll(async () => {
    if (await recovery.count() === 0) return true;
    const popup = page.context().pages().find(candidate => candidate.url().includes("notification.html"));
    const confirm = popup?.getByTestId("confirm-footer-button");
    if (confirm && await confirm.isVisible()) await confirm.click();
    return false;
  }, { timeout: 20000 }).toBeTruthy();
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  const selected = await page.evaluate(() => (window as unknown as { ethereum: { request: (input: unknown) => Promise<unknown> } }).ethereum.request({ method: "eth_chainId" }));
  expect(selected).toBe(`0x${chainId.toString(16)}`);
  expect(genericRequests).toEqual([]);
});
