/** Native selection and caller controls use inert Page-shaped objects only. */
import assert from 'node:assert/strict';

import { test } from 'node:test';
import { errors, expect, type Page } from '@playwright/test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as helper from '../../tests/metamask/wallet-ui.ts';
import { appEnvironment, withEnvironment } from '../../tests/fixtures/environment.mts';

const { requestWallet } = await withEnvironment(appEnvironment, () => import('../../tests/trading/walletExecution.ts'));

const buttonFor = helper.walletRequestButton;
const check = test;

type State = { visible: boolean; enabled?: boolean };
function fixture(definitions: { name: string; path?: string; controls?: Record<string, State>; closed?: boolean }[], onClick?: () => void) {
  const actions: string[] = [], inspections: string[] = [];
  type View = {
    name: string; path: string; controls: Record<string, State>; closed?: boolean;
    url(): string; bringToFront(): Promise<void>; goto(url: string, options: unknown): Promise<void>;
    setDefaultTimeout(timeout: number): void; getByTestId(id: string): Locator; locator(selector: string): Locator;
    isClosed(): boolean;
  };
  class Locator {
    view: View;
    ids: string[];
    constructor(view: View, ids: string[]) { this.view = view; this.ids = ids; }
    or(other: Locator) { return new Locator(this.view, [...new Set([...this.ids, ...other.ids])]); }
    matches() {
      if (this.view.closed) throw Object.assign(new Error('Closed inert view'), { name: 'TargetClosedError' });
      const found = this.ids.filter(id => Object.hasOwn(this.view.controls, id));
      if (found.length > 1) throw Object.assign(new Error('Ambiguous inert locator'), { name: 'StrictModeError' });
      return found.map(id => this.view.controls[id]);
    }
    async isVisible() { inspections.push(this.view.name); return this.matches()[0]?.visible ?? false; }
    async click() {
      const state = this.matches()[0];
      if (!state?.visible || state.enabled === false) throw new errors.TimeoutError('Ordinary inert click timeout');
      actions.push(`click:${this.view.name}`);
      onClick?.();
    }
  }
  function view(d: typeof definitions[number]) {
    const v: View = { ...d, path: d.path ?? 'notification.html', controls: d.controls ?? {},
      url: () => `chrome-extension://fixture/${v.path}`,
      bringToFront: async () => { if (v.closed) throw new Error('Closed inert view'); actions.push(`focus:${v.name}`); },
      goto: async (url: string, options: unknown) => { actions.push(`goto:${v.name}`); assert.equal(url, 'chrome-extension://fixture/notification.html'); assert.deepEqual(options, { waitUntil: 'domcontentloaded' }); },
      isClosed: () => Boolean(v.closed),
      setDefaultTimeout: (timeout: number) => { assert.equal(timeout, 30000); },
      getByTestId: (id: string) => new Locator(v, [id]),
      locator: (selector: string) => { assert.equal(selector, '.page-container__footer [data-testid="page-container-footer-next"]'); return new Locator(v, ['legacy']); },
    };
    return v;
  }
  const views = definitions.map(view);
  const page = { context: () => ({ serviceWorkers: () => [{ url: () => 'chrome-extension://fixture/background.js' }],
    pages: () => views, newPage: async () => { const v = view({ name: 'created', path: 'about-blank' }); views.push(v); actions.push('create'); return v; } }) };
  return { page: page as unknown as Page, views: views as unknown as Page[], actions, inspections };
}
const confirm = { 'confirm-footer-button': { visible: true } };
await check('single existing active notification stays unmodified', async () => {
  const f = fixture([{ name: 'active', controls: confirm }]);
  assert.equal(await helper.notification(f.page, undefined, buttonFor), f.views[0]);
  await buttonFor(f.views[0]).click();
  assert.deepEqual(f.actions, ['focus:active', 'click:active']);
});
await check('blank first notification does not hide later native confirmation', async () => {
  const f = fixture([{ name: 'blank' }, { name: 'active', controls: confirm }]);
  assert.equal(await helper.notification(f.page, undefined, buttonFor), f.views[1]);
  assert.deepEqual(f.actions, ['focus:active']);
});
await check('visible home confirmation is preserved without navigating', async () => {
  const f = fixture([{ name: 'blank' }, { name: 'active', path: 'home.html#confirm-transaction/request', controls: confirm }]);
  assert.equal(await helper.notification(f.page, undefined, buttonFor), f.views[1]);
  assert.deepEqual(f.actions, ['focus:active']);
});
await check('closed first view does not hide later native confirmation', async () => {
  const f = fixture([{ name: 'closed', closed: true }, { name: 'active', controls: confirm }]);
  assert.equal(await helper.notification(f.page, undefined, buttonFor), f.views[1]);
  assert.deepEqual(f.actions, ['focus:active']);
});
await check('visible disabled control retains ordinary native click error', async () => {
  const f = fixture([{ name: 'disabled', controls: { 'confirm-footer-button': { visible: true, enabled: false } } }, { name: 'active', controls: confirm }]);
  const selected = await helper.notification(f.page, undefined, buttonFor);
  assert.equal(selected, f.views[0]);
  await assert.rejects(buttonFor(selected).click(), { name: 'TimeoutError' });
});
await check('multiple matching controls retain strict locator failure', async () => {
  const f = fixture([{ name: 'ambiguous', controls: { ...confirm, 'confirm-btn': { visible: true } } }]);
  const selected = await helper.notification(f.page, undefined, buttonFor);
  assert.equal(selected, f.views[0]);
  await assert.rejects(buttonFor(selected).click(), { name: 'StrictModeError' });
});
await check('reject selection uses the actual reject control', async () => {
  const f = fixture([{ name: 'accept-only', controls: confirm }, { name: 'reject', controls: { 'confirm-footer-cancel-button': { visible: true } } }]);
  const reject = (view: Page) => buttonFor(view, true);
  assert.equal(await helper.notification(f.page, undefined, reject), f.views[1]);
});
await check('legacy footer confirmation uses the same union as click', async () => {
  const f = fixture([{ name: 'blank' }, { name: 'legacy', controls: { legacy: { visible: true } } }]);
  assert.equal(await helper.notification(f.page, undefined, buttonFor), f.views[1]);
  await buttonFor(f.views[1]).click();
});
await check('observer failure cannot replace selected native view', async () => {
  const f = fixture([{ name: 'active', controls: confirm }]);
  assert.equal(await helper.notification(f.page, () => { throw new Error('Optional observer'); }, buttonFor), f.views[0]);
});
await check('callers without action hint keep original notification selection', async () => {
  const f = fixture([{ name: 'blank' }, { name: 'active', path: 'home.html#confirm', controls: confirm }]);
  assert.equal(await helper.notification(f.page), f.views[0]);
  assert.deepEqual(f.inspections, []);
});
await check('no visible action keeps existing home navigation fallback', async () => {
  const f = fixture([{ name: 'home', path: 'home.html' }]);
  assert.equal(await helper.notification(f.page, undefined, buttonFor), f.views[0]);
  assert.deepEqual(f.actions, ['focus:home', 'goto:home']);
});
await check('no existing view keeps page creation fallback', async () => {
  const f = fixture([]);
  const selected = await helper.notification(f.page, undefined, buttonFor);
  assert.equal(selected, f.views[0]);
  assert.deepEqual(f.actions, ['create', 'focus:created', 'goto:created']);
});
await check('first visible caller control retains native ordering', async () => {
  const f = fixture([{ name: 'first', controls: confirm }, { name: 'second', controls: confirm }]);
  assert.equal(await helper.notification(f.page, undefined, buttonFor), f.views[0]);
});

