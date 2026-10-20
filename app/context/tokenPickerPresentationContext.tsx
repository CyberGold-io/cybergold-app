"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { usePathname } from "next/navigation";
import { readTokenPickerSnapshot, tokenPickerOpenStorageKey, writeTokenPickerSnapshot } from "../utils/tokenPickerSnapshot";

type TokenPickerPresentation = {
  isSellModalOpen: boolean;
  setIsSellModalOpen: Dispatch<SetStateAction<boolean>>;
  isBuyModalOpen: boolean;
  setIsBuyModalOpen: Dispatch<SetStateAction<boolean>>;
  isRestored: boolean;
};
const TokenPickerPresentationContext = createContext<TokenPickerPresentation>({
  isSellModalOpen: false, setIsSellModalOpen: () => {},
  isBuyModalOpen: false, setIsBuyModalOpen: () => {}, isRestored: false,
});
export const useTokenPickerPresentation = () => useContext(TokenPickerPresentationContext);

export function TokenPickerPresentationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<{ path: string; side?: "sell" | "buy"; restored: boolean }>({ path: pathname, restored: false });
  const persist = (side?: "sell" | "buy") => {
    try { sessionStorage.setItem(tokenPickerOpenStorageKey, JSON.stringify({ path: pathname, side })); } catch { /* optional preference */ }
  };
  useLayoutEffect(() => {
    let side: "sell" | "buy" | undefined;
    try {
      const stored = JSON.parse(sessionStorage.getItem(tokenPickerOpenStorageKey) ?? "null");
      if (stored?.path === pathname && (stored.side === "sell" || stored.side === "buy")) side = stored.side;
    } catch { /* ordinary closed picker */ }
    setState({ path: pathname, side, restored: true });
    const restore = (event: Event) => {
      const detail = (event as CustomEvent<{ side: "sell" | "buy"; open: boolean }>).detail;
      setState({ path: pathname, side: detail.open ? detail.side : undefined, restored: true });
    };
    window.addEventListener("token-picker-presentation", restore);
    return () => window.removeEventListener("token-picker-presentation", restore);
  }, [pathname]);
  const value = useMemo(() => {
    const change = (side: "sell" | "buy", update: SetStateAction<boolean>) => setState(current => {
      const open = typeof update === "function" ? update(current.path === pathname && current.side === side) : update;
      const nextSide = open ? side : current.side === side ? undefined : current.side;
      if (!open && current.side === side) {
        const snapshot = readTokenPickerSnapshot(side);
        if (snapshot) writeTokenPickerSnapshot(side, { ...snapshot, query: "", scrollTop: 0 });
      }
      persist(nextSide);
      return { path: pathname, side: nextSide, restored: true };
    });
    return { isSellModalOpen: state.path === pathname && state.side === "sell",
      isBuyModalOpen: state.path === pathname && state.side === "buy", isRestored: state.path === pathname && state.restored,
      setIsSellModalOpen: (update: SetStateAction<boolean>) => change("sell", update),
      setIsBuyModalOpen: (update: SetStateAction<boolean>) => change("buy", update) };
  // persist only writes the pathname represented by this value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, state]);
  return <TokenPickerPresentationContext.Provider value={value}>{children}</TokenPickerPresentationContext.Provider>;
}
