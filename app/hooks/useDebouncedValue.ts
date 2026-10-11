import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number, immediate = false) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [delayMs, value]);

  return immediate ? value : debouncedValue;
}
