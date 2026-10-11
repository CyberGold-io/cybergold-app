import { routeWalletBalances } from "./fixtures/wallet-balances";
import { expect, test, type Page } from "./fixtures/app-test";
import { choose, context, install } from "./fixtures/token-quotes";

test("a long exact quote completes across head changes, then resumes refresh and cancels edited input", async ({ page }) => {
  let head = { ...context }, finish!: () => void;
  let waiting = new Promise<void>(resolve => { finish = resolve; });
  const observed = await install(page, "", () => waiting, false, undefined, () => head);
  await page.goto("/en"); await choose(page, "WETH");
  const edited = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
  const computed = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last();
  await edited.fill("1");
  await expect.poll(() => observed.intents.length).toBe(1);
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  await page.clock.install();
  for (let index = 1; index <= 3; index++) {
    const refreshedFacts = page.waitForResponse(response => new URL(response.url()).pathname === "/api/protocol/facts");
    head = { ...head, blockNumber: String(100 + index), blockHash: `0x${(index + 1).toString(16).padStart(64, "0")}` };
    await page.clock.runFor(12_000);
    await refreshedFacts;
    await page.clock.runFor(250);
    await expect.poll(() => observed.intents.length).toBe(process.env.QUOTE_HEAD_COMPLETION_BASELINE === "1" ? index + 1 : 1);
    if (process.env.QUOTE_HEAD_COMPLETION_BASELINE === "1") await expect(computed).toHaveValue("");
    else await expect(computed).not.toHaveValue("");
  }
  const pendingStarts = observed.intents.length;
  finish();
  await expect(computed).toHaveValue("1");
  await expect(computed).toBeEnabled();
  await expect(page.getByTestId("quote-estimate-description")).not.toBeAttached();
  waiting = new Promise<void>(resolve => { finish = resolve; });
  head = { ...head, blockNumber: "104", blockHash: `0x${"5".padStart(64, "0")}` };
  await page.clock.runFor(12_000);
  await expect.poll(() => observed.intents.length).toBe(pendingStarts + 1);
  // A new head submits the browser's best accepted execution for selected-route
  // checks. It does not ask the backend to enumerate every candidate again.
  expect(observed.intents.at(-1)?.retainedPlan?.executionAmount).toBe("1000000000000000000");
  expect(observed.intents.at(-1)?.retainedPlan?.quotes.length).toBeGreaterThan(0);
  await expect(computed).toHaveValue("1");
  await edited.fill("2");
  await page.clock.runFor(150);
  await expect.poll(() => observed.intents.length).toBe(pendingStarts + 2);
  expect(observed.intents.at(-1)?.amount).toBe("2000000000000000000");
  expect(observed.intents.at(-1)?.retainedPlan).toBeUndefined();
  finish();
  await expect(computed).toBeEnabled();
  await test.info().attach("head-completion-measurement", { contentType: "application/json", body: JSON.stringify({
    variant: process.env.QUOTE_HEAD_COMPLETION_BASELINE === "1" ? "baseline" : "completion-preserved",
    headChangesWhilePending: 3, logicalPendingMs: 36_750, pendingIntentStarts: pendingStarts,
    totalStartsAfterNormalRefreshAndEdit: observed.intents.length,
    finalCompleted: true, scope: "Synthetic delayed producer across three twelve-second head changes; request counts, not measured live RPC work or computation latency.",
  }) });
});

test("slow first head reuses facts context without duplicating the initial quote", async ({ page }) => {
  const observed = await install(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/transaction/wait/head", async route => {
    await waiting;
    await route.fulfill({ json: { ...context, blockTimestamp: String(Math.floor(Date.now() / 1000)) } });
  });
  await page.goto("/en"); await choose(page, "WETH");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  const quoted = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last();
  await expect(quoted).toHaveValue("1");
  await expect.poll(() => observed.intents.length).toBe(1);
  release(); await page.waitForTimeout(500);
  expect(observed.intents.length).toBe(process.env.QUOTE_HEAD_BOOTSTRAP_BASELINE === "1" ? 2 : 1);
});

async function wallet(page: Page) {
  await page.addInitScript(({ account, chain }) => {
    const provider = { isMetaMask: true, selectedAddress: account,
      request: async ({ method }: { method: string }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [account];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "net_version") return String(chain);
        throw new Error(`Synthetic read-only wallet rejects ${method}`);
      }, on: () => {}, removeListener: () => {} };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  }, { account: "0x00000000000000000000000000000000000000a1", chain: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337) });
}

