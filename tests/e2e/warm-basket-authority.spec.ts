import { selectBasket } from "./fixtures/swap-selection";
import { expect, test } from "./fixtures/app-test";
import { install, asset } from "./fixtures/basket-quotes";
const context = { chainId: 31337, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, observedAt: "2026-10-01T00:00:00Z" };
const state = { assets: [asset], weights: ["1000000"], conversions: ["1000000000000000000"],
  issueFee: "1000", helperFee: "1000", redeemFee: "1000", supply: "100000000000000000000",
  maxSupply: "10000000000000000000000", effectiveCap: "10000000000000000000000",
  available: ["100000000000000000000"], recoveryShares: [], recoveryValues: [],
  descriptors: [{ kind: 0 as const, token: asset, id: "0" }] };
for (const mode of ["issue-exact-in", "redeem-exact-in"]) {
  test(`${mode}: warm read-only display stays busy until exact authority corrects it`, async ({ page }) => {
    const observed = await install(page, false, false, undefined, 700);
    const success = <T,>(value: T) => ({ status: "success", value });
    await page.route("**/api/protocol/facts", route => route.fulfill({ json: { context: { ...context, blockTimestamp: "1790800000" },
      core: "0x00000000000000000000000000000000000000a1", helpers: "0x00000000000000000000000000000000000000b2", basketModel: { context, state },
      basket: { assets: success([asset]), targetsPpm: success(["1000000"]), goldRefGramsFp18: success(["31103476800000000000"]),
        cygldPerUnitFp18: success(["1000000000000000000"]), metadata: [{ address: asset, decimals: success(18), name: success("PAX Gold"), symbol: success("PAXG") }] },
      reference: success("2000000000000000000"), fees: { issuancePpm: success("1000"), helpersPpm: success("1000") }, pause: success(false) } }));
    await page.goto("/en"); await selectBasket(page);
    if (mode.startsWith("redeem")) await page.getByRole("button", { name: "Reverse swap direction" }).click();
    const inputs = page.locator('input[inputmode="decimal"]:not(#execution-tolerance):visible');
    const edited = inputs.first();
    await edited.click(); await edited.fill("3");
    const quote = mode === "issue-exact-in" ? page.locator("#buy-amount")
      : page.getByRole("status", { name: "Buy amount (PAXG)", exact: true });
    await expect(quote).toHaveJSProperty("tagName", "OUTPUT");
    await expect(quote).not.toHaveText(/^(?:0(?:[.,]0+)?|\.\.\.)?$/);
    await expect(quote).toHaveAttribute("aria-busy", "true");
    const initial = (await quote.textContent())!;
    await expect.poll(() => observed.timings.some(row => row.completedAt !== undefined)).toBe(true);
    await expect(quote).not.toHaveAttribute("aria-busy", "true");
    if (mode === "issue-exact-in") await expect(quote).toHaveText("1");
    const final = (await quote.textContent())!;
    // The deliberately changed exact fixture returns one token/CYGLD; the
    // historical display must never prevent that authoritative correction.
    expect(final).not.toBe(initial); expect(observed.previews).toEqual([mode]);
  });
}
