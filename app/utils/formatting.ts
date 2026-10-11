import { formatUnits } from "viem";

const DEFAULT_DECIMAL_SEPARATOR = ".";
const GROUP_SEPARATOR = " ";
const GRAMS_PER_TROY_OUNCE = 31.1034768;
const SUBSCRIPT_DIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

type CanonicalNumberParts = {
  canonical: string;
  trailingDecimal: boolean;
};

type CurrencyFormatOptions = {
  compact?: boolean;
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
};

type NumberFormatOptions = {
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
};

const NUMERIC_PART_TYPES = new Set(["integer", "fraction", "decimal", "group"]);

function stripLeadingIntegerZeros(value: string) {
  const stripped = value.replace(/^0+(?=\d)/, "");
  return stripped === "" ? "0" : stripped;
}

export function getLocaleDecimalSeparator(locale: string) {
  try {
    return (
      new Intl.NumberFormat(locale)
        .formatToParts(1.1)
        .find((part) => part.type === "decimal")?.value ?? DEFAULT_DECIMAL_SEPARATOR
    );
  } catch {
    return DEFAULT_DECIMAL_SEPARATOR;
  }
}

export function canonicalizeNumberString(
  value: string | number,
  locale = "en"
): CanonicalNumberParts {
  const raw = String(value).trim();
  if (raw === "") {
    return { canonical: "", trailingDecimal: false };
  }

  const localeDecimal = getLocaleDecimalSeparator(locale);
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;

  let integerPart = "";
  let fractionalPart = "";
  let sawDecimal = false;
  let trailingDecimal = false;

  for (const char of unsigned) {
    if (/\d/.test(char)) {
      if (sawDecimal) {
        fractionalPart += char;
      } else {
        integerPart += char;
      }
      trailingDecimal = false;
      continue;
    }

    if ((char === "." || char === "," || char === localeDecimal) && !sawDecimal) {
      sawDecimal = true;
      trailingDecimal = true;
    }
  }

  if (!integerPart && !fractionalPart && !sawDecimal) {
    return { canonical: "", trailingDecimal: false };
  }

  const normalizedIntegerPart = stripLeadingIntegerZeros(integerPart || "0");
  const sign = negative ? "-" : "";
  const canonical = sawDecimal
    ? `${sign}${normalizedIntegerPart}.${fractionalPart}`
    : `${sign}${normalizedIntegerPart}`;

  return { canonical, trailingDecimal };
}

function formatCanonicalNumberString(
  canonical: string,
  locale = "en",
  trailingDecimal = false
) {
  if (canonical === "") {
    return "";
  }

  const localeDecimal = getLocaleDecimalSeparator(locale);
  const negative = canonical.startsWith("-");
  const unsigned = negative ? canonical.slice(1) : canonical;
  const [integerPartRaw = "0", fractionalPart = ""] = unsigned.split(".");
  const groupedIntegerPart = integerPartRaw.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    GROUP_SEPARATOR
  );
  const sign = negative ? "-" : "";

  if (fractionalPart !== "" || trailingDecimal) {
    return `${sign}${groupedIntegerPart}${localeDecimal}${fractionalPart}`;
  }

  return `${sign}${groupedIntegerPart}`;
}

function toSubscriptNumber(value: number) {
  return String(value)
    .split("")
    .map((digit) => SUBSCRIPT_DIGITS[Number(digit)] ?? digit)
    .join("");
}

