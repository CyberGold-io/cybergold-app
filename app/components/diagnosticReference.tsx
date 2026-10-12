"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export function DiagnosticReference({ reference }: { reference?: string }) {
  const t = useTranslations("Home"), [copied, setCopied] = useState(false);
  if (!reference) return null;
  return <div data-testid="diagnostic-reference" className="mt-2 text-xs text-text-muted">
    <p className="break-all select-text">{t("diagnosticReference", { reference })}</p>
    <button type="button" className="mt-1 underline" onClick={() => {
      try { void navigator.clipboard.writeText(reference).then(() => setCopied(true)).catch(() => setCopied(false)); }
      catch { setCopied(false); }
    }}>{t(copied ? "diagnosticReferenceCopied" : "copyDiagnosticReference")}</button>
  </div>;
}
