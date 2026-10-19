/** Non-replayable observations of the actual captured plan. Never contains calldata. */
type Json = string | number | boolean | Json[] | { [key: string]: Json };
export type SelectedPlan = { [key: string]: Json };
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const address = (value: unknown) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.exec(value)?.[0] === value ? value.toLowerCase() : undefined;
const uint = (value: unknown) => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.exec(value)?.[0] === value && BigInt(value) < 2n ** 256n ? value : undefined;
const fields = (value: unknown, amounts: readonly string[], addresses: readonly string[] = []) => {
  const input = object(value), result: SelectedPlan = {};
  if (!input) return result;
  for (const name of amounts) { const safe = uint(input[name]); if (safe !== undefined) result[name] = safe; }
  for (const name of addresses) { const safe = address(input[name]); if (safe) result[name] = safe; }
  return result;
};
function putList(target: SelectedPlan, key: string, value: unknown, project: (v: unknown) => Json | undefined, limit = 64, positional = false) {
  if (!Array.isArray(value)) return;
  const rows = value.slice(0, limit).map(project);
  if (positional && rows.some(value => value === undefined)) return;
  target[key] = rows.flatMap(value => value === undefined ? [] : [value]);
  if (value.length > limit) target[key + 'Omitted'] = value.length - limit;
}
function pool(value: unknown): SelectedPlan | undefined {
  const input = object(value); if (!input || (input.protocol !== 'v2' && input.protocol !== 'v3' && input.protocol !== 'v4')) return;
  const result: SelectedPlan = { protocol: input.protocol as string };
  for (const name of ['id', 'poolId']) { const v = input[name]; if (typeof v === 'string') { const match = /^(?:0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})|v3:0x[0-9a-fA-F]{40}:0x[0-9a-fA-F]{40}:([0-9]{1,7}))$/.exec(v); if (match?.[0] === v && (match[1] === undefined || Number(match[1]) <= 1e6)) result[name] = v.toLowerCase(); } }
  Object.assign(result, fields(input, [], ['address', 'poolAddress', 'poolManager']));
  for (const name of ['token0', 'token1']) { const safe = address(object(input[name])?.address ?? input[name]); if (safe) result[name] = safe; }
  if (Number.isInteger(input.feePips) && Number(input.feePips) >= 0 && Number(input.feePips) <= 1e6) result.feePips = input.feePips as number;
  return Object.keys(result).length > 1 ? result : undefined;
}
function route(value: unknown): SelectedPlan | undefined {
  const input = object(value); if (!input) return;
  const result = fields(input, ['inputAmount', 'outputAmount', 'limit'], ['tokenIn', 'tokenOut']);
  if (input.mode === 'exactIn' || input.mode === 'exactOut') result.mode = input.mode;
  putList(result, 'branches', input.branches, raw => {
    const branch = object(raw); if (!branch) return;
    const safe = fields(branch, ['amountIn']);
    putList(safe, 'hops', branch.hops, rawHop => {
      const hop = object(rawHop); if (!hop) return;
      const identity = pool(hop.pool); if (!identity) return;
      return { pool: identity, ...(typeof hop.zeroForOne === 'boolean' ? { zeroForOne: hop.zeroForOne } : {}) };
    }, 8);
    return safe;
  }, 8);
  return Object.keys(result).length ? result : undefined;
}
function assetAmount(value: unknown): SelectedPlan | undefined {
  const input = object(value); if (!input) return;
  const result = fields(input, ['id', 'amount', 'minimumAmount'], ['token']);
  if (Number.isInteger(input.kind) && Number(input.kind) >= 0 && Number(input.kind) <= 255) result.kind = input.kind as number;
  return Object.keys(result).length ? result : undefined;
}
function preview(value: unknown): SelectedPlan | undefined {
  const input = object(value); if (!input) return;
  const result = fields(input, ['netCygldOut', 'grossCygldIn', 'minimumAmountOut']);
  for (const [name, project] of [['amountsInExact', uint], ['orderedCoreAssets', address], ['projectedCoreOutputs', assetAmount]] as const) {
    putList(result, name, input[name], project, 64, name !== 'projectedCoreOutputs');
  }
  const fees = fields(input.fees, ['protocolFeeCygld', 'helperFeeCygld']); if (Object.keys(fees).length) result.fees = fees;
  return Object.keys(result).length ? result : undefined;
}
export function safeSelectedPlan(value: unknown, provider: 'core' | 'market', candidate?: unknown): SelectedPlan | undefined {
  try {
    const input = object(value); if (!input) return;
    const result = fields(input, ['executionAmount', 'displayAmount', 'minimumAmountOut', 'maximumInputAmount', 'expectedInputAmount', 'requestedGrossCygldOut', 'requestedNetCygldOut', 'expectedOutputAmount',
      'amountIn', 'amountOut', 'totalInput', 'netOutput', 'grossOutput', 'routedAmountIn', 'inputMaximum', 'outputMinimum', 'refundDust'], ['tokenIn', 'tokenOut']);
    const bound = object(candidate);
    Object.assign(result, fields(bound, ['quotedInput', 'quotedOutput', 'inputMaximum', 'outputMinimum'], ['tokenIn', 'tokenOut']));
    for (const name of ['mode', 'side'] as const) { const v = input[name] ?? bound?.[name]; if (typeof v === 'string' && ['buy','sell','exact-in','exact-out','issue-exact-in','issue-exact-out','redeem-exact-in','redeem-exact-out'].includes(v)) result[name] = v; }
    for (const name of ['preview', 'initialPreview', 'basketPreview'] as const) { const safe = preview(input[name]); if (safe) result[name] = safe; }
    putList(result, 'expectedCoreOutputs', input.expectedCoreOutputs, assetAmount);
    putList(result, 'legs', input.quotes, raw => {
      const leg = object(raw); if (!leg) return;
      const safe = fields(leg, ['inputAmount', 'amountIn', 'minimumAmountOut'], ['inputAsset', 'outputAsset']);
      const planned = route(leg.routePlan); if (planned) safe.route = planned;
      return Object.keys(safe).length ? safe : undefined;
    });
    const planned = route(object(input.plan)?.route); if (planned) result.route = planned;
    // A basket preview is itself the plan, without routed legs.
    const basket = preview(input.result); if (basket) result.preview = basket;
    const request = object(input.basketRequest);
    if (request) {
      const safe = fields(request, ['netCygldOut', 'grossCygldIn']);
      if (typeof request.mode === 'string' && ['issue-exact-in','issue-exact-out','redeem-exact-in','redeem-exact-out'].includes(request.mode)) safe.mode = request.mode;
      putList(safe, 'maximumAmountsIn', request.maximumAmountsIn, uint, 64, true);
      putList(safe, 'minimumOutputs', request.minimumOutputs, assetAmount);
      if (Object.keys(safe).length) result.basketRequest = safe;
    }
    return Object.keys(result).length ? { provider, ...result } : undefined;
  } catch { /* Optional plan observations cannot replace an existing outcome. */ }
}
