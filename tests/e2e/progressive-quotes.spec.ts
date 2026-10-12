import { tradeIntentEvent } from "./fixtures/trade-core";
import { routeWalletBalances } from "./fixtures/wallet-balances";
import { expect, test } from "./fixtures/app-test";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { QuoteIntentEvent, QuoteIntentRequest } from "../../app/utils/quoteIntent";
import { choose, context, install } from "./fixtures/token-quotes";
import { intentFixture } from "./fixtures/quote-intent";

const active = new Map<ServerResponse, QuoteIntentRequest>();
let phase: "partial" | "first" | "better" | "complete" | "error" | "preview-pending" | "qualified" | "qualified-better" | "invalidated" = "first";
let streamUrl: string;
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type,x-cybergold-attempt-id");
  if (request.method === "OPTIONS") { response.end(); return; }
  let body = ""; for await (const chunk of request) body += chunk;
  const intent = JSON.parse(body) as QuoteIntentRequest;
  response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  active.set(response, intent); response.on("close", () => active.delete(response)); send(response, intent);
});
function send(response: ServerResponse, request: QuoteIntentRequest) {
  const value = intentFixture(request, phase === "first" || phase === "qualified" ? "first" : "better");
  const event = phase === "complete" ? { type: "complete", value }
    : phase === "invalidated" ? { type: "invalidated", context }
    : phase.startsWith("qualified") ? { type: "qualified", value }
    : phase === "error" ? { type: "error", error: "Quote is temporarily unavailable.", correlationId: "fixture" }
    : phase === "partial" || phase === "preview-pending" ? { type: "progress", stage: "initial", completed: 1, total: 4 }
    : { type: "estimate", amount: value.displayAmount, context: value.context };
  response.write(JSON.stringify(tradeIntentEvent(event as QuoteIntentEvent, request)) + "\n");
  if (phase === "complete" || phase === "error") response.end();
}

for (const symbol of ["WETH", "USDC"] as const) {
  for (const operation of ["issue-in", "issue-out", "redeem-in", "redeem-minimum"] as const) {
    test(`${symbol} ${operation}: a qualified tuple remains usable during quiet improvement and background failure`, async ({ page }) => {
      const observed = await install(page, "", undefined, streamUrl);
      await page.goto("/en"); await choose(page, symbol);
      if (operation.startsWith("redeem")) await page.getByRole("button", { name: "Reverse swap direction" }).click();
      const inputs = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)'), exactIn = operation.endsWith("-in");
      const edited = exactIn ? inputs.first() : inputs.last(), quoted = exactIn ? inputs.last() : inputs.first();
      await edited.click(); await edited.fill("1");
      await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
      const start = performance.now();
      advance("qualified"); await expect(quoted).toBeEnabled();
      const qualifiedVisibleMs = performance.now() - start;
      await expect(page.getByTestId("quote-estimate-description")).not.toBeAttached();
      const first = Number(await quoted.inputValue());
      // A display-only update cannot replace checked execution terms.
      advance("better"); await expect(quoted).toHaveValue(String(first));
      advance("qualified-better");
      await expect.poll(async () => Number(await quoted.inputValue())).toEqual(exactIn ? first * 2 : first / 2);
      const improved = await quoted.inputValue();
      advance("first"); await expect(quoted).toHaveValue(improved); // A weaker advisory estimate cannot replace the selected Backend plan.
      advance("error"); await expect(quoted).toBeEnabled(); await expect(quoted).toHaveValue(improved);
      await expect(page.getByText("The quote service could not process this request. Retry.", { exact: true })).toHaveCount(0);
      expect(observed.intents).toHaveLength(1);
      phase = "partial"; await edited.fill("3");
      await expect(quoted).toHaveValue(""); await expect(quoted).toBeDisabled();
      await test.info().attach("qualified-readiness", { contentType: "application/json", body: JSON.stringify({
        symbol, operation, qualifiedVisibleMs,
        scope: "Controlled streaming fixture; no remote latency or RPC reduction is inferred.",
      }) });
    });
  }
}
function advance(next: typeof phase) { phase = next; for (const [response, request] of active) send(response, request); }

