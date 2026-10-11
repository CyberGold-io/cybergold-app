"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useSyncExternalStore } from "react";
import { getProtocolModel, subscribeQuoteModels } from "@/app/utils/quoteModelStore";

const empty = () => undefined;
export function useLocalBasketModel() {
  const { identity } = useProtocolConfiguration();
  return useSyncExternalStore(subscribeQuoteModels, () => getProtocolModel(identity), empty);
}
