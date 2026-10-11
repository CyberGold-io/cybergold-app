"use client";

import { FaCircleInfo } from "react-icons/fa6";

type InfoHintProps = {
    text: string;
};

export function InfoHint({ text }: InfoHintProps) {
    return (
        <span className="inline-flex items-center text-[var(--text-muted)] cursor-help" title={text} aria-label={text}>
            <FaCircleInfo className="text-[11px]" />
        </span>
    );
}

export type DualLineValueProps = {
    primary: string;
    secondary: string;
    align?: "left" | "right";
    primaryClassName?: string;
    secondaryClassName?: string;
};

export function DualLineValue({
    primary,
    secondary,
    align = "left",
    primaryClassName = "",
    secondaryClassName = "",
}: DualLineValueProps) {
    return (
        <div className={`flex flex-col ${align === "right" ? "items-end text-right" : "items-start"}`}>
            <span className={primaryClassName}>{primary}</span>
            <span className={secondaryClassName}>{secondary}</span>
        </div>
    );
}
