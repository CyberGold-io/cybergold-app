"use client";

import { useCallback, useState } from "react";

/** Keep display-only observations attached to their input; never feed execution. */
export function useProgressiveEstimate<T>(identity: readonly unknown[], enabled: boolean) {
  const key = JSON.stringify(identity, (_name, value) => typeof value === "bigint" ? String(value) : value);
  const [record, setRecord] = useState<{ key: string; value: T | undefined }>();
  const publish = useCallback((value: T | undefined) => setRecord({ key, value }), [key]);
  return { estimate: enabled && record?.key === key ? record.value : undefined, publish };
}
