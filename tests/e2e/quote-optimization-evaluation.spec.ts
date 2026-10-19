import { routeWalletBalances } from "./fixtures/wallet-balances";
import { expect, test, type Page } from "./fixtures/app-test";
import { choose, context, install } from "./fixtures/token-quotes";

const baseline = process.env.QUOTE_EVALUATION_BASELINE === "1";

async function readOnlyWallet(page: Page) {
  await page.addInitScript(({ chain }) => {
    const account = "0x00000000000000000000000000000000000000a1";
    const provider = { isMetaMask: true, selectedAddress: account,
      request: async ({ method }: { method: string }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [account];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [account] }] }];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        throw new Error(`Read-only fixture rejects ${method}`);
      }, on: () => {}, removeListener: () => {} };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "MetaMask", rdns: "io.metamask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { chain: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337) });
}

for (const symbol of ["WETH", "USDC"] as const) {
  for (const mode of ["issue-in", "redeem-in"]) {
    test(`${symbol} ${mode}: display survives refresh with changed token name`, async ({ page }) => {
      let head = { ...context }, name = "PAX Gold", finish!: () => void;
      let pending = Promise.resolve();
      const observed = await install(page, "", () => pending, false, undefined, () => head, () => name);
      await page.goto("/en"); await choose(page, symbol);
      if (mode.startsWith("redeem")) await page.getByRole("button", { name: "Reverse swap direction" }).click();
      const inputs = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)');
      const edited = inputs.first();
      await edited.click(); await edited.fill("1");
      const quoted = page.locator("#buy-amount");
      await expect(quoted).not.toHaveAttribute("aria-busy", "true"); await expect(quoted).not.toHaveText(/^(?:0(?:[.,]0+)?|\.\.\.)?$/);
      const before = (await quoted.textContent())!, count = observed.intents.length;
      pending = new Promise<void>(resolve => { finish = resolve; });
      name = "Updated display name";
      head = { ...head, blockHash: `0x${"b".repeat(64)}` };
      await expect.poll(() => observed.intents.length).toBeGreaterThan(count);
      const start = performance.now(), samples: { elapsedMs: number; blank: boolean }[] = [];
      for (let i = 0; i < 20; i++) {
        samples.push({ elapsedMs: performance.now()-start, blank: /^(?:0(?:[.,]0+)?|\.\.\.)?$/.test((await quoted.textContent())!) });
        await page.waitForTimeout(20);
      }
      expect(samples.some(s => s.blank)).toBe(baseline);
      if (!baseline) await expect(quoted).toHaveText(before);
      await test.info().attach("refresh-measurement", { body: JSON.stringify({ baseline, mode, symbol, sampleIntervalMs:20, samples }), contentType:"application/json" });
      finish(); await expect(quoted).not.toHaveAttribute("aria-busy", "true");
      // A changed raw input must not retain the preceding completed amount.
      pending = new Promise<void>(resolve => { finish = resolve; });
      await edited.fill("2");
      await expect(quoted).toHaveText("...");
      finish(); await expect(quoted).not.toHaveAttribute("aria-busy", "true");
    });
  }
}

test("balance warning precedes the exact request and survives a quote failure", async ({ page }) => {
  await readOnlyWallet(page);
  const observed = await install(page, "uniswap");
  await routeWalletBalances(page, route => route.fulfill({ json: {
    context: { ...context, blockTimestamp:"1790800000" }, holder:"0x00000000000000000000000000000000000000a1",
    native:{status:"success",value:"1000000000000000000"},
    tokens:[{id:"weth",address:"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",balance:{status:"success",value:"1000000000000000000"}}],
  } }));
  await page.goto("/en"); await expect(page.getByRole("button",{name:"Open wallet menu"})).toBeVisible();
  await choose(page,"WETH");
  const edited = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
  await page.evaluate(() => {
    const measurement = { start:0, warningMs:null as number|null };
    Object.assign(window,{ __quoteBalanceMeasurement:measurement });
    const observer = new MutationObserver(() => {
      if (measurement.start && measurement.warningMs === null && document.body.textContent?.includes("Reduce the swap amount to match your available balance.")) measurement.warningMs=performance.now()-measurement.start;
    }); observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    document.querySelector('input[inputmode="decimal"]:not(#execution-tolerance)')?.addEventListener("input",()=>{measurement.start=performance.now();});
  });
  await edited.fill("10");
  await expect.poll(() => observed.intents.length).toBe(1); // Indicative quoting continues.
  const warning = page.getByRole("button",{name:"Reduce the swap amount to match your available balance.",exact:true});
  if (baseline) await expect(warning).toBeHidden();
  else await expect(warning).toBeVisible();
  const measurement = await page.evaluate(() => (window as unknown as {__quoteBalanceMeasurement:unknown}).__quoteBalanceMeasurement);
  await test.info().attach("balance-measurement",{body:JSON.stringify({baseline,measurement,quoteRequests:observed.intents.length}),contentType:"application/json"});
});
