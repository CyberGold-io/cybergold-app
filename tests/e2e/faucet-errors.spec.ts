import { expect, test, type Page, type Route } from "./fixtures/app-test";

const account = "0x00000000000000000000000000000000000000a1";
const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const reference = "9d4bf37d-70af-4b6b-9b29-493af12d15b2";
const privateMessage = "private faucet URL, provider response, and traceback";
const labels = {
  en: {
    menu: "Open wallet menu", close: "Close balances", fund: "Fund wallet", funded: "Wallet funded",
    unavailable: "The funding service is temporarily unavailable.", quota: "The funding limit has been reached.",
    retry: "Try again in 60 seconds.", uncertain: "Wallet funding could not be confirmed. Check your balance.",
    copy: "Copy reference", copied: "Reference copied", reference: `Reference: ${reference}`,
  },
  fr: {
    menu: "Ouvrir le menu du portefeuille", close: "Fermer les soldes", fund: "Approvisionner", funded: "Portefeuille approvisionné",
    unavailable: "Le service d’approvisionnement est temporairement indisponible.", quota: "La limite d’approvisionnement a été atteinte.",
    retry: "Réessayez dans 60 secondes.", uncertain: "L’approvisionnement n’a pas pu être confirmé. Vérifiez votre solde.",
    copy: "Copier la référence", copied: "Référence copiée", reference: `Référence : ${reference}`,
  },
};
type Locale = keyof typeof labels;
type FundingRequest = { address: string; requestId: string };
type FaucetHandler = (route: Route, attempt: number) => Promise<void>;