test("unchanged heads cause no quote/fee refresh; same-height replacement refreshes both and retains display", async ({ page }) => {
  await wallet(page);
  let head = { ...context }, finish!: () => void;
  let finalPreview = Promise.resolve();
  const observed = await install(page, "", () => finalPreview, false, undefined, () => head);
  let fees = 0, facts = 0, failFees = false;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/protocol/facts") facts++; });
  await page.route("**/api/transaction/fees", route => {
    fees++;
    return route.fulfill(failFees ? { status: 503, json: { error: "Fee fixture unavailable" } } : { json: {
      context: { ...head, blockTimestamp: "1790800000" }, maxFeePerGas: String(fees * 10 ** 9), maxPriorityFeePerGas: "1",
    } });
  });
  await routeWalletBalances(page, route => route.fulfill({ json: {
    context: { ...head, blockTimestamp: "1790800000" }, holder: "0x00000000000000000000000000000000000000a1",
    native: { status: "success", value: "100000000000000000000" },
    tokens: [{ id: "weth", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", balance: { status: "success", value: "100000000000000000000" } }],
  } }));
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await expect(page.getByRole("switch")).toBeChecked();
  await page.getByRole("switch").uncheck(); // Settle the connection default before opening the picker.
  await choose(page, "WETH");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  const computed = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last();
  await expect(computed).toBeEnabled();
  await expect(computed).not.toHaveValue("");
  await expect(computed).toHaveValue("1"); // Completed execution quote, after its initial display estimate.
  // Wallet-free gas starts at mount; development Strict Mode can cancel and
  // restart that fetch before the display settles. Later reads stay head-driven.
  await expect.poll(() => fees).toBeGreaterThan(0);
  const initial = { fees, facts, quotes: observed.quotes.length, previews: observed.previews.length };
  const value = await computed.inputValue();
  await page.clock.install();
  await page.clock.runFor(60_000);
  await expect(computed).toHaveValue(value);
  expect({ fees, facts, quotes: observed.quotes.length, previews: observed.previews.length }).toEqual(initial);
  finalPreview = new Promise<void>(resolve => { finish = resolve; });
  head = { ...head, blockHash: `0x${"b".repeat(64)}` }; // Same height, different state identity.
  await page.clock.runFor(1_000);
  await expect.poll(async () => { await page.clock.runFor(1_000); return fees; }).toBe(initial.fees + 1);
  await expect.poll(() => observed.quotes.length).toBeGreaterThan(initial.quotes);
  await expect(computed).toHaveValue(value);
  await expect(page.getByRole("status").filter({ hasText: "Estimate — preparing final quote" })).toBeHidden();
  await expect(computed).toBeEnabled();
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
  finish();
  await expect(computed).toBeEnabled();
  await page.clock.runFor(5_000);
  expect(fees).toBe(initial.fees + 1);
  expect(facts).toBe(initial.facts + 1);
  failFees = true;
  head = { ...head, blockHash: `0x${"c".repeat(64)}` };
  await page.clock.runFor(12_000);
  await expect.poll(() => fees).toBeGreaterThanOrEqual(initial.fees + 2); // Ordinary failed-read retries remain independent.
  await expect(computed).toBeEnabled();
  await expect(computed).toHaveValue(value);
  await expect(page.getByRole("button", { name: "Swap currencies", exact: true })).toBeEnabled();
});

test("revisiting an amount at one head reuses route observations and exact preview calldata", async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en");
  await choose(page, "WETH");
  const edited = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
  const computed = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last();
  await edited.fill("1");
  await page.waitForTimeout(250);
  await expect(computed).toBeEnabled();
  await expect(computed).not.toHaveValue("");
  await edited.fill("2");
  await page.waitForTimeout(250);
  await expect.poll(() => observed.quotes.filter(mode => mode === "exact-in").length).toBe(2);
  await expect(computed).toBeEnabled();
  const before = { quotes: observed.quotes.length, previews: observed.previews.length };
  await edited.fill("1");
  await page.waitForTimeout(250);
  await expect(computed).toBeEnabled();
  await expect(computed).not.toHaveValue("");
  expect({ quotes: observed.quotes.length, previews: observed.previews.length }).toEqual(before);
});

test("the first head after an outage refreshes facts loaded at an older hash", async ({ page }) => {
  let ready = false, current = { ...context }, facts = 0;
  await install(page, "", undefined, false, undefined, () => current);
  await page.route("**/api/transaction/wait/head", route => route.fulfill(ready
    ? { json: { ...current, blockTimestamp: "1790800000" } }
    : { status: 503, json: { error: "Head temporarily unavailable" } }));
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/protocol/facts") facts++; });
  const initialFacts = page.waitForResponse(response => new URL(response.url()).pathname === "/api/protocol/facts");
  await page.goto("/en");
  await initialFacts;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("button", { name: /^(Select token|BASKET|XAUt XAUt|PAXG PAXG|Sélectionner un token|Token auswählen)$/ }).first()).toBeVisible();
  const before = facts;
  current = { ...current, blockHash: `0x${"b".repeat(64)}` };
  ready = true;
  await expect.poll(() => facts).toBe(before + 1);
  await page.waitForTimeout(1_100);
  expect(facts).toBe(before + 1);
});
