"use client";

import { useSyncExternalStore } from "react";

function subscribe(changed: () => void) {
  document.addEventListener("visibilitychange", changed);
  return () => document.removeEventListener("visibilitychange", changed);
}

/** Quote acquisition follows document visibility, including its initial state. */
export function usePageVisible() {
  return useSyncExternalStore(subscribe, () => !document.hidden, () => false);
}
