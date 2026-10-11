"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useSyncExternalStore } from "react";
import { getQuoteModel, subscribeQuoteModels } from "@/app/utils/quoteModelStore";
import { modelFamily, predictIntent, type QuoteModelPacket } from "@/app/utils/quoteModels";

const empty = () => undefined;
export function useLocalQuoteModel(input: QuoteModelPacket["intent"], enabled: boolean) {
  const { identity } = useProtocolConfiguration();
  const key = modelFamily(input);
  const packet = useSyncExternalStore(subscribeQuoteModels, () => getQuoteModel(key, identity), empty);
  return enabled && packet ? predictIntent(packet, BigInt(input.amount), input.targets) : undefined;
}
