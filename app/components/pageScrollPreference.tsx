"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { usePathname } from "@/i18n/navigation";

function restoreScroll(key: string) {
  try {
    const position = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      window.scrollTo(position.x, position.y);
    }
  } catch { /* Native browser restoration remains available. */ }
}

/** Runs after each page's cached presentation establishes its original height. */
export function PageScrollPreference() {
  const locale = useLocale();
  const pathname = usePathname();
  const key = `cg:page-scroll:v1:${locale}:${pathname}`;
  useEffect(() => {
    const save = () => {
      try { window.sessionStorage.setItem(key, JSON.stringify({ x: window.scrollX, y: window.scrollY })); }
      catch { /* Optional UI preference. */ }
    };
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("scroll", save);
      window.removeEventListener("pagehide", save);
    };
  }, [key]);
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
    suppressHydrationWarning dangerouslySetInnerHTML={{ __html: `(${restoreScroll.toString()})(${JSON.stringify(key)});` }} />;
}
