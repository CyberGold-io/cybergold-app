import { decodeAbiParameters, parseAbiParameters } from 'viem';
import type { Page, Route } from '@playwright/test';
import type { EconomicQuote, EconomicRequest, PreparedTransaction } from '../../../app/utils/economicQuotes';
import type { UniversalExactInputQuote } from '../../../app/utils/universalExactInput';
import { universalFixture } from './universal-exact-input';

const template = '(address inputCurrency,address outputCurrency,uint256 minimumOutput,(uint32 sharePpm,(uint8 kind,address currencyOut,uint24 fee,int24 tickSpacing)[] steps)[] routes)';
const continuation = `(${template} route,uint256 feeCygld)`;
const tokenMinimum = '(uint8 kind,address token,uint256 id,uint256 minimumAmount)';
const decode = (type: string, data: string) => decodeAbiParameters(parseAbiParameters(type), data as `0x${string}`)[0] as Record<string, unknown>;

/** Retained browser examples describe economics; they do not simulate a real Quoter. */
export function economicFixture(value: UniversalExactInputQuote, request: EconomicRequest): EconomicQuote {
  const allocations: { kind: 0 | 1; amountIn: string }[] = [];
  let body: Record<string, unknown>;
  if (request.intent === 2) body = decode(`(${continuation}[] continuations)`, value.plan.body);
  else if (request.intent === 3) body = { expectedOutputs: value.estimatedRecipientOutputs };
  else {
    const decoded = decode('((uint8 kind,uint256 amountIn,bytes data)[] branches)', value.plan.body);
    body = { branches: (decoded.branches as { kind: bigint; amountIn: bigint; data: string }[]).map(branch => {
      const kind = Number(branch.kind) as 0 | 1;
      allocations.push({ kind, amountIn: String(branch.amountIn) });
      const branchBody = kind === 1 ? decode(`(${template} route,uint256 feeCygld)`, branch.data)
        : request.intent === 0 ? decode(`(address[] basketAssets,(uint256 amountIn,${template} route)[] acquisitions,${continuation}[] continuations)`, branch.data)
          : decode(`(${tokenMinimum}[] expectedOutputs,${template}[] conversions)`, branch.data);
      return { kind, amountIn: String(branch.amountIn), data: branchBody };
    }) };
  }
  const semantic = (node: unknown): unknown => typeof node === 'bigint' ? String(node) : Array.isArray(node) ? node.map(semantic)
    : node && typeof node === 'object' ? Object.fromEntries(Object.entries(node).flatMap(([key, item]) =>
      key === 'minimumOutput' ? [] : [[key === 'minimumAmount' ? 'amount' : key, semantic(item)]])) : node;
  const terms = { ...value } as Partial<UniversalExactInputQuote>;
  delete terms.plan; delete terms.planDescription; delete terms.outputMinimum;
  return { ...terms, request: structuredClone(request), plan: { allocations, conversions: {}, body: semantic(body) } } as EconomicQuote;
}

const selectionKey = (quote: EconomicQuote) => JSON.stringify({ request: quote.request, plan: quote.plan, context: quote.context });

/** Shared fixture bridge: legacy examples become semantic JSON; bytes appear only on preparation.
 * This adapts mock HTTP evidence, never product code or an actual backend/RPC.
 */
export async function installEconomicApiFixtures(page: Page) {
  const fixtures = new Map<string, UniversalExactInputQuote>();
  const originalRoute = page.route.bind(page);
  const prepare = async (route: Route) => {
    const payload = route.request().postDataJSON(), selected = payload.quote as EconomicQuote;
    const prior = fixtures.get(selectionKey(selected));
    if (!prior) { await route.fulfill({ status: 503, json: { code: 'quote-unavailable', error: 'Economic fixture not found.' } }); return; }
    const deadline = String(Math.floor(Date.now() / 1000) + 600), slippageBps = payload.slippageBps ?? 100;
    const guarded = universalFixture({ ...selected.request, inputs: selected.inputs,
      recipient: payload.recipient, deadline, slippageBps }, { routeFamily: prior.routeFamily,
      quotedOutput: prior.quotedOutput, basketAssets: prior.plan.intent === 2 ? prior.inputs.map(row => row.currency) : undefined,
      recipientOutputs: prior.estimatedRecipientOutputs, recoveryShares: prior.recoveryShares,
      retainedInputs: prior.estimatedRetainedInputCharges, context: prior.context,
      coreProtocolFeeCygld: prior.fees.coreProtocolFeeCygld, coreHelpersFeeCygld: prior.fees.coreHelpersFeeCygld,
      marketFeeCygld: prior.fees.marketFeeCygld, adapter: prior.deployment.adapter,
      outputMinimum: payload.acceptedBounds?.minimumOutput });
    const result: PreparedTransaction = { ...guarded, plan: { ...guarded.plan, inputs: guarded.plan.inputs.map(row => ({ ...row })) },
      economicQuote: structuredClone(selected), sender: payload.sender };
    await route.fulfill({ json: result });
  };
  await originalRoute('**/api/tx-preparations', prepare);
  page.route = (pattern, handler, options) => originalRoute(pattern, async (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path !== '/api/economic-quotes') return handler(route, request);
    const economic = request.postDataJSON() as EconomicRequest;
    const adapted = new Proxy(route, { get(target, key) {
      if (key === 'fulfill') return async (response: Parameters<Route['fulfill']>[0]) => {
        const value = response?.json ?? (typeof response?.body === 'string' ? (() => { try { return JSON.parse(response.body); } catch { return undefined; } })() : undefined);
        if ((!response?.status || response.status < 400) && value?.strategy === 'universal' && typeof value.plan?.body === 'string') {
          const quote = economicFixture(value, economic);
          fixtures.set(selectionKey(quote), structuredClone(value));
          await target.fulfill({ ...response, json: quote, body: undefined }); return;
        }
        await target.fulfill(response);
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    return handler(adapted, request);
  }, options);
}
