import type { Page } from "@playwright/test";
import { encodeAbiParameters, encodeEventTopics, type Address } from "viem";
import { protocolAddresses, protocolConfigurationFixture } from "./protocol-configuration";
import { context, install } from "../e2e/fixtures/token-quotes";
import { coreIntentRequest, tradeFixture } from "../e2e/fixtures/trade-core";
import { intentFixture } from "../e2e/fixtures/quote-intent";
import { marketTradeFixture } from "../e2e/fixtures/market-quotes";
import { HISTORICAL_HELPERS_EXECUTION_ABI as HELPERS_EXECUTION_ABI } from "./helpers-execution-legacy.ts";
import { HELPERS_MARKET_ABI } from "../../app/contracts/generated/helpersMarket";
import type { TradeQuote, TradeQuoteRequest } from "../../app/utils/tradeQuote";
import type { QuoteIntent } from "../../app/utils/quoteIntent";
import type { TradeSelectionObservation } from "../../app/utils/tradeSelectionObservation";

export const selectionOwner = "0x0000000000000000000000000000000000000011" as Address;
export const selectionHash = `0x${"ab".repeat(32)}`;
const helpers = protocolAddresses.helpers! as Address;
const ceil = (value: bigint) => (value + 9_999n) / 10_000n;

/** Transport fixtures isolate real UI/authorization code, not real provider or chain qualification. */
export function selectedQuotes(request: TradeQuoteRequest, winner: "core" | "market") {
  const providerRequest = coreIntentRequest(request);
  const providerQuote: QuoteIntent = intentFixture(providerRequest);
  const amount = BigInt(request.amount), exactIn = request.mode === "exact-in", buy = request.side === "buy";
  // Independent unit-price examples: the Core alternative is twice as good or
  // twice as expensive. Market retains its separately tested 0.1% fee fixture.
  const variable = winner === "core" ? exactIn ? amount * 2n : amount / 2n : exactIn ? amount / 2n : amount * 2n;
  if (buy) {
    providerQuote.executionAmount = String(exactIn ? variable : amount);
    providerQuote.expectedInputAmount = String(exactIn ? amount : variable);
    providerQuote.maximumInputAmount = String(exactIn ? amount : ceil(variable * 10_100n));
    if (providerQuote.basketPreview && "amountsInExact" in providerQuote.basketPreview)
      providerQuote.basketPreview.amountsInExact = [providerQuote.expectedInputAmount];
  } else {
    providerQuote.executionAmount = String(exactIn ? amount : variable);
    providerQuote.expectedOutputAmount = String(exactIn ? variable : amount);
    if ("minimumAmountOut" in providerQuote.preview)
      providerQuote.preview.minimumAmountOut = String(exactIn ? variable * 9_900n / 10_000n : amount);
  }
  providerQuote.displayAmount = String(variable);
  const core = tradeFixture(providerQuote, providerRequest), market = marketTradeFixture(request);
  const selected = Object.assign(structuredClone(winner === "core" ? core : market), {
    providerCandidates: { core, market },
    providerAssessments: {
      core: { availability: "qualified", searchOutcome: "complete" },
      market: { availability: "qualified", searchOutcome: "complete" },
    },
  });
  return { core, market, selected };
}

type Transaction = { from?: string; to?: string; data?: string; value?: string };

