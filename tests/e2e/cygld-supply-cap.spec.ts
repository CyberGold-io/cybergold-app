import { expect, test, type Page } from "./fixtures/app-test";
import { asset, choose, context, install } from "./fixtures/token-quotes";
import { intentFixture } from "./fixtures/quote-intent";
import type { QuoteIntentRequest } from "../../app/utils/quoteIntent";
import type { BasketPreviewRequest } from "../../app/utils/basketPreview";
import { routeWalletBalances } from "./fixtures/wallet-balances";
import { selectBasket } from "./fixtures/swap-selection";
import { coreIntentRequest, routeCoreIntent } from "./fixtures/trade-core";
import { marketTradeFixture } from "./fixtures/market-quotes";
import { protocolAddresses } from "../fixtures/protocol-configuration";

const success = <T,>(value: T) => ({ status: "success", value });
const unit = 10n ** 18n;

async function installReadOnlyWallet(page: Page) {
  const owner = "0x0000000000000000000000000000000000000011";
  const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
  await page.addInitScript(({ owner, chain }) => {
    const provider = { isMetaMask: false, selectedAddress: owner,
      request: async ({ method }: { method: string }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [owner];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts",
          caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        throw new Error(`Synthetic read-only wallet rejects ${method}`);
      }, on: () => {}, removeListener: () => {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "Synthetic ordinary wallet", rdns: "io.synthetic.ordinary",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner, chain });
  await routeWalletBalances(page, route => route.fulfill({ json: { context, holder: owner,
    native: { status: "success", value: String(1000n * unit) },
    tokens: [{ id: "weth", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      balance: { status: "success", value: String(1000n * unit) } },
      { id: "cygld", address: protocolAddresses.core, balance: success(String(1000n * unit)) }],
  } }));
}
function supplyState(supply: bigint) {
  return { assets: [asset], weights: ["1000000"], conversions: ["15551738400000000000"],
    issueFee: "1000", helperFee: "0", redeemFee: "1000", supply: String(supply * unit),
    maxSupply: String(250n * unit), effectiveCap: String(250n * unit), available: [String(50n * unit)],
    recoveryShares: [], recoveryValues: [], descriptors: [{ kind: 0, token: asset, id: "0" }] };
}

function cappedIntent(request: QuoteIntentRequest, remainingGross = 200n * unit) {
  const value = intentFixture(request), requestedNet = request.mode === "issue-exact-in"
    ? BigInt(value.displayAmount) : BigInt(request.amount);
  const gross = requestedNet === 0n ? 0n : requestedNet + (requestedNet - 1n) * 1000n / 999000n;
  const remainingNet = remainingGross - remainingGross / 1000n;
  const executedNet = requestedNet > remainingNet ? remainingNet : requestedNet;
  return { ...value, executionAmount: String(executedNet), expectedInputAmount: String(executedNet), requestedNetCygldOut: String(requestedNet),
    requestedGrossCygldOut: String(gross), remainingGrossCapacity: String(remainingGross), remainingNetCapacity: String(remainingNet) };
}

async function routeCapQuotes(page: Page, remainingGross = 200n * unit) {
  const requests: QuoteIntentRequest[] = [];
  await routeCoreIntent(page, route => {
    const request = route.request().postDataJSON() as QuoteIntentRequest; requests.push(request);
    const remainingNet = remainingGross - remainingGross / 1000n;
    const unavailable = request.mode.startsWith("issue") && (remainingNet === 0n ||
      (request.mode === "issue-exact-out" && BigInt(request.amount) > remainingNet));
    const frame = unavailable ? { type: "error", code: "issuance-cap-exceeded",
      error: "Private cap diagnostic", correlationId: "fixture" } : { type: "complete",
      value: request.mode.startsWith("issue") ? cappedIntent(request, remainingGross) : intentFixture(request) };
    return route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify(frame) + "\n" });
  });
  return requests;
}

