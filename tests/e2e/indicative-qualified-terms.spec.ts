import { tradeIntentEvent } from "./fixtures/trade-core";
import { expect, test } from "./fixtures/app-test";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { install, choose, context } from "./fixtures/token-quotes";
import { intentFixture } from "./fixtures/quote-intent";
import type { QuoteIntentRequest } from "../../app/utils/quoteIntent";

test("fee row stays visible, and qualified issuance uses execution fees without an output haircut", async ({ page }) => {
  let response: ServerResponse | undefined, input: QuoteIntentRequest | undefined, requests = 0;
  const server = createServer(async (request, reply) => {
    reply.setHeader("Access-Control-Allow-Origin", "*"); reply.setHeader("Access-Control-Allow-Headers", "content-type,x-cybergold-attempt-id");
    if (request.method === "OPTIONS") { reply.end(); return; }
    let body = ""; for await (const chunk of request) body += chunk;
    input = JSON.parse(body); response = reply; requests++;
    reply.writeHead(200, { "content-type": "application/x-ndjson" });
    reply.write(JSON.stringify(tradeIntentEvent({ type: "estimate", amount: intentFixture(input!).displayAmount, context }, input!)) + "\n");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await install(page, "", undefined, `http://127.0.0.1:${(server.address() as AddressInfo).port}/intent`);
    await page.goto("/en");
    const feeRow = page.getByRole("button", { name: /Total fee/ });
    await expect(feeRow).toBeVisible(); await feeRow.click();
    await expect(page.getByText("Protocol fee", { exact: false })).toBeVisible();
    await choose(page, "WETH");
    const quoted = page.locator("#buy-amount");
    await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("3");
    await expect(quoted).toHaveText("3"); await expect(quoted).toHaveAttribute("aria-busy", "true");
    await expect(feeRow).toBeVisible();
    const value = intentFixture(input!);
    value.initialPreview!.fees = { protocolFeeCygld: "10000000000000000", helperFeeCygld: "0" };
    value.preview.fees = { protocolFeeCygld: "1000000000000000", helperFeeCygld: "0" };
    response!.write(JSON.stringify(tradeIntentEvent({ type: "qualified", value }, input!)) + "\n");
    await expect(quoted).not.toHaveAttribute("aria-busy", "true"); await expect(quoted).toHaveText("3");
    await expect(page.getByText(/^0\.001 CYGLD/)).toBeVisible();
    await expect(page.getByText(/^0\.01 CYGLD/)).toHaveCount(0);
    await expect(page.getByTestId("quote-estimate-description")).not.toBeAttached();
    response!.end(JSON.stringify(tradeIntentEvent({ type: "complete", value }, input!)) + "\n");
    await expect(feeRow).toBeVisible(); expect(requests).toBe(1);
    await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("");
    await expect(quoted).toHaveText(/^0(?:[.,]0+)?$/); await expect(feeRow).toBeVisible();
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
