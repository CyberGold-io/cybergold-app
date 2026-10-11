const MAX_FX_PRESENTATION_RATE = 1_000_000;
const MAX_GOLD_PRESENTATION_PRICE_USD = 1_000_000_000;

export function remainingMarketLifetime(fetchedAt: string | undefined, ttl: number, now = Date.now()) {
  return fetchedAt ? Math.max(0, ttl - Math.max(0, now - Date.parse(fetchedAt))) : 0;
}

type JsonRecord = Record<string, unknown>;

export type GoldMarketDataPayload = {
  price: number;
  fetchedAt: string;
  stale: boolean;
};

export type FxMarketDataPayload = {
  base: "USD";
  rates: {
    USD: number;
    EUR: number;
    CHF: number;
    RUB: number;
  };
  fetchedAt: string;
  stale: boolean;
};

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function hasExactKeys(
  value: JsonRecord,
  expectedKeys: readonly string[]
): boolean {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actualKeys.length === expected.length &&
    actualKeys.every((key, index) => key === expected[index])
  );
}

function boundedPositiveNumber(value: unknown, maximum: number) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= maximum
    ? value
    : undefined;
}

function isIsoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function parseGoldMarketDataPayload(
  payload: unknown
): GoldMarketDataPayload | undefined {
  const record = asRecord(payload);
  if (!record || !hasExactKeys(record, ["price", "fetchedAt", "stale"])) {
    return undefined;
  }

  const price = boundedPositiveNumber(
    record.price,
    MAX_GOLD_PRESENTATION_PRICE_USD
  );
  return price !== undefined &&
    isIsoTimestamp(record.fetchedAt) &&
    typeof record.stale === "boolean"
    ? {
        price,
        fetchedAt: record.fetchedAt,
        stale: record.stale,
      }
    : undefined;
}

export function parseFxMarketDataPayload(
  payload: unknown
): FxMarketDataPayload | undefined {
  const record = asRecord(payload);
  const rates = asRecord(record?.rates);
  if (
    !record ||
    !hasExactKeys(record, ["base", "rates", "fetchedAt", "stale"]) ||
    record.base !== "USD" ||
    !rates ||
    !hasExactKeys(rates, ["USD", "EUR", "CHF", "RUB"]) ||
    rates.USD !== 1 ||
    !isIsoTimestamp(record.fetchedAt) ||
    typeof record.stale !== "boolean"
  ) {
    return undefined;
  }

  const EUR = boundedPositiveNumber(rates.EUR, MAX_FX_PRESENTATION_RATE);
  const CHF = boundedPositiveNumber(rates.CHF, MAX_FX_PRESENTATION_RATE);
  const RUB = boundedPositiveNumber(rates.RUB, MAX_FX_PRESENTATION_RATE);
  return EUR !== undefined && CHF !== undefined && RUB !== undefined
    ? {
        base: "USD",
        rates: { USD: 1, EUR, CHF, RUB },
        fetchedAt: record.fetchedAt,
        stale: record.stale,
      }
    : undefined;
}
