"use client";

// Locale navigation remounts the navbar. Keep its panel state for this browser
// session, while a fresh page load and server rendering start closed.
const closedState = { isOpen: false, hasOpened: false };
let state = closedState;
const listeners = new Set<() => void>();

export function walletPanelState() {
  return state;
}

export function closedWalletPanelState() {
  return closedState;
}

export function setWalletPanelOpen(isOpen: boolean) {
  if (state.isOpen === isOpen) return;
  state = { isOpen, hasOpened: state.hasOpened || isOpen };
  listeners.forEach(listener => listener());
}

export function subscribeWalletPanel(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
