import { universalFixture } from "./universal-exact-input";
import { protocolAddresses } from "../../fixtures/protocol-configuration";
import { expect, type Page } from "@playwright/test";
import { encodeFunctionData } from "viem";
import { HELPERS_DIAMOND_ABI } from "../../../app/contracts/generated/helpersDiamond";
import { CORE_DIAMOND_ABI } from "../../../app/contracts/generated/coreDiamond";

const asset = "0x45804880de22913dafe09f4980848ece6ecbaf78";
const context = { chainId: 31337, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, observedAt: "2026-10-01T00:00:00Z" };
const success = <T,>(value: T) => ({ status: "success", value });
const previewSelectors = new Set(["previewIssueFromBasketExactIn", "previewIssueFromBasketExactOut",
  "previewRedeemToBasketExactIn", "previewRedeemToBasketExactOut"].map(name =>
  encodeFunctionData({ abi: HELPERS_DIAMOND_ABI, functionName: name, args: name.endsWith("ExactOut") && name.startsWith("previewRedeem") ? [[]] : name.endsWith("ExactIn") && name.startsWith("previewIssue") ? [[]] : [1n] } as never).slice(0, 10)));
const recoverySelector = encodeFunctionData({ abi: CORE_DIAMOND_ABI, functionName: "coreAttachedRecoveryAssets" }).slice(0, 10);
const precisionSelector = encodeFunctionData({ abi: CORE_DIAMOND_ABI, functionName: "recoveryPool", args: [asset] }).slice(0, 10);

export async function install(page: Page, unavailable = false, recoveryUnavailable = false, precision?: number | "unavailable", responseDelayMs = 0) {
  const previews: string[] = [], rpcSelectors: string[] = [], recoveryReads: string[] = [], precisionReads: string[] = [];
  const timings: { mode: string; request: unknown; receivedAt: number; completedAt?: number }[] = [];
  const diagnosticTimings: { operation: string; outcome: string; receivedAt: number }[] = [];
  const diagnostics: { operation: string; outcome: string }[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/protocol/config") { await route.fallback(); return; }
    if (path === "/api/protocol/facts") await route.fulfill({ json: {
      context: { ...context, blockTimestamp: "1790800000" }, core: "0x00000000000000000000000000000000000000a1",
      helpers: "0x00000000000000000000000000000000000000b2",
      basket: { assets: success([asset]), targetsPpm: success(["1000000"]), goldRefGramsFp18: success(["31103476800000000000"]),
        cygldPerUnitFp18: success(["15551738400000000000"]), metadata: [{ address: asset, decimals: success(18), name: success("PAX Gold"), symbol: success("PAXG") }] },
      reference: success("2000000000000000000"), fees: { issuancePpm: success("1000"), helpersPpm: success("1000") }, pause: success(false),
    } });
    else if (path === "/api/protocol/recovery-assets") {
      recoveryReads.push(path);
      await route.fulfill(recoveryUnavailable
        ? { status: 503, json: { error: "Core recovery assets are temporarily unavailable." } }
        : { json: { context: { ...context, blockTimestamp: "1790800000" },
            core: "0x00000000000000000000000000000000000000a1", assets: [] } });
    } else if (path === "/api/protocol/recovery-share-precision") {
      precisionReads.push(new URL(route.request().url()).searchParams.get("asset")!);
      await route.fulfill(precision === "unavailable" ? { status: 503, json: { error: "Precision unavailable" } }
        : { json: { context: { ...context, blockTimestamp: "1790800000" },
          core: protocolAddresses.core, asset, shareDecimals: precision } });
    } else if(path==="/api/quotes/universal-exact-input") {
      const request=route.request().postDataJSON();
      const mode=request.intent===2?"issue-exact-in":"redeem-exact-in";previews.push(mode);
      const timing={mode,request,receivedAt:Date.now(),completedAt:undefined as number|undefined};timings.push(timing);
      if(responseDelayMs)await new Promise(resolve=>setTimeout(resolve,responseDelayMs));
      if(unavailable){await route.fulfill({status:503,json:{error:"Basket quotes are temporarily unavailable."}});return;}
      const projected=[{kind:0,token:asset,id:"0",amount:String(10n**18n)}];
      if(precision!==undefined)projected.push({kind:1,token:protocolAddresses.core!,id:BigInt(asset).toString(),amount:"2500001"});
      await route.fulfill({json:universalFixture(request,{basketAssets:[asset],quotedOutput:request.intent===2?String(10n**18n):"0",recipientOutputs:request.intent===3?projected:undefined,context})});
      timing.completedAt=Date.now();
    } else if (path === "/api/quotes/basket-preview") {
      const request = route.request().postDataJSON(); previews.push(request.mode);
      const timing = { mode: request.mode, request, receivedAt: Date.now(), completedAt: undefined as number | undefined }; timings.push(timing);
      if (responseDelayMs) await new Promise(resolve => setTimeout(resolve, responseDelayMs));
      if (unavailable) { await route.fulfill({ status: 503, json: { error: "Basket previews are temporarily unavailable." } }); return; }
      const fees = { protocolFeeCygld: "0", helperFeeCygld: "0" };
      const amounts = [String(10n ** 18n)];
      const projectedCoreOutputs = [{ kind: 0, token: asset, id: "0", amount: amounts[0] }];
      if (precision !== undefined) projectedCoreOutputs.push({ kind: 1,
        token: protocolAddresses.core!, id: BigInt(asset).toString(), amount: "2500001" });
      const result = request.mode === "issue-exact-in" ? { fees, netCygldOut: amounts[0], amountsInExact: amounts, orderedCoreAssets: [asset] }
        : request.mode === "issue-exact-out" ? { fees, amountsInExact: amounts, orderedCoreAssets: [asset] }
        : request.mode === "redeem-exact-in" ? { fees, projectedCoreOutputs } : { fees, projectedCoreOutputs, grossCygldIn: amounts[0] };
      await route.fulfill({ json: { mode: request.mode, context, helpers: "0x00000000000000000000000000000000000000b2", result } });
      timing.completedAt = Date.now();
    } else if (path === "/api/diagnostics") {
      diagnostics.push(route.request().postDataJSON());
      diagnosticTimings.push({ ...route.request().postDataJSON(), receivedAt: Date.now() });
      await route.fulfill({ status: 202, json: { accepted: true } });
    } else if (path === "/api/gold") await route.fulfill({ json: { price: 3110.34768, fetchedAt: new Date().toISOString(), stale: false } });
    else if (path === "/api/fx") await route.fulfill({ json: { base: "USD", rates: { EUR: .9 }, fetchedAt: new Date().toISOString(), stale: false } });
    else if (path === "/api/rpc") {
      expect(path).not.toBe("/api/rpc");
      await route.continue();
    } else await route.fulfill({ status: 503, json: { error: "Unrelated fixture data unavailable" } });
  });
  return { timings, diagnosticTimings, previews, rpcSelectors, recoveryReads, precisionReads, diagnostics };
}

export { asset, previewSelectors, recoverySelector, precisionSelector };