export async function installProviderSelection(page: Page, winner: "core" | "market", lateEvidence = false) {
  await install(page);
  const requests: TradeQuoteRequest[] = [], preparations: { operation: string; args: unknown[] }[] = [];
  let selected: TradeQuote | undefined, transaction: Transaction | undefined;
  await page.addInitScript(({ owner, hash, chain }) => {
    const calls: { method: string; params?: unknown[] }[] = [], selections: TradeSelectionObservation[] = [];
    window.addEventListener("cybergold:trade-selection", event => selections.push((event as CustomEvent<TradeSelectionObservation>).detail));
    const provider = { isMetaMask: true, selectedAddress: owner, on: () => {}, removeListener: () => {},
      request: async (request: { method: string; params?: unknown[] }) => {
        calls.push(request);
        if (["eth_accounts", "eth_requestAccounts"].includes(request.method)) return [owner];
        if (request.method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
        if (request.method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (request.method === "net_version") return String(chain);
        if (request.method === "eth_signTypedData_v4") return `0x${"01".repeat(64)}1b`;
        if (request.method === "eth_sendTransaction") return hash;
        throw new Error(`Controlled wallet does not implement ${request.method}`);
      } };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    Object.assign(window, { __selectionWalletCalls: calls, __selectionCaptures: selections });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
      info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "MetaMask", rdns: "io.metamask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { owner: selectionOwner, hash: selectionHash, chain: protocolConfigurationFixture.chainId });
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/transaction/helpers-execution") preparations.push(request.postDataJSON());
  });
  await page.route("**/api/quotes/trade/stream", async route => {
    const request = route.request().postDataJSON() as TradeQuoteRequest;
    requests.push(request);
    const values = selectedQuotes(request, winner);
    selected = values.selected;
    const loser = winner === "core" ? values.market : values.core;
    const initial = structuredClone(values.selected);
    if (lateEvidence) {
      delete initial.providerCandidates[loser.strategy];
      initial.providerAssessments[loser.strategy] = { availability: "pending", searchOutcome: "running" };
      values.selected.providerAssessments[loser.strategy] = { availability: "qualified", searchOutcome: "timeout" };
    }
    await route.fulfill({ contentType: "application/x-ndjson", body: [
      ...(lateEvidence ? [
        { type: "qualified", value: initial },
        { type: "provider-qualified", strategy: loser.strategy, value: loser },
        { type: "provider-assessment", strategy: loser.strategy, value: values.selected.providerAssessments[loser.strategy] },
        { type: "error", code: "quote-timeout" },
      ] : [
        { type: "qualified", value: loser }, { type: "qualified", value: values.selected },
        { type: "complete", value: values.selected },
      ]),
    ].map(frame => JSON.stringify(frame)).join("\n") + "\n" });
  });
  await page.route("**/api/account/wallet-balances*", route => route.fulfill({ json: {
    holder: selectionOwner, context, native: { status: "success", value: "100000000000000000000" },
    tokens: protocolConfigurationFixture.tokens.filter(token => token.type === "erc20").map(token => ({
      id: token.id, address: token.address, balance: { status: "success", value: "1000000000000000000000" } })),
  } }));
  await page.route("**/api/account/token-permit*", route => route.fulfill({ json: {
    spender: helpers, allowance: { status: "success", value: String(2n ** 255n) },
  } }));
  await page.route("**/api/account/core-permit*", route => route.fulfill({ json: {
    nonce: "0", spender: helpers, domain: { name: "CyberGold", verifyingContract: protocolAddresses.core },
  } }));
  await page.route("**/api/governance/helpers-facts*", route => route.fulfill({ json: {
    helpers, context, adapter: { address: protocolAddresses.adapter, codePresent: { status: "success", value: true } },
    configuration: { helperFeePpm: { status: "success", value: "0" },
      wrappedNative: { status: "success", value: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
      owner: { status: "success", value: selectionOwner }, paused: { status: "success", value: false },
      approvedAdapters: { status: "success", value: [protocolAddresses.adapter] },
      marketSwapExactInput: { status: "success", value: true }, marketSwapExactOutput: { status: "success", value: true },
      permit2: { status: "success", value: "0x000000000022D473030F116dDEE9F6B43aC78BA3" } },
  } }));
  await page.route("**/api/transaction/helpers-execution", route => route.fulfill({ json: { helpers, gas: "250000" } }));
  await page.route("**/api/transaction/wait/transaction*", async route => {
    const calls = await page.evaluate(() => (window as unknown as { __selectionWalletCalls: { method: string; params?: Transaction[] }[] }).__selectionWalletCalls);
    transaction = calls.find(call => call.method === "eth_sendTransaction")?.params?.[0];
    await route.fulfill({ json: { transaction: { hash: selectionHash, from: selectionOwner, to: helpers,
      nonce: "0x0", gas: "0x493e0", value: transaction?.value ?? "0x0", input: transaction?.data ?? "0x", type: "0x2",
      blockHash: context.blockHash, blockNumber: "0x64", transactionIndex: "0x0" } } });
  });
  await page.route("**/api/transaction/wait/receipt*", async route => {
    if (!selected) throw new Error("No controlled selected plan");
    const name = selected.strategy === "market" ? "MarketSwapExecuted" : selected.side === "buy" ? "Issued" : "Redeemed";
    const abi = [...HELPERS_EXECUTION_ABI, ...HELPERS_MARKET_ABI].find(row => row.type === "event" && row.name === name);
    if (!abi || abi.type !== "event") throw new Error(`Missing event ${name}`);
    const amounts: Record<string, unknown> = selected.strategy === "market"
      ? { payer: selectionOwner, recipient: selectionOwner, counterToken: selected.providerQuote.params.counterToken,
        side: selected.side === "buy" ? 0 : 1, exactInput: selected.mode === "exact-in", swapInput: BigInt(selected.providerQuote.routedAmountIn),
        amountOut: BigInt(selected.providerQuote.netOutput), inputRefund: BigInt(selected.providerQuote.refundDust),
        outputRefund: 0n, feeCygld: BigInt(selected.providerQuote.fee.amount), feeRecipient: helpers }
      : selected.side === "buy"
        ? { payer: selectionOwner, recipient: selectionOwner, inputToken: selected.tokenIn, inputUsed: BigInt(selected.quotedInput),
          netCygldOut: BigInt(selected.quotedOutput), protocolFeeCygld: 0n, helperFeeCygld: 0n }
        : { payer: selectionOwner, recipient: selectionOwner, outputToken: selected.tokenOut, grossCygldIn: BigInt(selected.quotedInput),
          amountOut: BigInt(selected.quotedOutput), recoveryAssets: [], recoveryShareAmounts: [], protocolFeeCygld: 0n, helperFeeCygld: 0n };
    const fields = abi.inputs.filter(row => !row.indexed);
    const log = { address: helpers, topics: encodeEventTopics({ abi: [abi], eventName: name, args: amounts as never }),
      data: encodeAbiParameters(fields, fields.map(field => amounts[field.name]) as never),
      blockHash: context.blockHash, blockNumber: "0x64", transactionHash: selectionHash, transactionIndex: "0x0", logIndex: "0x0", removed: false };
    await route.fulfill({ json: { receipt: { transactionHash: selectionHash, transactionIndex: "0x0", blockHash: context.blockHash,
      blockNumber: "0x64", from: selectionOwner, to: helpers, cumulativeGasUsed: "0x493e0", gasUsed: "0x493e0", effectiveGasPrice: "0x1",
      contractAddress: null, logs: [log], logsBloom: `0x${"00".repeat(256)}`, status: "0x1", type: "0x2" } } });
  });
  return { requests, preparations, selection: () => selected, transaction: () => transaction };
}
