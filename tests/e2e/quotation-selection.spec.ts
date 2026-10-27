import { decodeFunctionData, type Hex } from "viem";
import { expect, test } from "./fixtures/app-test";
import { installProviderSelection, selectionOwner } from "../fixtures/provider-selection";
import { selectToken, showAllSellTokens, getMainInput, getSwapButton } from "../metamask/token-flows/helpers";
import { HELPERS_EXECUTION_ABI } from "../../app/contracts/cybergold-helpers/execution";
import type { TradeSelectionObservation } from "../../app/utils/tradeSelectionObservation";
import { protocolAddresses } from "../fixtures/protocol-configuration";
import { assertCapturedTradeInput, observedPreparation } from "../trading/planAssertions";
import { quoteObservations } from "../trading/quoteObservation";

// Controlled responses and wallet transport test actual product wiring. Real
// provider qualification and mined settlement are separate fork-run evidence.
for (const winner of ["core", "market"] as const)
  for (const side of ["buy", "sell"] as const)
    for (const mode of ["exact-in"] as const)
      for (const lateEvidence of [false, true])
      test(`${winner} wins ${side} ${mode}, ${lateEvidence ? "delayed complete search" : "completed search"}: actual UI click binds the submitted family and economics`, async ({ page }) => {
        const fixture = await installProviderSelection(page, winner, lateEvidence);
        await page.goto("/en");
        await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible({ timeout: 20_000 });
        await showAllSellTokens(page);
        await selectToken(page, "sell", side === "buy" ? "PAXG" : "CYGLD");
        await selectToken(page, "buy", side === "buy" ? "CYGLD" : "PAXG");
        const entered = getMainInput(page, mode === "exact-in" ? "sell" : "buy");
        await entered.click(); await entered.fill("1");
        const swap = await getSwapButton(page);
        await expect(swap).toBeEnabled();
        const selected = fixture.selection()!;
        expect(selected.strategy).toBe("universal");
        expect(selected.routeFamily).toBe(winner); expect(selected.request.intent).toBe(side === "buy" ? 0 : 1);
        if (winner === "core") {
          expect(mode === "exact-in" ? selected.quotedOutput : selected.quotedInput)
            .toBe(mode === "exact-in" ? "2000000000000000000" : "500000000000000000");
        }
        await swap.click();
        await expect(page.getByTestId("trade-receipt")).toContainText(/confirmed/i);
        const captures = await page.evaluate(() =>
          (window as unknown as { __selectionCaptures: TradeSelectionObservation[] }).__selectionCaptures);
        expect(captures).toHaveLength(1);
        expect(captures[0].economicQuote).toMatchObject(selected);
        expect(captures[0].deployment?.helpers?.toLowerCase()).toBe(protocolAddresses.helpers!.toLowerCase());
        expect(captures[0].economicQuote!.request).toMatchObject({
          intent: side === "buy" ? 0 : 1, inputs: [{ amount: "1000000000000000000" }],
        });
        const calls = await page.evaluate(() =>
          (window as unknown as { __selectionWalletCalls: { method: string; params?: { data?: string; to?: string }[] }[] }).__selectionWalletCalls);
        const sent = calls.filter(call => call.method === "eth_sendTransaction");
        expect(sent).toHaveLength(1);
        const observations = await quoteObservations(page);
        await assertCapturedTradeInput(captures[0], sent[0].params![0].data as Hex, selectionOwner, observations);
        const prepared = observedPreparation(captures[0], selectionOwner, observations)!;
        const decoded = decodeFunctionData({ abi: HELPERS_EXECUTION_ABI, data: sent[0].params![0].data as Hex });
        expect(decoded.functionName).toBe("executeExactInput");
        const params = decoded.args![0] as { intent: number; inputs: readonly {amount:bigint}[]; minimumOutput:bigint; body:Hex };
        expect(params.inputs[0].amount).toBe(1_000_000_000_000_000_000n);
        expect(params.minimumOutput).toBe(BigInt(selected.quotedOutput) * 9900n / 10000n);
        expect(params.body).toBe(prepared.plan.body);
        expect(fixture.preparations).toHaveLength(1);
        expect(fixture.preparations[0].quote).toMatchObject(selected);
      });

