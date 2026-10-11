import { expect, test, type Page } from "./fixtures/app-test";
import { asset, choose, context, install } from "./fixtures/token-quotes";
import { intentFixture } from "./fixtures/quote-intent";
import type { QuoteIntentRequest } from "../../app/utils/quoteIntent";
import type { BasketPreviewRequest } from "../../app/utils/basketPreview";
import { routeWalletBalances } from "./fixtures/wallet-balances";
import { selectBasket } from "./fixtures/swap-selection";

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
      balance: { status: "success", value: String(1000n * unit) } }],
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
  return { ...value, executionAmount: String(executedNet), requestedNetCygldOut: String(requestedNet),
    requestedGrossCygldOut: String(gross), remainingGrossCapacity: String(remainingGross), remainingNetCapacity: String(remainingNet) };
}

async function routeCapQuotes(page: Page, remainingGross = 200n * unit) {
  const requests: QuoteIntentRequest[] = [];
  await page.route("**/api/quotes/intent/stream", route => {
    const request = route.request().postDataJSON(); requests.push(request);
    return route.fulfill({ contentType: "application/x-ndjson", body:
      JSON.stringify({ type: "complete", value: cappedIntent(request, remainingGross) }) + "\n" });
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
  const ceiling = (numerator: bigint, denominator: bigint) => (numerator + denominator - 1n) / denominator;
  await install(page, "", undefined, false, assets);
  await installReadOnlyWallet(page);
  await routeWalletBalances(page, route => route.fulfill({ json: { context,
    holder: "0x0000000000000000000000000000000000000011",
    native: success(String(100n * unit)), tokens: [
      { id: "paxg", address: asset, balance: success(String(20n * unit)) },
      { id: "xaut", address: xaut, balance: success(String(xautWalletBalance)) },
    ],
  } }));
  await page.route("**/api/protocol/facts", route => route.fulfill({ json: {
    context: { ...context, blockTimestamp: "1790800000" },
    core: "0x00000000000000000000000000000000000000a1",
    helpers: "0x00000000000000000000000000000000000000b2", basketModel,
    issuanceCapacity: { totalSupply: success(String(50n * unit)),
      maxTotalSupply: success(String(250n * unit)), effectiveCygldSupplyCap: success(String(250n * unit)) },
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
      if (gross > 200n * unit) gross = 200n * unit;
    } else {
      const net = BigInt(request.netCygldOut);
      gross = net > 0n ? net + (net - 1n) * 1000n / 999_000n : 0n;
    }
    const amounts = weights.map((weight, index) =>
      ceiling(ceiling(gross * weight, 1_000_000n) * unit, conversions[index]));
    return route.fulfill({ json: { mode: request.mode, context,
      helpers: "0x00000000000000000000000000000000000000b2", basketModel,
      result: { orderedCoreAssets: assets, amountsInExact: amounts.map(String),
        fees: { protocolFeeCygld: String(gross / 1000n), helperFeeCygld: "0" },
        ...(request.mode === "issue-exact-in" ? { netCygldOut: String(gross - gross / 1000n) } : {}),
      },
    } });
  });
  return requests;
}

for (const scenario of [
  { constraint: "the limiting second wallet", xautWalletBalance: 2_000_000n,
    netOutput: "98.9108901", netOutputRaw: "98910890100000000000", paxgInput: "2.97", xautInput: "1.98",
    maximumInputs: "2.99999997 PAXG + 2 XAUt" },
  { constraint: "the supply cap", xautWalletBalance: 10_000_000n,
    netOutput: "199.8", netOutputRaw: "199800000000000000000", paxgInput: "6", xautInput: "4",
    maximumInputs: "6.06 PAXG + 4.04 XAUt" },
]) {
  for (const { side, fullModel } of [false, true].flatMap(fullModel =>
    (["sell", "buy"] as const).map(side => ({ side, fullModel })))) {
    test(`${fullModel ? "warm" : "cold"} two-asset basket ${side} MAX fits ${scenario.constraint}`, async ({ page }) => {
      const requests = await installTwoAssetBasket(page, scenario.xautWalletBalance, fullModel);
      await page.goto("/en");
      await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
      await page.getByRole("switch", { name: "Show only tokens available in wallet", exact: true }).uncheck();
      await selectBasket(page);
      await expect(page.getByTestId("cygld-purchase-capacity")).toHaveText("Available: 199.8 CYGLD");
      const paxg = page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true });
      const xaut = page.getByRole("textbox", { name: "Sell amount (XAUt)", exact: true });
      const buy = page.locator("#buy-amount");
      await paxg.fill("12");
      await expect(xaut).toHaveValue("8");
      await expect.poll(() => requests.at(-1)).toMatchObject({ mode: "issue-exact-in",
        maximumAmountsIn: ["12000000000000000000", "8000000"] });
      await expect(buy).toBeEnabled();
      await expect(buy).toHaveValue("399.6");
      for (const amount of [paxg, xaut, buy]) {
        await expect(amount).toHaveAttribute("aria-invalid", "true");
        await expect(amount).toHaveClass(/text-red-500/);
      }
      await expect(page.locator("#purchase-cap-warning")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Reduce/ })).toBeDisabled();

      await page.getByRole("button", { name: side === "sell" ? "Use maximum sell amount" : "Use maximum purchase amount", exact: true }).click();
      // MAX fits the smaller of capacity and every wallet's protected budget,
      // then quotes all required inputs using their different basket weights.
      await expect(buy).toHaveValue(scenario.netOutput);
      await expect(page.getByRole("button", { name: "Edit sell amount (PAXG)", exact: true })).toHaveText(scenario.paxgInput);
      await expect(page.getByRole("button", { name: "Edit sell amount (XAUt)", exact: true })).toHaveText(scenario.xautInput);
      await expect(buy).not.toHaveAttribute("aria-invalid", "true");
      for (const symbol of ["PAXG", "XAUt"]) {
        await expect(page.getByRole("button", { name: `Edit sell amount (${symbol})`, exact: true })).not.toHaveClass(/text-red-500|text-text-amber/);
      }
      await expect(page.locator("#purchase-cap-warning")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
      await expect.poll(() => requests.at(-1)).toMatchObject({ mode: "issue-exact-out", netCygldOut: scenario.netOutputRaw });
      await page.getByRole("button", { name: /Total fee/ }).click();
      await expect(page.getByTestId("swap-maximum-input")).toContainText(scenario.maximumInputs);
      await expect(page.getByTestId("swap-minimum-output")).toHaveCount(0);
    });
  }
}

