import { protocolConfigurationFixture, protocolAddresses } from "../fixtures/protocol-configuration";
import { expect, test, type Page } from "./fixtures/app-test";
import { decodeFunctionData, maxUint256 } from "viem";
import { HELPERS_EXECUTION_ABI } from "../../app/contracts/cybergold-helpers/execution";
import { choose, context, install } from "./fixtures/token-quotes";
import { routeWalletBalances } from "./fixtures/wallet-balances";

const owner = "0x0000000000000000000000000000000000000011";
const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const hash = `0x${"ab".repeat(32)}`;
const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const unit = 10n ** 18n;
type Submitted = { data: `0x${string}`; value?: string };

async function expandFees(page: Page, locale: "en" | "fr" = "en") {
  const accordion = page.getByRole("button", { name: new RegExp(locale === "fr" ? "Frais totaux" : "Total fee") });
  if (await accordion.getAttribute("aria-expanded") !== "true") await accordion.click();
}

async function installSyntheticWallet(page: Page) {
  await page.addInitScript(({ owner, hash, chain }) => {
    const transactions: { data: `0x${string}`; value?: string }[] = [];
    const provider = { isMetaMask: false, selectedAddress: owner,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [owner];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts",
          caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        if (method === "eth_signTypedData_v4") return `0x${"01".repeat(64)}1b`;
        if (method === "eth_sendTransaction") { transactions.push(params![0] as Submitted); return hash; }
        throw new Error(`Synthetic wallet rejects ${method}`);
      }, on: () => {}, removeListener: () => {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    Object.assign(window, { __toleranceTransactions: transactions });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "Synthetic ordinary wallet", rdns: "io.synthetic.ordinary",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner, hash, chain });
  const observed = await install(page);
  await routeWalletBalances(page, route => route.fulfill({ json: {
    context, holder: owner, native: { status: "success", value: String(unit * 100n) },
    tokens: [{ id: "weth", address: weth, balance: { status: "success", value: String(unit * 100n) } },
      { id: "cygld", address: protocolAddresses.core,
        balance: { status: "success", value: String(unit * 100n) } }],
  } }));
  await page.route("**/api/diagnostics", route => route.fulfill({ status: 202, json: { accepted: true } }));
  await page.route("**/api/account/core-permit*", route => route.fulfill({ json: { nonce: "0", spender: protocolAddresses.helpers, domain: { name: "CyberGold", verifyingContract: protocolAddresses.core } } }));
  await page.route("**/api/account/token-permit*", route => route.fulfill({ json: {
    context, token: { chainId: chain, address: weth }, owner,
    spender: protocolAddresses.helpers,
    nonce: { status: "failure", error: "not-supported" },
    allowance: { status: "success", value: String(maxUint256) },
    authorization: { kind: "none", confidence: "observed" },
  } }));
  await page.route("**/api/transaction/fees", route => route.fulfill({ json: {
    context, maxFeePerGas: "1000000000", maxPriorityFeePerGas: "1",
  } }));
  await page.route("**/api/transaction/helpers-execution", route => route.fulfill({ json: { context, helpers: protocolAddresses.helpers, gas: "360000" } }));
  // The synthetic wallet records calldata; every receipt is an explicit fixture failure.
  await page.route("**/api/transaction/wait/receipt*", route => route.fulfill({ status: 503, json: { error: "Fixture receipt unavailable" } }));
  return observed;
}

test("redemption uses the slider's selected minimum in final calldata", async ({ page }) => {
  const observed = await installSyntheticWallet(page);
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await page.getByRole("switch").uncheck(); await choose(page, "ETH");
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await page.locator("#sell-amount").click(); await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("1");
  await expandFees(page);
  await expect(page.getByTestId("swap-minimum-output")).toContainText("0.99 ETH");
  await expect(page.getByTestId("swap-maximum-input")).toHaveCount(0);
  const slider = page.getByRole("slider", { name: "Adjust execution tolerance", exact: true });
  await page.locator("#execution-tolerance").fill("0.24");
  await slider.focus(); await slider.press("ArrowRight");
  await expect(page.locator("#execution-tolerance")).toHaveValue("0.25");
  await expect(page.getByTestId("swap-minimum-output")).toContainText("0.9975 ETH");
  await expect(page.locator("#buy-amount")).toHaveText("1");
  await expect.poll(() => observed.intents.at(-1)?.slippageBps).toBe(25);
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click();
  const transactions = () => page.evaluate(() => (window as unknown as { __toleranceTransactions: Submitted[] }).__toleranceTransactions);
  await expect.poll(async () => (await transactions()).length).toBe(1);
  const decoded = decodeFunctionData({ abi: HELPERS_EXECUTION_ABI, data: (await transactions())[0].data });
  expect(decoded.functionName).toBe("executeExactInput");
  const params = decoded.args![0] as { minimumOutput: bigint; inputs: readonly { amount: bigint }[] };
  expect(params.inputs[0].amount).toBe(unit); expect(params.minimumOutput).toBe(unit * 9975n / 10000n);

});

for (const width of [1280, 390]) {
  test(`French tolerance field and keyboard slider fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 920 }); await install(page);
    await page.goto("/fr");
    await page.getByRole("button", { name: "Sélectionner un token", exact: true }).first().click();
    await page.getByPlaceholder("Rechercher une devise...").fill("WETH");
    await page.locator("#dropdown-from").getByRole("button", { name: "WETH Wrapped Ether WETH", exact: true }).click();
    await page.getByRole("button", { name: "Inverser le sens de l’échange", exact: true }).click();
    await page.locator("#sell-amount").click(); await page.locator("#sell-amount").fill("1");
    await expandFees(page, "fr");
    const field = page.getByLabel("Tolérance d’exécution:", { exact: true });
    await expect(field).toHaveValue("1"); await field.fill("0,25");
    await expect(page.getByTestId("swap-minimum-output")).toContainText("0,9975 WETH");
    const slider = page.getByRole("slider", { name: "Ajuster la tolérance d’exécution", exact: true });
    await slider.focus(); await slider.press("ArrowRight");
    await expect(field).toHaveValue("0.26");
    await expect(page.locator("#buy-amount")).toHaveText("1");
    const control = page.getByTestId("execution-tolerance-control");
    expect(await control.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `out/audit/execution-tolerance/${width}-fr.png`, fullPage: true });
  });
}

test("fees accordion owns tolerance, retains its value and shows only the active execution bound", async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en"); await choose(page, "WETH");
  const sell = page.locator("#sell-amount"), buy = page.locator("#buy-amount");
  await sell.fill("1"); await expect(buy).toHaveText("1");
  const accordion = page.getByRole("button", { name: /Total fee/ });
  await expect(accordion).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("execution-tolerance-control")).toHaveCount(0);
  await expect(page.getByTestId("swap-minimum-output")).toHaveCount(0);
  await expect(page.getByTestId("swap-maximum-input")).toHaveCount(0);
  await accordion.click();
  const field = page.locator("#execution-tolerance");
  const slider = page.getByRole("slider", { name: "Adjust execution tolerance", exact: true });
  await expect(field).toHaveValue("1");
  await expect(slider).toHaveAttribute("min", "0"); await expect(slider).toHaveAttribute("max", "1");
  await expect(page.getByTestId("swap-minimum-output")).toContainText("0.99 CYGLD");
  await expect(page.getByTestId("swap-maximum-input")).toHaveCount(0);
  await expect.poll(() => observed.intents.at(-1)?.mode).toBe("issue-exact-in");
  const feePanel = page.getByText(/^Protocol fee/).locator("..").locator("..");
  expect(await feePanel.evaluate(node => node.contains(document.querySelector("#execution-tolerance")))).toBe(true);

  await slider.focus(); await slider.press("Home");
  await expect(field).toHaveValue("0"); await expect(slider).toHaveValue("0");
  await expect.poll(() => observed.intents.at(-1)?.slippageBps).toBe(0);
  await slider.press("End");
  await expect(field).toHaveValue("1"); await expect(slider).toHaveValue("1");
  await field.fill("0.5"); await field.blur();
  await expect.poll(() => observed.intents.at(-1)?.slippageBps).toBe(50);
  await field.fill("1.01"); await field.blur();
  await expect(field).toHaveValue("0.5"); await expect(slider).toHaveValue("0.5");
  await accordion.click();
  await expect(page.getByTestId("execution-tolerance-control")).toHaveCount(0);
  await expect(page.getByTestId("swap-minimum-output")).toHaveCount(0);
  await accordion.click(); await expect(field).toHaveValue("0.5");


});

for (const side of ["issue", "redeem"] as const) test(`${side}: a complete universal plan binds execution without caller-selected adapter calldata`, async ({ page }) => {
  const observed = await installSyntheticWallet(page);
  const approvalAdapters: string[] = [];
  await page.route("**/api/governance/helpers-facts**", async route => {
    const adapter = new URL(route.request().url()).searchParams.get("adapter");
    if (adapter) approvalAdapters.push(adapter.toLowerCase());
    await route.fallback();
  });
  await page.route("**/api/protocol/config", route => route.fulfill({ json: {
    ...protocolConfigurationFixture, contracts: { ...protocolConfigurationFixture.contracts, uniswapAdapter: null },
    adapter: { status: "unavailable", encoding: null, observation: null },
    universalExactInput: {adapter:protocolAddresses.adapter,encoding:"uniswap-routing-v1",settlementPolicy:"protocol-retained-input"},
  } }));
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await page.getByRole("switch").uncheck(); await choose(page, "ETH");
  if (side === "redeem") await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  const edited = page.locator("#sell-amount");
  await edited.click(); await edited.fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("1");
  await expect.poll(() => observed.intents.length).toBeGreaterThan(0);
  // App sends only an economic trade intent. The Backend fixture resolves its
  // concrete Core adapter, which the existing approval read and calldata use.
  expect(observed.rawIntents).toHaveLength(observed.intents.length);
  expect(observed.rawIntents.every(request => !("adapter" in (request as object)))).toBe(true);
  expect(observed.intents.every(request => request.adapter?.toLowerCase() === protocolAddresses.adapter)).toBe(true);
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); await swap.click();
  const transactions = () => page.evaluate(() => (window as unknown as { __toleranceTransactions: Submitted[] }).__toleranceTransactions);
  await expect.poll(async () => (await transactions()).length).toBe(1);
  // The adapter is bound by the deployed facet. The universal selector has no
  // caller-selected adapter field and adds no redundant App approval read.
  expect(approvalAdapters).toEqual([]);
  const decoded = decodeFunctionData({ abi: HELPERS_EXECUTION_ABI, data: (await transactions())[0].data });
  expect(decoded.functionName).toBe("executeExactInput");
  const plan=decoded.args![0] as {intent:number;inputs:readonly{amount:bigint}[]};
  expect(plan.intent).toBe(side === "issue" ? 0 : 1);expect(plan.inputs[0].amount).toBe(unit);
});
