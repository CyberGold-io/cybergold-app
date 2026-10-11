"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";

type GovernanceAccessGateProps = {
  isLoading: boolean;
  isConnected: boolean;
  hasAccess: boolean;
  children: ReactNode;
};

export function GovernanceAccessGate({
  isLoading,
  isConnected,
  hasAccess,
  children,
}: GovernanceAccessGateProps) {
  const t = useTranslations("Governance");

  if (isLoading) {
    return (
      <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4 text-[var(--text-muted)]">
        {t("checkingAccess")}
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4 text-[var(--text-muted)]">
        <p className="font-semibold text-[var(--text-input)]">{t("connectTitle")}</p>
        <p className="mt-1 text-sm">{t("connectDescription")}</p>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="bg-[var(--background-swap-container)] border border-[var(--swap-container-border)] rounded-lg px-4 py-4 text-[var(--text-muted)]">
        <p className="font-semibold text-[var(--text-input)]">{t("deniedTitle")}</p>
        <p className="mt-1 text-sm">{t("deniedDescription")}</p>
      </div>
    );
  }

  return <>{children}</>;
}
