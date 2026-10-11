"use client";

import { useEffect, useRef } from "react";
import { createQuoteDiagnostics, type DiagnosticContext } from "../utils/clientDiagnostics";

export function useQuoteDiagnostics(context: DiagnosticContext | undefined, status: string | undefined) {
  const observer = useRef<ReturnType<typeof createQuoteDiagnostics> | null>(null);
  if (observer.current === null) observer.current = createQuoteDiagnostics();
  const { direction, route, inputMode, chainId, assetCount } = context ?? {};
  useEffect(() => {
    observer.current?.observe(direction ? { direction, route, inputMode, chainId, assetCount } : undefined, status);
  }, [direction, route, inputMode, chainId, assetCount, status]);
  return observer;
}
