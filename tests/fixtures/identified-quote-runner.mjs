import { mock } from 'node:test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import * as matrix from '../trading/matrix.ts';
import * as helpers from '../metamask/token-flows/helpers.ts';
import { protocolConfigurationFixture as config, tokenAddresses } from './protocol-configuration.ts';

// Only the origin/browser I/O is replaced; the CLI, observer and policy run unchanged.
const codes = JSON.parse(process.env.REJECTION_FIXTURE_CODES);
const base = { ...matrix.activeMatrixTemplates().find(row => row.id === 'core-redeem-basket-exact-in-large'),
  amountRaw: '77599013858487449084', displayAmount: '77.599013858487449084', nominalUsd: '10000' };
const scenarios = codes.map((_, index) => ({ ...base, id: base.id + '-' + index }));
const facts = { basket: { assets: { status: 'success', value: [tokenAddresses.PAXG, tokenAddresses.XAUT] },
  targetsPpm: { status: 'success', value: ['500000', '500000'] } } };
let navigations = 0;
const observations = [], requests = [];
const input = { click: async () => {}, fill: async () => {
  const request = { intent: 3, inputs: [{ currency: config.contracts.core, amount: base.amountRaw }],
    outputCurrency: '0x0000000000000000000000000000000000000000' };
  requests.push(request);
  observations.push({ path: '/api/economic-quotes', request, status: 400,
    terminal: { type: 'error', code: codes[navigations - 1] } });
} };
const path = relative => fileURLToPath(new URL(relative, import.meta.url));
mock.module(path('../trading/matrix.ts'), { namedExports: { ...matrix,
  activeMatrixTemplates: () => scenarios, buildMatrix: () => scenarios,
  readValuation: async () => ({ id: 'identified-rejection-fixture' }) } });
mock.module(path('../metamask/token-flows/helpers.ts'), { namedExports: { ...helpers,
  showAllSellTokens: async () => {}, selectToken: async () => {},
  getMainInput: () => input, ensureBasketInputEditable: async () => input } });
const finish = async () => writeFileSync(process.env.REJECTION_FIXTURE_ACTIONS,
  JSON.stringify({ navigations, requests }));
chromium.launch = async () => ({ newPage: async () => ({
  setDefaultTimeout() {}, addInitScript: async () => {}, goto: async () => { navigations++; },
  getByRole: () => ({ waitFor: async () => {} }),
  evaluate: async () => structuredClone(observations), close: finish,
}), close: finish });
globalThis.fetch = async raw => {
  const pathname = new URL(raw).pathname;
  return pathname === '/en' ? new Response('<html></html>')
    : Response.json(pathname === '/api/protocol/config' ? config : facts);
};
