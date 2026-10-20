"use client";

// This is a tab's UI preference, not evidence of a connected wallet. The panel
// still waits for the observed account before showing its scoped data.
const storageKey = "cg:wallet-panel-open:v1";
const closedState = { isOpen: false, hasOpened: false };
let state = closedState;
let restored = false;
const listeners = new Set<() => void>();

export function walletPanelState() {
  if (!restored && typeof window !== "undefined") {
    restored = true;
    try {
      if (window.sessionStorage.getItem(storageKey) === "true") {
        state = { isOpen: true, hasOpened: true };
      }
    } catch { /* The ordinary panel still works when storage is unavailable. */ }
  }
  return state;
}

export function closedWalletPanelState() {
  return closedState;
}

export function setWalletPanelOpen(isOpen: boolean) {
  walletPanelState();
  try { window.sessionStorage.setItem(storageKey, String(isOpen)); }
  catch { /* Keep close/disconnect usable when storage is unavailable. */ }
  if (state.isOpen === isOpen) return;
  state = { isOpen, hasOpened: state.hasOpened || isOpen };
  listeners.forEach(listener => listener());
}

export function subscribeWalletPanel(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
