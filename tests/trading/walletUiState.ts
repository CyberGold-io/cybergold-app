import type { Page } from "@playwright/test";

export const walletUiRoutes = ["onboarding", "confirmation", "unlock", "home", "other"] as const;
export const walletUiControlGroups = ["confirmation", "alert", "alertSubmit", "alertAcknowledge", "importWallet", "importSrp",
  "srpInput", "srpConfirm", "password", "passwordConfirm", "passwordTerms", "passwordSubmit", "metricsOptIn", "metricsAccept",
  "onboardingDone", "accountMenu", "unlock"] as const;
type ControlGroup = typeof walletUiControlGroups[number];
type ControlCounts = Partial<Record<"matched" | "visible" | "enabled", number>>;
/** Best-effort last observed DOM state, not actionability or native request identity. */
export type WalletUiState = { route?: typeof walletUiRoutes[number]; controls?: Partial<Record<ControlGroup, ControlCounts>> };

const confirmationControls = {
  confirmation: '[data-testid="confirm-footer-button"], [data-testid="confirm-btn"], .page-container__footer [data-testid="page-container-footer-next"]',
  alert: '[data-testid="alert-modal"]', alertSubmit: '[data-testid="confirm-alert-modal-submit-button"]',
  alertAcknowledge: '[data-testid="alert-modal-acknowledge-checkbox"]',
};
const onboardingControls = {
  importWallet: '[data-testid="onboarding-import-wallet"]', importSrp: '[data-testid="onboarding-import-with-srp-button"]',
  srpInput: '[data-testid="srp-input-import__srp-note"]', srpConfirm: '[data-testid="import-srp-confirm"]',
  password: '[data-testid="create-password-new-input"]', passwordConfirm: '[data-testid="create-password-confirm-input"]',
  passwordTerms: '[data-testid="create-password-terms"]', passwordSubmit: '[data-testid="create-password-submit"]',
  metricsOptIn: '#metametrics-opt-in', metricsAccept: '[data-testid="metametrics-i-agree"]',
  onboardingDone: '[data-testid="onboarding-complete-done"]', accountMenu: '[data-testid="account-menu-icon"]',
  unlock: '[data-testid="unlock-password"]',
};

/** Re-project optional browser/binding data before it crosses a report boundary. */
export function safeWalletUiState(value: unknown): WalletUiState | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const source = value as Record<string, unknown>, result: WalletUiState = {};
    if (typeof source.route === "string" && (walletUiRoutes as readonly string[]).includes(source.route))
      result.route = source.route as WalletUiState["route"];
    if (source.controls && typeof source.controls === "object" && !Array.isArray(source.controls)) {
      const controls = source.controls as Record<string, unknown>, projected: NonNullable<WalletUiState["controls"]> = {};
      for (const group of walletUiControlGroups) {
        const row = controls[group];
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const counts = row as Record<string, unknown>;
        const safe: ControlCounts = {};
        for (const name of ["matched", "visible", "enabled"] as const)
          if (typeof counts[name] === "number" && Number.isSafeInteger(counts[name]) && counts[name] >= 0) safe[name] = counts[name];
        if (Object.keys(safe).length) projected[group] = safe;
      }
      if (Object.keys(projected).length) result.controls = projected;
    }
    return Object.keys(result).length ? result : undefined;
  } catch { /* Optional diagnostic data cannot change a wallet result. */ }
}

