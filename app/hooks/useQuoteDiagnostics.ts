"use client";

import { useEffect, useRef } from "react";
import { createQuoteDiagnostics, type DiagnosticContext } from "../utils/clientDiagnostics";
import type { DiagnosticReferences } from "../utils/diagnosticReferences";

export function useQuoteDiagnostics(context: DiagnosticContext | undefined, status: string | undefined, error?: unknown, metadata?: DiagnosticReferences) {
  const observer = useRef<ReturnType<typeof createQuoteDiagnostics> | null>(null);
  if (observer.current === null) observer.current = createQuoteDiagnostics();
  const serialized = JSON.stringify(context), references = JSON.stringify(metadata);
  useEffect(() => {
    observer.current?.observe(serialized ? JSON.parse(serialized) : undefined, status, error, references ? JSON.parse(references) : undefined);
  }, [serialized, references, status, error]);
  return observer;
}
