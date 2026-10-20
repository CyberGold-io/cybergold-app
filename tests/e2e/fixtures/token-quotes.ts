import { protocolAddresses } from "../../fixtures/protocol-configuration";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { universalFixture, universalFromCoreQuote, tradeRequestFromUniversal } from "./universal-exact-input";
import { intentFixture } from "./quote-intent";
import { coreIntentRoute, coreIntentRequest, tradeIntentBody, tradeIntentEvent } from "./trade-core";
import type { QuoteIntentRequest } from "../../../app/utils/quoteIntent";
import { expect, type Page } from "@playwright/test";
import { toFunctionSelector } from "viem";
import { HELPERS_DIAMOND_ABI } from "../../../app/contracts/generated/helpersDiamond";

export const asset = "0x45804880de22913dafe09f4980848ece6ecbaf78";
export const context = { chainId: 31337, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, observedAt: "2026-10-01T00:00:00Z" };
const success = <T,>(value: T) => ({ status: "success", value });
const adapter = protocolAddresses.adapter!;
const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
export const previewSelectors = new Set<string>(HELPERS_DIAMOND_ABI.filter(row => row.type === "function" && row.name.startsWith("preview"))
  .map(row => toFunctionSelector(row as never)));
previewSelectors.add(toFunctionSelector("quoteExactInput(bytes,uint256)"));
previewSelectors.add(toFunctionSelector("quoteExactOutput(bytes,uint256)"));

