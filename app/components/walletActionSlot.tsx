"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

export function WalletActionSlot({ children }: { children?: ReactNode }) {
  const t = useTranslations("WalletBalances");

  return (
    <span className="inline-grid shrink-0">
      {(["import", "importing", "imported"] as const).map((label) => (
        <span key={label} aria-hidden="true"
          className="invisible col-start-1 row-start-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold">
          {t(label)}
        </span>
      ))}
      <span className="col-start-1 row-start-1 flex items-center justify-end">
        {children}
      </span>
    </span>
  );
}
