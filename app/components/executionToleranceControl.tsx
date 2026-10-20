"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export function ExecutionToleranceControl({ value, onChange, disabled = false }: {
  value: number;
  onChange: (basisPoints: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("Home");
  // Restored preferences come from the prop; only active edits need a draft.
  const [draft, setDraft] = useState<string>();
  const update = (percent: string) => {
    setDraft(percent);
    if (percent.trim() === "") return;
    const parsed = Number(percent.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return;
    onChange(Math.round(parsed * 100));
  };

  return (
    <div className="flex items-center justify-between gap-2" data-testid="execution-tolerance-control">
      <label htmlFor="execution-tolerance" className="shrink-0 whitespace-nowrap">{t("executionTolerance")}:</label>
      <input data-trade-tolerance="range" type="range" min="0" max="1" step="0.01" value={value / 100}
        disabled={disabled} aria-label={t("executionToleranceSlider")} className="min-w-0 max-w-28 flex-1 accent-[var(--gold-cg)]"
        onChange={event => update(event.currentTarget.value)} />
      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-swap-container-border px-2 py-1 text-text-input">
        <input data-trade-tolerance="input" id="execution-tolerance" type="text" inputMode="decimal" value={draft ?? String(value / 100)}
          disabled={disabled} className="w-10 bg-transparent text-right tabular-nums outline-none sm:w-14"
          onChange={event => update(event.currentTarget.value)} onBlur={() => setDraft(undefined)} />
        <span>%</span>
      </div>
    </div>
  );
}
