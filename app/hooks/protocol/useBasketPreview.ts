"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { targetChain } from "@/app/config/chain";

import { fetchBasketPreview, type BasketPreviewRequest } from "@/app/utils/basketPreview";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { useTranslations } from "next-intl";
import { QuotePreviewError, quoteErrorMessage } from "@/app/utils/quoteErrors";
import { usePageVisible } from "@/app/hooks/usePageVisible";
import { diagnosticReferences } from "@/app/utils/diagnosticReferences";

export function useBasketPreview<M extends BasketPreviewRequest["mode"]>(
  request: Extract<BasketPreviewRequest, { mode: M }>, enabled: boolean, retry?: false,
) {
  const { addresses: { helpers: HELPERS_DIAMOND_ADDRESS }, identity } = useProtocolConfiguration();
  const generation = useSandboxForkGeneration();
  const t = useTranslations("Home");
  const client = useQueryClient();
  const visible = usePageVisible();
  const queryKey = ["basket-preview", targetChain.id, HELPERS_DIAMOND_ADDRESS, generation, request, identity];
  const serializedKey = JSON.stringify(queryKey);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchBasketPreview<M>(request, signal, fetch, identity),
    enabled: enabled && visible && Boolean(HELPERS_DIAMOND_ADDRESS), retry: retry ?? false, staleTime: Infinity,
  });
  useEffect(() => {
    if (!visible) void client.cancelQueries({ queryKey: JSON.parse(serializedKey), exact: true });
  }, [client, visible, serializedKey]);
  return { ...query, error: query.error instanceof QuotePreviewError
    ? new QuotePreviewError(query.error.code, quoteErrorMessage(query.error, t), diagnosticReferences(query.error))
    : query.error ? new Error(quoteErrorMessage(query.error, t)) : query.error };
}