async function installCapacity(page: Page, initialSupply = 50n, fullModel = true) {
  const observed = await install(page);
  let supply = initialSupply, factsReads = 0;
  await page.route("**/api/protocol/facts", route => {
    factsReads++;
    return route.fulfill({ json: { context: { ...context, blockTimestamp: "1790800000" },
      core: "0x00000000000000000000000000000000000000a1", helpers: "0x00000000000000000000000000000000000000b2",
      basketModel: fullModel ? { context, state: supplyState(supply) } : null,
      ...(!fullModel ? { issuanceCapacity: { totalSupply: success(String(supply * unit)),
        maxTotalSupply: success(String(250n * unit)), effectiveCygldSupplyCap: success(String(250n * unit)) } } : {}),
      basket: { assets: success([asset]), targetsPpm: success(["1000000"]), goldRefGramsFp18: success(["31103476800000000000"]),
        cygldPerUnitFp18: success(["15551738400000000000"]), metadata: [{ address: asset, decimals: success(18), name: success("PAX Gold"), symbol: success("PAXG") }] },
      reference: success("2000000000000000000"), fees: { issuancePpm: success("1000"), helpersPpm: success("0") }, pause: success(false) } });
  });
  return { observed, setSupply: (value: bigint) => { supply = value; }, reads: () => factsReads };
}

async function installTwoAssetBasket(page: Page, xautWalletBalance: bigint, fullModel: boolean) {
  const xaut = "0x68749665ff8d2d112fa859aa293f07a622782f38";
  const assets = [asset, xaut], weights = [600_000n, 400_000n];
  // Both tokens represent 20 CYGLD per token; XAUt uses six token decimals.
  const conversions = [20n * unit, 20n * 10n ** 30n];
  const basketModel = fullModel ? { context, state: { assets, weights: weights.map(String),
    conversions: conversions.map(String), issueFee: "1000", helperFee: "0", redeemFee: "1000",
    supply: String(50n * unit), maxSupply: String(250n * unit), effectiveCap: String(250n * unit),
    available: [String(20n * unit), "10000000"], recoveryShares: [], recoveryValues: [],
    descriptors: assets.map(token => ({ kind: 0, token, id: "0" })),
  } } : null;
  const requests: BasketPreviewRequest[] = [];
  let remainingGross = 200n * unit;
  let head = { ...context };
  const ceiling = (numerator: bigint, denominator: bigint) => (numerator + denominator - 1n) / denominator;
  await install(page, "", undefined, false, assets, () => head);
  await installReadOnlyWallet(page);
  await routeWalletBalances(page, route => route.fulfill({ json: { context,
    holder: "0x0000000000000000000000000000000000000011",
    native: success(String(100n * unit)), tokens: [
      { id: "paxg", address: asset, balance: success(String(20n * unit)) },
      { id: "xaut", address: xaut, balance: success(String(xautWalletBalance)) },
    ],
  } }));
  await page.route("**/api/protocol/facts", route => route.fulfill({ json: {
    context: { ...head, blockTimestamp: "1790800000" },
    core: "0x00000000000000000000000000000000000000a1",
    helpers: "0x00000000000000000000000000000000000000b2", basketModel,
    issuanceCapacity: { totalSupply: success(String(50n * unit)),
      maxTotalSupply: success(String(50n * unit + remainingGross)), effectiveCygldSupplyCap: success(String(50n * unit + remainingGross)) },
    basket: { assets: success(assets), targetsPpm: success(weights.map(String)),
      goldRefGramsFp18: success([String(40n * unit), String(40n * 10n ** 30n)]),
      cygldPerUnitFp18: success(conversions.map(String)), metadata: [
        { address: asset, decimals: success(18), name: success("PAX Gold"), symbol: success("PAXG") },
        { address: xaut, decimals: success(6), name: success("Tether Gold"), symbol: success("XAUt") },
      ] },
    reference: success(String(2n * unit)), fees: { issuancePpm: success("1000"), helpersPpm: success("0") },
    pause: success(false),
  } }));
  await page.route("**/api/quotes/basket-preview", route => {
    const request = route.request().postDataJSON() as BasketPreviewRequest;
    requests.push(request);
    if (request.mode !== "issue-exact-in" && request.mode !== "issue-exact-out") return route.fallback();
    let gross: bigint;
    if (request.mode === "issue-exact-in") {
      const supported = request.maximumAmountsIn.map((amount, index) =>
        BigInt(amount) * conversions[index] / unit * 1_000_000n / weights[index]);
      gross = supported.reduce((smallest, amount) => amount < smallest ? amount : smallest);
      if (gross > remainingGross) return route.fulfill({ status: 422, json: {
        code: "issuance-cap-exceeded", error: "Core issuance capacity exceeded", context: head,
      } });
    } else {
      const net = BigInt(request.netCygldOut);
      gross = net > 0n ? net + (net - 1n) * 1000n / 999_000n : 0n;
    }
    const amounts = weights.map((weight, index) =>
      ceiling(ceiling(gross * weight, 1_000_000n) * unit, conversions[index]));
    return route.fulfill({ json: { mode: request.mode, context: head,
      helpers: "0x00000000000000000000000000000000000000b2", basketModel,
      result: { orderedCoreAssets: assets, amountsInExact: amounts.map(String),
        fees: { protocolFeeCygld: String(gross / 1000n), helperFeeCygld: "0" },
        ...(request.mode === "issue-exact-in" ? { netCygldOut: String(gross - gross / 1000n) } : {}),
      },
    } });
  });
  return { requests, setCapacity: (amount: bigint) => {
    remainingGross = amount;
    head = { ...head, blockHash: `0x${"c".repeat(64)}` };
    if (basketModel) {
      basketModel.context = head;
      basketModel.state.maxSupply = String(50n * unit + amount);
      basketModel.state.effectiveCap = String(50n * unit + amount);
    }
  } };
}