export async function install(page: Page, unavailable = "", waitForFinalPreview?: () => Promise<void>, progressive: string | false = false, basketAssets = [asset], headSource: () => typeof context = () => context, nameSource: () => string = () => "PAX Gold", models = false, basketSymbols?: readonly string[]) {
  const previews: string[] = [], quotes: string[] = [], rpcSelectors: string[] = [], poolReads: string[] = [];
  const intents: QuoteIntentRequest[] = [];
  const rawIntents: unknown[] = [];
  const modelFrame = (request: Parameters<typeof intentFixture>[0], current = context) => {
    const value = intentFixture(request, "complete", current);
    return JSON.stringify({ type: "model", value: { revision: 1,
      intent: { ...request, deadline: undefined }, protocol: null, routes: [],
      whole: [{ input: request.amount, display: request.mode === "issue-exact-in" ? value.executionAmount : value.displayAmount,
        context: current, recordedAt: Date.now() / 1000 }] } }) + "\n";
  };
  let finalStreamUrl: string | undefined;
  if (waitForFinalPreview) {
    const server = createServer(async (request, response) => {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Headers", "content-type,x-cybergold-attempt-id");
      if (request.method === "OPTIONS") { response.end(); return; }
      let body = ""; for await (const chunk of request) body += chunk;
      const value = JSON.parse(body), current = headSource();
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      // The replacement-head case pauses before publishing a new estimate;
      // the page must retain its completed display without stale execution.
      if (current.blockHash === context.blockHash) response.write(JSON.stringify(tradeIntentEvent({ type: "estimate", amount: value.mode === "issue-exact-in" ? "1000000000000000000" : intentFixture(value).displayAmount, context: current }, value)) + "\n");
      await waitForFinalPreview();
      if (!response.destroyed) response.end(tradeIntentBody((models ? modelFrame(value, current) : "") + JSON.stringify({ type: "complete", value: intentFixture(value, "complete", current) }) + "\n", value));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    finalStreamUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/intent`;
    page.on("close", () => { server.closeAllConnections(); server.close(); });
  }
  await page.route("**/api/**", async route => {
    if (new URL(route.request().url()).pathname === "/api/quotes/universal-exact-input") {
      const request=route.request().postDataJSON();rawIntents.push(request);
      if(request.intent<2) {
        const legacy=coreIntentRequest(tradeRequestFromUniversal(request),basketAssets);intents.push(legacy);
        quotes.push("exact-in");previews.push((legacy.mode.startsWith("issue")?"issue-":"redeem-")+(legacy.native?"native-":"token-")+"exact-in");
        if(unavailable){await route.fulfill({status:503,json:{code:"quote-unavailable",error:"Quote is temporarily unavailable."}});return;}
        let value=intentFixture(legacy,"complete",headSource());
        if(progressive) {
          const response=await route.fetch({url:progressive,method:"POST",postData:JSON.stringify(legacy)});
          const frames=(await response.text()).split("\n").filter(Boolean).map(line=>JSON.parse(line));
          const complete=frames.findLast(frame=>frame.type==="complete")??frames.findLast(frame=>frame.type==="qualified");
          if(complete)value=complete.value;
        } else await waitForFinalPreview?.();
        await route.fulfill({json:universalFromCoreQuote(request,value,basketAssets)});return;
      }
      previews.push(request.intent===2?"issue-exact-in":"redeem-exact-in");
      if(unavailable==="basket-preview"){await route.fulfill({status:503,json:{code:"quote-unavailable"}});return;}
      await route.fulfill({json:universalFixture(request,{basketAssets,context:headSource()})});return;
    }
    if (new URL(route.request().url()).pathname === "/api/quotes/trade/stream") rawIntents.push(route.request().postDataJSON());
    route = coreIntentRoute(route, basketAssets);
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/protocol/config") { await route.fallback(); return; }
    const currentContext = headSource();
    if (path === "/api/transaction/wait/head") await route.fulfill({ json: { ...currentContext, blockTimestamp: String(Math.floor(Date.now() / 1000)) } });
    else if (path === "/api/protocol/facts") await route.fulfill({ json: {
      context: { ...currentContext, blockTimestamp: "1790800000" }, core: "0x00000000000000000000000000000000000000a1",
      helpers: "0x00000000000000000000000000000000000000b2",
      basket: { assets: success(basketAssets), targetsPpm: success(basketAssets.map((_, index) => String(Math.floor(1000000 / basketAssets.length) + (index === 0 ? 1000000 % basketAssets.length : 0)))), goldRefGramsFp18: success(basketAssets.map(() => "31103476800000000000")),
        cygldPerUnitFp18: success(basketAssets.map(() => "15551738400000000000")), metadata: basketAssets.map((address, index) => ({ address, decimals: success(18), name: success(index === 0 ? nameSource() : "Second Gold"), symbol: success(basketSymbols?.[index] ?? (index === 0 ? "PAXG" : "GOLD2")) })) },
      reference: success("2000000000000000000"), fees: { issuancePpm: success("1000"), helpersPpm: success("0") }, pause: success(false),
    } });
    else if (path === "/api/quotes/trade/model") {
      const request = route.request().postDataJSON();
      const coreRequest=coreIntentRequest({...request,recipient:protocolAddresses.helpers!,deadline:"2000000000"},basketAssets);
      const modeled=intentFixture(coreRequest,"complete",currentContext);
      await route.fulfill({ json: { namespace: "trade", intent: request, models: [],
        ...(waitForFinalPreview||progressive||models?{estimate:{strategy:"core",amount:modeled.displayAmount}}:{}) } });
    }
    else if (path === "/api/quotes/intent/stream") {
      const request = route.request().postDataJSON(); intents.push(request);
      quotes.push(request.mode.endsWith("exact-in") ? "exact-in" : "exact-out");
      previews.push((request.mode.startsWith("issue") ? "issue-" : "redeem-") + (request.native ? "native-" : "token-") + (request.mode.endsWith("exact-in") ? "exact-in" : "exact-out"));
      if (unavailable) {
        await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "error", error: "Quote is temporarily unavailable.", correlationId: "fixture" }) + "\n" }); return;
      }
      if (progressive || finalStreamUrl) { await route.continue({ url: progressive || finalStreamUrl }); return; }
      await route.fulfill({ contentType: "application/x-ndjson", body: (models ? modelFrame(request, currentContext) : "") + JSON.stringify({ type: "complete", value: intentFixture(request, "complete", currentContext) }) + "\n" });
    }
    else if (path === "/api/quotes/basket-preview") {
      const request = route.request().postDataJSON(); previews.push(request.mode);
      if (unavailable === "basket-preview") { await route.fulfill({ status: 503, json: { error: "Basket previews are temporarily unavailable." } }); return; }
      const fees = { protocolFeeCygld: "0", helperFeeCygld: "0" };
      const amounts = basketAssets.map(() => progressive && request.mode === "redeem-exact-in" ? String(BigInt(request.grossCygldIn) / BigInt(basketAssets.length)) : String(10n ** 18n));
      const estimatedGross = progressive && request.mode === "redeem-exact-out"
        ? String(request.minimumOutputs.reduce((sum: bigint, row: { minimumAmount: string }) => sum + BigInt(row.minimumAmount), 0n)) : amounts[0];
      const projectedCoreOutputs = basketAssets.map((token, index) => ({ kind: 0, token, id: "0", amount: amounts[index] }));
      const result = request.mode === "issue-exact-in" ? { fees, netCygldOut: amounts[0], amountsInExact: amounts, orderedCoreAssets: basketAssets }
        : request.mode === "issue-exact-out" ? { fees, amountsInExact: amounts, orderedCoreAssets: basketAssets }
        : request.mode === "redeem-exact-in" ? { fees, projectedCoreOutputs } : { fees, projectedCoreOutputs, grossCygldIn: estimatedGross };
      await route.fulfill({ json: { mode: request.mode, context: currentContext, helpers: "0x00000000000000000000000000000000000000b2", result } });
    } else if (path === "/api/governance/helpers-facts") await route.fulfill({ json: {
      context: currentContext, helpers: "0x00000000000000000000000000000000000000b2", configuration: {
        helperFeePpm: success("0"), permit2: success("0x00000000000000000000000000000000000000b3"),
        wrappedNative: success(weth), owner: success("0x00000000000000000000000000000000000000a1"),
        approvedAdapters: success([adapter]), paused: success(false),
        basketPermitIssuanceExactIn: success(false), basketPermitIssuanceExactOut: success(false),
      },
      adapter: { address: adapter, codePresent: success(true) },
    } });
    else if (path === "/api/protocol/recovery-assets") await route.fulfill({ json: { context: currentContext, assets: [] } });
    else if (path === "/api/pools/snapshot") {
      poolReads.push(path);
      const request = route.request().postDataJSON();
      const [token0, token1] = [request.tokenA.toLowerCase(), request.tokenB.toLowerCase()].sort();
      await route.fulfill({ json: { context: { ...currentContext, observedAt: new Date().toISOString() },
        exists: true, poolAddress: "0x00000000000000000000000000000000000000c3", token0, token1,
        sqrtPriceX96Raw: String(2n ** 96n), activeLiquidityRaw: String(10n ** 24n), tick: 0,
        token0BalanceRaw: String(10n ** 30n), token1BalanceRaw: String(10n ** 30n), fee: request.fee } });
    } else if (path === "/api/quotes/routes" || path === "/api/quotes/routes/stream") {
      if (path.endsWith("/stream") && progressive) {
        quotes.push(route.request().postDataJSON().mode);
        await route.continue({ url: progressive });
        return;
      }
      const request = route.request().postDataJSON(); quotes.push(request.mode);
      const results = request.targets.map((target: { inputAsset: string; outputAsset: string; amount: string }) => ({
        target, attempted: 4, succeeded: 4, failures: [],
        best: { path: `0x${(request.mode === "exact-in" ? target.inputAsset : target.outputAsset).slice(2)}0001f4${(request.mode === "exact-in" ? target.outputAsset : target.inputAsset).slice(2)}`,
          quote: String(10n ** 18n), route: "direct", feeInfo: "500" },
      }));
      await route.fulfill(unavailable === "uniswap" ? { status: 503, json: { error: "Route search is temporarily unavailable." } }
        : path.endsWith("/stream")
          ? { contentType: "application/x-ndjson", body: JSON.stringify({ type: "complete", value: { mode: request.mode, context: currentContext, results } }) + "\n" }
          : { json: { mode: request.mode, context: currentContext, results } });
    } else if (path === "/api/quotes/uniswap") {
      const request = route.request().postDataJSON(); quotes.push(request.mode);
      await route.fulfill(unavailable === "uniswap" ? { status: 503, json: { error: "Uniswap quotes are temporarily unavailable." } }
        : { json: { mode: request.mode, context: currentContext, result: { amount: String(10n ** 18n) } } });
    } else if (path === "/api/quotes/token-preview") {
      const request = route.request().postDataJSON(); previews.push(request.mode);
      if (request.mode.startsWith("issue") && request.mode.endsWith("exact-out")) await waitForFinalPreview?.();
      if (unavailable === "token-preview") { await route.fulfill({ status: 503, json: { error: "Token previews are temporarily unavailable." } }); return; }
      const fees = { protocolFeeCygld: "0", helperFeeCygld: "0" };
      const routeAmount = progressive && request.quotes?.length
        ? request.quotes.reduce((sum: bigint, quote: { minimumAmountOut: string }) => sum + BigInt(quote.minimumAmountOut), 0n) : 10n ** 18n;
      const result = request.mode.startsWith("redeem") ? { fees, minimumAmountOut: String(progressive ? routeAmount : BigInt(request.grossCygldIn) /
          (request.outputToken?.toLowerCase() === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" ? 10n ** 12n : 1n)),
        projectedCoreOutputs: [{ kind: 0, token: asset, id: "0", amount: String(10n ** 18n) }] }
        : request.mode.endsWith("exact-in") ? { fees, netCygldOut: String(routeAmount), orderedCoreAssets: basketAssets }
        : { fees, orderedCoreAssets: basketAssets };
      await route.fulfill({ json: { mode: request.mode, context: currentContext, helpers: "0x00000000000000000000000000000000000000b2", result } });
    } else if (path === "/api/quote-pool-cache") { poolReads.push(path); await route.fulfill({ json: { records: [] } }); }
    else if (path === "/api/gold") await route.fulfill({ json: { price: 3110.34768, fetchedAt: new Date().toISOString(), stale: false } });
    else if (path === "/api/fx") await route.fulfill({ json: { base: "USD", rates: { EUR: .9 }, fetchedAt: new Date().toISOString(), stale: false } });
    else if (path === "/api/rpc") {
      expect(path).not.toBe("/api/rpc");
      await route.continue();
    } else await route.fulfill({ status: 503, json: { error: "Unrelated fixture data unavailable" } });
  });
  return { previews, quotes, rpcSelectors, poolReads, intents, rawIntents };
}

export async function choose(page: Page, name: string) {
  const search=page.getByPlaceholder("Search currency...");
  await expect(async()=>{
    if(!await search.isVisible())await page.getByRole("button", { name: /^(Select token|BASKET|XAUt XAUt|PAXG PAXG)$/ }).first().click();
    await expect(search).toBeVisible({timeout:300});
  }).toPass();
  await search.fill(name);
  await page.locator("#dropdown-from").getByRole("button").filter({ has: page.getByText(name === "ETH" ? "Ether" : name === "USDC" ? "USDC" : name === "USDT" ? "Tether USD" : "Wrapped Ether", { exact: true }) }).click();
}
