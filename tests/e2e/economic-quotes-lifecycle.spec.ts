import { expect, test } from './fixtures/app-test';
import { installMarket, marketUniversalFixture } from './fixtures/market-quotes';
import { context } from './fixtures/token-quotes';
import { universalFixture } from './fixtures/universal-exact-input';

test('economic quote lifecycle: elapsed time, heads, focus and tolerance keep the observation until explicit Refresh', async ({ page }) => {
  const observed = await installMarket(page);
  const economicRequests: Record<string, unknown>[] = [], preparationRequests: unknown[] = [];
  let head = { ...context };
  await page.route('**/api/transaction/wait/head', route => route.fulfill({ json: { ...head, blockTimestamp: '2000000000' } }));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/economic-quotes/stream') economicRequests.push(request.postDataJSON());
    if (new URL(request.url()).pathname === '/api/tx-preparations') preparationRequests.push(request.postDataJSON());
  });
  await page.goto('/en'); await page.locator('#sell-amount').fill('1');
  await expect(page.locator('#buy-amount')).toHaveText('0.999');
  await expect.poll(() => observed.requests.length).toBe(1);
  await page.getByRole('button', { name: /Total fee/ }).click();
  const minimum = page.getByTestId('swap-minimum-output'), original = await minimum.textContent();
  await page.clock.install();
  head = { ...head, blockNumber: '101', blockHash: `0x${'b'.repeat(64)}` };
  await page.clock.runFor(12_500);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
  await page.locator('#execution-tolerance').fill('0.5');
  await page.clock.runFor(200);
  await expect(minimum).not.toHaveText(original!);
  expect(observed.requests).toHaveLength(1);
  expect(economicRequests[0]).not.toHaveProperty('recipient');
  expect(economicRequests[0]).not.toHaveProperty('deadline');
  expect(economicRequests[0]).not.toHaveProperty('slippageBps');
  expect(preparationRequests).toEqual([]);
  await page.locator('[data-trade-refresh]').click();
  await expect.poll(() => observed.requests.length).toBe(2);
  expect(economicRequests.at(-1)?.refresh).toBe(true);
  await expect(page.locator('#buy-amount')).toHaveText('0.999');
});

test('economic quote lifecycle: returning to an amount restores its measured output; a failed Refresh keeps it visible', async ({ page }) => {
  await installMarket(page);
  const requests: { amount: string; refresh: boolean }[] = [];
  await page.route('**/api/economic-quotes', async route => {
    const request = route.request().postDataJSON();
    requests.push({ amount: request.inputs[0].amount, refresh: request.refresh === true });
    if (request.refresh) { await route.fulfill({ status: 503, json: { code: 'quote-timeout', error: 'Timed out.' } }); return; }
    const output = request.inputs[0].amount === '1000000000000000000' ? '250000000000000000' : '500000000000000000';
    const market = marketUniversalFixture(request);
    await route.fulfill({ json: universalFixture(request, { routeFamily: 'market', quotedOutput: output,
      marketFeeCygld: market.fees.marketFeeCygld }) });
  });
  await page.goto('/en'); await page.locator('#sell-amount').fill('1');
  await expect(page.locator('#buy-amount')).toHaveText('0.25');
  await page.locator('#sell-amount').fill('2'); await expect(page.locator('#buy-amount')).toHaveText('0.5');
  expect(requests).toHaveLength(2);
  await page.locator('#sell-amount').fill('1'); await expect(page.locator('#buy-amount')).toHaveText('0.25');
  expect(requests).toHaveLength(2);
  await page.locator('[data-trade-refresh]').click();
  await expect.poll(() => requests.length).toBe(3);
  await expect(page.getByRole('alert').filter({ hasText: 'Refresh failed. Showing the previous quote.' })).toBeVisible();
  await expect(page.locator('#buy-amount')).toHaveText('0.25');
  expect(requests.at(-1)).toEqual({ amount: '1000000000000000000', refresh: true });
});