test("cold issuance facts show capacity and MAX before optional basket history exists", async ({ page }) => {
  await installCapacity(page, 50n, false);
  const requests = await routeCapQuotes(page);
  await page.goto("/en");
  await expect(page.getByTestId("cygld-purchase-capacity")).toHaveText("Available: 199.8 CYGLD");
  await choose(page, "WETH");
  const inputMax = page.getByRole("button", { name: "Use maximum sell amount", exact: true });
  const outputMax = page.getByRole("button", { name: "Use maximum purchase amount", exact: true });
  await expect(inputMax).toBeEnabled(); await expect(outputMax).toBeEnabled();
  expect(requests).toHaveLength(0);
  await outputMax.click();
  await expect(page.locator("#buy-amount")).toHaveValue("199.8");
  await expect(page.locator("#sell-amount")).toHaveValue("199.8");
  await expect(page.locator("#purchase-cap-warning")).toHaveCount(0);
  expect(requests[0]).toMatchObject({ mode: "issue-exact-out", amount: "199800000000000000000" });
});

for (const width of [1280, 390]) {
  test(`French purchase capacity stays compact at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 920 });
    await installCapacity(page);
    await page.goto("/fr");
    const note = page.getByTestId("cygld-purchase-capacity");
    await expect(note).toHaveText("Disponible : 199,8 CYGLD");
    await expect(note).toHaveAttribute("title", /Plafond actuel : 250 CYGLD/);
    expect(await note.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `out/audit/cygld-supply-cap/${width}-fr.png`, fullPage: true });
  });
}

test("a cap rejection refreshes capacity, retains the input and uses inline feedback", async ({ page }) => {
  const fixture = await installCapacity(page);
  await page.route("**/api/quotes/intent/stream", async route => {
    const request = route.request().postDataJSON();
    if (request.amount !== String(300n * unit)) return route.fallback();
    fixture.setSupply(100n);
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "error",
      code: "issuance-cap-exceeded", error: "private cap diagnostic", correlationId: "fixture" }) + "\n" });
  });
  await page.goto("/en");
  await expect(page.getByTestId("cygld-purchase-capacity")).toHaveText("Available: 199.8 CYGLD");
  const initialReads = fixture.reads();
  await choose(page, "WETH");
  const buy = page.locator("#buy-amount");
  await buy.click(); await buy.fill("300");
  await expect(page.getByTestId("cygld-purchase-capacity")).toContainText("149.85");
  await expect(buy).toHaveValue("300");
  await expect(buy).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#sell-amount")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#purchase-cap-warning")).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  expect(fixture.reads()).toBe(initialReads + 1);
  await buy.fill("1");
  await expect(page.locator("#sell-amount")).not.toHaveValue("");
  await expect(page.getByTestId("cygld-purchase-capacity")).toHaveText("Available: 149.85 CYGLD");
});

test("the exhausted cap leaves CYGLD redemption usable", async ({ page }) => {
  const fixture = await installCapacity(page, 250n);
  await installReadOnlyWallet(page);
  await page.route("**/api/quotes/intent/stream", route => {
    const request = route.request().postDataJSON();
    if (!request.mode.startsWith("issue")) return route.fallback();
    return route.fulfill({ contentType: "application/x-ndjson", body:
      JSON.stringify({ type: "complete", value: cappedIntent(request, 0n) }) + "\n" });
  });
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await expect(page.getByTestId("cygld-purchase-capacity")).toHaveText("Supply cap reached");
  await choose(page, "WETH");
  await page.locator("#sell-amount").fill("1");
  for (const input of ["#sell-amount", "#buy-amount"]) {
    await expect(page.locator(input)).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator(input)).toHaveClass(/text-red-500/);
  }
  await expect(page.locator("#purchase-cap-warning")).toBeVisible();
  await expect(page.getByRole("button", { name: "Supply cap reached", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await expect(page.getByTestId("cygld-purchase-capacity")).toHaveCount(0);
  await page.locator("#sell-amount").click();
  await page.locator("#sell-amount").fill("3");
  await expect.poll(() => fixture.observed.intents.some(intent => intent.mode === "redeem-exact-in")).toBe(true);
  await expect(page.locator("#buy-amount")).not.toHaveValue("");
});

test("fresh quote models update purchase capacity without a separate supply request", async ({ page }) => {
  const fixture = await installCapacity(page);
  await page.route("**/api/quotes/intent/stream", route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ contentType: "application/x-ndjson", body: [
      JSON.stringify({ type: "model", value: { revision: 1, intent: { ...request, deadline: undefined },
        protocol: { context, state: supplyState(100n) }, routes: [], whole: [] } }),
      JSON.stringify({ type: "complete", value: intentFixture(request) }), "",
    ].join("\n") });
  });
  await page.goto("/en");
  await expect(page.getByTestId("cygld-purchase-capacity")).toHaveText("Available: 199.8 CYGLD");
  const initialReads = fixture.reads();
  await choose(page, "WETH");
  await page.locator("#sell-amount").fill("1");
  await expect(page.getByTestId("cygld-purchase-capacity")).toHaveText("Available: 149.85 CYGLD");
  expect(fixture.reads()).toBe(initialReads);
});

test("an oversized budget retains the requested output and displays the rounded capacity separately", async ({ page }) => {
  await installCapacity(page);
  const capacity = 188768908336865677216n;
  await page.route("**/api/quotes/intent/stream", route => {
    const request = route.request().postDataJSON(), value = intentFixture(request);
    return route.fulfill({ contentType: "application/x-ndjson", body: [
      JSON.stringify({ type: "model", value: { revision: 1, intent: { ...request, deadline: undefined },
        protocol: { context, state: { ...supplyState(50n), supply: "61042133796931254039" } }, routes: [], whole: [] } }),
      JSON.stringify({ type: "complete", value: { ...value, executionAmount: String(capacity),
        requestedNetCygldOut: String(200n * unit), requestedGrossCygldOut: String(201n * unit),
        remainingGrossCapacity: String(250n * unit - 61042133796931254039n), remainingNetCapacity: String(capacity) } }), "",
    ].join("\n") });
  });
  await page.goto("/en"); await choose(page, "WETH");
  await page.locator("#sell-amount").fill("200");
  await expect(page.locator("#buy-amount")).toHaveValue("200");
  await expect(page.locator("#buy-amount")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("cygld-purchase-capacity")).toContainText("188.769");
});

for (const width of [1280, 390]) {
  test(`an oversized purchase shows red French feedback and stays blocked at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 920 });
    await installCapacity(page);
    await installReadOnlyWallet(page);
    await routeCapQuotes(page);
    await page.goto("/fr");
    await expect(page.getByRole("button", { name: "Ouvrir le menu du portefeuille" })).toBeVisible();
    await page.getByRole("button", { name: "Sélectionner un token", exact: true }).first().click();
    await page.getByPlaceholder("Rechercher une devise...").fill("WETH");
    await page.locator("#dropdown-from").getByRole("button", { name: "WETH Wrapped Ether WETH", exact: true }).click();
    await page.locator("#sell-amount").fill("200");
    await expect(page.locator("#buy-amount")).toHaveValue("200");
    for (const input of ["#sell-amount", "#buy-amount"]) {
      await expect(page.locator(input)).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator(input)).toHaveClass(/text-red-500/);
    }
    const note = page.getByTestId("cygld-purchase-capacity");
    await expect(note).toContainText("199,8");
    await expect(page.locator("#purchase-cap-warning")).toBeVisible();
    await expect(page.getByRole("button", { name: "Réduisez le montant", exact: true })).toBeDisabled();
    expect(await note.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await page.screenshot({ path: `out/audit/cygld-supply-cap/${width}-fr-capped.png`, fullPage: true });
  });
}