test("wallet preparation freezes displayed terms while a better quote arrives", async ({ page }) => {
  await page.addInitScript(({ chain }) => {
    const state = { hold: false, waiting: false, release: () => {}, rejected: [] as string[] };
    Object.assign(window, { quotePreparationFixture: state });
    Object.defineProperty(window, "ethereum", { configurable: true, value: {
      isMetaMask: true, selectedAddress: "0x00000000000000000000000000000000000000a1",
      request: async ({ method }: { method: string }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return ["0x00000000000000000000000000000000000000a1"];
        if (method === "wallet_getCapabilities") return {};
        if (method === "eth_chainId") {
          if (state.hold) {
            state.waiting = true;
            await new Promise<void>(resolve => { state.release = resolve; });
            return "0x1"; // Abort at the existing network check, before any signing.
          }
          return `0x${chain.toString(16)}`;
        }
        if (method === "net_version") return String(chain);
        state.rejected.push(method);
        throw new Error(`Synthetic read-only wallet rejects ${method}`);
      }, on: () => {}, removeListener: () => {},
    } });
  }, { chain: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337) });
  await install(page, "", undefined, streamUrl);
  await routeWalletBalances(page, route => route.fulfill({ json: {
    context, holder: "0x00000000000000000000000000000000000000a1",
    native: { status: "success", value: String(100n * 10n ** 18n) },
    tokens: [{ id: "weth", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", balance: { status: "success", value: String(100n * 10n ** 18n) } }],
  } }));
  await page.route("**/api/transaction/fees", route => route.fulfill({ json: {
    context, maxFeePerGas: "1000000000", maxPriorityFeePerGas: "1",
  } }));
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await page.getByRole("switch").uncheck(); await choose(page, "WETH");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  advance("qualified");
  const quoted = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last();
  const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
  await expect(swap).toBeEnabled(); const displayed = await quoted.inputValue();
  await page.evaluate(() => { (window as unknown as { quotePreparationFixture: { hold: boolean } }).quotePreparationFixture.hold = true; });
  await swap.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { quotePreparationFixture: { waiting: boolean } }).quotePreparationFixture.waiting)).toBe(true);
  advance("qualified-better"); await page.waitForTimeout(100);
  await expect(quoted).toHaveValue(displayed);
  await page.evaluate(() => { (window as unknown as { quotePreparationFixture: { release: () => void } }).quotePreparationFixture.release(); });
  await expect(page.getByText(/^Wrong network — switch to /)).toBeVisible();
  await expect(quoted).not.toHaveValue(displayed);
  expect(await page.evaluate(() => (window as unknown as { quotePreparationFixture: { rejected: string[] } }).quotePreparationFixture.rejected)).toEqual([]);
});

test("a proven invalidation keeps the amount indicative until a new checked tuple arrives", async ({ page }) => {
  await install(page, "", undefined, streamUrl); await page.goto("/en"); await choose(page, "WETH");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  const quoted = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last();
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  advance("qualified"); await expect(quoted).toBeEnabled();
  const previous = await quoted.inputValue();
  advance("invalidated"); await expect(quoted).toBeDisabled(); await expect(quoted).toHaveValue(previous);
  advance("qualified-better"); await expect(quoted).toBeEnabled(); await expect(quoted).not.toHaveValue(previous);
});

test("an expired qualified tuple is replaced under the ordinary deadline policy", async ({ page }) => {
  const observed = await install(page, "", undefined, streamUrl); await page.goto("/en"); await choose(page, "WETH");
  await page.clock.install();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  advance("qualified"); const quoted = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last(); await expect(quoted).toBeEnabled();
  const count = observed.intents.length;
  phase = "partial"; await page.clock.fastForward(601_000);
  await expect.poll(() => observed.intents.length).toBe(count+1);
  await expect(quoted).toBeDisabled();
  advance("qualified"); await expect(quoted).toBeEnabled();
});