type BrowserOptions = { mode: "snapshot" | "observe" | "stop"; selectors: Partial<Record<ControlGroup, string>>; binding?: string };
/** Self-contained for Page.evaluate; never reads DOM text, input values or exports a URL. */
export function walletUiInPage(options: BrowserOptions): WalletUiState | undefined {
  type Observation = { binding: string; active: boolean; observer?: MutationObserver; publish?: () => void };
  const scope = window as Window & typeof globalThis & { __cybergoldWalletUiObservation?: Observation };
  const current = scope.__cybergoldWalletUiObservation;
  if (options.mode === "stop") {
    if (current && current.binding === options.binding) { current.active = false; current.observer?.disconnect(); }
    else if (!current && options.binding) scope.__cybergoldWalletUiObservation = { binding: options.binding, active: false };
    return;
  }
  const snapshot = (): WalletUiState => {
    const path = location.hash.slice(1).split("?")[0];
    const route = /^\/?onboarding(?:\/|$)/.test(path) ? "onboarding"
      : /^\/?(?:confirm|confirm-transaction|confirmation|signature-request|permissions-connect|connect)(?:\/|$)/.test(path) ? "confirmation"
      : /^\/?unlock(?:\/|$)/.test(path) ? "unlock" : path === "" || path === "/" ? "home" : "other";
    const controls: NonNullable<WalletUiState["controls"]> = {};
    for (const [group, selector] of Object.entries(options.selectors)) {
      const nodes = [...document.querySelectorAll(selector)];
      controls[group as ControlGroup] = { matched: nodes.length,
        visible: nodes.filter(node => {
          const style = getComputedStyle(node), rect = node.getBoundingClientRect();
          return style.visibility !== "hidden" && style.visibility !== "collapse" && rect.width > 0 && rect.height > 0;
        }).length,
        enabled: nodes.filter(node => !node.matches(":disabled") && !node.closest('[aria-disabled="true"]')).length };
    }
    return { route, controls };
  };
  if (options.mode === "snapshot") return snapshot();
  if (!options.binding) return;
  if (current?.binding === options.binding) { if (current.active) current.publish?.(); return; }
  current?.observer?.disconnect();
  const observation: Observation = { binding: options.binding, active: true };
  scope.__cybergoldWalletUiObservation = observation;
  let scheduled = false, inFlight = false, changedWhilePending = false, previous: string | undefined;
  const schedule = () => {
    if (!observation.active || scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; observation.publish?.(); });
  };
  observation.publish = () => {
    if (!observation.active) return;
    if (inFlight) { changedWhilePending = true; return; }
    try {
      const deliver = (scope as unknown as Record<string, unknown>)[observation.binding];
      if (typeof deliver !== "function") return;
      const state = snapshot(), serialized = JSON.stringify(state);
      if (serialized === previous) return;
      previous = serialized; inFlight = true;
      void Promise.resolve(deliver(state)).catch(() => {}).finally(() => {
        inFlight = false;
        if (changedWhilePending) { changedWhilePending = false; schedule(); }
      });
    } catch { inFlight = false; /* DOM teardown or bridge failure is independent of import. */ }
  };
  observation.observer = new MutationObserver(schedule);
  observation.observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  observation.publish();
}

export async function readWalletUiState(page: Page): Promise<WalletUiState | undefined> {
  try {
    const path = new URL(page.url()).hash.slice(1).split("?")[0];
    const route = /^\/?onboarding(?:\/|$)/.test(path) ? "onboarding"
      : /^\/?(?:confirm|confirm-transaction|confirmation|signature-request|permissions-connect|connect)(?:\/|$)/.test(path) ? "confirmation"
      : /^\/?unlock(?:\/|$)/.test(path) ? "unlock" : path === "" || path === "/" ? "home" : "other";
    const controls: NonNullable<WalletUiState["controls"]> = {};
    // MetaMask scuttles main-world eval. Built-in locator counts run in the
    // isolated utility world without changing the wallet's security policy.
    for (const [group, selector] of Object.entries(confirmationControls)) {
      const nodes = page.locator(selector);
      controls[group as ControlGroup] = { matched: await nodes.count(),
        visible: await nodes.and(page.locator(":visible")).count(),
        enabled: await nodes.and(page.locator(':not(:disabled):not([aria-disabled="true"], [aria-disabled="true"] *)')).count() };
    }
    return safeWalletUiState({ route, controls });
  }
  catch { /* Closed or unresponsive optional observations cannot replace a click error. */ }
}

let observationSequence = 0;
/** Observe only this existing wallet page; the SDK still owns every import action. */
export function observeWalletPageUiState(page: Page, receive: (state: WalletUiState) => void) {
  let active = true;
  const binding = `__cybergoldWalletUiState${++observationSequence}`;
  const options: BrowserOptions = { mode: "observe", selectors: onboardingControls, binding };
  const capture = () => {
    if (!active) return;
    try { void page.evaluate(walletUiInPage, options).catch(() => {}); } catch { /* Optional bridge setup. */ }
  };
  const navigated = (frame: ReturnType<Page["mainFrame"]>) => { if (frame === page.mainFrame()) capture(); };
  try {
    page.on("domcontentloaded", capture); page.on("framenavigated", navigated);
    void page.exposeBinding(binding, (_source, value: unknown) => {
      if (!active) return;
      const state = safeWalletUiState(value);
      if (state) { try { receive(state); } catch { /* Optional consumer. */ } }
    }).then(capture).catch(() => {});
  } catch { /* Optional observer setup never prevents onboarding. */ }
  return { stop() {
    active = false;
    try {
      page.off("domcontentloaded", capture); page.off("framenavigated", navigated);
      void page.evaluate(walletUiInPage, { ...options, mode: "stop" as const }).catch(() => {});
    } catch { /* Closing pages need no diagnostic cleanup. */ }
  } };
}