async function install(page: Page, handleFaucet: FaucetHandler) {
  await page.addInitScript(({ account, chain }) => {
    const provider = {
      isMetaMask: true, selectedAddress: account,
      request: async ({ method }: { method: string }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [account];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts",
          caveats: [{ type: "restrictReturnedAccounts", value: [account] }] }];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        if (method === "eth_getBalance") return "0x0";
        throw new Error(`Synthetic wallet rejects ${method}`);
      },
      on: () => {}, removeListener: () => {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "MetaMask", rdns: "io.metamask",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
    const copies: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { writeText: async (value: string) => { copies.push(value); } } });
    Object.assign(window, { __faucetReferenceCopies: copies });
  }, { account, chain });
  const requests: FundingRequest[] = [];
  const context = { chainId: chain, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`,
    blockTimestamp: "1790800000", observedAt: "2026-10-01T00:00:00Z" };
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:3000").origin;
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/api/faucet") {
      expect(request.method()).toBe("POST");
      expect(request.headers()["authorization"]).toBeUndefined();
      requests.push(request.postDataJSON());
      await handleFaucet(route, requests.length);
    } else if (url.pathname === "/api/account/wallet-balances") {
      await route.fulfill({ json: { context, holder: account,
        native: { status: "success", value: "3000000000000000000" }, tokens: [] } });
    } else if (url.pathname === "/api/account/native-balance") {
      await route.fulfill({ json: { context, holder: account, balance: "3000000000000000000" } });
    } else if (url.pathname === "/api/account/ens-name") {
      await route.fulfill({ json: { context, holder: account, name: null } });
    } else if (url.pathname === "/api/diagnostics") {
      await route.fulfill({ status: 202, json: { accepted: true } });
    } else if (url.pathname.startsWith("/api/")) {
      await route.fulfill({ status: 503, json: { error: "Unrelated fixture API unavailable" } });
    } else if (url.origin !== origin) await route.abort();
    else await route.continue();
  });
  return requests;
}

async function openWallet(page: Page, locale: Locale = "en") {
  await page.goto(`/${locale}`);
  await page.getByRole("button", { name: labels[locale].menu, exact: true }).click();
  const panel = page.getByTestId("wallet-balance-modal");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: labels[locale].fund, exact: true })).toBeEnabled();
  return panel;
}

for (const locale of ["en", "fr"] as const) {
  test(`${locale} faucet service failure shows a translated message and safe reference`, async ({ page }) => {
    const requests = await install(page, route => route.fulfill({ status: 502,
      json: { code: "BAD_GATEWAY", error: privateMessage, correlationId: reference } }));
    const panel = await openWallet(page, locale);
    await panel.getByRole("button", { name: labels[locale].fund, exact: true }).click();
    const feedback = panel.getByRole("alert");
    await expect(feedback).toContainText(labels[locale].unavailable);
    await expect(feedback).toContainText(labels[locale].reference);
    await expect(page.locator("[data-sonner-toast]")).toContainText(labels[locale].unavailable);
    await expect(page.getByText(privateMessage, { exact: false })).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].address.toLowerCase()).toBe(account);
    expect(requests[0].requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test(`${locale} faucet quota failure preserves the retry delay and replaces the rejected request identity`, async ({ page }) => {
    const requests = await install(page, route => route.fulfill({ status: 429,
      headers: { "Retry-After": "60", "X-CyberGold-Faucet-Request-Id": "replace" },
      json: { code: "ADDRESS_QUOTA_EXHAUSTED", error: privateMessage, correlationId: reference } }));
    const panel = await openWallet(page, locale);
    const fund = panel.getByRole("button", { name: labels[locale].fund, exact: true });
    await fund.click();
    await expect(panel.getByRole("alert")).toContainText(labels[locale].quota);
    await expect(panel.getByRole("alert")).toContainText(labels[locale].retry);
    await fund.click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(fund).toBeEnabled();
    expect(requests[1].requestId).not.toBe(requests[0].requestId);
    await expect(page.getByText(privateMessage, { exact: false })).toHaveCount(0);
  });
}

for (const code of ["REQUEST_UNCERTAIN", "TIMEOUT"] as const) {
  test(`faucet ${code} reports unconfirmed funding and retains the pending identity`, async ({ page }) => {
    const requests = await install(page, route => route.fulfill({ status: code === "TIMEOUT" ? 504 : 409,
      json: { code, error: privateMessage, correlationId: reference } }));
    const panel = await openWallet(page);
    const fund = panel.getByRole("button", { name: labels.en.fund, exact: true });
    await fund.click();
    await expect(panel.getByRole("alert")).toContainText(labels.en.uncertain);
    await fund.click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(fund).toBeEnabled();
    expect(requests[1].requestId).toBe(requests[0].requestId);
    await expect(page.getByText("Test funds could not be added. Try again later.", { exact: true })).toHaveCount(0);
  });
}

test("a malformed faucet response reports unconfirmed funding and keeps its request identity", async ({ page }) => {
  const requests = await install(page, route => route.fulfill({ status: 502,
    contentType: "text/html", body: "<html>private upstream traceback</html>" }));
  const panel = await openWallet(page);
  const fund = panel.getByRole("button", { name: labels.en.fund, exact: true });
  await fund.click();
  await expect(panel.getByRole("alert")).toContainText(labels.en.uncertain);
  await expect(panel.getByRole("button", { name: labels.en.copy, exact: true })).toHaveCount(0);
  await expect(page.getByText("private upstream traceback", { exact: false })).toHaveCount(0);
  await fund.click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(fund).toBeEnabled();
  expect(requests[1].requestId).toBe(requests[0].requestId);
});

test("pending funding survives wallet-panel reopening and a confirmed success clears the identity", async ({ page }) => {
  const requests = await install(page, (route, attempt) => route.fulfill(attempt === 1
    ? { status: 409, json: { code: "REQUEST_IN_PROGRESS", error: privateMessage, correlationId: reference } }
    : { json: { address: account, ethWei: "10000000000000000000", tokens: [] } }));
  const panel = await openWallet(page);
  await panel.getByRole("button", { name: labels.en.fund, exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Your funding request is still being processed.");
  await page.getByRole("button", { name: labels.en.close, exact: true }).first().click();
  await expect(panel).not.toBeVisible();
  await page.getByRole("button", { name: labels.en.menu, exact: true }).click();
  const fund = panel.getByRole("button", { name: labels.en.fund, exact: true });
  await fund.click();
  await expect(page.getByText(labels.en.funded, { exact: true })).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1].requestId).toBe(requests[0].requestId);
  await fund.click();
  await expect.poll(() => requests.length).toBe(3);
  await expect(fund).toBeEnabled();
  expect(requests[2].requestId).not.toBe(requests[1].requestId);
});

for (const outcome of ["copied", "failed"] as const) {
  test(`an older reference copy that ${outcome} cannot change the newer failure's copy feedback`, async ({ page }) => {
    const nextReference = "bc0e1c4b-6ecd-4fe5-b02d-17ff29e6b2c4";
    const requests = await install(page, (route, attempt) => route.fulfill({ status: 502,
      json: { code: "BAD_GATEWAY", error: privateMessage, correlationId: attempt === 1 ? reference : nextReference } }));
    const panel = await openWallet(page);
    await page.evaluate(outcome => {
      Object.defineProperty(navigator, "clipboard", { configurable: true,
        value: { writeText: (value: string) => new Promise<void>((resolve, reject) => {
          const state = window as unknown as { __faucetReferenceCopies: string[]; __finishFaucetReferenceCopy: () => void };
          state.__faucetReferenceCopies.push(value);
          state.__finishFaucetReferenceCopy = () => outcome === "copied" ? resolve() : reject(new Error("Fixture clipboard refusal"));
        }) } });
    }, outcome);
    const fund = panel.getByRole("button", { name: labels.en.fund, exact: true });
    await fund.click();
    await panel.getByRole("button", { name: labels.en.copy, exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { __faucetReferenceCopies: string[] }).__faucetReferenceCopies)).toEqual([reference]);
    await fund.click();
    const feedback = panel.getByRole("alert");
    await expect(feedback).toContainText(`Reference: ${nextReference}`);
    await page.evaluate(async () => {
      (window as unknown as { __finishFaucetReferenceCopy: () => void }).__finishFaucetReferenceCopy();
      // Let the deferred clipboard handler and React render its completion.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await expect(feedback.getByRole("button", { name: labels.en.copy, exact: true })).toBeVisible();
    await expect(feedback).not.toContainText(labels.en.copied);
    await expect(feedback).not.toContainText("The reference could not be copied.");
    expect(requests).toHaveLength(2);
  });
}

for (const width of [320, 1280]) {
  test(`French faucet reference remains copyable inside the wallet panel at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const requests = await install(page, route => route.fulfill({ status: 502,
      json: { code: "BAD_GATEWAY", error: privateMessage, correlationId: reference } }));
    const panel = await openWallet(page, "fr");
    await panel.getByRole("button", { name: labels.fr.fund, exact: true }).click();
    const feedback = panel.getByRole("alert");
    await expect(feedback).toContainText(labels.fr.reference);
    const copy = feedback.getByRole("button", { name: labels.fr.copy, exact: true });
    await copy.click();
    await expect(feedback).toContainText(labels.fr.copied);
    expect(await page.evaluate(() => (window as unknown as { __faucetReferenceCopies: string[] }).__faucetReferenceCopies)).toEqual([reference]);
    expect(requests).toHaveLength(1);
    expect(await feedback.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const screenshot = await page.screenshot({ path: `out/audit/faucet-errors/${width}-fr-synthetic.png`, fullPage: true });
    await test.info().attach("synthetic-faucet-reference-fr", { body: screenshot, contentType: "image/png" });
  });
}
