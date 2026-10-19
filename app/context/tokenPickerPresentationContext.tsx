"use client";

import { createContext, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { usePathname } from "next/navigation";

type TokenPickerPresentation = {
  isSellModalOpen: boolean;
  setIsSellModalOpen: Dispatch<SetStateAction<boolean>>;
  isBuyModalOpen: boolean;
  setIsBuyModalOpen: Dispatch<SetStateAction<boolean>>;
};

const TokenPickerPresentationContext = createContext<TokenPickerPresentation>({
  isSellModalOpen: false,
  setIsSellModalOpen: () => {},
  isBuyModalOpen: false,
  setIsBuyModalOpen: () => {},
});

export const useTokenPickerPresentation = () => useContext(TokenPickerPresentationContext);

export function TokenPickerPresentationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [previousPathname, setPreviousPathname] = useState(pathname);
  const [isSellModalOpen, setIsSellModalOpen] = useState(false);
  const [isBuyModalOpen, setIsBuyModalOpen] = useState(false);
  if (previousPathname !== pathname) {
    setPreviousPathname(pathname);
    setIsSellModalOpen(false);
    setIsBuyModalOpen(false);
  }
  const value = useMemo(() => ({ isSellModalOpen, setIsSellModalOpen, isBuyModalOpen, setIsBuyModalOpen }),
    [isSellModalOpen, isBuyModalOpen]);

  return <TokenPickerPresentationContext.Provider value={value}>{children}</TokenPickerPresentationContext.Provider>;
}