function trimFormattedDecimal(value: string) {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function formatIntlWithCustomGrouping(
  value: number,
  locale = "en",
  options?: Intl.NumberFormatOptions
) {
  const formatter = new Intl.NumberFormat(locale, options);
  const parts = formatter.formatToParts(value);

  const firstNumericPartIndex = parts.findIndex((part) => NUMERIC_PART_TYPES.has(part.type));
  let lastNumericPartIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (NUMERIC_PART_TYPES.has(parts[index].type)) {
      lastNumericPartIndex = index;
      break;
    }
  }

  if (firstNumericPartIndex === -1 || lastNumericPartIndex === -1) {
    return formatter.format(value);
  }

  const prefix = parts
    .slice(0, firstNumericPartIndex)
    .map((part) => part.value)
    .join("");
  const suffix = parts
    .slice(lastNumericPartIndex + 1)
    .map((part) => part.value)
    .join("");
  const numericValue = parts
    .slice(firstNumericPartIndex, lastNumericPartIndex + 1)
    .map((part) => {
      if (part.type === "group") return "";
      if (part.type === "decimal") return ".";
      return part.value;
    })
    .join("");
  const formattedNumber = formatNumberWithSpaces(numericValue, locale);

  return `${prefix}${formattedNumber}${suffix}`;
}

// Display a decimal string compactly without hiding tiny non-zero amounts as 0.
export const formatMeaningfulDecimalString = (
  s: string,
  locale = "en",
  defaultFractionDigits = 3,
  maxFractionDigits = 6
) => {
  if (s === "") return "";

  const { canonical } = canonicalizeNumberString(s, locale);
  if (canonical === "") return "";

  const n = Number(canonical);
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "0";

  const localeDecimal = getLocaleDecimalSeparator(locale);
  const negative = canonical.startsWith("-");
  const unsigned = negative ? canonical.slice(1) : canonical;
  const [integerPart = "0", fractionalPart = ""] = unsigned.split(".");
  const sign = negative ? "-" : "";

  if (integerPart !== "0") {
    return formatNumberWithSpaces(trimFormattedDecimal(n.toFixed(defaultFractionDigits)), locale);
  }

  const firstSignificantIndex = fractionalPart.search(/[1-9]/);
  if (firstSignificantIndex === -1) return "0";

  const neededFractionDigits = firstSignificantIndex + defaultFractionDigits;
  if (neededFractionDigits <= maxFractionDigits) {
    return formatNumberWithSpaces(
      trimFormattedDecimal(n.toFixed(Math.max(defaultFractionDigits, neededFractionDigits))),
      locale
    );
  }

  const significantDigits = fractionalPart.slice(firstSignificantIndex, firstSignificantIndex + defaultFractionDigits + 1);
  return `${sign}0${localeDecimal}0${toSubscriptNumber(firstSignificantIndex)}${significantDigits}`;
};

// Truncate a decimal string to a fixed number of fractional digits without rounding up.
export const truncateDecimalString = (value: string, fractionDigits: number) => {
  if (!value || fractionDigits < 0) return "";

  const normalized = value.trim();
  if (normalized === "") return "";

  const [integerPart, fractionalPart = ""] = normalized.split(".");
  if (fractionDigits === 0 || fractionalPart === "") return integerPart;

  const truncatedFraction = fractionalPart.slice(0, fractionDigits).replace(/0+$/, "");
  return truncatedFraction ? `${integerPart}.${truncatedFraction}` : integerPart;
};

// Add spaces as thousands separators while preserving the decimal part.
// The grouping separator stays a regular space, while the decimal separator follows the locale.
export const formatNumberWithSpaces = (value: number | string, locale = "en") => {
  const { canonical, trailingDecimal } = canonicalizeNumberString(value, locale);
  return formatCanonicalNumberString(canonical, locale, trailingDecimal);
};

// Use six displayed digits, including leading zeros, while preserving the integer part.
export const formatWalletBalanceAmount = (balance: bigint, decimals: number, locale = "en") => {
  const integerDigits = Math.max(1, balance.toString().length - decimals);
  const fractionDigits = Math.max(0, 6 - integerDigits);
  const unit = 10n ** BigInt(Math.max(0, decimals - fractionDigits));
  if (balance > 0n && balance < unit) {
    return `<${formatNumberWithSpaces(formatUnits(unit, decimals), locale)}`;
  }
  const rounded = ((balance + unit / 2n) / unit) * unit;
  return formatNumberWithSpaces(formatUnits(rounded, decimals), locale);
};

