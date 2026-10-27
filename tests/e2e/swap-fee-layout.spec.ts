import { routeCoreIntent } from "./fixtures/trade-core";
import { expect, test } from "./fixtures/app-test";
import { choose, context, install } from "./fixtures/token-quotes";
import { intentFixture } from "./fixtures/quote-intent";

for (const width of [1280, 390]) {
  test(`${width}px fees retain grey previous values during edits and keep an independent gas estimate`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await install(page);
    // Human-scale prices keep the visual proof useful; these are synthetic
    // pool observations, not financial measurements or live market quotes.
    await page.route("**/api/pools/snapshot", async route => {
      const request = route.request().postDataJSON();
      const [token0, token1] = [request.tokenA.toLowerCase(), request.tokenB.toLowerCase()].sort();
      if (token0 !== "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" || token1 !== "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2") {
        await route.fallback(); return;
      }
      await route.fulfill({ json: { context, exists: true,
        poolAddress: "0x00000000000000000000000000000000000000c3", token0, token1,
        sqrtPriceX96Raw: String(BigInt(Math.round(Math.sqrt(500_000_000) * 1_000_000)) * 2n ** 96n / 1_000_000n),
        activeLiquidityRaw: String(10n ** 24n), tick: 0,
        token0BalanceRaw: "2000000000000", token1BalanceRaw: "1000000000000000000000", fee: request.fee,
      } });
    });
    let hold = false, started = false, release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/transaction/fees", route => route.fulfill({ json: {
      context, maxFeePerGas: "2000000000", maxPriorityFeePerGas: "1000000000",
    } }));
    await routeCoreIntent(page, async route => {
      const request = route.request().postDataJSON();
      if (hold) { started = true; await pending; }
      const value = intentFixture(request);
      value.preview.fees = { protocolFeeCygld: String(BigInt(request.amount) / 1000n), helperFeeCygld: "0" };
      await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "complete", value }) + "\n" });
    });
    await page.goto("/en");
    await choose(page, "WETH");
    const fees = page.getByTestId("swap-fees");
    const details = fees.getByRole("button", { name: /Total fee/ });
    if (await details.getAttribute("aria-expanded") === "false") await details.click();
    const protocol = fees.getByText(/^Protocol fee/).locator("..").locator("span").last();
    const helper = fees.getByText(/^Helpers fee/).locator("..").locator("span").last();
    const gas = fees.getByText(/^Transaction fee/).locator("..").locator("span").last();
    const sell = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
    await sell.fill("1");
    await expect(protocol).toContainText("0.001 CYGLD");
    await expect(helper).toHaveText("0 CYGLD (~ $0.00)");
    await expect(protocol).toContainText("CYGLD (~ $");
    await expect(gas).toContainText("ETH");
    await expect(fees).toHaveAttribute("aria-busy", "false");
    const previousGas = await gas.innerText();
    const previousProtocol = await protocol.innerText();
    const completeColor = await protocol.evaluate(element => getComputedStyle(element).color);
    const before = await fees.boundingBox();

    hold = true;
    await sell.fill("2");
    await expect(fees).toHaveAttribute("aria-busy", "true");
    await expect(protocol).toHaveText(previousProtocol);
    await expect(gas).toHaveText(previousGas);
    await expect(fees.getByText("Updating…", { exact: true })).toHaveCount(0);
    expect(await protocol.evaluate(element => getComputedStyle(element).color)).not.toBe(completeColor);
    await expect.poll(() => started).toBe(true);
    await expect(protocol).toHaveText(previousProtocol);
    expect((await fees.boundingBox())?.height).toBe(before?.height);
    await page.screenshot({ path: `out/audit/swap-grey-fees-${width}.png`, fullPage: true });
    release();
    await expect(protocol).toContainText("0.002 CYGLD");
    await expect(fees).toHaveAttribute("aria-busy", "false");
    await expect(gas).toContainText("ETH");
    expect(await protocol.evaluate(element => getComputedStyle(element).color)).toBe(completeColor);
    expect((await fees.boundingBox())?.height).toBe(before?.height);
    await sell.fill("");
    await expect(protocol).toHaveText("...");
    await expect(gas).toHaveText("...");
  });
}

