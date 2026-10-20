"use client";

import { ConnectButton, useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useDisconnect, useSwitchChain } from "wagmi";
import { resolveActiveProvider, type EthereumProvider } from "../utils/ethereumProvider";
import { useObservedWalletAccount } from "../hooks/useObservedWalletAccount";
import { WalletBalanceModal } from "./walletBalanceModal";
import { WalletDisplayBootstrap, clearWalletPresentation } from "./walletDisplayBootstrap";
import { walletConnectedPillClass, walletPillBaseClass } from "./walletPresentation";
import { setWalletExplicitlyDisconnected } from "../utils/walletConnectionPreference";
import { closedWalletPanelState, setWalletPanelOpen, subscribeWalletPanel, walletPanelState } from "../utils/walletPanelState";
import {
  addEthereumChainParameter,
  canAddTargetChainWithCurrentWalletRpcUrl,
  targetBlockExplorerUrl,
  targetChain,
  targetChainHex,
  targetChainName,
  targetWalletRpcUrl,
} from "../config/chain";

type Eip1193Error = {
  code?: number;
  name?: string;
  message?: string;
  shortMessage?: string;
  cause?: unknown;
  data?: {
    originalError?: {
      code?: number;
    };
  };
};

function isUserRejectedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as Eip1193Error;
  if (
    candidate.code === 4001 ||
    candidate.name === "UserRejectedRequestError" ||
    candidate.data?.originalError?.code === 4001
  ) {
    return true;
  }

  return isUserRejectedError(candidate.cause);
}

async function switchOrAddChain(provider: EthereumProvider) {
  const normalizedTargetChainId = targetChainHex.toLowerCase();
  const initialChainId = await provider.request({ method: "eth_chainId" });

  console.log("[wallet-switch] requested-target", {
    chainIdHex: targetChainHex,
    chainName: targetChainName,
    walletRpcUrl: targetWalletRpcUrl,
    blockExplorerUrl: targetBlockExplorerUrl,
    initialChainId,
  });

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainHex }],
    });
  } catch (err) {
    const switchError = err as Eip1193Error;
    console.error("[wallet-switch] switch-error", {
      code: switchError.code,
      error: err,
    });
    if (switchError.code !== 4902 && switchError.code !== 4901) {
      throw err;
    }

    console.log("[wallet-switch] adding-chain", {
      chainIdHex: targetChainHex,
      chainName: targetChainName,
      walletRpcUrl: targetWalletRpcUrl,
      blockExplorerUrl: targetBlockExplorerUrl,
    });
    if (!canAddTargetChainWithCurrentWalletRpcUrl) {
      throw new Error(
        `MetaMask requires an HTTPS RPC URL to add remote networks. Configure NEXT_PUBLIC_WALLET_RPC_URL with an HTTPS endpoint for ${targetChainName}. Current value: ${targetWalletRpcUrl}`,
      );
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: targetChainHex,
          chainName: targetChainName,
          rpcUrls: [targetWalletRpcUrl],
          nativeCurrency: {
            name: "Ether",
            symbol: "ETH",
            decimals: 18,
          },
          ...(targetBlockExplorerUrl ? { blockExplorerUrls: [targetBlockExplorerUrl] } : {}),
        },
      ],
    });

    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainHex }],
    });
  }

  const activeChainId = await provider.request({ method: "eth_chainId" });
  console.log("[wallet-switch] active-chain-after-switch", {
    activeChainId,
    normalizedTargetChainId,
  });
  if (typeof activeChainId !== "string" || activeChainId.toLowerCase() !== normalizedTargetChainId) {
    throw new Error(`Wallet did not switch to target chain ${targetChainHex}. Current chain: ${String(activeChainId)}`);
  }
}

export function WalletConnectButton() {
  return <WalletDisplayBootstrap><WalletConnectControl /></WalletDisplayBootstrap>;
}