export const getGoldQualifier = (locale = "en") =>
  locale.toLowerCase().startsWith("fr") ? "d'or" : "of gold";

export const formatGoldQualifiedLabel = (label: string, locale = "en") =>
  `${label} ${getGoldQualifier(locale)}`;

export const formatGoldAmountForDisplay = (
  amountOzt: number,
  locale = "en",
  unit: "imperial" | "metric" = "metric"
) => {
  if (unit === "imperial") {
    const absoluteAmountOzt = Math.abs(amountOzt);
    let fractionDigits = 2;

    if (absoluteAmountOzt > 0 && absoluteAmountOzt < 0.01) {
      fractionDigits = 5;
    } else if (absoluteAmountOzt < 0.1) {
      fractionDigits = 4;
    } else if (absoluteAmountOzt < 1) {
      fractionDigits = 3;
    }

    return `${new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amountOzt)} troy oz`;
  }

  const grams = amountOzt * GRAMS_PER_TROY_OUNCE;
  let value = grams;
  let displayUnit = "g";
  let maxFractionDigits = 2;

  if (grams >= 1_000_000) {
    value = grams / 1_000_000;
    displayUnit = "t";
    maxFractionDigits = 3;
  } else if (grams >= 1_000) {
    value = grams / 1_000;
    displayUnit = "kg";
    maxFractionDigits = 2;
  }

  return formatGoldQualifiedLabel(`${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFractionDigits,
  }).format(value)} ${displayUnit}`, locale);
};

export const formatCurrencyWithCustomGrouping = (
  amount: number,
  locale = "en",
  currency = "USD",
  options?: CurrencyFormatOptions
) => {
  return formatIntlWithCustomGrouping(amount, locale, {
    style: "currency",
    currency,
    notation: options?.compact ? "compact" : "standard",
    minimumFractionDigits: options?.minimumFractionDigits,
    maximumFractionDigits: options?.maximumFractionDigits,
  });
};

export const formatNumberWithCustomGrouping = (
  amount: number,
  locale = "en",
  options?: NumberFormatOptions
) => {
  return formatIntlWithCustomGrouping(amount, locale, {
    minimumFractionDigits: options?.minimumFractionDigits,
    maximumFractionDigits: options?.maximumFractionDigits,
  });
};

export const formatAmount = (
  amount: bigint | undefined,
  decimals: number | undefined,
  fallback = ""
) => {
  if (amount === undefined || decimals === undefined) return fallback;
  try {
    return formatUnits(amount, decimals);
  } catch {
    return fallback;
  }
};

export const formatPpmAsPercent = (
  ppm: bigint | number | undefined,
  fractionDigits = 4,
) => {
  if (ppm === undefined) return undefined;

  const ppmValue = typeof ppm === "bigint" ? Number(ppm) : ppm;
  if (!Number.isFinite(ppmValue)) return undefined;

  const percent = ppmValue / 10_000;
  return `${percent
    .toFixed(fractionDigits)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "")}%`;
};

export const normalizeDecimalInput = (
  value: string | undefined,
  locale = "en"
) => {
  const { canonical, trailingDecimal } = canonicalizeNumberString(
    value ?? "",
    locale
  );
  return formatCanonicalNumberString(canonical, locale, trailingDecimal);
};

export const formatDecimalInputForCursor = (
  value: string,
  locale = "en",
  selectionStart?: number | null
) => {
  const normalized = normalizeDecimalInput(value, locale);
  const prefix =
    selectionStart === undefined || selectionStart === null
      ? normalized
      : normalizeDecimalInput(value.slice(0, selectionStart), locale);

  return {
    value: normalized,
    selectionStart: Math.min(prefix.length, normalized.length),
  };
};
