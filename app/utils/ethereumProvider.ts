export type EthereumRequestArgs = {
  method: string;
  params?: unknown;
};

export type EthereumProvider = {
  request: (args: EthereumRequestArgs) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  selectedAddress?: string | null;
  isMetaMask?: boolean;
  providers?: EthereumProvider[];
};

export async function resolveActiveProvider(
  connector: { getProvider?: () => Promise<unknown> } | null
): Promise<EthereumProvider | undefined> {
  if (connector?.getProvider) {
    const connectorProvider = await connector.getProvider();
    if (
      connectorProvider &&
      typeof connectorProvider === "object" &&
      "request" in connectorProvider &&
      typeof (connectorProvider as { request?: unknown }).request === "function"
    ) {
      return connectorProvider as EthereumProvider;
    }
  }

  const injected = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  if (!injected) return undefined;

  if (Array.isArray(injected.providers) && injected.providers.length > 0) {
    const metaMaskProvider = injected.providers.find((provider: EthereumProvider) => provider?.isMetaMask);
    return metaMaskProvider ?? injected.providers[0];
  }

  return injected;
}

export function resolveInjectedProvider(): EthereumProvider | undefined {
  const injected = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  if (!injected) return undefined;

  if (Array.isArray(injected.providers) && injected.providers.length > 0) {
    const metaMaskProvider = injected.providers.find((provider: EthereumProvider) => provider?.isMetaMask);
    return metaMaskProvider ?? injected.providers[0];
  }

  return injected;
}
