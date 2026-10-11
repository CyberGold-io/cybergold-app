import { protocolAddresses } from "../fixtures/protocol-configuration";
import { routeWalletBalances } from "./fixtures/wallet-balances";
import { expect, test } from "./fixtures/app-test";
import { decodeFunctionData, erc20Abi, getAddress, maxUint256 } from "viem";
import { HELPERS_ABI_ISSUE_FROM_TOKEN } from "../../app/contracts/cybergold-helpers/issueFacet";
import { choose, context, install } from "./fixtures/token-quotes";
import { intentFixture } from "./fixtures/quote-intent";

const owner = "0x0000000000000000000000000000000000000011";
const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const hash = `0x${"ab".repeat(32)}`;
const approvalHash = `0x${"cd".repeat(32)}`;
const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const input = 10n ** 18n;
const net = input * 999n / 1000n;

for (const operation of ["purchase", "redemption"] as const) {
  for (const symbol of ["ETH", "WETH"] as const) {
    for (const firstUse of operation === "purchase" && symbol === "WETH" ? [false, true] : [false]) {
    test(`${symbol} ${operation}${firstUse ? " with first-use approval" : ""} separates the displayed output from execution slippage protection`, async ({ page }) => {
      await page.addInitScript(({ owner, hash, approvalHash, chain }) => {
        const transactions: { data: `0x${string}`; value?: string }[] = [];
        const requests: string[] = [];
        const provider = { isMetaMask: false, selectedAddress: owner,
          request: async ({ method, params }: { method: string; params?: unknown[] }) => {
            requests.push(method);
            if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [owner];
            if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts",
              caveats: [{ type: "restrictReturnedAccounts", value: [owner] }] }];
            if (method === "eth_chainId") return `0x${chain.toString(16)}`;
            if (method === "net_version") return String(chain);
            if (method === "eth_signTypedData_v4") return `0x${"01".repeat(64)}1b`;
            if (method === "eth_sendTransaction") {
              transactions.push(params![0] as { data: `0x${string}`; value?: string });
              return transactions.at(-1)!.data.startsWith("0x095ea7b3") ? approvalHash : hash;
            }
            throw new Error(`Synthetic wallet rejects ${method}`);
          }, on: () => {}, removeListener: () => {},
        };
        Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
        Object.assign(window, { __purchaseTransactions: transactions, __purchaseWalletRequests: requests });
        const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider,
          info: { uuid: "f5640300-0353-45e0-b3c8-1850146e0788", name: "Synthetic ordinary wallet", rdns: "io.synthetic.ordinary",
            icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" } } }));
        window.addEventListener("eip6963:requestProvider", announce); announce();
      }, { owner, hash, approvalHash, chain });
      await install(page);
      await page.route("**/api/diagnostics", route => route.fulfill({ status: 202, json: { accepted: true } }));
      let preparing = false, balanceStarted = false, adapterStarted = false;
      let releaseChecks!: () => void;
      const pendingChecks = new Promise<void>(resolve => { releaseChecks = resolve; });
      const walletBalances = {
        context, holder: owner, native: { status: "success", value: String(input * 100n) },
        tokens: [{ id: "weth", address: weth, balance: { status: "success", value: String(input * 100n) } },
          { id: "cygld", address: protocolAddresses.core,
            balance: { status: "success", value: String(input * 100n) } }],
      };
      await routeWalletBalances(page, async route => {
        if (preparing) { balanceStarted = true; await pendingChecks; }
        await route.fulfill({ json: walletBalances });
      });
      await page.route("**/api/governance/helpers-facts*", async route => {
        if (new URL(route.request().url()).searchParams.has("adapter")) {
          adapterStarted = true; await pendingChecks;
        }
        await route.fulfill({ json: {
        context, helpers: protocolAddresses.helpers, configuration: {
          helperFeePpm: { status: "success", value: "0" },
          permit2: { status: "success", value: "0x00000000000000000000000000000000000000b3" },
          wrappedNative: { status: "success", value: weth }, owner: { status: "success", value: owner },
          approvedAdapters: { status: "success", value: [protocolAddresses.adapter] },
          paused: { status: "success", value: false },
        }, adapter: { address: protocolAddresses.adapter, codePresent: { status: "success", value: true } },
      } }); });
      await page.route("**/api/account/core-permit*", route => route.fulfill({ json: { nonce: "0", spender: protocolAddresses.helpers, domain: { name: "CyberGold", verifyingContract: protocolAddresses.core } } }));
      let tokenContextStarted = false, approvalGasStarted = false;
      const permit2 = "0x00000000000000000000000000000000000000b3";
      await page.route("**/api/account/permit2", route => {
        const request = route.request().postDataJSON();
        return route.fulfill({ json: { context, mode: request.mode, permit2,
          result: request.mode === "allowances" ? { allowances: request.tokens.map((token: string) => ({ token, value: "0" })) }
            : request.mode === "nonce" ? { nonce: "0" } : { code: "0x01" } } });
      });
      await page.route("**/api/transaction/permit2-approval-gas", route => {
        approvalGasStarted = true; return route.fulfill({ json: { gas: "50000" } });
      });
      await page.route("**/api/account/token-permit*", route => {
        tokenContextStarted = true;
        return route.fulfill({ json: { context, token: { chainId: chain, address: weth }, owner,
          spender: protocolAddresses.helpers,
          nonce: { status: "failure", error: "not-supported" },
          allowance: { status: "success", value: firstUse ? "0" : String(maxUint256) },
          authorization: { kind: "none", confidence: "observed" },
        } });
      });
      await page.route("**/api/transaction/token-approval-gas", route => {
        approvalGasStarted = true;
        expect(route.request().postDataJSON()).toEqual({ owner, token: getAddress(weth), amount: String(input) });
        return route.fulfill({ json: { gas: "50000" } });
      });
      await page.route("**/api/quotes/intent/stream", route => {
        const request = route.request().postDataJSON(), value = intentFixture(request);
        const fees = { protocolFeeCygld: String(input - net), helperFeeCygld: "0" };
        return route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "complete", value: {
          ...value, displayAmount: String(net), executionAmount: String(operation === "purchase" ? net : input),
          preview: { ...value.preview, fees, ...(operation === "redemption" ? { minimumAmountOut: String(net * 99n / 100n) } : {}) },
          initialPreview: operation === "purchase" ? { ...value.initialPreview, fees, netCygldOut: String(net) } : null,
        } }) + "\n" });
      });
      const simulations: { operation: string; args: { netCygldOut: string }[] }[] = [];
      let finishEstimate!: () => void;
      const pendingEstimate = new Promise<void>(resolve => { finishEstimate = resolve; });
      await page.route("**/api/transaction/fees", route => route.fulfill({ json: {
        context, maxFeePerGas: "1000000000", maxPriorityFeePerGas: "1",
      } }));
      await page.route("**/api/transaction/helpers-execution", async route => {
        simulations.push(route.request().postDataJSON());
        // The signed operation estimate finishes before its transaction request.
        await pendingEstimate;
        await route.fulfill({ json: { context, helpers: protocolAddresses.helpers, gas: "360000" } }).catch(() => {});
      });
      // No transaction reaches a chain: the synthetic wallet only records calldata.
      await page.route("**/api/transaction/wait/receipt*", route => route.fulfill(
        new URL(route.request().url()).searchParams.get("hash") === approvalHash ? { json: { receipt: {
          transactionHash: approvalHash, transactionIndex: "0x0", blockHash: context.blockHash, blockNumber: "0x64",
          from: owner, to: weth, cumulativeGasUsed: "0xc350", gasUsed: "0xc350", effectiveGasPrice: "0x1",
          contractAddress: null, logs: [], logsBloom: `0x${"00".repeat(256)}`, status: "0x1", type: "0x2",
        } } } : { status: 503, json: { error: "Fixture receipt unavailable" } }));
      await page.goto("/en");
      await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
      await page.getByRole("switch").uncheck();
      await choose(page, symbol);
      if (operation === "redemption") {
        await page.getByRole("button", { name: "Reverse swap direction" }).click();
        await page.locator("#sell-amount").click();
      }
      await page.locator("#sell-amount").fill("1");
      await expect(page.locator("#buy-amount")).toHaveValue("0.999");
      const swap = page.getByRole("button", { name: "Swap currencies", exact: true });
      await expect(swap).toBeEnabled();
      preparing = true;
      await swap.click();
      const transactions = () => page.evaluate(() => (window as unknown as {
        __purchaseTransactions: { data: `0x${string}`; value?: string }[];
      }).__purchaseTransactions);
      await expect.poll(() => balanceStarted && adapterStarted).toBe(true);
      const walletRequests = await page.evaluate(() => (window as unknown as {
        __purchaseWalletRequests: string[];
      }).__purchaseWalletRequests);
      expect(walletRequests.filter(method => method.startsWith("eth_sign") || method === "eth_sendTransaction")).toEqual([]);
      releaseChecks();
      await expect.poll(() => simulations.length).toBe(1);
      if (operation === "purchase") {
        expect((await transactions()).length).toBe(firstUse ? 1 : 0);
        if (firstUse) {
          const approval = decodeFunctionData({ abi: erc20Abi, data: (await transactions())[0].data });
          expect(approval.functionName).toBe("approve");
          expect(approval.args).toEqual([getAddress(permit2), maxUint256]);
        }
      } else {
        expect((await transactions()).length).toBe(0);
      }
      finishEstimate();
      await expect.poll(async () => (await transactions()).length).toBe(firstUse ? 2 : 1);
      const submitted = (await transactions()).at(-1)!;
      const decoded = decodeFunctionData({ abi: HELPERS_ABI_ISSUE_FROM_TOKEN, data: submitted.data });
      if (operation === "purchase") {
        expect(decoded.functionName).toBe(symbol === "ETH" ? "issueFromNativeExactOut" : firstUse ? "issueFromTokenExactOutWithPermit2" : "issueFromTokenExactOut");
        const params = decoded.args![0] as { netCygldOut: bigint; maximumInputAmount?: bigint; maximumNativeIn?: bigint };
        expect(params.netCygldOut).toBe(net);
        expect(params.maximumInputAmount ?? params.maximumNativeIn).toBe(input);
        if (symbol === "ETH") expect(BigInt(submitted.value!)).toBe(input);
        expect(simulations[0].args[0].netCygldOut).toBe(String(net));
      } else {
        expect(decoded.functionName).toBe(symbol === "ETH" ? "redeemToNativeExactIn" : "redeemToTokenExactIn");
        const params = decoded.args![0] as { minimumAmountOut: bigint; grossCygldIn: bigint };
        expect(params.grossCygldIn).toBe(input);
        expect(params.minimumAmountOut).toBe(net * 99n / 100n);
      }
      expect(simulations).toHaveLength(1);
      if (operation === "purchase" && symbol === "WETH") expect(tokenContextStarted).toBe(true);
      if (firstUse) expect(approvalGasStarted).toBe(true);
    });
    }
  }
}
