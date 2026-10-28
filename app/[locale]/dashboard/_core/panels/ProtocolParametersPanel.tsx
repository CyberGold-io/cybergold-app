"use client";

import { InfoHint } from "./PanelPrimitives";

type ProtocolUpdateRef = {
    txHash: string | null;
} | null;

type ProtocolParametersPanelProps = {
    t: (key: string) => string;
    protocolStatusClass: string;
    protocolIsActive: boolean | null;
    isValidProtocolAddress: boolean;
    protocolAddress: string;
    protocolExplorerUrl: string;
    issuanceFeePercent: number | null;
    redemptionFeePercent: number | null;
    protocolUpdateTimestamp: string;
    parameterUpdateTimestamp: string;
    protocolLogicUpdate: ProtocolUpdateRef;
    protocolParameterUpdate: ProtocolUpdateRef;
    protocolUpdateTxUrl: string;
    parameterUpdateTxUrl: string;
    shortenAddress: (address: string) => string;
    shortenTxHash: (hash: string) => string;
    formatPercent: (valuePercent: number, fractionDigits?: number, signed?: boolean) => string;
};

export function ProtocolParametersPanel({
    t,
    protocolStatusClass,
    protocolIsActive,
    isValidProtocolAddress,
    protocolAddress,
    protocolExplorerUrl,
    issuanceFeePercent,
    redemptionFeePercent,
    protocolUpdateTimestamp,
    parameterUpdateTimestamp,
    protocolLogicUpdate,
    protocolParameterUpdate,
    protocolUpdateTxUrl,
    parameterUpdateTxUrl,
    shortenAddress,
    shortenTxHash,
    formatPercent,
}: ProtocolParametersPanelProps) {
    return (
        <div className="cg-glass px-4 py-4">
            <h3 className="text-md font-semibold text-[var(--text-input)] flex items-center gap-1">
                {t("protocolParameters")}
                <InfoHint text={t("tipProtocolParameters")} />
            </h3>
            <div className="mt-4 space-y-3 text-xs">
                <div className="flex justify-between items-center gap-4">
                    <span className="flex items-center gap-1">
                        {t("protocolStatus")}
                        <InfoHint text={t("tipProtocolStatus")} />
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${protocolStatusClass}`}>
                        {protocolIsActive === null ? "N/A" : protocolIsActive ? t("statusActive") : t("statusPaused")}
                    </span>
                </div>
                <div className="flex justify-between items-center gap-4">
                    <span className="flex items-center gap-1">
                        {t("deploymentAddress")}
                        <InfoHint text={t("tipDeploymentAddress")} />
                    </span>
                    {isValidProtocolAddress ? (
                        <a
                            href={protocolExplorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-gold-cg hover:underline"
                        >
                            {shortenAddress(protocolAddress)}
                        </a>
                    ) : (
                        <span className="font-semibold">N/A</span>
                    )}
                </div>
                <div className="flex justify-between items-center gap-4">
                    <span className="flex items-center gap-1">
                        {t("mintingFeeRate")}
                        <InfoHint text={t("tipMintingFeeRate")} />
                    </span>
                    <span className="font-semibold">{issuanceFeePercent !== null ? formatPercent(issuanceFeePercent, 2) : "N/A"}</span>
                </div>
                <div className="flex justify-between items-center gap-4">
                    <span className="flex items-center gap-1">
                        {t("redemptionFeeRate")}
                        <InfoHint text={t("tipRedemptionFeeRate")} />
                    </span>
                    <span className="font-semibold">{redemptionFeePercent !== null ? formatPercent(redemptionFeePercent, 2) : "N/A"}</span>
                </div>
                <div className="flex justify-between items-start gap-4">
                    <span className="flex items-center gap-1">
                        {t("protocolLogicUpdate")}
                        <InfoHint text={t("tipProtocolLogicUpdate")} />
                    </span>
                    <div className="flex flex-col items-end text-right">
                        <span className="font-semibold">{protocolUpdateTimestamp}</span>
                        {protocolLogicUpdate?.txHash ? (
                            <a
                                href={protocolUpdateTxUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-gold-cg hover:underline mt-0.5"
                            >
                                {t("viewUpdateTx")} ({shortenTxHash(protocolLogicUpdate.txHash)})
                            </a>
                        ) : null}
                    </div>
                </div>
                <div className="flex justify-between items-start gap-4">
                    <span className="flex items-center gap-1">
                        {t("protocolParameterUpdate")}
                        <InfoHint text={t("tipProtocolParameterUpdate")} />
                    </span>
                    <div className="flex flex-col items-end text-right">
                        <span className="font-semibold">{parameterUpdateTimestamp}</span>
                        {protocolParameterUpdate?.txHash ? (
                            <a
                                href={parameterUpdateTxUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-gold-cg hover:underline mt-0.5"
                            >
                                {t("viewUpdateTx")} ({shortenTxHash(protocolParameterUpdate.txHash)})
                            </a>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
