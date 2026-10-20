"use client";

import { useSyncExternalStore } from "react";

const memory = new Map<string, string>();

/** Tab-local interface choices only; never transaction or authority state. */
export function useSessionPagePreference<T extends string>(key: string, fallback: T, choices?: readonly T[]) {
  const value = useSyncExternalStore(
    listener => {
      window.addEventListener("cybergold:page-preference", listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener("cybergold:page-preference", listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => {
      const local = memory.get(key) as T | undefined;
      if (local !== undefined) return !choices || choices.includes(local) ? local : fallback;
      try {
        const stored = sessionStorage.getItem(key) as T | null;
        return stored !== null && (!choices || choices.includes(stored)) ? stored : fallback;
      } catch {
        const stored = memory.get(key) as T | undefined;
        return stored !== undefined && (!choices || choices.includes(stored)) ? stored : fallback;
      }
    },
    () => fallback,
  );
  return [value, (update: T | ((previous: T) => T)) => {
    let previous = memory.get(key) as T | undefined;
    if (previous === undefined) {
      try { previous = sessionStorage.getItem(key) as T | null ?? undefined; } catch { /* Use the tab's ordinary memory fallback. */ }
    }
    const current = previous !== undefined && (!choices || choices.includes(previous)) ? previous : fallback;
    const next = typeof update === "function" ? update(current) : update;
    memory.set(key, next);
    try { sessionStorage.setItem(key, next); } catch { /* The live page remains usable without storage. */ }
    window.dispatchEvent(new Event("cybergold:page-preference"));
  }] as const;
}
