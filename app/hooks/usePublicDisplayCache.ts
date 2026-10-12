"use client";

import { useMemo, useSyncExternalStore } from "react";
import { publicDisplaySnapshot } from "../utils/publicDisplayCache";

const subscribe = () => () => undefined;
const serverSnapshot = () => undefined;

/** The first client render matches SSR; optional display data is restored after hydration. */
export function usePublicDisplayCache<T>(key: string, parse: (value: unknown) => T | undefined): T | undefined {
  const snapshot = useMemo(() => publicDisplaySnapshot(key, parse), [key, parse]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
