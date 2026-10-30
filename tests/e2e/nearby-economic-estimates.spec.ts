import { expect, test, type Page } from "./fixtures/app-test";
import { context, install } from "./fixtures/token-quotes";
import { selectToken, showAllSellTokens } from "../metamask/token-flows/helpers";
import { economicFixture } from "./fixtures/economic-api";
import { universalFixture } from "./fixtures/universal-exact-input";
import { protocolConfigurationFixture as config } from "../fixtures/protocol-configuration";
import type { EconomicQuote, EconomicRequest } from "../../app/utils/economicQuotes";

const unit = 10n ** 18n, owner = "0x0000000000000000000000000000000000000011";
const fees = { coreProtocolFeeCygld: String(unit / 50n), coreHelpersFeeCygld: String(unit / 100n), marketFeeCygld: String(unit * 3n / 100n) };
const deferred = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };

async function readOnlyWallet(page: Page) {
  await page.addInitScript(({ owner, chain }) => {
    const methods: string[] = [];
    const provider = { isMetaMask: false, selectedAddress: owner, on: () => {}, removeListener: () => {},
      request: async ({ method }: { method: string }) => {
        methods.push(method);
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [owner];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts",
          caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        throw new Error(`Read-only arithmetic fixture rejects ${method}`);
      } };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    Object.assign(window, { __estimateWalletMethods: methods });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "Synthetic ordinary wallet", rdns: "io.synthetic.ordinary",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner, chain: config.chainId });
  await page.route("**/api/account/wallet-balances*", route => route.fulfill({ json: {
    holder: owner, context, native: { status: "success", value: String(100n * unit) },
    tokens: config.tokens.filter(token => token.type === "erc20").map(token => ({ id: token.id, address: token.address,
      balance: { status: "success", value: String(100n * unit) } })),
  } }));
  await page.route("**/api/account/native-balance*", route => route.fulfill({ json: { holder: owner, context, balance: String(100n * unit) } }));
  await page.route("**/api/transaction/fees", route => route.fulfill({ json: {
    context, maxFeePerGas: "2000000000", maxPriorityFeePerGas: "1000000000",
  } }));
}

function observation(request: EconomicRequest, output: bigint, consumed = unit): EconomicQuote {
  const value = economicFixture(universalFixture({ ...request, recipient: owner, deadline: "2000000000" },
    { routeFamily: "mixed", quotedOutput: String(output), ...fees }), request);
  return { ...value, reuseSample: { referenceInput: String(consumed), netOutput: String(output), fees, basis: "observed-nonretained" } };
}

