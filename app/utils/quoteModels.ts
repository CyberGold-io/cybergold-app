import type { components } from "../contracts/backend/http";

export type QuoteModelPacket = components["schemas"]["QuoteModelPacket"];
type Rational = { n: bigint; d: bigint };
const f = (n: bigint, d = 1n): Rational => ({ n, d });
const add = (a: Rational, b: Rational) => f(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) => f(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => f(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational) => f(a.n * b.d, a.d * b.n);
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const round = (a: Rational, up: boolean) => a.n > 0n && a.d > 0n ? up ? ceil(a.n, a.d) : a.n / a.d : undefined;
const ppm = 1_000_000n, fp = 10n ** 18n;
const grossForNet = (n: bigint, fee: bigint) => n > 0n ? n + (n - 1n) * fee / (ppm - fee) : 0n;

/** Rational raw token units: measured marginal rate, known fee, modeled impact. */
export function predictLeg(route: Pick<QuoteModelPacket["routes"][number], "points" | "exchangeRate" | "feeRetention" | "localImpact">,
  amount: bigint, inverse = false): bigint | undefined {
  if (amount <= 0n) return amount === 0n ? 0n : undefined;
  const points = route.points.map(p => [BigInt(p.input), BigInt(p.output)] as const);
  const axis = inverse ? 1 : 0;
  const nearest = points.toSorted((a, b) => {
    const da = a[axis] > amount ? a[axis] - amount : amount - a[axis];
    const db = b[axis] > amount ? b[axis] - amount : amount - b[axis];
    return da < db ? -1 : da > db ? 1 : 0;
  })[0];
  if (route.exchangeRate) {
    const rate = f(BigInt(route.exchangeRate.numerator), BigInt(route.exchangeRate.denominator));
    const fee = f(BigInt(route.feeRetention.numerator), BigInt(route.feeRetention.denominator));
    const impact = nearest ? div(sub(div(mul(mul(rate, fee), f(nearest[0])), f(nearest[1])), f(1n)), mul(fee, f(nearest[0])))
      : route.localImpact ? f(BigInt(route.localImpact.numerator), BigInt(route.localImpact.denominator)) : undefined;
    if (impact && impact.n >= 0n) {
      const denominator = inverse ? mul(fee, sub(rate, mul(impact, f(amount)))) : add(f(1n), mul(mul(impact, fee), f(amount)));
      const value = round(div(inverse ? f(amount) : mul(mul(rate, fee), f(amount)), denominator), inverse);
      if (value !== undefined) return value;
    }
  }
  // This fallback is explicitly a historical combined rate; never invent a
  // separately measured exchange rate when no pool observation is available.
  const larger = points.filter(p => p[axis] >= amount).toSorted((a, b) => a[axis] < b[axis] ? -1 : 1)[0] ?? nearest;
  return larger ? round(f(amount * larger[inverse ? 0 : 1], larger[axis]), inverse) : undefined;
}

export class BasketModel {
  readonly s;
  readonly denominator: bigint;
  constructor(state: NonNullable<QuoteModelPacket["protocol"]>["state"]) {
    this.s = { ...state, weights: state.weights.map(BigInt), conversions: state.conversions.map(BigInt),
      available: state.available.map(BigInt), recoveryShares: state.recoveryShares.map(BigInt),
      recoveryValues: state.recoveryValues.map(BigInt), supply: BigInt(state.supply), maxSupply: BigInt(state.maxSupply),
      effectiveCap: BigInt(state.effectiveCap), issueFee: BigInt(state.issueFee), helperFee: BigInt(state.helperFee), redeemFee: BigInt(state.redeemFee) };
    const value = this.s.available.reduce((sum, a, i) => sum + ceil(a * this.s.conversions[i], fp), 0n)
      + this.s.recoveryValues.reduce((sum, a) => sum + a, 0n);
    this.denominator = value > this.s.supply ? value : this.s.supply;
  }
  issue(net: bigint, includesHelper = true, applyCap = true) {
    const s = this.s, coreNet = includesHelper ? grossForNet(net, s.helperFee) : net;
    const gross = grossForNet(coreNet, s.issueFee), cap = s.maxSupply < s.effectiveCap ? s.maxSupply : s.effectiveCap;
    if (applyCap && gross > cap - s.supply) return undefined;
    return { amounts: s.weights.map((w, i) => ceil(ceil(gross * w, ppm) * fp, s.conversions[i])),
      net: includesHelper ? net : coreNet - coreNet * s.helperFee / ppm };
  }
  issueIn(budgets: bigint[], applyCap = true) {
    const s = this.s;
    let gross: bigint | undefined;
    s.weights.forEach((w, i) => { if (w > 0n) {
      const value = (budgets[i] * s.conversions[i] / fp) * ppm / w;
      gross = gross === undefined || value < gross ? value : gross;
    } });
    if (gross === undefined) return undefined;
    const cap = (s.maxSupply < s.effectiveCap ? s.maxSupply : s.effectiveCap) - s.supply;
    if (applyCap) gross = gross < cap ? gross : cap > 0n ? cap : 0n;
    return this.issue(gross - gross * s.issueFee / ppm, false, applyCap);
  }
  redeemIn(gross: bigint) {
    const s = this.s, coreGross = gross - gross * s.helperFee / ppm;
    if (coreGross > s.supply || this.denominator <= 0n) return undefined;
    const net = coreGross - coreGross * s.redeemFee / ppm;
    return [...s.available, ...s.recoveryShares].map(a => a * net / this.denominator);
  }
  redeemOut(minima: bigint[]) {
    const available = [...this.s.available, ...this.s.recoveryShares];
    if (minima.length !== available.length || minima.some((m, i) => m > available[i])) return undefined;
    let net = 0n;
    minima.forEach((m, i) => { const value = m > 0n ? ceil(m * this.denominator, available[i]) : 0n; if (value > net) net = value; });
    const gross = grossForNet(grossForNet(net, this.s.redeemFee), this.s.helperFee);
    return { gross, amounts: this.redeemIn(gross) };
  }
}

/** Approximation only. Failure or missing components use available whole history. */
export function predictIntent(packet: QuoteModelPacket, amount: bigint, targets = packet.intent.targets): bigint | undefined {
  if (amount <= 0n) return undefined;
  const mode = packet.intent.mode;
  const historical = () => {
    const rows = packet.whole.toSorted((a, b) => {
      const aa = BigInt(a.input), bb = BigInt(b.input);
      return (aa > amount ? aa - amount : amount - aa) < (bb > amount ? bb - amount : amount - bb) ? -1 : 1;
    });
    return rows[0] ? amount * BigInt(rows[0].display) / BigInt(rows[0].input) : undefined;
  };
  try {
    if (!packet.protocol || packet.protocol.state.assets.map(a => a.toLowerCase()).join() !== packet.intent.orderedAssets.map(a => a.toLowerCase()).join()) return historical();
    const basket = new BasketModel(packet.protocol.state), token = packet.intent.quoteToken.toLowerCase();
    const quote = (input: string, output: string, raw: bigint, inverse = false) => {
      if (input.toLowerCase() === output.toLowerCase()) return raw;
      const route = packet.routes.find(r => r.tokens[0].toLowerCase() === input.toLowerCase() && r.tokens.at(-1)?.toLowerCase() === output.toLowerCase());
      return route ? predictLeg(route, raw, inverse) : undefined;
    };
    if (mode === "issue-exact-in") {
      const budgets = packet.intent.orderedAssets.map(asset => {
        const row = targets.find(t => t.outputAsset.toLowerCase() === asset.toLowerCase());
        const raw = row ? BigInt(row.amount) : amount - targets.reduce((sum, t) => sum + BigInt(t.amount), 0n);
        const value = quote(token, asset, raw);
        return value;
      });
      if (budgets.some(v => v === undefined)) return historical();
      const value = basket.issueIn(budgets as bigint[], false)?.net;
      return value === undefined ? historical() : value;
    }
    if (mode === "issue-exact-out") {
      const lots = basket.issue(amount, true, false)?.amounts;
      if (!lots) return historical();
      let total = 0n;
      for (let i = 0; i < lots.length; i++) {
        const value = quote(token, packet.intent.orderedAssets[i], lots[i], true);
        if (value === undefined) return historical();
        total += value;
      }
      return total;
    }
    const redeem = (gross: bigint) => {
      const lots = basket.redeemIn(gross);
      if (!lots) return undefined;
      let total = 0n;
      for (let i = 0; i < packet.intent.orderedAssets.length; i++) {
        const value = quote(packet.intent.orderedAssets[i], token, lots[i]);
        if (value === undefined) return undefined;
        total += value;
      }
      return total;
    };
    if (mode === "redeem-exact-in") return redeem(amount) ?? historical();
    // Display-only inversion, with existing observations as a CPU seed.
    // This never changes the exact backend solver or its evaluation budget.
    let gross = historical();
    if (!gross) {
      const allocations = targets.length ? targets : packet.intent.targets;
      const oldTotal = allocations.reduce((sum, t) => sum + BigInt(t.amount), 0n);
      if (oldTotal <= 0n) return undefined;
      let allocated = 0n;
      const minima = basket.s.assets.map(asset => {
        const index = allocations.findIndex(t => t.inputAsset.toLowerCase() === asset.toLowerCase());
        if (index < 0) return 0n;
        const target = index === allocations.length - 1 ? amount - allocated : amount * BigInt(allocations[index].amount) / oldTotal;
        allocated += target;
        return quote(asset, token, target, true);
      });
      if (minima.some(value => value === undefined)) return undefined;
      gross = basket.redeemOut([...(minima as bigint[]), ...basket.s.recoveryShares.map(() => 0n)])?.gross;
    }
    if (!gross) return undefined;
    for (let i = 0; i < 3; i++) {
      const value = redeem(gross);
      if (!value) return historical();
      gross = ceil(gross * amount, value);
    }
    return gross;
  } catch {
    return historical();
  }
}

export const modelFamily = (input: Omit<QuoteModelPacket["intent"], "amount" | "targets">) => JSON.stringify([
  input.mode, input.token.toLowerCase(), input.quoteToken.toLowerCase(), input.native,
  (input.adapter ?? "").toLowerCase(), input.orderedAssets.map(a => a.toLowerCase()),
]);
