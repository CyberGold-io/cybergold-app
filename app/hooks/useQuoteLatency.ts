"use client";

import { useLayoutEffect, useRef } from "react";
import { createQuoteDisplayTiming, observeQuoteLongTasks } from "../utils/quoteLatency";
import type { DiagnosticReferences } from "../utils/diagnosticReferences";

/** Observe native edits before the existing React input/debounce handlers. */
export function useQuoteLatency(visible: boolean, references?: DiagnosticReferences, source?: "stored" | "search", full = false) {
  const clock = useRef<ReturnType<typeof createQuoteDisplayTiming> | null>(null);
  if (clock.current === null) clock.current = createQuoteDisplayTiming();
  useLayoutEffect(() => {
    const stopObservation = observeQuoteLongTasks();
    const input = (event: Event) => {
      if (event.target instanceof HTMLInputElement && event.target.matches("[data-trade-display], [data-trade-basket-input]")) clock.current?.input();
    };
    const click = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-trade-refresh]")) clock.current?.input(true);
    };
    document.addEventListener("input", input, true); document.addEventListener("click", click, true);
    return () => { document.removeEventListener("input", input, true); document.removeEventListener("click", click, true); stopObservation(); };
  }, []);
  // Layout effects run after the displayed DOM has committed, before paint.
  useLayoutEffect(() => { clock.current?.display(visible, references, source, full); });
}