for (const side of ["sell", "buy"] as const) {
  test(`${side} MAX replaces oversized terms with a valid cap-fitting quote`, async ({ page }) => {
    await installCapacity(page);
    const requests = await routeCapQuotes(page);
    await page.goto("/en"); await choose(page, "WETH");
    await page.locator("#sell-amount").fill("300");
    await expect(page.locator("#buy-amount")).toHaveValue("300");
    await expect(page.locator("#purchase-cap-warning")).toBeVisible();
    await page.getByRole("button", { name: side === "sell" ? "Use maximum sell amount" : "Use maximum purchase amount", exact: true }).click();
    await expect(page.locator("#buy-amount")).toHaveValue("199.8");
    await expect(page.locator("#sell-amount")).toHaveValue("199.8");
    for (const input of ["#sell-amount", "#buy-amount"]) {
      await expect(page.locator(input)).not.toHaveAttribute("aria-invalid", "true");
    }
    await expect(page.locator("#purchase-cap-warning")).toHaveCount(0);
    await expect.poll(() => requests.at(-1)?.mode).toBe("issue-exact-out");
    expect(requests.at(-1)?.amount).toBe(String(199800000000000000000n));
    await page.getByRole("button", { name: /Total fee/ }).click();
    await expect(page.getByTestId("swap-maximum-input")).toContainText("201.798 WETH");
  });
}

