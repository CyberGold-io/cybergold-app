"use client";

import '@rainbow-me/rainbowkit/styles.css';
import {
  connectorsForWallets,
  getDefaultWallets,
  RainbowKitProvider,
} from '@rainbow-me/rainbowkit';
import { injectedWallet } from '@rainbow-me/rainbowkit/wallets';
import { cookieToInitialState, createConfig, WagmiProvider } from "wagmi";
import {
  QueryClientProvider,
  QueryClient,
} from "@tanstack/react-query";
import { CurrencyProvider } from "./context/currencyContext";
import { Toaster } from "@/components/ui/sonner";
import { targetChain } from "./config/chain";
import { useLocale } from "next-intl";
import { publicEnv } from "./config/publicEnvironment";
import { SandboxForkBoundary } from "./context/sandboxForkContext";
import { ChainHeadBoundary } from "./context/chainHeadContext";
import { useState } from "react";
import { ProtocolConfigurationProvider } from "./context/protocolConfigurationContext";
import { createAppPublicClient } from "./utils/appPublicClient";

const walletConnectProjectId = publicEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const connectors = connectorsForWallets(walletConnectProjectId ? getDefaultWallets().wallets : [
  // Direct browser wallets work locally without a relay project.
  { groupName: "Browser wallets", wallets: [injectedWallet] },
], {
  appName: "CyberGold", projectId: walletConnectProjectId ?? "",
  walletConnectParameters: { metadata: { name: "CyberGold", description: "CyberGold",
    url: typeof window !== "undefined" ? window.location.origin : "", icons: [] } },
});
const config = createConfig({
  chains: [targetChain], connectors, ssr: true,
  // Wagmi's supported client factory permits fixed product actions while
  // retaining RainbowKit's standard connector list and wallet behavior.
  client: ({ chain }) => createAppPublicClient({ chain, pollingInterval: 10_000 }),
});


function createQueryClient() { return new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
      retryDelay: () => 3_000 + Math.random() * 2_000,
    },
  },
}); }
export function Web3Providers({
  children,
  cookie,
}: {
  children: React.ReactNode;
  cookie?: string;
}) {
  const [queryClient] = useState(createQueryClient);
  const locale = useLocale();
  const walletLocale = locale === "fr" || locale === "de" || locale === "ru" ? locale : "en";
  const initialState = cookie ? cookieToInitialState(config, cookie) : undefined;

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <SandboxForkBoundary>
        <ProtocolConfigurationProvider>
        <ChainHeadBoundary>
        <CurrencyProvider>
          <RainbowKitProvider modalSize="compact" locale={walletLocale}>
            {children}
            <Toaster position="top-center" duration={5000} richColors closeButton />
          </RainbowKitProvider>
        </CurrencyProvider>
        </ChainHeadBoundary>
        </ProtocolConfigurationProvider>
        </SandboxForkBoundary>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
