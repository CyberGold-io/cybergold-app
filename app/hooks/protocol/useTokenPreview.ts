"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";

import { useQuery } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";

import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { fetchTokenPreview, type TokenPreviewRequest } from "@/app/utils/tokenPreview";

export function useTokenPreview<M extends TokenPreviewRequest["mode"]>(
  request: Extract<TokenPreviewRequest, { mode: M }>, enabled: boolean,
  options: { staleTime: number },
) {
  const { helpers: HELPERS_DIAMOND_ADDRESS } = useProtocolConfiguration().addresses;
  const generation = useSandboxForkGeneration();
  return useQuery({
    queryKey: ["token-preview", targetChainId, HELPERS_DIAMOND_ADDRESS, generation, request],
    queryFn: ({ signal }) => fetchTokenPreview<M>(request, signal), enabled: enabled && Boolean(HELPERS_DIAMOND_ADDRESS), retry: false,
    staleTime: options.staleTime,
  });
}
