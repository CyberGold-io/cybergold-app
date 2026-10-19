import type { Page } from "@playwright/test";

export const walletUiRoutes = ["onboarding", "confirmation", "unlock", "home", "other"] as const;
export const walletUiControlGroups = ["confirmation", "alert", "alertSubmit", "alertAcknowledge", "importWallet", "importSrp",
  "srpInput", "srpWords", "srpConfirm", "passwordInput", "passwordConfirm", "passwordTerms", "passwordSubmit", "metricsOptIn", "metricsAccept",
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
  srpInput: '[data-testid="srp-input-import__srp-note"]', srpWords: '[data-testid^="import-srp__srp-word-"]', srpConfirm: '[data-testid="import-srp-confirm"]',
  passwordInput: '[data-testid="create-password-new-input"]', passwordConfirm: '[data-testid="create-password-confirm-input"]',
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

async function readWalletPageUiState(page: Page, selectors: Partial<Record<ControlGroup, string>>): Promise<WalletUiState | undefined> {
  try {
    const path = new URL(page.url()).hash.slice(1).split("?")[0];
    const route = /^\/?onboarding(?:\/|$)/.test(path) ? "onboarding"
      : /^\/?(?:confirm|confirm-transaction|confirmation|signature-request|permissions-connect|connect)(?:\/|$)/.test(path) ? "confirmation"
      : /^\/?unlock(?:\/|$)/.test(path) ? "unlock" : path === "" || path === "/" ? "home" : "other";
    const controls: NonNullable<WalletUiState["controls"]> = {};
    // MetaMask scuttles main-world eval. Built-in locator counts run in the
    // isolated utility world without changing the wallet's security policy.
    for (const [group, selector] of Object.entries(selectors)) {
      const nodes = page.locator(selector);
      controls[group as ControlGroup] = { matched: await nodes.count(),
        visible: await nodes.and(page.locator(":visible")).count(),
        enabled: await nodes.and(page.locator(':not(:disabled):not([aria-disabled="true"], [aria-disabled="true"] *)')).count() };
    }
    return safeWalletUiState({ route, controls });
  }
  catch { /* Closed or unresponsive optional observations cannot replace a click error. */ }
}

export function readWalletUiState(page: Page): Promise<WalletUiState | undefined> {
  return readWalletPageUiState(page, confirmationControls);
}
export function readWalletOnboardingUiState(page: Page): Promise<WalletUiState | undefined> {
  return readWalletPageUiState(page, onboardingControls);
}

/** Observe only this wallet page in Playwright's isolated utility world.
 * MetaMask scuttles main-world eval, including observer/binding setup there.
 * Reads are optional, serialized and stopped with their owning fixture.
 */
export function observeWalletPageUiState(page: Page, receive: (state: WalletUiState) => void) {
  let active = true, inFlight = false, timer: ReturnType<typeof setTimeout> | undefined;
  let previous: string | undefined;
  const capture = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const state = await readWalletOnboardingUiState(page);
      if (!active || !state) return;
      const serialized = JSON.stringify(state);
      if (serialized !== previous) {
        previous = serialized;
        try { receive(state); } catch { /* Optional consumer. */ }
      }
    } catch { /* Closed or unresponsive wallet observations stay optional. */ }
    finally {
      inFlight = false;
      if (active) {
        clearTimeout(timer);
        timer = setTimeout(() => { void capture(); }, 1000);
        timer.unref?.();
      }
    }
  };
  const changed = () => { void capture(); };
  const navigated = (frame: ReturnType<Page["mainFrame"]>) => {
    if (frame === page.mainFrame()) changed();
  };
  try {
    page.on("domcontentloaded", changed); page.on("framenavigated", navigated);
    changed();
  } catch { /* Optional observer setup never prevents onboarding. */ }
  return { stop() {
    active = false; clearTimeout(timer);
    try { page.off("domcontentloaded", changed); page.off("framenavigated", navigated); }
    catch { /* Closing pages need no diagnostic cleanup. */ }
  } };
}