test("a new intent gets a fresh deadline after renewal, clearing and an idle period", async ({ page }) => {
  const requests: QuoteIntentRequest[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/quotes/trade/stream") requests.push(request.postDataJSON());
  });
  await install(page, "", undefined, streamUrl);
  await page.goto("/en"); await choose(page, "WETH");
  await page.clock.install();
  const edited = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
  const quoted = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last();
  await edited.fill("1");
  await page.clock.runFor(250);
  await expect.poll(() => requests.length).toBe(1);
  advance("qualified"); await expect(quoted).toBeEnabled();

  phase = "partial";
  await page.clock.fastForward(601_000);
  await expect.poll(() => requests.length).toBe(2);
  advance("qualified"); await expect(quoted).toBeEnabled();
  await edited.fill("");
  await page.clock.runFor(250);
  await expect(quoted).toHaveValue("");

  await page.clock.fastForward(601_000);
  phase = "partial";
  await edited.fill("2");
  await page.clock.runFor(250);
  await expect.poll(() => requests.length).toBe(3);
  const nowSeconds = await page.evaluate(() => Date.now() / 1000);
  expect(Number(requests[2].deadline)).toBeGreaterThan(nowSeconds);
  expect(BigInt(requests[2].deadline) - BigInt(Math.floor(nowSeconds))).toBeLessThanOrEqual(600n);
  advance("complete"); await expect(quoted).toBeEnabled();
});

test("intents after renewal still reuse an exact fresh browser quote before debounce", async ({ page }) => {
  const observed = await install(page, "", undefined, streamUrl);
  await page.goto("/en"); await choose(page, "WETH");
  await page.clock.install();
  const edited = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
  const quoted = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last();
  await edited.fill("1");
  await expect.poll(async () => { await page.clock.runFor(250); return observed.intents.length; }).toBe(1);
  advance("qualified"); await expect(quoted).toBeEnabled();
  phase = "partial"; await page.clock.fastForward(601_000);
  await expect.poll(() => observed.intents.length).toBe(2);
  advance("complete"); await expect(quoted).toBeEnabled();

  // Move beyond the old reuse window before constructing another input's quote.
  await page.clock.fastForward(11_000);
  await edited.fill("2"); await page.clock.runFor(250);
  await expect.poll(() => observed.intents.length).toBe(3);
  await expect(quoted).toBeEnabled();
  const cachedValue = await quoted.inputValue();
  await edited.fill("3"); await page.clock.runFor(250);
  await expect.poll(() => observed.intents.length).toBe(4);
  await expect(quoted).toBeEnabled();
  const pausedAt = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(pausedAt + 1000));
  await edited.fill("2");
  await expect(quoted).toHaveValue(cachedValue);
  await expect(quoted).toBeEnabled();
  expect(observed.intents.length).toBe(4);
});