for (const fullModel of [false, true]) for (const scenario of [
  { xautWalletBalance: 2_000_000n, paxgInput: "3", xautInput: "2", netOutput: "99.9", overCap: false },
  { xautWalletBalance: 10_000_000n, paxgInput: "15", xautInput: "10", netOutput: "499.5", overCap: true },
]) test(`${fullModel ? "warm" : "cold"} basket MAX follows wallet proportions independently of Core capacity: ${scenario.xautInput} XAUt`, async ({ page }) => {
  const { requests, setCapacity } = await installTwoAssetBasket(page, scenario.xautWalletBalance, fullModel);
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await page.getByRole("switch", { name: "Show only tokens available in wallet", exact: true }).uncheck();
  await selectBasket(page);
  const paxg = page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true });
  const xaut = page.getByRole("textbox", { name: "Sell amount (XAUt)", exact: true });
  await page.getByRole("button", { name: "Use maximum sell amount", exact: true }).click();
  await expect(paxg).toHaveValue(scenario.paxgInput);
  await expect(xaut).toHaveValue(scenario.xautInput);
  await expect.poll(() => requests.at(-1)).toMatchObject({ mode: "issue-exact-in", maximumAmountsIn: [
    String(BigInt(scenario.paxgInput) * unit), String(BigInt(scenario.xautInput) * 1_000_000n),
  ] });
  await expect(page.getByRole("button", { name: "Use maximum purchase amount", exact: true })).toHaveCount(0);
  if (scenario.overCap) {
    await expect(page.locator("#purchase-cap-warning")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Reduce/ })).toBeDisabled();
  } else {
    await expect(page.locator("#buy-amount")).toHaveValue(scenario.netOutput);
    await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  }
  setCapacity(600n * unit);
  await page.reload();
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await page.getByRole("button", { name: /Total fee/ }).click();
  await page.locator("#execution-tolerance").fill("0.5");
  await page.locator("#execution-tolerance").blur();
  await expect(page.getByRole("slider", { name: "Adjust execution tolerance", exact: true })).toHaveValue("0.5");
  await page.getByRole("button", { name: "Use maximum sell amount", exact: true }).click();
  await expect(paxg).toHaveValue(scenario.paxgInput);
  await expect(xaut).toHaveValue(scenario.xautInput);
  await expect.poll(() => requests.at(-1)).toMatchObject({ mode: "issue-exact-in", maximumAmountsIn: [
    String(BigInt(scenario.paxgInput) * unit), String(BigInt(scenario.xautInput) * 1_000_000n),
  ] });
  await expect(page.locator("#buy-amount")).toHaveValue(scenario.netOutput);
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  expect(requests.every(request => request.mode === "issue-exact-in")).toBe(true);
});

