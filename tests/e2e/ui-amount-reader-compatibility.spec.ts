import { expect, test } from "@playwright/test";
import { protocolConfigurationFixture as config, tokenAddresses } from "../fixtures/protocol-configuration";
import { tradeScenarios } from "../trading/scenarios";
import { armUiQuoteCapture, basketAmountControls, capturedUiQuote, currentUiQuote, displayedUiAmount, quoteAssets } from "../trading/uiQuoteCapture";

const variants = ["legacy", "readonly-input", "readonly-text"] as const;

for (const variant of variants) for (const basket of [false, true]) {
  test(`${variant} ${basket ? "basket" : "token"} receive markup is captured without activating output entry`, async ({ page }) => {
    const scenario = tradeScenarios.find(row => row.id === (basket ? "core-redeem-basket-exact-in" : "core-issue-paxg-exact-in"))!;
    const assets = quoteAssets(scenario, config, basket ? [tokenAddresses.PAXG, tokenAddresses.XAUT] : []);
    const output = (value: string, symbol: string, index: number) => {
      const attributes = basket ? `aria-label="${variant === "legacy" ? "Edit buy" : "Buy"} amount (${symbol})"` : 'id="buy-amount"';
      return variant === "legacy" && basket ? `<button ${attributes} data-receive="${index}">${value}</button>`
        : variant === "readonly-text" ? `<output ${attributes} data-receive="${index}">${value}</output>`
        : `<input ${attributes} data-receive="${index}" readonly value="${value}">`;
    };
    const values = basket ? ["0.01", "0.02"] : ["2"];
    const receives = assets.output.map((asset, i) => output(values[i], asset.symbol, i)).join("");
    const bounds = assets.output.map((asset, i) => `${basket ? ["0.0099", "0.0198"][i] : "1.98"} ${asset.symbol}`).join(" + ");
    await page.setContent(`<input id="sell-amount" value="1">
      ${basket ? `<div id="buy-basket-composition">${receives}</div>` : receives}
      <div data-testid="execution-tolerance-control"><input type="range" value="1" min="0" max="1" step="0.01"></div>
      <div data-testid="swap-minimum-output"><span>Minimum received</span><span>${bounds}</span></div>
      <button id="swap">Swap</button>`);
    await page.evaluate(() => {
      const scope = window as Window & { outputInteractions?: number };
      scope.outputInteractions = 0;
      document.querySelectorAll("[data-receive]").forEach(control => {
        for (const event of ["focus", "click", "input"]) control.addEventListener(event, () => { scope.outputInteractions!++; });
      });
    });
    if (basket) {
      const controls = basketAmountControls(page, "buy");
      await expect(controls).toHaveCount(assets.output.length);
      expect(await Promise.all((await controls.all()).map(displayedUiAmount))).toEqual(values);
    } else expect(await displayedUiAmount(page.locator("#buy-amount"))).toBe(values[0]);
    const button = page.locator("#swap");
    await armUiQuoteCapture(button, assets);
    const ready = await currentUiQuote(page, assets, "exact-in");
    expect(ready.output.map(row => row.amount)).toEqual(basket ? ["10000000000000000", "20000"] : ["2000000000000000000"]);
    await button.click();
    expect(await capturedUiQuote(page, assets, "exact-in")).toEqual(ready);
    expect(await page.evaluate(() => (window as Window & { outputInteractions?: number }).outputInteractions)).toBe(0);
  });
}