test("zero fee rows, backdrop crop and footer stay stable while a quote replaces placeholders", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await install(page);
  await page.route("**/api/transaction/fees", route => route.fulfill({ json: {
    context, maxFeePerGas: "2000000000", maxPriorityFeePerGas: "1000000000",
  } }));
  await page.goto("/en");
  await choose(page, "WETH");
  const fees = page.getByTestId("swap-fees");
  const toggle = fees.getByRole("button", { name: /Total fee/ });
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  await expect(fees.getByText(/^Helpers fee/)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // Wait for the CSS backdrop pixels, not an arbitrary quote or wallet timer.
  await page.evaluate(async () => {
    // Both original PNGs must load; gradients are separate background layers.
    const layers = [
      getComputedStyle(document.querySelector(".swap-page-background")!).backgroundImage,
      getComputedStyle(document.querySelector(".swap-page-backdrop")!, "::before").backgroundImage,
    ];
    const urls = new Set(layers.flatMap(layer => [...layer.matchAll(/url\(["']?(.*?)["']?\)/g)].map(match => match[1])));
    if (urls.size === 0) throw new Error("Swap backdrop images are missing");
    await Promise.all([...urls].map(async url => {
      const image = new Image(); image.src = url; await image.decode();
    }));
  });
  const crop = { x: 0, y: 240, width: 150, height: 180 };
  const waitForPaint = () => page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await waitForPaint();
  const beforePixels = await page.screenshot({ clip: crop, path: test.info().outputPath("backdrop-before.png") });
  const expectStableBackdrop = async (stage: string) => {
    // Let layout and the fixed-background compositor commit the new frame.
    await waitForPaint();
    const actual = await page.screenshot({ clip: crop });
    // PNG compression/chunk boundaries can differ for identical pixels.
    // Decode in the browser to preserve an exact visual comparison without
    // adding an image-processing dependency or allowing a pixel tolerance.
    const samePixels = actual.equals(beforePixels) || await page.evaluate(async ([expected, received]) => {
      const decode = async (base64: string) => {
        const image = new Image(); image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [left, right] = await Promise.all([decode(expected), decode(received)]);
      return left.length === right.length && left.every((value, index) => value === right[index]);
    }, [beforePixels.toString("base64"), actual.toString("base64")]);
    if (!samePixels) {
      await page.screenshot({ clip: crop, path: test.info().outputPath(`backdrop-${stage}.png`) });
      await test.info().attach("backdrop-before", { body: beforePixels, contentType: "image/png" });
      await test.info().attach(`backdrop-${stage}`, { body: actual, contentType: "image/png" });
    }
    expect(samePixels, `backdrop remains stable ${stage}`).toBe(true);
  };
  const card = page.locator("#swapsection");
  const beforeCard = await card.boundingBox();
  const beforeFooter = await page.locator("footer").boundingBox();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect(fees.getByText(/^0 CYGLD \(/)).toHaveCount(2);
  await expect(fees).toHaveAttribute("aria-busy", "false");
  await expect(card).toHaveAttribute("data-trade-evaluation", "confirmed");
  expect((await card.boundingBox())!.height).toBe(beforeCard!.height);
  const afterCard=(await card.boundingBox())!,afterFooter=(await page.locator("footer").boundingBox())!;
  expect(afterFooter.y).toBeGreaterThanOrEqual(afterCard.y+afterCard.height);
  expect(afterFooter.y).toBeGreaterThanOrEqual(beforeFooter!.y);
  await expectStableBackdrop("after-quote");
  await toggle.click();
  expect((await card.boundingBox())?.height).toBeLessThan(beforeCard!.height);
  await expectStableBackdrop("after-collapse");
  // Intentional long content keeps normal document scrolling, while the
  // decorative image uses the same viewport crop.
  await page.locator("#swapsection").evaluate(node => { node.style.minHeight = "1400px"; });
  await expectStableBackdrop("with-long-content");
  expect((await page.locator("footer").boundingBox())!.y).toBeGreaterThan(1000);
});
