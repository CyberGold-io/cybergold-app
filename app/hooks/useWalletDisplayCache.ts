"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { publicDisplaySnapshot, writePublicDisplayCache } from "../utils/publicDisplayCache";

const subscribe = () => () => undefined;
const serverSnapshot = () => undefined;

/** Session-only display data never populates a query or an action's live observation. */
export function useWalletDisplayCache<T>(key: string | undefined, parse: (value: unknown) => T | undefined,
  observed?: T, merge?: (cached: T | undefined, observed: T) => T): T | undefined {
  const snapshot = useMemo(() => {
    let read: (() => T | undefined) | undefined;
    return () => {
      if (!key) return;
      try {
        read ??= publicDisplaySnapshot(key, parse, window.sessionStorage);
        return read();
      } catch { return undefined; }
    };
  }, [key, parse]);
  const cached = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const display = useMemo(() => observed === undefined ? cached : merge ? merge(cached, observed) : observed,
    [cached, observed, merge]);
  useEffect(() => {
    if (key && observed !== undefined && display !== undefined) {
      try { writePublicDisplayCache(key, display, window.sessionStorage); } catch { /* best effort */ }
    }
  }, [key, observed, display]);
  return display;
}
