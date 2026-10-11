'use client';

import { useAccount } from "wagmi";
import { type Address, getAddress, isAddress } from "viem";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { resolveActiveProvider } from "../utils/ethereumProvider";
import { setWalletExplicitlyDisconnected, subscribeWalletConnectionPreference, walletExplicitlyDisconnected } from "../utils/walletConnectionPreference";

function normalizeWalletAddress(value: unknown): Address | undefined {
  if (typeof value !== "string" || !isAddress(value)) {
    return undefined;
  }

  return getAddress(value);
}

type ProviderObservation =
  | { status: "unknown" }
  | { status: "connected"; address: Address }
  | { status: "disconnected" };

export function useObservedWalletAccount() {
  const account = useAccount();
  const { address: wagmiAddress, connector, isConnected: wagmiConnected } = account;
  const explicitlyDisconnected = useSyncExternalStore(subscribeWalletConnectionPreference, walletExplicitlyDisconnected, () => false);
  const [providerObservation, setProviderObservation] = useState<ProviderObservation>({
    status: "unknown",
  });
  const [selectedProviderAddress, setSelectedProviderAddress] = useState<Address | undefined>(undefined);

  // A new connector connection is the user's return from a prior disconnect.
  useEffect(() => {
    if (wagmiConnected) setWalletExplicitlyDisconnected(false);
  }, [wagmiConnected]);

  useEffect(() => {
    let disposed = false;

    queueMicrotask(() => {
      if (disposed) {
        return;
      }

      if (wagmiAddress) {
        setProviderObservation((current) =>
          current.status === "connected" && current.address === wagmiAddress
            ? current
            : { status: "connected", address: wagmiAddress }
        );
        return;
      }

      if (!wagmiConnected) {
        setProviderObservation((current) =>
          current.status === "disconnected" ? current : { status: "disconnected" }
        );
      }
    });

    return () => {
      disposed = true;
    };
  }, [wagmiAddress, wagmiConnected]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function attachProviderListener() {
      const provider = await resolveActiveProvider(connector ?? null);
      if (disposed || !provider) {
        setProviderObservation({ status: "unknown" });
        setSelectedProviderAddress(undefined);
        return;
      }

      const syncSelectedAddress = () => {
        const nextSelectedAddress = normalizeWalletAddress(provider.selectedAddress);
        setSelectedProviderAddress((current) =>
          current === nextSelectedAddress ? current : nextSelectedAddress
        );
      };

      const applyProviderAccounts = (accounts: unknown) => {
        if (!Array.isArray(accounts)) {
          setProviderObservation({ status: "disconnected" });
          return;
        }

        const nextAddress = normalizeWalletAddress(accounts[0]);
        if (!nextAddress) {
          setProviderObservation({ status: "disconnected" });
          return;
        }

        setProviderObservation((current) =>
          current.status === "connected" && current.address === nextAddress
            ? current
            : { status: "connected", address: nextAddress }
        );
      };

      const syncFromProvider = async () => {
        try {
          syncSelectedAddress();
          const accounts = await provider.request({ method: "eth_accounts" });
          if (disposed) {
            return;
          }

          applyProviderAccounts(accounts);
        } catch (error) {
          console.warn("Unable to sync wallet account from provider", error);
        }
      };

      await syncFromProvider();

      const handleAccountsChanged = (accounts: unknown) => {
        if (disposed) {
          return;
        }

        syncSelectedAddress();
        applyProviderAccounts(accounts);
      };

      const unsubscribe =
        provider.removeListener?.bind(provider) ??
        provider.off?.bind(provider);

      provider.on?.("accountsChanged", handleAccountsChanged);
      const syncSelectedAddressOnFocus = () => {
        if (disposed) {
          return;
        }

        syncSelectedAddress();
      };

      const selectedAddressPollId = window.setInterval(syncSelectedAddressOnFocus, 800);
      window.addEventListener("focus", syncSelectedAddressOnFocus);
      document.addEventListener("visibilitychange", syncSelectedAddressOnFocus);
      cleanup = () => {
        window.clearInterval(selectedAddressPollId);
        window.removeEventListener("focus", syncSelectedAddressOnFocus);
        document.removeEventListener("visibilitychange", syncSelectedAddressOnFocus);
        unsubscribe?.("accountsChanged", handleAccountsChanged);
      };
    }

    attachProviderListener();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [connector]);

  const permittedAddress =
    providerObservation.status === "connected"
      ? providerObservation.address
      : providerObservation.status === "disconnected"
        ? undefined
        : wagmiAddress;
  const hasSelectedAddressMismatch =
    !!selectedProviderAddress &&
    !!permittedAddress &&
    selectedProviderAddress !== permittedAddress;
  const address = explicitlyDisconnected || hasSelectedAddressMismatch ? undefined : permittedAddress;
  const isConnected =
    !explicitlyDisconnected && !hasSelectedAddressMismatch &&
    (
      providerObservation.status === "connected"
        ? true
        : providerObservation.status === "disconnected"
          ? false
          : wagmiConnected && !!wagmiAddress
    );

  return useMemo(
    () => ({
      ...account,
      address,
      connector,
      isConnected,
    }),
    [account, address, connector, isConnected]
  );
}
