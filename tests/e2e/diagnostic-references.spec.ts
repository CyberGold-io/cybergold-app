import { expect, test } from "./fixtures/app-test";
import { install, choose } from "./fixtures/token-quotes";

test("a quote failure keeps its localized message and copyable Backend reference", async ({ page, context }) => {
  await install(page);
  const requestId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e", correlationId = "eb3e6932-a2af-4303-a09e-35831f864a1d";
  const events: Record<string, unknown>[] = [];
  await page.route("**/api/diagnostics", route => { events.push(route.request().postDataJSON()); return route.fulfill({ status: 204 }); });
  await page.route("**/api/economic-quotes", route => {
    expect(route.request().headers()["x-cybergold-attempt-id"]).toMatch(/^[0-9a-f-]{36}$/);
    return route.fulfill({ headers: { "X-CyberGold-Request-Id": requestId }, status: 503, json: { code: "rpc-timeout", correlationId, requestId, error: "private-provider-diagnostic" } });
  });
  await page.goto("/en"); await choose(page, "USDC");
  await page.locator("#sell-amount").fill("10");
  await expect(page.getByTestId("diagnostic-reference")).toContainText(correlationId);
  await expect(page.getByText("RPC error: the server did not respond in time. Retry.", { exact: true })).toBeVisible();
  await expect(page.getByText("private-provider-diagnostic")).toHaveCount(0);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy reference", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reference copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(correlationId);
  await expect.poll(() => events.some(event => event.operation === "quote" && event.outcome === "failed"
    && event.requestId === requestId && event.correlationId === correlationId && event.errorClassification === "rpc-timeout")).toBe(true);
});
