import { expect, test, type Page } from "./fixtures/app-test";
import type { EconomicRequest } from "../../app/utils/economicQuotes";
import { protocolAddresses, tokenAddresses } from "../fixtures/protocol-configuration";
import { installProviderSelection, selectionOwner } from "../fixtures/provider-selection";
import { context } from "./fixtures/token-quotes";
import { universalFixture } from "./fixtures/universal-exact-input";
import { selectBasket } from "./fixtures/swap-selection";

const unit = 10n ** 18n;
const success = <T,>(value: T) => ({ status: "success", value });
const assets = [tokenAddresses.PAXG, tokenAddresses.XAUT];

/** Transport examples exercise actual budget/funding UI wiring, not the Quoter's capacity solver. */
async function capacityQuote(page: Page, intent: 2 | 3, insufficientAtPreflight = false) {
  const observed = await installProviderSelection(page, "core");
  const requests: EconomicRequest[] = [];
  let held = false, preflights = 0;
  const releases: (() => void)[] = [];
  await page.route("**/api/protocol/facts", route => route.fulfill({ json: {
    core: protocolAddresses.core, helpers: protocolAddresses.helpers,
    context, basketModel: { context, state: { assets, weights: ["600000", "400000"],
      conversions: [String(20n * unit), String(20n * 10n ** 30n)], issueFee: "1000", helperFee: "0", redeemFee: "1000",
      supply: String(50n * unit), maxSupply: String(250n * unit), effectiveCap: String(250n * unit),
      available: [String(20n * unit), "10000000"], recoveryShares: [], recoveryValues: [],
      descriptors: assets.map(token => ({ kind: 0, token, id: "0" })) } },
    basket: { assets: success(assets), targetsPpm: success(["600000", "400000"]),
      goldRefGramsFp18: success([String(40n * unit), String(40n * 10n ** 30n)]),
      cygldPerUnitFp18: success([String(20n * unit), String(20n * 10n ** 30n)]),
      metadata: [{ address: assets[0], decimals: success(18), name: success("PAX Gold"), symbol: success("PAXG") },
        { address: assets[1], decimals: success(6), name: success("Tether Gold"), symbol: success("XAUt") }] },
    reference: success(String(2n * unit)), fees: { issuancePpm: success("1000"), helpersPpm: success("0") }, pause: success(false),
  } }));
  await page.route("**/api/account/wallet-balances*", route => {
    const fresh = new URL(route.request().url()).searchParams.get("purpose") === "swap-preflight";
    if (fresh) preflights++;
    return route.fulfill({ json: { context, holder: selectionOwner, native: success(String(100n * unit)), tokens: [
      { id: "paxg", address: assets[0], balance: success(String((fresh && insufficientAtPreflight && intent === 2 ? 5n : 7n) * unit)) },
      { id: "xaut", address: assets[1], balance: success("5000000") },
      { id: "cygld", address: protocolAddresses.core, balance: success(String((fresh && insufficientAtPreflight && intent === 3 ? 4n : 6n) * unit)) },
    ] } });
  });
  await page.route("**/api/economic-quotes", async route => {
    const request = route.request().postDataJSON() as EconomicRequest;
    if (request.intent !== intent) return route.fallback();
    requests.push(request);
    if (held) await new Promise<void>(resolve => releases.push(resolve));
    const funded = intent === 2 ? [{ currency: assets[0], amount: String(6n * unit) },
      { currency: assets[1], amount: "4000000" }] : [{ currency: protocolAddresses.core!, amount: String(5n * unit) }];
    await route.fulfill({ json: universalFixture({ ...request, inputs: funded,
      recipient: selectionOwner, deadline: "2000000000" }, { basketAssets: assets,
      quotedOutput: intent === 2 ? String(1998n * unit / 10n) : "0",
      coreProtocolFeeCygld: intent === 2 ? String(unit / 5n) : String(unit / 200n),
      recipientOutputs: intent === 3 ? [
        { kind: 0, token: assets[0], id: "0", amount: "149850000000000000" },
        { kind: 0, token: assets[1], id: "0", amount: "99900" },
      ] : undefined }) });
  });
  // Stop after observing the actual selected quote sent for preparation. No
  // signature or transaction is needed to establish the accepted funding.
  await page.route("**/api/tx-preparations", route => route.fulfill({ status: 503,
    json: { code: "quote-service-unavailable", error: "Controlled preparation observation." } }));
  return { requests, preparations: observed.preparations, preflights: () => preflights,
    hold: () => { held = true; }, release: () => { held = false; releases.splice(0).forEach(resolve => resolve()); } };
}

async function enterBudget(page: Page, intent: 2 | 3) {
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  if (intent === 3) await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await selectBasket(page, intent === 2 ? "sell" : "buy");
  const input = intent === 2 ? page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true }) : page.locator("#sell-amount");
  await input.fill("100");
  return input;
}

for (const intent of [2, 3] as const) test(`capacity-limited basket intent ${intent} preserves budget, displayed funding and preparation across reload`, async ({ page }) => {
  const observed = await capacityQuote(page, intent);
  const input = await enterBudget(page, intent);
  const spending = page.getByTestId("purchase-spending");
  const value = spending.locator("[data-trade-spending-value]");
  const actual = intent === 2 ? "6 PAXG + 4 XAUt" : "5 CYGLD";
  await expect(value).toHaveText(actual);
  await expect(value).toHaveAttribute("data-limited", "true");
  await expect(input).toHaveValue("100");
  await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "confirmed");
  if (intent === 2) await expect(page.locator("#buy-amount")).toHaveText("199.8");
  await expect(page.locator("#purchase-cap-warning")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  const budget = structuredClone(observed.requests.at(-1)!.inputs);
  expect(budget[0].amount).toBe(String(100n * unit));
  observed.hold();
  try {
    await page.reload();
    await expect.poll(() => observed.requests.length).toBe(2);
    await expect(spending).toBeVisible();
    await expect(value).toHaveText(actual);
    await expect(input).toHaveValue("100");
    observed.release();
    await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Swap currencies", exact: true }).click();
    await expect.poll(() => observed.preparations.length).toBe(1);
    const selected = observed.preparations[0].quote as { request: EconomicRequest; inputs: EconomicRequest["inputs"] };
    expect(selected.request.inputs).toEqual(budget);
    expect(selected.inputs.map(row => row.amount)).toEqual(intent === 2 ? [String(6n * unit), "4000000"] : [String(5n * unit)]);
    expect(observed.preflights()).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __selectionWalletCalls: { method: string }[] }).__selectionWalletCalls
      .some(row => row.method === "eth_sendTransaction" || row.method === "eth_signTypedData_v4"))).toBe(false);
  } finally { observed.release(); }
});

for (const intent of [2, 3] as const) test(`capacity-limited basket intent ${intent} still rejects a fresh balance below selected funding`, async ({ page }) => {
  const observed = await capacityQuote(page, intent, true);
  await enterBudget(page, intent);
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled();
  await swap.click();
  await expect.poll(observed.preflights).toBe(1);
  await expect(page.locator("[data-sonner-toast]")).toContainText(intent === 2 ? "PAXG" : "CYGLD");
  expect(observed.preparations).toHaveLength(0);
  expect(await page.evaluate(() => (window as unknown as { __selectionWalletCalls: { method: string }[] }).__selectionWalletCalls
    .some(row => row.method === "eth_sendTransaction" || row.method === "eth_signTypedData_v4"))).toBe(false);
});
