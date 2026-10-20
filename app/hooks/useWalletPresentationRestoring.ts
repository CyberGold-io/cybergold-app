"use client";

import { useSyncExternalStore } from "react";

const snapshot = () => Boolean(document.querySelector("[data-wallet-cached]:not([hidden])"));
const addressSnapshot = () => document.querySelector<HTMLElement>("[data-wallet-cached]:not([hidden])")?.dataset.walletAddress?.toLowerCase();
function subscribe(notify: () => void) {
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target instanceof Element && record.target.matches("[data-wallet-cached]"))) notify();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });
  document.addEventListener("wallet-display-finished", notify, true);
  return () => { observer.disconnect(); document.removeEventListener("wallet-display-finished", notify, true); };
}

/** Presentation lifecycle only. It does not imply an authorized wallet. */
export function useWalletPresentationRestoring() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

export function useWalletPresentationAddress() {
  return useSyncExternalStore(subscribe, addressSnapshot, () => undefined);
}