test.beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  streamUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/intent`;
});
test.beforeEach(() => { for (const response of active.keys()) response.destroy(); active.clear(); phase = "first"; });
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

for (const symbol of ["WETH", "ETH", "USDC"] as const) {
  for (const operation of ["issue-in", "issue-out", "redeem-in", "redeem-minimum"] as const) {
    test(`${symbol} ${operation} improves its estimate before the final quote completes`, async ({ page }) => {
      const observed = await install(page, "", undefined, streamUrl);
      await page.goto("/en"); await choose(page, symbol);
      if (operation.startsWith("redeem")) await page.getByRole("button", { name: "Reverse swap direction" }).click();
      const inputs = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)');
      const exactIn = operation.endsWith("-in"), edited = exactIn ? inputs.first() : inputs.last();
      await edited.click(); await edited.fill("1");
      const quoted = exactIn ? inputs.last() : inputs.first();
      const label = page.getByTestId("quote-estimate-description");
      await expect(label).toBeAttached(); await expect(quoted).toHaveAttribute("aria-describedby", /quote-(sell|buy)-estimate/); await expect(quoted).not.toHaveValue(""); await expect(quoted).toBeDisabled();
      const first = Number((await quoted.inputValue()).replace(/\s/g, "")); expect(first).toBeGreaterThan(0);
      advance("better");
      await expect.poll(async () => { const value = Number((await quoted.inputValue()).replace(/\s/g, "")); return exactIn ? value > first : value < first; }).toBe(true);
      await expect(label).toBeAttached(); await expect(quoted).toBeDisabled(); expect(active.size).toBe(1);
      expect(observed.intents).toHaveLength(1);
      advance("complete"); await expect(label).not.toBeAttached(); await expect(quoted).toBeEnabled(); await expect(quoted).not.toHaveValue("");
    });
  }
}

test("an errored intent removes its provisional amount", async ({ page }) => {
  await install(page, "", undefined, streamUrl); await page.goto("/en"); await choose(page, "WETH");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  advance("error");
  await expect(page.getByTestId("quote-estimate-description")).not.toBeAttached();
  await expect(page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last()).toHaveValue("");
  await expect(page.getByText("The quote service could not process this request. Retry.", { exact: true }).first()).toBeVisible();
});

test("changed input amounts cancel old intents and clear old estimates", async ({ page }) => {
  await install(page, "", undefined, streamUrl); await page.goto("/en"); await choose(page, "WETH");
  const edited = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first(); await edited.fill("1");
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  const old = [...active.keys()]; phase = "partial"; await edited.fill("2");
  await expect.poll(() => old.every(response => !active.has(response))).toBe(true);
  await expect(page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last()).toHaveValue("");
  advance("first"); await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
});

test("an edit cancels its old stream before the replacement typing debounce elapses", async ({ page }) => {
  await install(page, "", undefined, streamUrl); await page.goto("/en"); await choose(page, "WETH");
  const edited = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
  await edited.fill("1");
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  const frozenAt = Date.now() + 1_000;
  await page.clock.install({ time: new Date(frozenAt) });
  await page.clock.pauseAt(new Date(frozenAt + 1_000));
  const old = [...active.keys()], count = active.size;
  phase = "partial";
  await edited.fill("2");
  // No logical time advances: cancellation cannot depend on the 100 ms timer.
  await expect.poll(() => old.every(response => !active.has(response))).toBe(true);
  expect(active.size).toBe(0);
  await page.clock.runFor(99);
  expect(active.size).toBe(0);
  await page.clock.runFor(1);
  await expect.poll(() => active.size).toBe(count);
  expect([...active.values()][0].amount).toBe("2000000000000000000");
});

async function visible(page: import("@playwright/test").Page, value: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => !value });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value ? "visible" : "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}

test("a hidden tab cancels its stream and renews an expired quote only when visible", async ({ page }) => {
  const observed = await install(page, "", undefined, streamUrl); await page.goto("/en"); await choose(page, "WETH");
  await page.clock.install();
  const edited = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first(), quoted = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last();
  await edited.fill("1");
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  advance("qualified"); await expect(quoted).toBeEnabled();
  const previous = [...active.keys()], before = observed.intents.length;
  let heads = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/transaction/wait/head") heads++; });
  await visible(page, false);
  await expect.poll(() => previous.every(response => !active.has(response))).toBe(true);
  const hiddenHeads = heads;
  await page.clock.fastForward(601_000);
  expect(observed.intents.length).toBe(before);
  expect(heads).toBe(hiddenHeads);
  phase = "partial";
  await visible(page, true);
  await expect.poll(() => observed.intents.length).toBe(before + 1);
  await expect.poll(() => heads).toBeGreaterThan(hiddenHeads);
  await expect(quoted).toBeDisabled();
  const now = await page.evaluate(() => Math.floor(Date.now() / 1000));
  const deadline = Number(observed.intents.at(-1)!.deadline);
  expect(deadline).toBeGreaterThan(now);
  expect(deadline - now).toBeLessThanOrEqual(600);
  advance("complete"); await expect(quoted).toBeEnabled();
});

test("returning promptly to a completed fresh quote does not restart it", async ({ page }) => {
  phase = "complete";
  const observed = await install(page, "", undefined, streamUrl); await page.goto("/en"); await choose(page, "WETH");
  await page.clock.install();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect(page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last()).toBeEnabled();
  await expect(page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last()).toHaveValue("2");
  const before = observed.intents.length;
  await visible(page, false); await page.clock.runFor(1_000); await visible(page, true);
  await page.clock.runFor(250);
  expect(observed.intents.length).toBe(before);
  await expect(page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last()).toHaveValue("2");
});

test("an initially hidden page defers its first quote until it becomes visible", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  });
  const observed = await install(page, "", undefined, streamUrl); await page.goto("/en"); await choose(page, "WETH");
  await page.clock.install();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await page.clock.runFor(1_000);
  expect(observed.intents).toHaveLength(0);
  await visible(page, true);
  await expect.poll(() => observed.intents.length).toBe(1);
});

test("token changes and reversal cancel intents from the previous direction", async ({ page }) => {
  await install(page, "", undefined, streamUrl); await page.goto("/en"); await choose(page, "WETH");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  const old = [...active.keys()]; await page.getByRole("button", { name: "WETH WETH", exact: true }).click();
  await page.getByPlaceholder("Search currency...").fill("USDC");
  await page.locator("#dropdown-from").getByRole("button").filter({ has: page.getByText("USDC", { exact: true }) }).click();
  await expect.poll(() => old.every(response => !active.has(response))).toBe(true);
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  const before = [...active.keys()]; await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await expect.poll(() => before.every(response => !active.has(response))).toBe(true);
  await expect.poll(() => [...active.values()].every(request => request.mode.startsWith("redeem") && request.quoteToken.toLowerCase() === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")).toBe(true);
});

test("a previous estimate stays visible while an improved preview is pending", async ({ page }) => {
  await install(page, "", undefined, streamUrl); await page.goto("/en"); await choose(page, "WETH");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  const quoted = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last(); await expect(quoted).toHaveValue("1");
  advance("preview-pending"); await expect(quoted).toHaveValue("1"); await expect(quoted).toBeDisabled();
  advance("better"); await expect(quoted).toHaveValue("2");
  advance("complete"); await expect(quoted).toHaveValue("2"); await expect(quoted).toBeEnabled();
});

test("partial route progress produces no basket estimate", async ({ page }) => {
  phase = "partial"; await install(page, "", undefined, streamUrl); await page.goto("/en"); await choose(page, "WETH");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1"); await expect.poll(() => active.size).toBe(1);
  await expect(page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last()).toHaveValue("");
  advance("first"); await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
});

for (const width of [1280, 390]) {
  test(`${width}px amount and local equivalents update and clear in the same rendered frame`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await install(page, "", undefined, streamUrl);
    await page.goto("/en"); await choose(page, "USDC");
    const edited = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
    const quoted = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last();
    const equivalent = page.getByTestId("buy-amount-equivalents").filter({ visible: true });
    await edited.fill("1");
    await expect(quoted).toHaveValue("1");
    await expect(equivalent).toContainText("200");
    await page.evaluate(() => {
      const frames: Array<{ amount: string; value: string }> = [];
      Object.assign(window, { amountValueFrames: frames });
      new MutationObserver(() => {
        const input = document.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]:not(#execution-tolerance)')[1];
        const value = [...document.querySelectorAll<HTMLElement>('[data-testid="buy-amount-equivalents"]')]
          .find(element => element.getClientRects().length > 0);
        frames.push({ amount: input.value, value: value?.textContent ?? "" });
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    advance("better"); await expect(quoted).toHaveValue("2");
    await expect(equivalent).toContainText("400");
    advance("complete"); await expect(quoted).toHaveValue("2");
    await expect(equivalent).toContainText("400");
    phase = "partial"; await edited.fill("3");
    await expect(quoted).toHaveValue("");
    await expect(equivalent).not.toContainText("400");
    const frames = await page.evaluate(() => (window as unknown as {
      amountValueFrames: Array<{ amount: string; value: string }>
    }).amountValueFrames);
    for (const frame of frames) {
      if (frame.amount === "1") expect(frame.value).toContain("200");
      if (frame.amount === "2") expect(frame.value).toContain("400");
      if (frame.amount === "") expect(frame.value).not.toMatch(/200|400/);
    }
    await test.info().attach("amount-value-frames", {
      contentType: "application/json", body: JSON.stringify({ width, frames,
        scope: "Controlled DOM commits, using already loaded reference prices; no new valuation RPC." }),
    });
  });
}