test("cold optional Core capacity does not restrict trading and connected MAX uses the wallet budget", async ({ page }) => {
  await installCapacity(page, 50n, false); await installReadOnlyWallet(page);
  const requests = await routeCapQuotes(page);
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await choose(page, "WETH");
  await expect(page.getByTestId("cygld-purchase-capacity")).toHaveCount(0);
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Use maximum sell amount", exact: true }).click();
  await expect(page.locator("#sell-amount")).toHaveValue("1000");
  await expect(page.locator("#buy-amount")).toHaveValue("199.8");
  await expect.poll(() => requests.at(-1)).toMatchObject({ mode: "issue-exact-in", amount: String(1000n * unit) });
  await expect(page.getByTestId("trade-mechanism")).toHaveCount(0);
  await expect(page.locator("#purchase-cap-warning")).toHaveCount(0);
});

for (const width of [1280, 390]) {
  test(`French specialized basket purchase capacity stays compact at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 920 });
    await installCapacity(page);
    await page.goto("/fr"); await selectBasket(page);
    const note = page.getByTestId("cygld-purchase-capacity");
    await expect(note).toHaveText("Disponible : 199,8 CYGLD");
    await expect(note).toHaveAttribute("title", /Plafond actuel : 250 CYGLD/);
    expect(await note.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `out/audit/cygld-supply-cap/${width}-fr.png`, fullPage: true });
  });
}

test("an exhausted Core cap leaves CYGLD redemption usable", async ({ page }) => {
  await installCapacity(page, 250n); await installReadOnlyWallet(page);
  const requests = await routeCapQuotes(page, 0n);
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await choose(page, "WETH"); await page.locator("#sell-amount").fill("1");
  await expect(page.getByTestId("cygld-purchase-capacity")).toHaveText("Reduce the amount");
  await expect(page.getByText("private cap diagnostic", { exact: true })).toHaveCount(0);
  await expect(page.locator("#purchase-cap-warning")).toHaveCount(0);
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await page.locator("#sell-amount").click(); await page.locator("#sell-amount").fill("3");
  await expect.poll(() => requests.at(-1)?.mode).toBe("redeem-exact-in");
  await expect(page.locator("#buy-amount")).toHaveValue("3");
  await expect(page.getByTestId("trade-mechanism")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
});

test("an exhausted Core model does not block a qualified market winner", async ({ page }) => {
  await installCapacity(page, 250n);
  await page.route("**/api/quotes/trade/stream", route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ contentType: "application/x-ndjson", body: [
      JSON.stringify({ type: "model", value: { namespace: "trade", intent: { ...request, deadline: undefined }, models: [
        { strategy: "core", value: { revision: 1, intent: { ...coreIntentRequest(request), deadline: undefined }, protocol: { context, state: supplyState(250n) }, routes: [], whole: [] } },
      ] } }),
      JSON.stringify({ type: "provider-error", strategy: "core", code: "issuance-cap-exceeded", error: "Core is full" }),
      JSON.stringify({ type: "complete", value: marketTradeFixture(request) }), "",
    ].join("\n") });
  });
  await page.goto("/en");
  await page.getByRole("button", { name: "Select token", exact: true }).first().click();
  await page.getByPlaceholder("Search currency...").fill("PAXG");
  await page.locator("#dropdown-from").getByRole("button").filter({ has: page.getByText("PAXG", { exact: true }) }).click();
  await page.locator("#sell-amount").fill("300");
  await expect(page.locator("#buy-amount")).toHaveValue("299.7");
  await expect(page.getByTestId("trade-mechanism")).toHaveCount(0);
  await expect(page.getByTestId("cygld-purchase-capacity")).toHaveCount(0);
  await expect(page.locator("#purchase-cap-warning")).toHaveCount(0);
  await expect(page.locator("#buy-amount")).not.toHaveAttribute("aria-invalid", "true");
});

test("fresh Core model capacity remains advisory without a separate supply request", async ({ page }) => {
  const fixture = await installCapacity(page);
  await routeCoreIntent(page, route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ contentType: "application/x-ndjson", body: [
      JSON.stringify({ type: "model", value: { revision: 1, intent: { ...request, deadline: undefined },
        protocol: { context, state: supplyState(100n) }, routes: [], whole: [] } }),
      JSON.stringify({ type: "complete", value: intentFixture(request) }), "",
    ].join("\n") });
  });
  await page.goto("/en"); await choose(page, "WETH");
  const initialReads = fixture.reads();
  await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveValue("1");
  await expect(page.getByTestId("cygld-purchase-capacity")).toHaveCount(0);
  expect(fixture.reads()).toBe(initialReads);
});

test("a capped Core quote displays its actual net execution and retains the funded budget", async ({ page }) => {
  await installCapacity(page);
  const capacity = 188768908336865677216n;
  await routeCoreIntent(page, route => {
    const request = route.request().postDataJSON(), value = intentFixture(request);
    return route.fulfill({ contentType: "application/x-ndjson", body: [
      JSON.stringify({ type: "model", value: { revision: 1, intent: { ...request, deadline: undefined },
        protocol: { context, state: { ...supplyState(50n), supply: "61042133796931254039" } }, routes: [], whole: [] } }),
      JSON.stringify({ type: "complete", value: { ...value, executionAmount: String(capacity), expectedInputAmount: String(capacity),
        requestedNetCygldOut: String(200n * unit), requestedGrossCygldOut: String(201n * unit),
        remainingGrossCapacity: String(250n * unit - 61042133796931254039n), remainingNetCapacity: String(capacity) } }), "",
    ].join("\n") });
  });
  await page.goto("/en"); await choose(page, "WETH"); await page.locator("#sell-amount").fill("200");
  await expect(page.locator("#buy-amount")).toHaveValue("188.769");
  await expect(page.locator("#sell-amount")).toHaveValue("200");
  await expect(page.locator("#buy-amount")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("cygld-purchase-capacity")).toHaveCount(0);
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.getByTestId("swap-maximum-input")).toHaveCount(0);
  await expect(page.getByTestId("swap-minimum-output")).toContainText("188.768908336865677216 CYGLD");
});

for (const width of [1280, 390]) {
  test(`a capped qualified Core result stays usable and compact in French at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 920 });
    await installCapacity(page); await installReadOnlyWallet(page); await routeCapQuotes(page);
    await page.goto("/fr");
    await expect(page.getByRole("button", { name: "Ouvrir le menu du portefeuille" })).toBeVisible();
    await page.getByRole("button", { name: "Sélectionner un token", exact: true }).first().click();
    await page.getByPlaceholder("Rechercher une devise...").fill("WETH");
    await page.locator("#dropdown-from").getByRole("button", { name: "WETH Wrapped Ether WETH", exact: true }).click();
    await page.locator("#sell-amount").fill("200");
    await expect(page.locator("#buy-amount")).toHaveValue("199,8");
    await expect(page.locator("#sell-amount")).toHaveValue("200");
    for (const input of ["#sell-amount", "#buy-amount"]) {
      await expect(page.locator(input)).not.toHaveAttribute("aria-invalid", "true");
      await expect(page.locator(input)).not.toHaveClass(/text-red-500/);
    }
    await expect(page.getByTestId("cygld-purchase-capacity")).toHaveCount(0);
    await expect(page.locator("#purchase-cap-warning")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Échanger les devises", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await page.screenshot({ path: `out/audit/cygld-supply-cap/${width}-fr-capped.png`, fullPage: true });
  });
}

