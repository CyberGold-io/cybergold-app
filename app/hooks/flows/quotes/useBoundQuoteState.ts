"use client";

import { useCallback, useState } from "react";

/** Keep route state attached to its producing input, including before effects reset it. */
export function useBoundQuoteState<T>(identity: readonly unknown[]) {
  const key = JSON.stringify(identity, (_name, value) => typeof value === "bigint" ? String(value) : value);
  const [record, setRecord] = useState<{ key: string; value: T | undefined }>();
  const publish = useCallback((value: T | undefined) => setRecord({ key, value }), [key]);
  return [record?.key === key ? record.value : undefined, publish] as const;
}
