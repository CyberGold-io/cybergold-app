"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useLocale } from "next-intl";
import { useObservedWalletAccount } from "@/app/hooks/useObservedWalletAccount";
import { EXPECTED_CHAIN_ID } from "@/app/utils/expectedChain";

function parseText(value: unknown): Record<string, string> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.values(value).every(entry => typeof entry === "string") ? value as Record<string, string> : undefined;
}

function textSnapshot(key: string) {
  let raw: string | null | undefined;
  let result: Record<string, string> | undefined;
  return () => {
    try {
      const next = sessionStorage.getItem(key);
      if (next !== raw) { raw = next; result = next ? parseText(JSON.parse(next)) : undefined; }
    } catch { result = undefined; }
    return result;
  };
}

/** Last rendered observation text only. The original query remains the action's input. */
export function useGovernanceObservationText(section: string, live: Record<string, string | undefined>) {
  const { address } = useObservedWalletAccount();
  const locale = useLocale();
  const key = `cg:governance-observation-text:v1:${EXPECTED_CHAIN_ID}:${locale}:${address?.toLowerCase() ?? "disconnected"}:${section}`;
  const snapshot = useMemo(() => textSnapshot(key), [key]);
  const cached = useSyncExternalStore(listener => {
    window.addEventListener("cybergold:governance-observation-text", listener);
    return () => window.removeEventListener("cybergold:governance-observation-text", listener);
  }, snapshot, () => undefined);
  const known = Object.fromEntries(Object.entries(live).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const serialized = JSON.stringify(known);
  useEffect(() => {
    try {
      const previous = parseText(JSON.parse(sessionStorage.getItem(key) ?? "null")) ?? {};
      const next = JSON.stringify({ ...previous, ...JSON.parse(serialized) });
      if (next !== JSON.stringify(previous)) {
        sessionStorage.setItem(key, next);
        window.dispatchEvent(new Event("cybergold:governance-observation-text"));
      }
    } catch { /* Presentation storage is optional and never affects reads or actions. */ }
  }, [key, serialized]);
  return { ...cached, ...known } as Record<string, string | undefined>;
}