function WalletConnectControl() {
  const t = useTranslations("WalletMenu");
  const balanceT = useTranslations("WalletBalances");
  const balanceReturnFocusRef = useRef<HTMLButtonElement>(null);
  const unsupportedWalletButtonClass = `${walletPillBaseClass} border-red-500 bg-red-500 font-semibold text-white hover:bg-red-600`;
  const { isOpen: showBalances, hasOpened: hasOpenedBalances } = useSyncExternalStore(
    subscribeWalletPanel, walletPanelState, closedWalletPanelState
  );
  const [isSwitchingNetwork, setIsSwitchingNetwork] = useState(false);
  const [isDisconnectingWallet, setIsDisconnectingWallet] = useState(false);
  const { address, connector, isConnected: observedIsConnected } = useObservedWalletAccount();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const { chainModalOpen } = useChainModal();
  const handleSwitchOrAddNetwork = async () => {
    try {
      setIsSwitchingNetwork(true);
      console.log("[wallet-switch] requested-via-connector", {
        chainId: targetChain.id,
      });

      try {
        if (canAddTargetChainWithCurrentWalletRpcUrl) {
          await switchChainAsync({
            chainId: targetChain.id,
            addEthereumChainParameter,
          });
        } else {
          await switchChainAsync({
            chainId: targetChain.id,
          });
        }
        return;
      } catch (error) {
        if (isUserRejectedError(error)) {
          return;
        }

        console.warn("[wallet-switch] connector-switch-failed-falling-back", error);
      }

      const provider = await resolveActiveProvider(connector ?? null);
      if (!provider) {
        throw new Error("No active wallet provider was found.");
      }

      console.log("[wallet-switch] provider-resolved");
      await switchOrAddChain(provider);
    } catch (error) {
      console.error("Network switch/add failed", error);
      if (!isUserRejectedError(error)) {
        toast.error(t("networkFailed"), {
          description: t("networkFailedDescription", { network: targetChain.name }),
        });
      }
    } finally {
      setIsSwitchingNetwork(false);
    }
  };

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openChainModal,
        authenticationStatus,
        mounted,
      }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected =
          ready &&
          account &&
          chain &&
          observedIsConnected &&
          (!authenticationStatus ||
            authenticationStatus === "authenticated");
        const connectedAddressLabel =
          address ? `${address.slice(0, 6)}...${address.slice(-4)}` : account?.displayName;
        const isUnsupportedChain = !!chain?.unsupported;

        const handleDisconnectWallet = async () => {
          try {
            setIsDisconnectingWallet(true);
            setWalletPanelOpen(false);
            clearWalletPresentation();
            await disconnectAsync();
            setWalletExplicitlyDisconnected(true);
          } catch (error) {
            console.error("Wallet disconnect failed", error);
            toast.error(t("disconnectFailed"), {
              description: t("disconnectFailedDescription"),
            });
          } finally {
            setIsDisconnectingWallet(false);
          }
        };
        return (
          <div data-wallet-disconnecting={isDisconnectingWallet || undefined}>
            {/* Not connected */}
            {!connected && (
              <button
                type="button"
                onClick={openConnectModal}
                className="px-3 py-1.5 rounded-full border border-gold-cg bg-gold-cg text-[15px] text-zinc-950 font-semibold transition-transform duration-200 hover:scale-102 shadow-md hover:shadow-lg"
                >
                  <span className="min-[1025px]:hidden">{t("connect")}</span>
                  <span className="hidden min-[1025px]:inline">{t("connectWallet")}</span>
              </button>
            )}

            {/* Wrong network */}
            {/* Connected wallet controls */}
            {connected && (
              <div className="flex items-center gap-2 relative">
                {isUnsupportedChain && (
                  <button
                    type="button"
                    onClick={handleSwitchOrAddNetwork}
                    data-wallet-network-switch
                    disabled={isSwitchingNetwork}
                    className={unsupportedWalletButtonClass}
                  >
                    {isSwitchingNetwork ? t("updatingNetwork") : t("useNetwork", { network: targetChainName })}
                  </button>
                )}
                  <button
                    type="button"
                    onClick={() => setWalletPanelOpen(!walletPanelState().isOpen)}
                    data-wallet-connected-button
                    data-wallet-address={address?.toLowerCase()}
                    aria-expanded={showBalances}
                    className={walletConnectedPillClass(showBalances)}
                    aria-label={showBalances ? balanceT("close") : t("menu")}
                    ref={balanceReturnFocusRef}
                  >
                    <span className="text-[15px] min-[1025px]:font-semibold">{connectedAddressLabel}</span>
                  </button>

              </div>
            )}
            {/* Preserve pending faucet request identity after the first opening. */}
            {hasOpenedBalances && (
              <WalletBalanceModal isOpen={showBalances} onClose={() => setWalletPanelOpen(false)} returnFocusRef={balanceReturnFocusRef}
                onDisconnect={() => void handleDisconnectWallet()} isDisconnecting={isDisconnectingWallet}
                networkName={chain?.name ?? targetChainName}
                isNetworkChooserOpen={chainModalOpen}
                onNetworkChange={openChainModal} />
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
