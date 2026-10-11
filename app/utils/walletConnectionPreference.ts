"use client";

const listeners = new Set<() => void>();
let disconnected = false;

export function walletExplicitlyDisconnected() {
  return disconnected;
}

export function setWalletExplicitlyDisconnected(value: boolean) {
  if (disconnected === value) return;
  disconnected = value;
  listeners.forEach(listener => listener());
}

export function subscribeWalletConnectionPreference(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
