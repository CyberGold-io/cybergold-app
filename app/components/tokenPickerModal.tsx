import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { FaBasketShopping } from "react-icons/fa6";
import { useIsDarkMode } from "../hooks/useIsDarkMode";
import type { TokenType } from "../types";
import { resolveTokenImagePath } from "../utils/tokenImages";
import { isAddress, getAddress, type Address } from "viem";
import type { erc20Token } from "../config/tokens";
import type { TokenMetadata } from "../utils/importedTokens";

type TokenPickerModalProps = {
    open: boolean;
    onClose: () => void;
    tokens: TokenType[];
    selectedId?: string;
    onSelect: (id: string) => void;
    triggerRef: RefObject<HTMLButtonElement | null>;
    onImport?: (address: Address, signal: AbortSignal) => Promise<{ token: erc20Token | undefined; observation: TokenMetadata }>;
    walletOnly?: boolean;
};

export function TokenPickerModal({ open, ...props }: TokenPickerModalProps) {
     if (!open) return null;

    return <TokenPickerModalContent {...props} />;
}

function TokenPickerModalContent({
    onClose,
    tokens,
    selectedId,
    onSelect,
    triggerRef,
    onImport,
    walletOnly = false,
}: Omit<TokenPickerModalProps, "open">) {
    const [query, setQuery] = useState("");
    const [imported, setImported] = useState<{ token: erc20Token | undefined; observation: TokenMetadata }>();
    const [importLoading, setImportLoading] = useState(false);
    const [importError, setImportError] = useState(false);
    const isDarkMode = useIsDarkMode();
    const t = useTranslations("Home");
    const modalRef = useRef<HTMLDivElement | null>(null);
    const searchRef = useRef<HTMLInputElement | null>(null);
    const shouldShowSearch = tokens.length > 1 || Boolean(onImport);

    const importAddress = isAddress(query.trim(), { strict: false }) ? getAddress(query.trim()) : undefined;
    const alreadyListed = importAddress && tokens.some(token => token.type === "erc20" && token.address.toLowerCase() === importAddress.toLowerCase());
    useEffect(() => {
        if (!onImport || !importAddress || alreadyListed) return;
        const controller = new AbortController();
        setImportLoading(true);
        setImportError(false);
        onImport(importAddress, controller.signal).then(value => {
            if (!controller.signal.aborted) setImported(value);
        }).catch(() => {
            if (!controller.signal.aborted) setImportError(true);
        }).finally(() => {
            if (!controller.signal.aborted) setImportLoading(false);
        });
        return () => controller.abort();
    }, [onImport, importAddress, alreadyListed]);

    useEffect(() => {
        const modal = modalRef.current;
        const trigger = triggerRef.current;
        const initialFocus = searchRef.current ?? modal?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? modal?.querySelector<HTMLButtonElement>("button") ?? modal;
        initialFocus?.focus({ preventScroll: true });
        return () => {
            if (modal?.contains(document.activeElement) || document.activeElement === document.body) {
                trigger?.focus({ preventScroll: true });
            }
        };
    }, [triggerRef, shouldShowSearch]);

    // Close modal when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) {
                onClose();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose, triggerRef]);

    const filtered = useMemo(() => {
        if (!shouldShowSearch || query.trim() === "") {
            return tokens;
        }

        const lowerQuery = query.trim().toLowerCase();
        const matches = tokens.filter((token) =>
            token.name.toLowerCase().includes(lowerQuery) ||
            token.symbol.toLowerCase().includes(lowerQuery) ||
            token.id.toLowerCase().includes(lowerQuery) ||
            (token.type === "erc20" && token.address.toLowerCase().includes(lowerQuery))
        );
        if (imported?.token && imported.token.address.toLowerCase() === importAddress?.toLowerCase() && !matches.some(token => token.id === imported.token!.id) &&
            (!walletOnly || (imported.observation.balance?.status === "success" && BigInt(imported.observation.balance.value) > 0n))) matches.push(imported.token);
        return matches;
    }, [query, shouldShowSearch, tokens, imported, importAddress, walletOnly]);

    return ( 
        <div id="dropdown-from" ref={modalRef} role="dialog" aria-label={t("chooseCurrency")} tabIndex={-1}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    triggerRef.current?.focus({ preventScroll: true });
                    onClose();
                    return;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    const options = Array.from(modalRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                    if (options.length === 0) return;
                    event.preventDefault();
                    const current = options.indexOf(document.activeElement as HTMLButtonElement);
                    const next = current < 0
                        ? event.key === "ArrowDown" ? 0 : options.length - 1
                        : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
                    options[next]?.focus();
                }
            }}
            className="absolute right-0 z-[80] mt-2 w-80 max-w-[calc(100vw-4.5rem)] sm:max-w-none rounded-2xl border border-[var(--swap-container-border)] bg-[var(--background-swap-container)] p-3 shadow-2xl">

        {/* SEARCH BAR */}
            {shouldShowSearch && (
                <div className="p-2 sm:p-5">
                    <input
                        ref={searchRef}
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setImported(undefined); setImportError(false); setImportLoading(false); }}
                        aria-label={t("searchCurrency")}
                        placeholder={t("searchCurrency")}
                        className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--swap-container-border)] rounded-xl text-base focus:outline-none focus:ring-1 focus:ring-gold-cg"
                    />
                </div>
            )} 

        {/* TOKEN LIST */}
          <div className="px-3 pb-4">
            <div className="max-h-[min(20rem,50dvh)] overflow-y-auto">
              {filtered.length === 0 ? (
                <div role="status" className="px-4 py-6 text-sm text-[var(--text-muted)]">{t(importLoading ? "importTokenLoading" : importError ? "importTokenUnavailable" :
                  imported && !imported.token ? "importTokenPrecisionUnavailable" :
                  walletOnly && imported?.observation.balance?.status === "failure" ? "importTokenBalanceUnavailable" : "noTokensFound")}</div>
              ) : (
                filtered.map((token) => {
                  const isSelected = token.id === selectedId;

                  const basketText =
                    token.type === "basket" && token.components?.length
                      ? token.components
                          .map((c) => {
                            const sym = c.token.symbol;
                            return `${(Number(c.targetWeight) * 100 / 1_000_000).toFixed(0)}% ${sym}`;
                          })
                          .join(" + ")
                      : "";

                  return (
                    <button
                      type="button"
                      key={token.id}
                      aria-pressed={isSelected}
                      onClick={() => onSelect(token.id)}
                      className={[
                        "w-full text-left",
                        "flex items-center justify-between",
                        "border border-transparent p-3 rounded-xl transition-colors",
                        "hover:bg-[rgba(223,185,65,0.1)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        isSelected ? "border-gold-cg/45 bg-transparent" : "",
                      ].join(" ")}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {token.id === "goldbasket" ? (
                          <FaBasketShopping className="text-gold-cg text-2xl" />
                        ) : (
                          <Image
                            src={resolveTokenImagePath(token.id, isDarkMode)}
                            alt={token.symbol}
                            width={28}
                            height={28}
                            className={token.id === "eth" ? "rounded-full scale-80" : "rounded-full"}
                          />
                        )}

                        <div className="min-w-0 break-words">
                          <div className="font-semibold text-[var(--text-input)]">
                            <div className="truncate" title={token.name}>{token.name}</div>
                          </div>
                            
                        {basketText ? (
                            <div className="text-sm text-[var(--text-muted)]">{basketText}</div>
                          ) : <div className="text-sm text-[var(--text-muted)]">{token.symbol}</div>
                        }
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>   
);
}
