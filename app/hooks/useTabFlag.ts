"use client";

import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

const memory = new Map<string, boolean>();
const preferenceEvent = "tab-flag-change";

function readFlag(key: string) {
  const current = memory.get(key);
  if (current !== undefined) return current;
  try { return window.sessionStorage.getItem(key) === "true"; }
  catch { return false; }
}

/** UI disclosure only; the server's closed default is corrected before paint. */
export function useTabFlag(key: string): [boolean, (value: SetStateAction<boolean>) => void] {
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener(preferenceEvent, notify);
    return () => window.removeEventListener(preferenceEvent, notify);
  }, []);
  const snapshot = useCallback(() => readFlag(key), [key]);
  const value = useSyncExternalStore(subscribe, snapshot, () => false);
  const setValue = useCallback((change: SetStateAction<boolean>) => {
    const next = typeof change === "function" ? change(readFlag(key)) : change;
    memory.set(key, next);
    try { window.sessionStorage.setItem(key, String(next)); } catch { /* ordinary controls remain usable */ }
    window.dispatchEvent(new Event(preferenceEvent));
  }, [key]);
  return [value, setValue];
}