for (const side of ["sell"] as ("sell" | "buy")[]) {
  test(`connected ${side} MAX uses the wallet budget while Core refunds the capped remainder`, async ({ page }) => {
    await installCapacity(page); await installReadOnlyWallet(page);
    const requests = await routeCapQuotes(page);
    await page.goto("/en"); await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
    await choose(page, "WETH"); await page.locator("#sell-amount").fill("300");
    await expect(page.locator("#buy-amount")).toHaveValue("199.8");
    await page.getByRole("button", { name: side === "sell" ? "Use maximum sell amount" : "Use maximum purchase amount", exact: true }).click();
    await expect(page.locator("#buy-amount")).toHaveValue("199.8");
    await expect(page.locator("#sell-amount")).toHaveValue("1000");
    await expect.poll(() => requests.at(-1)).toMatchObject({ mode: "issue-exact-in", amount: String(1000n * unit) });
    for (const input of ["#sell-amount", "#buy-amount"]) await expect(page.locator(input)).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#purchase-cap-warning")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: /Total fee/ }).click();
    await expect(page.getByTestId("swap-maximum-input")).toHaveCount(0);
    await expect(page.getByTestId("swap-minimum-output")).toContainText("199.8 CYGLD");
  });
}

for (const side of ["sell"] as ("sell" | "buy")[]) {
  test(`disconnected ${side} MAX never substitutes Core capacity for an unknown wallet budget`, async ({ page }) => {
    await installCapacity(page);
    const requests: QuoteIntentRequest[] = [];
    await routeCoreIntent(page, route => {
      const request = route.request().postDataJSON(); requests.push(request);
      return route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "error",
        code: "quote-no-route", error: "Fixture DEX route unavailable", correlationId: "fixture" }) + "\n" });
    });
    await page.goto("/en"); await choose(page, "WETH");
    const sell = page.locator("#sell-amount"); await sell.fill("300");
    await expect(page.getByText("No exchange route is available for this amount.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: side === "sell" ? "Use maximum sell amount" : "Use maximum purchase amount", exact: true })).toHaveCount(0);
    await expect(sell).toHaveValue("300");
    await expect(sell).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#purchase-cap-warning")).toHaveCount(0);
    expect(requests.at(-1)).toMatchObject({ mode: "issue-exact-in", amount: String(300n * unit) });
  });
}

