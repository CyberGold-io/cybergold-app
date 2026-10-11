"use client";

import { useState } from "react";

/** Display continuity is independent of the existing execution readiness. */
export function useRetainedQuoteDisplay<T>(identity: readonly unknown[], value: T, status?: string, preparing = false) {
  const serialize = (item: unknown) => JSON.stringify(item, (_name, field) => typeof field === "bigint" ? String(field) : field);
  const key = serialize(identity);
  const valueKey = serialize(value);
  const [completed, setCompleted] = useState<{ key: string; valueKey: string | undefined; value: T }>();
  if (!preparing && status === "success" && (completed?.key !== key || completed.valueKey !== valueKey)) {
    setCompleted({ key, valueKey, value });
  }
  const retained = !!completed && (preparing || ((status === "loading" || status === "idle") && completed.key === key));
  return { value: retained ? completed.value : value, retained };
}