for (const { symbol, consumed, expected, side } of [
  { symbol: "PAXG", consumed: unit, expected: "9", side: "buy" },
  { symbol: "ETH", consumed: unit, expected: "9", side: "buy" },
  { symbol: "PAXG", consumed: unit * 6n / 10n, expected: "10", side: "buy" },
  { symbol: "PAXG", consumed: unit, expected: "9", side: "sell" },
]) test(`${side} ${symbol}, consumed ${consumed}: immediate cached arithmetic precedes debounce and exact work`, async ({ page }) => {
  await install(page); await readOnlyWallet(page);
  const exact = deferred(), estimate = deferred(), requests: EconomicRequest[] = [], estimateRequests: string[] = [];
  const preparations: { quote: EconomicQuote; acceptedBounds: { minimumOutput: string; inputs: EconomicRequest["inputs"] } }[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/economic-estimates", async route => {
    const input = route.request().postDataJSON(); estimateRequests.push(input.amount);
    if (input.amount !== String(unit)) await estimate.promise;
    await route.fulfill({ json: { namespace: "trade", intent: input, models: [] } });
  });
  await page.route("**/api/economic-quotes", async route => {
    const input: EconomicRequest & { refresh?: boolean } = route.request().postDataJSON(); requests.push(input);
    if (input.refresh) { await route.fulfill({ status: 503, json: { code: "quote-timeout", error: "Controlled Refresh failure." } }); return; }
    if (input.inputs[0].amount !== String(unit)) await exact.promise;
    await route.fulfill({ json: observation(input, input.inputs[0].amount === String(unit) ? 10n * unit : unit * 85n / 10n, consumed) });
  });
  await page.route("**/api/tx-preparations", async route => {
    preparations.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { code: "quote-unavailable", error: "Read-only preparation capture." } });
  });
  try {
    await page.goto("/en");
    await expect(page.getByRole("button", { name: "Open wallet menu", exact: true })).toBeVisible();
    await showAllSellTokens(page); await selectToken(page, "sell", symbol);
    if (side === "sell") await page.getByRole("button", { name: "Reverse swap direction" }).click();
    await page.locator("#sell-amount").fill("1");
    await expect(page.locator("#buy-amount")).toHaveText("10");
    await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "confirmed");
    await expect(page.locator("[data-trade-action]")).toBeEnabled();
    await page.getByRole("button", { name: /Total fee/ }).click();
    await page.clock.install(); const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(new Date(now + 1000));
    await page.locator("#sell-amount").fill("0.9");
    await expect.poll(async () => { await page.clock.runFor(0); return page.locator("#buy-amount").textContent(); }).toBe(expected);
    expect(requests).toHaveLength(1);
    await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
    await expect(page.locator("[data-trade-action]")).toBeDisabled();
    await expect(page.getByTestId("swap-minimum-output")).toContainText("...");
    await expect(page.locator('[data-trade-display="feeApplicationValue"]')).toHaveText(consumed === unit ? "0.027 CYGLD" : "0.03 CYGLD");
    await expect(page.locator('[data-trade-display="feeApplicationValue"]')).toHaveClass(/text-text-input-disabled/);
    expect(preparations).toEqual([]);
    await page.clock.runFor(150);
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].inputs[0].amount).toBe(String(unit * 9n / 10n));
    await expect(page.locator("#buy-amount")).toHaveText(expected);
    exact.release(); await page.clock.runFor(0);
    await expect.poll(async () => { await page.clock.runFor(0); return page.locator("#buy-amount").textContent(); }).toBe("8.5");
    await expect(page.locator("[data-trade-action]")).toBeEnabled();
    await expect(page.getByTestId("swap-minimum-output")).toContainText(`8.415 ${side === "buy" ? "CYGLD" : "PAXG"}`);
    await page.locator("[data-trade-refresh]").click();
    await expect.poll(async () => { await page.clock.runFor(0); return page.getByRole("alert").filter({ hasText: "Refresh failed. Showing the previous quote." }).count(); }).toBe(1);
    await expect(page.locator("#buy-amount")).toHaveText("8.5");
    await expect(page.locator('[data-trade-display="feeApplicationValue"]')).toHaveText("0.03 CYGLD");
    await expect(page.locator("[data-trade-action]")).toBeEnabled();
    if (symbol === "PAXG" && consumed === unit && side === "buy") {
      await page.locator("[data-trade-action]").click();
      await expect.poll(() => preparations.length).toBe(1);
      expect(preparations[0].quote.quotedOutput).toBe(String(unit * 85n / 10n));
      expect(preparations[0].acceptedBounds.minimumOutput).toBe(String(unit * 8415n / 1000n));
      expect(preparations[0].acceptedBounds.inputs[0].amount).toBe(String(unit * 9n / 10n));
    }
    expect(errors).toEqual([]);
    await test.info().attach("cached-arithmetic-before-exact", { contentType: "application/json", body: JSON.stringify({ symbol, side,
      consumed: String(consumed), requested: String(unit), edited: String(unit * 9n / 10n), hint: expected, exact: "8.5",
      requests, estimateRequests, scope: "Actual App, paused debounce, held estimator/exact replies and synthetic read-only wallet; no chain execution." }) });
  } finally { exact.release(); estimate.release(); }
});

test("cold-tab Backend hints follow the edited amount; late hints cannot replace it or enable Swap", async ({ page }) => {
  await install(page); await readOnlyWallet(page);
  const exact = deferred(), oldEstimate = deferred(); let requestCount = 0;
  await page.route("**/api/economic-quotes", async route => {
    await exact.promise;
    await route.fulfill({ status: 503, json: { code: "quote-no-route", error: "Held exact fixture." } });
  });
  await page.route("**/api/economic-estimates", async route => {
    const input = route.request().postDataJSON(); requestCount++;
    if (input.amount === String(unit * 9n / 10n)) await oldEstimate.promise;
    const amount = BigInt(input.amount) * 8n;
    await route.fulfill({ json: { namespace: "trade", intent: input, models: [], estimate: {
      strategy: "universal", source: "cached-upper", amount: String(amount), referenceInput: input.amount,
      basis: "observed-nonretained", fees, context,
    } } });
  });
  try {
    await page.goto("/en"); await expect(page.getByRole("button", { name: "Open wallet menu", exact: true })).toBeVisible();
    await page.locator("#sell-amount").fill("0.9"); await expect.poll(() => requestCount).toBeGreaterThan(0);
    await page.locator("#sell-amount").fill("0.8");
    await expect(page.locator("#buy-amount")).toHaveText("6.4");
    await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
    await expect(page.locator("[data-trade-action]")).toBeDisabled();
    oldEstimate.release();
    await expect(page.locator("#buy-amount")).toHaveText("6.4");
    await expect(page.getByTestId("swap-minimum-output")).toContainText("...");
    await page.locator("#sell-amount").fill("");
    await expect(page.locator("#buy-amount")).toHaveText(/^(0(?:[.,]0+)?|\.\.\.)$/);
  } finally { oldEstimate.release(); exact.release(); }
});