test("a late wallet-budget MAX quote cannot overwrite a newer manual input amount", async ({ page }) => {
  await installCapacity(page); await installReadOnlyWallet(page);
  let maxStarted = false, releaseMax!: () => void;
  const pendingMax = new Promise<void>(resolve => { releaseMax = resolve; });
  await routeCoreIntent(page, async route => {
    const request = route.request().postDataJSON();
    if (request.mode === "issue-exact-in" && request.amount === String(1000n * unit)) {
      maxStarted = true; await pendingMax;
    }
    await route.fulfill({ contentType: "application/x-ndjson", body:
      JSON.stringify({ type: "complete", value: cappedIntent(request) }) + "\n" }).catch(() => {});
  });
  await page.goto("/en"); await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await choose(page, "WETH");
  const buy = page.locator("#buy-amount"), sell = page.locator("#sell-amount");
  await sell.fill("1"); await expect(buy).toHaveValue("1");
  try {
    await page.getByRole("button", { name: "Use maximum sell amount", exact: true }).click();
    await expect.poll(() => maxStarted).toBe(true);
    await sell.fill("10"); await expect(buy).toHaveValue("10");
    releaseMax();
    await expect(buy).toHaveValue("10"); await expect(sell).toHaveValue("10");
    await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  } finally { releaseMax(); }
});
