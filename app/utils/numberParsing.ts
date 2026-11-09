import { parseUnits } from "viem";
import { canonicalizeLocalizedNumberString } from "./formatting.ts";

export function parseInputToBigInt(
  input: string,
  decimals: number | undefined,
  locale = "en"
): bigint | undefined {
  if (decimals === undefined) return undefined;
  const normalized = canonicalizeLocalizedNumberString(input, locale).canonical.replace(/\.$/, "");
  if (!normalized.trim()) return undefined;
  try {
    return parseUnits(normalized, decimals);
  } catch {
    return undefined;
  }
}

export function parseDisplayNumber(input: string, locale = "en"): number | undefined {
  const normalized = canonicalizeLocalizedNumberString(input, locale).canonical.replace(/\.$/, "");
  if (!normalized.trim()) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}