for (const side of ["sell", "buy"] as const) {
  test(`disconnected ${side} MAX reduces the output to capacity when that DEX route is unavailable`, async ({ page }) => {
    await installCapacity(page);
    const requests: QuoteIntentRequest[] = [];
    await page.route("**/api/quotes/intent/stream", route => {
      const request = route.request().postDataJSON(); requests.push(request);
      const frame = request.mode === "issue-exact-in"
        ? { type: "complete", value: cappedIntent(request) }
        : { type: "error", code: "quote-no-route", error: "Fixture DEX route unavailable", correlationId: "fixture" };
      return route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify(frame) + "\n" });
    });
    await page.goto("/en"); await choose(page, "WETH");
    const buy = page.locator("#buy-amount"), sell = page.locator("#sell-amount");
    await sell.fill("300"); await expect(buy).toHaveValue("300");
    await expect(page.locator("#purchase-cap-warning")).toBeVisible();
    await page.getByRole("button", { name: side === "sell" ? "Use maximum sell amount" : "Use maximum purchase amount", exact: true }).click();
    await expect(buy).toHaveValue("199.8");
    await expect.poll(() => requests.at(-1)?.mode).toBe("issue-exact-out");
    expect(requests.at(-1)?.amount).toBe("199800000000000000000");
    await expect(page.getByText("No exchange route is available for this amount.", { exact: true })).toBeVisible();
    for (const input of [buy, sell]) {
      await expect(input).not.toHaveAttribute("aria-invalid", "true");
      await expect(input).not.toHaveClass(/text-red-500/);
    }
    await expect(page.locator("#purchase-cap-warning")).toHaveCount(0);
    await expect(page.getByTestId("cygld-purchase-capacity")).toHaveText("Available: 199.8 CYGLD");
  });
}

