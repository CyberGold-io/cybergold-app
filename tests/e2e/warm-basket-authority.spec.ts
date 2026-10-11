import { selectBasket } from "./fixtures/swap-selection";
import { expect, test } from "./fixtures/app-test";
import { install, asset } from "./fixtures/basket-quotes";
const context = { chainId: 31337, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, observedAt: "2026-10-01T00:00:00Z" };
const state = { assets: [asset], weights: ["1000000"], conversions: ["1000000000000000000"],
  issueFee: "1000", helperFee: "1000", redeemFee: "1000", supply: "100000000000000000000",
  maxSupply: "10000000000000000000000", effectiveCap: "10000000000000000000000",
  available: ["100000000000000000000"], recoveryShares: [], recoveryValues: [],
  descriptors: [{ kind: 0 as const, token: asset, id: "0" }] };
for (const mode of ["issue-exact-in", "issue-exact-out", "redeem-exact-in", "redeem-exact-out"]) {
  test(`${mode}: warm indicative display is disabled until exact authority corrects it`, async ({ page }) => {
    const observed = await install(page, false, false, undefined, 700);
    const success = <T,>(value: T) => ({ status: "success", value });
    await page.route("**/api/protocol/facts", route => route.fulfill({ json: { context: { ...context, blockTimestamp: "1790800000" },
      core: "0x00000000000000000000000000000000000000a1", helpers: "0x00000000000000000000000000000000000000b2", basketModel: { context, state },
      basket: { assets: success([asset]), targetsPpm: success(["1000000"]), goldRefGramsFp18: success(["31103476800000000000"]),
        cygldPerUnitFp18: success(["1000000000000000000"]), metadata: [{ address: asset, decimals: success(18), name: success("PAX Gold"), symbol: success("PAXG") }] },
      reference: success("2000000000000000000"), fees: { issuancePpm: success("1000"), helpersPpm: success("1000") }, pause: success(false) } }));
    await page.goto("/en"); await selectBasket(page);
    if (mode.startsWith("redeem")) await page.getByRole("button", { name: "Reverse swap direction" }).click();
    if (mode === "redeem-exact-out") await page.getByRole("button", { name: /^Basket assets/ }).click();
    const inputs = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)'), exactIn = mode.endsWith("exact-in");
    const edited = exactIn ? inputs.first() : inputs.last();
    await edited.click(); await edited.fill("3");
    const mainQuote = mode === "issue-exact-in" ? inputs.last() : inputs.first();
    const componentQuote = page.getByRole("button", { name: mode.startsWith("issue") ? "Edit sell amount (PAXG)" : "Edit buy amount (PAXG)", exact: true });
    const componentMode = mode === "issue-exact-out" || mode === "redeem-exact-in";
    if (componentMode) { await expect(componentQuote).toHaveText(/[1-9]/); await expect(componentQuote).toBeDisabled(); }
    else { await expect(mainQuote).not.toHaveValue(""); await expect(mainQuote).toBeDisabled(); }
    const initial = componentMode ? await componentQuote.textContent() : await mainQuote.inputValue();
    await expect.poll(() => observed.timings.some(row => row.completedAt !== undefined)).toBe(true);
    if (componentMode) await expect(componentQuote).toBeEnabled(); else await expect(mainQuote).toBeEnabled();
    if (mode === "issue-exact-in") await expect(mainQuote).toHaveValue("1");
    const final = componentMode ? await componentQuote.textContent() : await mainQuote.inputValue();
    // The deliberately changed exact fixture returns one token/CYGLD; the
    // historical display must never prevent that authoritative correction.
    expect(final).not.toBe(initial); expect(observed.previews).toEqual([mode]);
  });
}