await check('independent native requests select the same visible control used for clicking', async () => {
  const pending = Promise.withResolvers<unknown>();
  const f = fixture([{ name: 'blank' }, { name: 'active', controls: confirm }], () => pending.resolve('0xpublic-fixture-hash'));
  const page = f.page as unknown as { bringToFront: () => Promise<void>; evaluate: () => Promise<unknown> };
  page.bringToFront = async () => undefined;
  page.evaluate = async () => pending.promise;
  const original = expect.poll;
  expect.poll = ((callback: () => Promise<boolean>) => ({ toBe: async (expected: boolean) => {
    assert.equal(await callback(), expected);
  } })) as unknown as typeof expect.poll;
  try {
    assert.equal(await requestWallet(f.page, { method: 'eth_sendTransaction', params: [] }), '0xpublic-fixture-hash');
    assert.deepEqual(f.actions, ['focus:active', 'click:active']);
  } finally { expect.poll = original; pending.resolve('0xpublic-fixture-hash'); }
});

await check('UI confirmation polls select and click the same native control', async () => {
  let submitted = false;
  const f = fixture([{ name: 'blank' }, { name: 'active', path: 'home.html#confirm', controls: confirm }], () => { submitted = true; });
  const source = readFileSync(new URL('../../tests/metamask/fixed-api-roundtrips.spec.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('fixed-api-roundtrips.spec.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'approveUntilMined');
  assert.ok(declaration && ts.isFunctionDeclaration(declaration));
  const javascript = ts.transpile(declaration.getText(parsed), { target: ts.ScriptTarget.ES2022 });
  const approve = vm.runInNewContext(javascript + '; approveUntilMined', {
    errors, notification: helper.notification, walletRequestButton: buttonFor,
    confirmedTransactionText: () => ({ isVisible: async () => submitted }),
    getSwapButton: async () => ({ innerText: async () => 'MetaMask 1 of 1:' }),
    uiCompletionAssertion: async (action: () => Promise<void>) => action(),
    expect: { poll: (callback: () => Promise<boolean>, options: { timeout: number; intervals: number[] }) => {
      assert.equal(options.timeout, 90000); assert.equal(Array.from(options.intervals).join(','), '250,500,1000');
      return { toBe: async (expected: boolean) => {
        let value = false;
        for (let turn = 0; turn < 2 && !value; turn++) value = await callback();
        assert.equal(value, expected);
      } };
    } },
  }) as (page: Page, submitted: () => boolean) => Promise<void>;
  const page = f.page as unknown as { getByText: () => { isVisible: () => Promise<boolean> } };
  page.getByText = () => ({ isVisible: async () => false });
  await approve(f.page, () => submitted);
  assert.deepEqual(f.actions, ['focus:active', 'click:active']);
});