test("input MAX also adapts both terms when connected and the output is editable", async ({ page }) => {
  await installCapacity(page); await installReadOnlyWallet(page); await routeCapQuotes(page);
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await choose(page, "WETH");
  const buy = page.locator("#buy-amount"), sell = page.locator("#sell-amount");
  await buy.click(); await buy.fill("300");
  await expect(buy).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Use maximum sell amount", exact: true }).click();
  await expect(buy).toHaveValue("199.8"); await expect(sell).toHaveValue("199.8");
  await expect(buy).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
});

test("a late MAX quote cannot overwrite a newer manual output amount", async ({ page }) => {
  await installCapacity(page); await installReadOnlyWallet(page);
  let maxStarted = false, releaseMax!: () => void;
  const pendingMax = new Promise<void>(resolve => { releaseMax = resolve; });
  await page.route("**/api/quotes/intent/stream", async route => {
    const request = route.request().postDataJSON();
    if (request.mode === "issue-exact-out" && request.amount === "199800000000000000000") {
      maxStarted = true; await pendingMax;
    }
    await route.fulfill({ contentType: "application/x-ndjson", body:
      JSON.stringify({ type: "complete", value: cappedIntent(request) }) + "\n" }).catch(() => {});
  });
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await choose(page, "WETH");
  const buy = page.locator("#buy-amount"), sell = page.locator("#sell-amount");
  await buy.click(); await buy.fill("1"); await expect(sell).toHaveValue("1");
  try {
    await page.getByRole("button", { name: "Use maximum sell amount", exact: true }).click();
    await expect.poll(() => maxStarted).toBe(true);
    await buy.fill("10"); await expect(sell).toHaveValue("10");
    releaseMax();
    await expect(page.getByRole("button", { name: "Use maximum sell amount", exact: true })).toBeEnabled();
    await expect(buy).toHaveValue("10"); await expect(sell).toHaveValue("10");
    await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  } finally { releaseMax(); }
});
